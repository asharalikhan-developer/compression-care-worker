# Compression Care - Email Processor

A Node.js service that reads emails from Gmail, extracts content from various formats (PDF, DOCX, images, plain text), and uses OpenAI GPT-4.5 to extract medical details including referrer information, patient details, and prescription data.

## Features

- 📧 **Gmail Integration**: Reads emails and attachments using Gmail API
- 📄 **Multi-format Support**: Extracts text from:
  - PDF documents
  - DOCX/Word documents
  - Images (via OCR and Vision API)
  - Plain text emails
  - Spreadsheets (`.xls`, `.xlsx`, `.csv`) — extracts textual cells
- 🤖 **AI-Powered Extraction**: Uses OpenAI GPT-4.5 to extract:
  - Referrer details (name, organization, contact info, NPI)
  - Patient information (name, DOB, insurance, contact)
  - Prescription details (diagnosis, medications, DME items)
- 📊 **Structured Output**: Returns well-formatted JSON with all extracted data

## Prerequisites

- Node.js 18+ installed
- Google Cloud account with Gmail API enabled
- OpenAI API key

## Installation

1. **Clone and install dependencies:**

```bash
cd "compression care"
npm install
```

2. **Set up Google Cloud credentials:**

   a. Go to [Google Cloud Console](https://console.cloud.google.com/)
   
   b. Create a new project or select an existing one
   
   c. Enable the Gmail API:
      - Go to "APIs & Services" > "Library"
      - Search for "Gmail API" and enable it
   
   d. Create OAuth 2.0 credentials:
      - Go to "APIs & Services" > "Credentials"
      - Click "Create Credentials" > "OAuth 2.0 Client ID"
      - Choose "Desktop application"
      - Download the JSON file and save it as `credentials.json` in the project root

3. **Set up environment variables:**

```bash
cp env.example .env
```

Edit `.env` and add your OpenAI API key:

```
OPENAI_API_KEY=sk-your-openai-api-key-here
```

4. **Authenticate with Gmail:**

```bash
npm run auth
```

This will open a browser window for Google OAuth authentication. After authenticating, a `token.json` file will be created.

## Usage

### Process Unread Emails

Run the main script to process all unread emails:

```bash
npm start
```

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Programmatic Usage

```javascript
import { emailProcessorService } from './src/index.js';

// Initialize the service
await emailProcessorService.initialize();

// Process all unread emails
const results = await emailProcessorService.processUnreadEmails();
console.log(results);

// Process a specific email by ID
const result = await emailProcessorService.processEmailById('email-id-here');

// Start continuous monitoring
const stopMonitoring = emailProcessorService.startMonitoring((results) => {
  console.log('New emails processed:', results);
});

// Stop monitoring when done
stopMonitoring();
```

## Output Format

The service returns a JSON object with the following structure:

```json
{
  "success": true,
  "emailId": "abc123",
  "emailSubject": "Patient Referral - John Doe",
  "emailFrom": "doctor@clinic.com",
  "emailDate": "2024-01-15",
  "processedAt": "2024-01-15T10:30:00.000Z",
  "extractedData": {
    "referrer": {
      "name": "Dr. Jane Smith",
      "title": "MD",
      "specialty": "Internal Medicine",
      "organization": "City Medical Center",
      "address": "123 Medical Dr, City, ST 12345",
      "phone": "(555) 123-4567",
      "fax": "(555) 123-4568",
      "email": "jsmith@citymedical.com",
      "npi": "1234567890",
      "license_number": "MD12345"
    },
    "patient": {
      "name": "John Doe",
      "date_of_birth": "1985-03-15",
      "age": 38,
      "gender": "Male",
      "address": "456 Patient St, Town, ST 67890",
      "phone": "(555) 987-6543",
      "email": "johndoe@email.com",
      "insurance_provider": "Blue Cross Blue Shield",
      "insurance_id": "XYZ123456789",
      "medical_record_number": "MRN001234"
    },
    "prescription": {
      "diagnosis": ["Chronic venous insufficiency", "Lymphedema"],
      "icd_codes": ["I87.2", "I89.0"],
      "items": [
        {
          "name": "Compression Stockings",
          "type": "compression garment",
          "specifications": "30-40 mmHg, knee-high, closed toe",
          "quantity": "2 pairs",
          "frequency": "Daily wear",
          "duration": "6 months",
          "instructions": "Wear during waking hours, remove at night"
        }
      ],
      "medical_necessity": "Required for management of chronic venous insufficiency",
      "date_prescribed": "2024-01-15",
      "valid_until": "2024-07-15"
    },
    "additional_notes": "Patient to follow up in 3 months",
    "document_type": "referral",
    "confidence_score": 0.95,
    "extraction_warnings": []
  },
  "validation": {
    "isValid": true,
    "missingFields": []
  }
}
```

## Configuration

Environment variables in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | Required |
| `CHECK_INTERVAL_MS` | Interval between email checks (ms) | 60000 |
| `MAX_EMAILS_PER_CHECK` | Maximum emails to process per check | 10 |
| `MAX_WORKER_ATTEMPTS` | Max retry attempts per job before final failure | 3 |
| `PROCESSORS` | Comma-separated list of enabled processors (`gmail`, `client`) | `gmail,client` |

## Document Orientation Model

Scanned/fax PDFs are run through `src/scripts/fixPdfOrientation.js` to detect and correct page orientation (0°, 90°, 180°, 270°) before the PDF is uploaded to Cloudinary and sent to OpenAI. Correctly-oriented pages improve OCR accuracy significantly.

The detector is **PaddlePaddle PP-LCNet_x1_0_doc_ori** running locally via ONNX Runtime (no external API call). The 6.5 MB ONNX model lives at:

```
models/PP-LCNet_x1_0_doc_ori.onnx
```

It is committed to git, so a fresh `git clone` already includes it. The path is overridable via `PPLCNET_MODEL_PATH` env var.

### Model source

- HuggingFace repo: <https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx>
- Direct download URL: <https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx/resolve/main/inference.onnx>
- Preprocessing spec (reference only — values are hardcoded in `fixPdfOrientation.js`): <https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx/resolve/main/inference.yml>

### Re-downloading the model

If the local file ever goes missing or you want to verify a clean copy:

```bash
mkdir -p models
curl -sL -o models/PP-LCNet_x1_0_doc_ori.onnx \
  https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx/resolve/main/inference.onnx
```

### Tuning

Two knobs at the top of `src/scripts/fixPdfOrientation.js`:

| Constant | Default | Purpose |
|---|---|---|
| `RENDER_SCALE` | `2.0` | pdf-to-img render scale (~144 DPI). Higher values are wasted since the model resizes to 256 short edge internally. |
| `MIN_MARGIN_FOR_ROTATION` | `0.15` | Below this margin (top-1 prob − runner-up prob), the page is left as-is. Confident pages get margin ~0.25; blank/sparse pages get margin ~0.00. |

The preprocessing constants (`RESIZE_SHORT`, `CROP_SIZE`, `MEAN`, `STD`, `LABELS`) come from the model's `inference.yml` and **must not be changed** — they are fixed by the model's training.

### Convention note

PP-LCNet returns the **current rotation** of the page (CW from upright), not the rotation to apply to fix it. The engine converts to the "rotation-to-apply" convention internally:

```
fixAngle = (360 - detectedAngle) % 360
```

So a model output of `270°` results in a `90°` CW rotation being applied. The 180° case is symmetric (both directions land at the same result), which can mask the bug if you only test on upside-down pages.

## Error Handling & Retries (Client Processor)

The `client` processor uses stage-tagged errors, exponential-backoff retries, and a uniform Mongo "acknowledgement" payload so the producer can poll a single document and learn exactly what happened.

### Retry behavior

- Each job runs up to `MAX_WORKER_ATTEMPTS` times (default `3`). Configure via env var.
- Backoff is exponential: `5s → 10s → 20s → 40s …` capped at **60s**.
- Retries are managed by the worker itself (it re-enqueues onto the same BullMQ queue with `delay`) — the producer does **not** need to set BullMQ `attempts`.
- Each attempt stamps `_workerAttempt` on `job.data` so the next attempt knows which try it's on.
- On every failed attempt, any Cloudinary assets uploaded during that attempt are **deleted** — no orphan files build up.
- **Permanent** errors (bad input, doc not found, unsupported format) short-circuit retries and go straight to the failure acknowledgement.

### Acknowledgement payload (MongoDB `documents` collection, keyed by `uniqueId`)

**On success:**

```json
{
  "status": "processed",
  "processedAt": "2026-06-17T10:00:00.000Z",
  "attemptsMade": 1,
  "error": null,
  "result": { "type": "patient", "patient": { /* extracted fields */ } }
}
```

**On final failure** (after retries exhausted or a permanent error):

```json
{
  "status": "failed",
  "failedAt": "2026-06-17T10:00:30.000Z",
  "attemptsMade": 3,
  "error": {
    "message": "Failed to download ... (504 Gateway Timeout)",
    "stage": "download",
    "code": "DOWNLOAD_FAILED"
  }
}
```

### Error stages

| `stage`       | When it fires |
|---------------|---------------|
| `detect`      | Job input validation / format sniffing (PDF vs ZIP vs unknown) |
| `download`    | Fetching `pdfUrls[0]` from the source (signed URL) |
| `unzip`       | Extracting PDFs from a ZIP archive |
| `preprocess`  | Text-check + orientation fix on a PDF |
| `cloudinary`  | Uploading a (possibly orientation-fixed) PDF to Cloudinary |
| `openai`      | Calling GPT-5.5 via the Response API |
| `mongo`       | Updating the `documents` collection with the result |

### Error codes

| `code`                       | `permanent` | Meaning |
|------------------------------|:-----------:|---------|
| `BAD_INPUT`                  | yes         | `uniqueId` or `pdfUrls` missing on the job |
| `UNSUPPORTED_FORMAT`         | yes         | Source URL returned neither a PDF nor a ZIP |
| `EMPTY_ZIP`                  | yes         | ZIP contained no `.pdf` entries |
| `NO_PATIENT_RETURNED`        | yes         | OpenAI returned a payload without a `patient` object |
| `DOC_NOT_FOUND`              | yes         | No `documents.{uniqueId}` row to update |
| `DOWNLOAD_FAILED`            | no          | Transient HTTP error fetching the source URL |
| `UNZIP_FAILED`               | no          | ZIP extraction threw |
| `PREPROCESS_FAILED`          | no          | Unexpected failure in text-check / orientation fix |
| `CLOUDINARY_UPLOAD_FAILED`   | no          | Transient Cloudinary error |
| `OPENAI_ERROR`               | no          | Transient OpenAI error (429, 5xx, network) |
| `MONGO_UPDATE_FAILED`        | no          | Transient MongoDB error during the final write |
| `UNHANDLED_ERROR`            | no          | Caught-but-unclassified — treat as a bug, investigate |
| `PIPELINE_ERROR`             | varies      | Generic fallback if a `PipelineError` is thrown without a more specific code |

`permanent: yes` → no retry; failure is acknowledged immediately.
`permanent: no` → retried up to `MAX_WORKER_ATTEMPTS` with exponential backoff before final failure.

## Project Structure

```
compression-care/
├── src/
│   ├── config/
│   │   └── index.js          # Configuration management
│   ├── services/
│   │   ├── gmail.service.js           # Gmail API integration
│   │   ├── content-extractor.service.js # PDF, DOCX, image extraction
│   │   ├── openai.service.js          # OpenAI integration
│   │   └── email-processor.service.js # Main orchestration service
│   ├── scripts/
│   │   └── authenticate.js   # Gmail OAuth setup script
│   └── index.js              # Main entry point
├── credentials.json          # Google OAuth credentials (not in git)
├── token.json               # OAuth token (not in git)
├── .env                     # Environment variables (not in git)
├── .gitignore
├── package.json
└── README.md
```

## Troubleshooting

### "credentials.json not found"

Make sure you've downloaded the OAuth credentials from Google Cloud Console and saved them as `credentials.json` in the project root.

### "OpenAI API key is not configured"

Ensure you've set the `OPENAI_API_KEY` in your `.env` file.

### "Token has been expired or revoked"

Delete `token.json` and run `npm run auth` again to re-authenticate.

### OCR not working properly

Make sure Tesseract dependencies are installed. For better image processing, the service also supports sending images directly to OpenAI Vision API.

## License

ISC











