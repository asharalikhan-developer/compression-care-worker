import OpenAI from 'openai';
import config from '../config/index.js';

class OpenAIService {
  constructor() {
    this.client = null;
  }

  initialize() {
    if (!config.openai.apiKey) {
      throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in .env file');
    }

    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });

    console.log('✅ OpenAI service initialized successfully');
    return this;
  }


  async extractMedicalDetails(extractedContent) {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(extractedContent);
    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    if (extractedContent.images && extractedContent.images.length > 0) {
      const content = [
        { type: 'text', text: userPrompt },
      ];

      for (const image of extractedContent.images) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.base64}`,
            detail: 'high',
          },
        });
      }

      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'user', content: userPrompt });
    }

    try {
      const response = await this.client.chat.completions.create({
        model: config.openai.model,
        messages,
        temperature: config.openai.temperature,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      const result = response.choices[0]?.message?.content;
      
      if (!result) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(result);
    } catch (error) {
      console.error('OpenAI extraction error:', error.message);
      throw new Error(`Failed to extract details: ${error.message}`);
    }
  }


  buildSystemPrompt() {
    return `You are a medical document analyzer specialized in extracting structured information from healthcare documents, referrals, and prescriptions.

IMPORTANT: First, determine if this email is related to medical/healthcare needs (patient referrals, prescriptions, medical records, compression garments, DME orders, etc.).

If the email is NOT medical-related (e.g., promotional emails, newsletters, personal messages, spam, general business correspondence), return:
{
  "is_relevant": false,
  "reason": "Brief explanation of why this is not a medical document"
}

If the email IS medical-related, extract and return a JSON object. 

CRITICAL: An email may contain data for MULTIPLE PATIENTS - for example, one patient's info in the email body, another in a PDF attachment, and another in an image. You MUST extract ALL patients found across ALL sources (email body, attachments, images).

Return structure:

{
  "is_relevant": true,
  "total_patients_found": number,
  "patients": [
    {
      "source": "string (e.g., 'email_body', 'attachment: filename.pdf', 'image: image.jpg')",
      "referrer": {
        "name": "string or null",
        "title": "string or null (e.g., Dr., MD, NP)",
        "specialty": "string or null",
        "organization": "string or null",
        "address": "string or null",
        "phone": "string or null",
        "fax": "string or null",
        "email": "string or null",
        "npi": "string or null (National Provider Identifier)",
        "license_number": "string or null"
      },
      "patient": {
        "name": "string or null",
        "date_of_birth": "string or null (format: YYYY-MM-DD if possible)",
        "age": "number or null",
        "gender": "string or null",
        "address": "string or null",
        "phone": "string or null",
        "email": "string or null",
        "insurance_provider": "string or null",
        "insurance_id": "string or null",
        "medical_record_number": "string or null"
      },
      "prescription": {
        "diagnosis": ["array of diagnosis strings"],
        "icd_codes": ["array of ICD codes if present"],
        "items": [
          {
            "name": "string",
            "type": "string (e.g., medication, compression garment, DME)",
            "specifications": "string or null (size, strength, details)",
            "quantity": "string or null",
            "frequency": "string or null",
            "duration": "string or null",
            "instructions": "string or null"
          }
        ],
        "medical_necessity": "string or null",
        "date_prescribed": "string or null",
        "valid_until": "string or null"
      },
      "additional_notes": "string or null",
      "document_type": "string (e.g., referral, prescription, medical_record, fax)",
      "confidence_score": "number between 0 and 1 indicating extraction confidence",
      "extraction_warnings": ["array of any issues or uncertainties encountered"]
    }
  ]
}

Rules:
1. Extract ALL patients found - each patient should be a separate object in the "patients" array
2. Identify the source of each patient's data (email body, specific attachment filename, or image)
3. If the same patient appears in multiple sources, merge their data into one entry
4. Extract all available information, using null for missing fields
5. Be precise with medical terminology and codes
6. If text is unclear or partially legible, note it in extraction_warnings
7. Normalize phone numbers and dates where possible
8. If multiple prescriptions/items exist for a patient, include all in their items array
9. Always return valid JSON`;
  }


  buildUserPrompt(extractedContent) {
    let prompt = 'Please analyze the following content and extract medical details:\n\n';
    
    const hasAttachments = (extractedContent.attachmentContents && extractedContent.attachmentContents.length > 0) ||
                          (extractedContent.images && extractedContent.images.length > 0);

    prompt += `--- EMAIL METADATA ---\n`;
    prompt += `Subject: ${extractedContent.subject || 'N/A'}\n`;
    prompt += `From: ${extractedContent.from || 'N/A'}\n`;
    prompt += `Date: ${extractedContent.date || 'N/A'}\n\n`;

    if (extractedContent.textContent && extractedContent.textContent.trim().length > 0) {
      prompt += `--- EMAIL BODY (IMPORTANT: This may contain the primary medical information) ---\n`;
      prompt += `${extractedContent.textContent}\n\n`;
      
      if (!hasAttachments) {
        prompt += `NOTE: No attachments were found. All medical information should be extracted from the email body above.\n\n`;
      }
    }

    if (extractedContent.attachmentContents && extractedContent.attachmentContents.length > 0) {
      for (const attachment of extractedContent.attachmentContents) {
        prompt += `--- ATTACHMENT: ${attachment.filename} ---\n${attachment.content}\n\n`;
      }
    }

    if (extractedContent.images && extractedContent.images.length > 0) {
      prompt += `--- IMAGES ---\n`;
      prompt += `${extractedContent.images.length} image(s) attached for analysis.\n`;
      prompt += `Please examine the images carefully for any medical information, prescriptions, or referral details.\n\n`;
    }

    prompt += `INSTRUCTIONS: 
1. Check ALL sources (email body, each attachment, each image) for patient information
2. An email may contain MULTIPLE PATIENTS - extract ALL of them
3. Each patient found should be a separate entry in the "patients" array
4. Indicate the source where each patient's data was found
5. Return as JSON with the patients array containing all found patient records.`;

    return prompt;
  }


  validateExtraction(data) {
    if (data.is_relevant === false) {
      return {
        isValid: true,
        missingFields: [],
        data,
      };
    }

    if (!data.patients || !Array.isArray(data.patients)) {
      console.warn('Missing or invalid patients array in extraction');
      return {
        isValid: false,
        missingFields: ['patients'],
        data,
      };
    }

    const requiredPatientFields = ['patient', 'prescription', 'document_type'];
    const validationResults = [];

    for (let i = 0; i < data.patients.length; i++) {
      const patient = data.patients[i];
      const missingFields = requiredPatientFields.filter(field => !(field in patient));
      
      if (missingFields.length > 0) {
        console.warn(`Patient ${i + 1}: Missing fields: ${missingFields.join(', ')}`);
      }
      
      validationResults.push({
        patientIndex: i,
        patientName: patient.patient?.name || 'Unknown',
        source: patient.source || 'Unknown',
        isValid: missingFields.length === 0,
        missingFields,
      });
    }

    const allValid = validationResults.every(r => r.isValid);

    return {
      isValid: allValid,
      totalPatients: data.patients.length,
      validationResults,
      data,
    };
  }
}

export const openaiService = new OpenAIService();
export default openaiService;

