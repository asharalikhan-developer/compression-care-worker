import OpenAI from 'openai';
import { Mistral } from '@mistralai/mistralai';
import config from '../config/index.js';
import { logCost } from '../utils/openai-cost.js';

// Chat model that turns the OCR markdown into structured JSON.
const CHAT_MODEL = 'gpt-4.1-mini';

// Mistral OCR pricing (https://mistral.ai/pricing):
//   standard:  $4 / 1000 pages  => $0.004 / page
//   batch API: $2 / 1000 pages  => $0.002 / page (50% off)
const OCR_PRICE_PER_PAGE = 0.004;
const OCR_PRICE_PER_PAGE_BATCH = 0.002;

// Words Mistral OCR transcribes with a confidence below this (0–1) are surfaced
// as "OCR was unsure about this value" so a reviewer can verify them.
const OCR_LOW_CONF_BELOW = 0.85;

/**
 * Alternative client-PDF extractor.
 *
 * Pipeline:  PDF  ──(Mistral Document AI OCR)──▶  Markdown  ──(GPT-4o-mini)──▶  JSON
 *
 * Why two stages instead of sending the PDF straight to a vision model:
 * Mistral OCR renders the document and transcribes it (tables, checkboxes,
 * handwriting) into clean Markdown. We then hand that text to a cheap chat
 * model for the structured extraction, so the expensive vision pass is done
 * once by a model purpose-built for it.
 *
 * NOTE: Mistral OCR processes ONE document per `ocr.process` call. To OCR many
 * PDFs at once cheaply (50% off) use `ocrBatch()` — but that is async/offline
 * (submit job → poll → download), not suited to real-time per-email work.
 */
class OpenAIClientService2 {
  constructor() {
    this.openai = null;
    this.mistral = null;
  }

  initialize() {
    if (this.openai && this.mistral) return this;
    if (!config.openai.apiKey) {
      throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in .env');
    }
    if (!config.mistral.apiKey) {
      throw new Error('Mistral API key is not configured. Please set MISTRAL_API_KEY in .env');
    }
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    this.mistral = new Mistral({ apiKey: config.mistral.apiKey });
    console.log('✅ OpenAI+Mistral client (OCR→GPT) service initialized');
    return this;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OCR (one document per call)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Run Mistral OCR on a single document and return its Markdown.
   * @param {{ url?: string, base64?: string }} doc - pass a public URL or raw base64 PDF
   * @returns {Promise<{ markdown: string, pages: number }>}
   */
  async ocrDocument({ url, base64 } = {}) {
    if (!this.mistral) this.initialize();
    if (!url && !base64) throw new Error('ocrDocument requires either a url or base64');

    const documentUrl = url || `data:application/pdf;base64,${base64}`;

    const res = await this.mistral.ocr.process({
      model: config.mistral.ocrModel, // 'mistral-ocr-latest'
      document: { type: 'document_url', documentUrl },
      includeImageBase64: false,
      // header/footer extraction requires OCR 2512+; harmless on latest.
      extractHeader: true,
      extractFooter: true,
      confidenceScoresGranularity: 'page',
    });

    const pages = res.pages || [];
    const markdown = pages
      .map((p) => p.markdown || '')
      .join('\n\n---\n\n')
      .trim();

    const pageCount = res.usageInfo?.pagesProcessed ?? pages.length;
    console.log(
      `  📝 Mistral OCR: ${pageCount} page(s), ${markdown.length} chars — ` +
        `cost ≈ $${(pageCount * OCR_PRICE_PER_PAGE).toFixed(5)}`,
    );

    return { markdown, pages: pageCount };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Structured extraction (markdown → JSON via GPT-4o-mini)
  // ──────────────────────────────────────────────────────────────────────────

  async extractPatientFromMarkdown(markdown, docCount = 1) {
    if (!this.openai) this.initialize();
    if (!markdown || !markdown.trim()) {
      throw new Error('extractPatientFromMarkdown received empty markdown');
    }

    const response = await this.openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0, // deterministic structured extraction — avoids run-to-run drift
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: this.buildUserPrompt(markdown, docCount) },
      ],
    });

    logCost(`OCR→GPT extraction (${docCount} doc${docCount === 1 ? '' : 's'})`, CHAT_MODEL, response.usage);

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) throw new Error('No response from OpenAI chat completion');
    return JSON.parse(raw);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API — mirrors openai-client.service.js so it's a drop-in
  // ──────────────────────────────────────────────────────────────────────────

  async extractPatientFromPdfUrl(pdfUrl) {
    return this.extractPatientFromPdfUrls([pdfUrl]);
  }

  /**
   * OCR each PDF (sequentially, one per call), concatenate the Markdown, then
   * run a single GPT-4o-mini extraction over the combined text.
   */
  async extractPatientFromPdfUrls(pdfUrls) {
    if (!this.openai || !this.mistral) this.initialize();
    if (!Array.isArray(pdfUrls) || pdfUrls.length === 0) {
      throw new Error('pdfUrls must be a non-empty array');
    }

    try {
      const sections = [];
      for (let i = 0; i < pdfUrls.length; i++) {
        const { markdown } = await this.ocrDocument({ url: pdfUrls[i] });
        sections.push(`# DOCUMENT ${i + 1}\n\n${markdown}`);
      }
      const combined = sections.join('\n\n========================\n\n');

      return await this.extractPatientFromMarkdown(combined, pdfUrls.length);
    } catch (error) {
      console.error('OCR→GPT client extraction error:', error.message);
      throw new Error(`Failed to extract patient via Mistral OCR: ${error.message}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Optional: batch OCR (offline / bulk, 50% cheaper)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Submit many documents as a single Mistral batch OCR job (50% off:
   * ~$0.002/page). This is ASYNCHRONOUS — it returns a batch job id; results
   * become available later and must be downloaded. Use for backfills/bulk, not
   * real-time per-email processing.
   *
   * @param {Array<{ id: string, url?: string, base64?: string }>} items
   * @returns {Promise<{ jobId: string }>}
   */
  async ocrBatchSubmit(items) {
    if (!this.mistral) this.initialize();
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('ocrBatchSubmit requires a non-empty items array');
    }

    // 1) Build the JSONL body — one line per request, each with a custom_id.
    const jsonl = items
      .map((it) =>
        JSON.stringify({
          custom_id: it.id,
          body: {
            model: config.mistral.ocrModel,
            document: {
              type: 'document_url',
              documentUrl: it.url || `data:application/pdf;base64,${it.base64}`,
            },
            include_image_base64: false,
          },
        }),
      )
      .join('\n');

    // 2) Upload the JSONL as a batch input file.
    const file = await this.mistral.files.upload({
      file: { fileName: `ocr-batch-${Date.now()}.jsonl`, content: Buffer.from(jsonl, 'utf-8') },
      purpose: 'batch',
    });

    // 3) Create the batch job against the OCR endpoint.
    const job = await this.mistral.batch.jobs.create({
      inputFiles: [file.id],
      model: config.mistral.ocrModel,
      endpoint: '/v1/ocr',
      timeoutHours: 24,
    });

    console.log(
      `  📦 Batch OCR submitted: job ${job.id}, ${items.length} doc(s) ` +
        `— est. ≤ $${(items.length * OCR_PRICE_PER_PAGE_BATCH).toFixed(5)} (assuming 1 page/doc)`,
    );
    return { jobId: job.id };
  }

  /** Poll a batch job and, when finished, return parsed OCR results keyed by custom_id. */
  async ocrBatchResults(jobId) {
    if (!this.mistral) this.initialize();
    const job = await this.mistral.batch.jobs.get({ jobId });
    if (job.status !== 'SUCCESS') {
      return { status: job.status, results: null };
    }
    const stream = await this.mistral.files.download({ fileId: job.outputFile });
    const text = await streamToString(stream);
    const results = {};
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const pages = row.response?.body?.pages || [];
      results[row.custom_id] = pages.map((p) => p.markdown || '').join('\n\n---\n\n').trim();
    }
    return { status: job.status, results };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Prompts
  // ──────────────────────────────────────────────────────────────────────────

  buildSystemPrompt() {
    return `You are a medical document analyzer. Your input is OCR-extracted MARKDOWN (produced by an OCR engine) of one or more healthcare documents — referrals, prescriptions, intake forms, and compression-garment order forms. Extract structured patient information.

ABBREVIATIONS & ROLE MAPPINGS:
- "PT" / "P.T." / "Physical Therapist" → the "therapist" fields.
- "MD" / "PCP" / "Referring Physician" / "Primary Care Physician" / "Doctor" → the "primary_care_physician" fields.

There is exactly ONE patient across ALL documents — never multiple. Merge every detail into one patient object.

READING THE OCR MARKDOWN — DO THIS METHODICALLY (two passes):
The OCR renders every checkbox as a literal character:
  • CHECKED   = ☑  (also ☒, ✔, ✗, ■, [x], [X])
  • UNCHECKED = ☐  (also □, [ ], or an empty cell)

PASS 1 — Sweep the WHOLE document top to bottom and collect EVERY option marked ☑, each with its label, into the "checked_options" array. Do not stop early. A single order form spans many sections and the LATER ones are the most commonly missed — you MUST walk every one:
  Material; Compression (CCL); Standard Colors; Trend Colors; Qty; Side; Handpiece; Style (Hand piece); Proximal Ending (Hand piece); Style (Armsleeve); Proximal Ending (Armsleeve); Topband; Position / Topband Piece / Anti-slip dots; Design / Fashion / Crystal elements; Other Accessories; Shoulder Attachments; Donning Accessories; and the circaid profile block (Sleeve length, Side: Quantity, Foam, Thickness, Adjustable Band, Foam Sleeve Options, Oversleeve colors).
  The Armsleeve column and the entire circaid block are frequently dropped — double-check them.
- Include EVERY ☑ option. NEVER include a ☐ option. Do not guess.
- QUANTITY IMPLIES SELECTION: treat an option as SELECTED if a non-empty quantity/value sits next to it, EVEN IF its box reads ☐ — OCR sometimes misses a faint checkmark but the number confirms the choice. E.g. "☐ Right ¹" → "Side: Right (qty 1)"; "☐ magenta Quantity ¹" → "Oversleeve: magenta (qty 1)". A blank line (e.g. "☐ Left _____") is NOT selected.
- If a group has multiple ☑, include them ALL (e.g. two materials).
- Capture typed/handwritten free text and quantities next to a label (e.g. "hand pcs: 2", "arm pcs: 2", "Special Requests: ...").

COMPRESSION (CCL) GRID — read carefully:
The CCL section is a grid: columns CCL 1 (15-21 mmHg), CCL 2 (23-32 mmHg), CCL 3 (34-46 mmHg) crossed with rows Hand piece / Arm Sleeve. OCR often flattens it (e.g. "CCL² 23-32 mmHg ☐ ☑"). The compression class is whichever COLUMN contains the ☑ — report that class (e.g. "Compression: CCL 2"), NOT the first column. If only one ☑ appears anywhere in the CCL grid, that single class applies to the order.

PASS 2 — Compose "product_ordered" as one human-readable string that includes EVERY entry from checked_options plus the captured quantities/free-text. product_ordered must never contain fewer selections than checked_options.
- If a checkbox state is genuinely ambiguous in the OCR, note it in extraction_warnings and leave it OUT.

Return ONLY this JSON shape:
{
  "type": "patient",
  "patient": {
    "source": "string (e.g., 'pdf-ocr')",
    "patient_first_name": "string or null",
    "patient_middle_name": "string or null",
    "patient_last_name": "string or null",
    "patient_address": "string or null",
    "patient_gender": "string or null",
    "patient_date_of_birth": "string or null (format: YYYY-MM-DD if possible)",
    "patient_email_address": "string or null",
    "primary_insurance": { "id_number": "string or null", "name": "string or null", "group_number": "string or null" },
    "secondary_insurance": { "id_number": "string or null", "name": "string or null", "group_number": "string or null" },
    "tertiary_insurance": { "id_number": "string or null", "name": "string or null", "group_number": "string or null" },
    "checked_options": ["array of strings — EVERY ☑-marked option with its label, one per entry, e.g. 'Material: mondi esprit 350 SL glove', 'Material: mondi esprit 350', 'Compression: CCL 2', 'Color: Black', 'Side: Right', 'Armsleeve: CG/CD/CE/CF', 'circaid Foam: Classic'. Empty array only if the document has no order form."],
    "product_ordered": "string or null (composed from checked_options + quantities/free-text; must include every checked_options entry)",
    "therapist": { "first_name": "string or null", "last_name": "string or null", "email_address": "string or null" },
    "primary_care_physician": { "first_name": "string or null", "last_name": "string or null" },
    "others": ["array of strings — extra info that doesn't fit the fields above"],
    "confidence_score": "number 0-100 — your self-rated confidence in this extraction",
    "extraction_warnings": ["array of issues or uncertainties encountered"]
  }
}

Rules:
1. Exactly ONE patient — merge all details into the single "patient" object.
2. Extract all available information; use null for missing fields.
3. Be precise with medical terminology and codes.
4. Note unclear/illegible text in extraction_warnings.
5. Normalize dates to YYYY-MM-DD where possible.
6. If secondary/tertiary insurance are not explicitly present, set them to null; do NOT copy from primary.
7. "others": useful info that doesn't fit a defined field; [] if none.
8. "confidence_score": honest integer 0-100; lower it when key fields are missing/unclear.
9. Always return valid JSON matching the schema. No commentary, no markdown — JSON only.`;
  }

  buildUserPrompt(markdown, docCount = 1) {
    const intro =
      docCount <= 1
        ? 'Below is the OCR markdown of ONE source document.'
        : `Below is the OCR markdown of ${docCount} documents (all the SAME single patient), separated by "DOCUMENT N" headers. Merge them into one patient object.`;
    return `${intro} Extract the patient information per the system instructions. Return JSON only.\n\n${markdown}`;
  }
}

async function streamToString(stream) {
  // Mistral files.download() returns a web ReadableStream.
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks = [];
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  }
  // Fallback: Node Readable
  const parts = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts).toString('utf-8');
}

export const openaiClientService2 = new OpenAIClientService2();
export default openaiClientService2;
