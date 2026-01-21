# Compression Care - Email Processor

A Node.js service that reads emails from Gmail, extracts content from various formats (PDF, DOCX, images, plain text), and uses OpenAI GPT-4.5 to extract medical details including referrer information, patient details, and prescription data.

## Features

- 📧 **Gmail Integration**: Reads emails and attachments using Gmail API
- 📄 **Multi-format Support**: Extracts text from:
  - PDF documents
  - DOCX/Word documents
  - Images (via OCR and Vision API)
  - Plain text emails
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











