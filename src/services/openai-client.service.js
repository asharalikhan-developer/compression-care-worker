import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdf as renderPdf } from 'pdf-to-img';
import config from '../config/index.js';
import { logCost } from '../utils/openai-cost.js';
import { getFileInputModel } from './runtime-settings.js';

// ── Document routing (one request mixes both input types) ─────────────────────
// A page needs at least this many non-space chars to count as having a usable
// text layer. A PDF where NO page clears this bar is treated as scanned/fax and
// sent as FILE input; otherwise it is digital → its text layer is sent as text
// and only its form/checkbox pages (AcroForm widgets) are rendered to images.
const MIN_PAGE_TEXT_CHARS = 15;
// Scale at which digital form pages are rasterized (higher = sharper checkboxes).
const RENDER_SCALE = 3;

class OpenAIClientService {
  constructor() {
    this.client = null;
  }

  initialize() {
    if (this.client) return this;
    if (!config.openai.apiKey) {
      throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in .env file');
    }
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
    console.log('✅ OpenAI client (PDF-URL) service initialized');
    return this;
  }

  async extractPatientFromPdfUrl(pdfUrl) {
    return this.extractPatientFromPdfUrls([pdfUrl]);
  }

  async extractPatientFromPdfUrls(pdfUrls) {
    if (!this.client) this.initialize();
    if (!Array.isArray(pdfUrls) || pdfUrls.length === 0) {
      throw new Error('pdfUrls must be a non-empty array');
    }

    const systemPrompt = this.buildSystemPrompt();

    // Build ONE request that mixes both input types across all PDFs:
    //   • digital PDF → its text layer (input_text) + images of its form/
    //     checkbox pages (input_image)
    //   • scanned/fax PDF (no text layer) → the whole file (input_file / file_url)
    const textSections = [];
    const imageBlocks = [];
    const fileBlocks = [];
    let digitalCount = 0;
    let faxCount = 0;

    for (let i = 0; i < pdfUrls.length; i++) {
      const doc = await this.#buildDocInput(pdfUrls[i], i + 1);
      if (doc.textSection) textSections.push(doc.textSection);
      for (const dataUri of doc.images) imageBlocks.push({ type: 'input_image', image_url: dataUri });
      if (doc.fileBlock) fileBlocks.push(doc.fileBlock);
      if (doc.kind === 'fax') faxCount++;
      else digitalCount++;
    }

    const userPrompt = this.buildUserPrompt(pdfUrls.length, digitalCount, faxCount);
    const textBlob = textSections.length
      ? `\n\nEXTRACTED TEXT OF DIGITAL DOCUMENT(S):\n\n${textSections.join('\n\n')}`
      : '';

    const content = [
      { type: 'input_text', text: `${systemPrompt}\n\n${userPrompt}${textBlob}` },
      ...imageBlocks, // digital form pages
      ...fileBlocks, // scanned/fax whole files
    ];

    const model = getFileInputModel() || config.openai.gpt5model;
    try {
      const response = await this.client.responses.create({
        model,
        input: [{ role: 'user', content }],
      });

      logCost(
        `Client PDF extraction (${pdfUrls.length} file${pdfUrls.length === 1 ? '' : 's'}: ` +
          `${digitalCount} digital + ${faxCount} fax, ${imageBlocks.length} image${imageBlocks.length === 1 ? '' : 's'})`,
        model,
        response.usage,
      );

      const raw = response.output_text;
      if (!raw) throw new Error('No response from OpenAI Response API');

      return JSON.parse(raw);
    } catch (error) {
      console.error('OpenAI client extraction error:', error.message);
      throw new Error(`Failed to extract patient from PDF URLs: ${error.message}`);
    }
  }

  /**
   * Classify one PDF and turn it into model input for the shared request:
   *   • fax / fully scanned (no text layer) → { kind:'fax', fileBlock:{ input_file, file_url } }
   *   • digital (has a text layer)          → { kind:'digital', textSection, images[] }
   *       text  = every page's text layer (exact typed content, cheap tokens)
   *       images = only the form/checkbox pages (AcroForm widgets), rendered so
   *                gpt-5.5 can read what is ticked
   * On any parse failure, degrade to sending the raw file (file_url).
   */
  async #buildDocInput(url, docNo) {
    const filename = (() => {
      try { return new URL(url).pathname.split('/').pop() || 'document.pdf'; }
      catch { return 'document.pdf'; }
    })();

    try {
      const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
      const pages = await this.#analyzePages(buffer); // [{ n, text, widgets }]
      const hasTextLayer = pages.some(
        (p) => p.text.replace(/\s/g, '').length >= MIN_PAGE_TEXT_CHARS,
      );

      // No usable text anywhere → scanned/fax → let gpt-5.5 read the whole file.
      if (!hasTextLayer) {
        console.log(`  📠 ${filename}: scanned/fax → file input`);
        return { kind: 'fax', images: [], fileBlock: { type: 'input_file', file_url: url } };
      }

      // Digital → text for every page + images of the form/checkbox pages only.
      const formPages = pages.filter((p) => p.widgets > 0).map((p) => p.n);
      const formSet = new Set(formPages);
      const images = [];
      if (formPages.length > 0) {
        console.log(`  🗂️  ${filename}: digital, imaging form page(s) ${formPages.join(', ')}`);
        const rendered = await renderPdf(buffer, {
          scale: RENDER_SCALE,
          docInitParams: { verbosity: pdfjsLib.VerbosityLevel.ERRORS }, // silence benign pdfjs warnings
        });
        let n = 0;
        for await (const png of rendered) {
          n++;
          if (formSet.has(n)) images.push(`data:image/png;base64,${png.toString('base64')}`);
        }
      } else {
        console.log(`  📄 ${filename}: digital, text only (no form pages)`);
      }

      const body = pages
        .map((p) => `--- Page ${p.n}${formSet.has(p.n) ? ' (form image attached)' : ''} ---\n${p.text || '(no text)'}`)
        .join('\n\n');
      return {
        kind: 'digital',
        textSection: `===== DOCUMENT ${docNo}: ${filename} =====\n${body}`,
        images,
      };
    } catch (err) {
      console.warn(`  ⚠️ Could not parse ${filename} (${err.message}); sending raw file URL`);
      return { kind: 'fax', images: [], fileBlock: { type: 'input_file', file_url: url } };
    }
  }

  /**
   * Per page: pull the text layer and count AcroForm widgets.
   * @returns {Promise<Array<{ n:number, text:string, widgets:number }>>}
   */
  async #analyzePages(buffer) {
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS, // silence benign pdfjs warnings
    }).promise;

    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);

      const tc = await page.getTextContent();
      const text = tc.items.map((it) => it.str).join(' ').replace(/[ \t]+/g, ' ').trim();

      let widgets = 0;
      try {
        const annots = await page.getAnnotations();
        widgets = annots.filter((a) => a.subtype === 'Widget').length;
      } catch { /* best-effort */ }

      pages.push({ n, text, widgets });
    }

    if (typeof doc.cleanup === 'function') await doc.cleanup();
    return pages;
  }

  buildSystemPrompt() {
    return `You are a medical document analyzer specialized in extracting structured patient information from healthcare documents, referrals, prescriptions, and compression-garment orders.

ABBREVIATIONS & ROLE MAPPINGS:
- "PT" or "P.T." or "Physical Therapist" refers to the therapist. Map to the "therapist" fields.
- "MD", "PCP", "Referring Physician", "Primary Care Physician", or "Doctor" refers to the primary_care_physician. Map to the "primary_care_physician" fields.

The input is one or more PDFs (medical referrals, prescriptions, intake forms, lab results, etc.) — all belonging to the SAME single patient. There is exactly ONE patient — never multiple. Collect that single patient's details from anywhere across ALL provided documents and merge every field into one patient object.

CHECKBOX ORDER FORMS (very important):
Some documents are compression-garment order forms with many checkboxes (Material, Compression / CCL, Colors, Qty, Side, Handpiece, Style, Proximal Ending, Topband, Accessories, etc.). These define the product_ordered.

- A checkbox is CHECKED when the box is filled/solid/marked: ■, ☑, ☒, ✔, ✗, X, a hand-drawn tick, or any visibly filled square.
- A checkbox is UNCHECKED when the box is empty/outlined: □, ☐, ◻.
- ONLY include CHECKED options in product_ordered. NEVER include unchecked options. Do not guess.
- If the same group has multiple checked boxes (e.g. both "mondi esprit 350 SL glove" and "mondi esprit 350" under Material), include both.
- For grids/tables (e.g. CCL 1 / CCL 2 / CCL 3 across rows like "Hand piece" and "Arm Sleeve"), read the checked column per row and report it as "Hand piece: CCL 2", "Arm Sleeve: CCL 2", etc.
- Capture handwritten quantities and free-text fields next to a label (e.g. "hand pcs: 2", "arm pcs: 2").
- Compose product_ordered as a single human-readable string that concatenates the brand/material, compression level, side, color(s), style, quantities, and any accessory selections — only the ones that are checked or filled in.
- If a checkbox state is genuinely ambiguous (smudge, partially marked, unclear scan), add a note to extraction_warnings and lean toward leaving it OUT of product_ordered.

Return ONLY this JSON shape:
{
  "type": "patient",
  "patient": {
    "source": "string (e.g., 'pdf')",
    "patient_first_name": "string or null",
    "patient_middle_name": "string or null",
    "patient_last_name": "string or null",
    "patient_address": "string or null",
    "patient_gender": "string or null",
    "patient_date_of_birth": "string or null (format: YYYY-MM-DD if possible)",
    "patient_email_address": "string or null",
    "primary_insurance": {
      "id_number": "string or null (also: Member ID, Member #, Subscriber ID)",
      "name": "string or null",
      "group_number": "string or null (also: Group, Group #, Grp #, Plan ID)"
    },
    "secondary_insurance": {
      "id_number": "string or null",
      "name": "string or null",
      "group_number": "string or null"
    },
    "tertiary_insurance": {
      "id_number": "string or null",
      "name": "string or null",
      "group_number": "string or null"
    },
    "product_ordered": "string or null",
    "therapist": {
      "first_name": "string or null",
      "last_name": "string or null",
      "email_address": "string or null"
    },
    "primary_care_physician": {
      "first_name": "string or null",
      "last_name": "string or null"
    },
    "others": ["array of strings — any extra info present in the document that doesn't fit the fields above (e.g., 'Allergies: latex', 'Height: 5\\'9\"', 'Preferred contact: text')"],
    "confidence_score": "number 0-100 — your self-rated confidence in the overall accuracy of this patient extraction",
    "extraction_warnings": ["array of any issues or uncertainties encountered"]
  }
}

Rules:
1. There is exactly ONE patient — merge all patient details into the single "patient" object.
2. Extract all available information; use null for missing fields.
3. Be precise with medical terminology and codes.
4. If text is unclear or partially legible, note it in extraction_warnings.
5. Normalize dates to YYYY-MM-DD where possible.
6. If secondary or tertiary insurance are not explicitly present, set them to null and do NOT copy from primary insurance.
7. Set "others" to any useful info that doesn't fit a defined field (allergies, height, weight, language preference, preferred contact, notes, etc.). Each entry is a single plain-text string. Return [] if nothing extra was found.
8. Set "confidence_score" to an integer from 0 to 100 representing your overall confidence in this extraction. Lower it when key fields are missing or unclear; raise it when most fields are unambiguous. Be honest.
9. Always return valid JSON matching the schema above. No commentary, no markdown, JSON only.`;
  }

  buildUserPrompt(fileCount = 1, digitalCount = 0, faxCount = 0) {
    const parts = [];
    parts.push(
      fileCount <= 1
        ? 'You are given ONE source document.'
        : `You are given ${fileCount} source documents — they ALL belong to the SAME single patient. Merge every detail across them into ONE patient object.`,
    );
    if (digitalCount > 0) {
      parts.push(
        'For DIGITAL documents you are given their extracted TEXT (below) plus IMAGES of their ' +
          'form/checkbox pages. Use the TEXT for typed fields (names, dates, insurance, addresses) ' +
          'and the IMAGES to read which checkboxes/options are actually marked and any handwritten ' +
          'values. Where the text and the image disagree on a checkbox, TRUST THE IMAGE.',
      );
    }
    if (faxCount > 0) {
      parts.push(
        'Scanned/fax documents are attached as FILES — read every page of them directly, including handwritten content.',
      );
    }
    parts.push('Extract per the system instructions. Return JSON only.');
    return parts.join(' ');
  }
}

export const openaiClientService = new OpenAIClientService();
export default openaiClientService;
