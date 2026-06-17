import OpenAI from 'openai';
import config from '../config/index.js';
import { logCost } from '../utils/openai-cost.js';

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
    const userPrompt = this.buildUserPrompt(pdfUrls.length);

    const content = [
      { type: 'input_text', text: `${systemPrompt}\n\n${userPrompt}` },
      ...pdfUrls.map((url) => ({ type: 'input_file', file_url: url })),
    ];

    try {
      const response = await this.client.responses.create({
        model: config.openai.gpt5model,
        input: [{ role: 'user', content }],
      });

      logCost(
        `Client PDF extraction (${pdfUrls.length} file${pdfUrls.length === 1 ? '' : 's'})`,
        config.openai.gpt5model,
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

  buildUserPrompt(fileCount = 1) {
    if (fileCount <= 1) {
      return `The attached PDF is the source document. Read all pages, including any handwritten or scanned content, and extract the patient information per the system instructions. Return JSON only.`;
    }
    return `${fileCount} PDFs are attached. They all belong to the SAME single patient. Read every page of every file (including handwritten or scanned content), merge all patient information across the files into ONE patient object, and extract per the system instructions. Return JSON only.`;
  }
}

export const openaiClientService = new OpenAIClientService();
export default openaiClientService;
