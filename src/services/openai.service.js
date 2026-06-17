import OpenAI from "openai";
import config from "../config/index.js";
import { logCost } from "../utils/openai-cost.js";

class OpenAIService {
  constructor() {
    this.client = null;
  }

  initialize() {
    if (!config.openai.apiKey) {
      throw new Error(
        "OpenAI API key is not configured. Please set OPENAI_API_KEY in .env file",
      );
    }

    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });

    console.log("✅ OpenAI service initialized successfully");
    return this;
  }

  // async extractMedicalDetails(extractedContent) {
  //   const systemPrompt = this.buildSystemPrompt();
  //   const agg = { is_relevant: null, patients: [], shipments: [] };
  //   const patientIndex = new Map();
  //   const shipmentIndex = new Map();

  //   // Function to merge partial extraction results into aggregate
  //   const mergeResults = (partial) => {
  //     if (!partial || partial.is_relevant === false) return;
  //     if (agg.is_relevant !== false)
  //       agg.is_relevant = partial.is_relevant ?? agg.is_relevant;

  //     if (Array.isArray(partial.patients)) {
  //       for (const p of partial.patients) {
  //         const key = `${(p.patient?.name || "").toLowerCase()}|${p.patient?.date_of_birth || ""}`;
  //         const idx = patientIndex.get(key);
  //         if (idx == null) {
  //           patientIndex.set(key, agg.patients.length);
  //           agg.patients.push(p);
  //         } else {
  //           const e = agg.patients[idx];
  //           agg.patients[idx] = {
  //             ...e,
  //             referrer: { ...(e.referrer || {}), ...(p.referrer || {}) },
  //             patient: { ...(e.patient || {}), ...(p.patient || {}) },
  //             prescription: {
  //               ...(e.prescription || {}),
  //               items: [
  //                 ...(e.prescription?.items || []),
  //                 ...(p.prescription?.items || []),
  //               ],
  //               diagnosis: [
  //                 ...new Set([
  //                   ...(e.prescription?.diagnosis || []),
  //                   ...(p.prescription?.diagnosis || []),
  //                 ]),
  //               ],
  //               icd_codes: [
  //                 ...new Set([
  //                   ...(e.prescription?.icd_codes || []),
  //                   ...(p.prescription?.icd_codes || []),
  //                 ]),
  //               ],
  //             },
  //             additional_notes:
  //               p.additional_notes || e.additional_notes || null,
  //             document_type: p.document_type || e.document_type || null,
  //             extraction_warnings: [
  //               ...(e.extraction_warnings || []),
  //               ...(p.extraction_warnings || []),
  //             ],
  //           };
  //         }
  //       }
  //     }

  //     if (Array.isArray(partial.shipments)) {
  //       for (const s of partial.shipments) {
  //         const key =
  //           (s.tracking_number || "").toLowerCase() ||
  //           `${(s.shipper || "").toLowerCase()}|${s.ship_date || ""}|${(s.source || "").toLowerCase()}`;
  //         const idx = shipmentIndex.get(key);
  //         if (idx == null) {
  //           shipmentIndex.set(key, agg.shipments.length);
  //           agg.shipments.push(s);
  //         } else {
  //           const e = agg.shipments[idx];
  //           agg.shipments[idx] = {
  //             ...e,
  //             manufacturer_template:
  //               s.manufacturer_template || e.manufacturer_template,
  //             ship_date: s.ship_date || e.ship_date,
  //             shipper: s.shipper || e.shipper,
  //             tracking_number: s.tracking_number || e.tracking_number,
  //             tracking_url: s.tracking_url || e.tracking_url,
  //             expected_delivery_date:
  //               s.expected_delivery_date || e.expected_delivery_date,
  //             referral_status: s.referral_status || e.referral_status,
  //             line_items: [...(e.line_items || []), ...(s.line_items || [])],
  //             notes: s.notes || e.notes || null,
  //             extraction_warnings: [
  //               ...(e.extraction_warnings || []),
  //               ...(s.extraction_warnings || []),
  //             ],
  //           };
  //         }
  //       }
  //     }
  //   };

  //   // Function to call OpenAI with given prompt and optional images
  //   const callModel = async ({ userPrompt, images = [] }) => {
  //     const messages = [{ role: "system", content: systemPrompt }];
  //     if (images.length > 0) {
  //       const content = [{ type: "text", text: userPrompt }];
  //       for (const image of images) {
  //         content.push({
  //           type: "image_url",
  //           image_url: {
  //             url: `data:${image.mimeType};base64,${image.base64}`,
  //             detail: "high",
  //           },
  //         });
  //       }
  //       messages.push({ role: "user", content });
  //     } else {
  //       messages.push({ role: "user", content: userPrompt });
  //     }

  //     const response = await this.client.chat.completions.create({
  //       model: config.openai.model,
  //       messages,
  //       temperature: config.openai.temperature,
  //       max_tokens: 4096,
  //       response_format: { type: "json_object" },
  //     });
  //     const raw = response.choices[0]?.message?.content;
  //     if (!raw) throw new Error("No response from OpenAI");
  //     return JSON.parse(raw);
  //   };

  //   try {
  //     // Process email body first
  //     // if (extractedContent.textContent && extractedContent.textContent.trim().length > 0) {
  //     //   const userPrompt = this.buildBodyPrompt(extractedContent);
  //     //   const res = await callModel({ userPrompt });
  //     //   mergeResults(res);
  //     // }

  //     // // Process each attachment separately
  //     // if (Array.isArray(extractedContent.attachmentContents)) {
  //     //   for (const a of extractedContent.attachmentContents) {
  //     //     if (!a?.content) continue;
  //     //     const userPrompt = this.buildAttachmentPrompt(a.filename || 'unknown', a.content);
  //     //     const res = await callModel({ userPrompt });
  //     //     mergeResults(res);
  //     //   }
  //     // }

  //     // // Process images if any
  //     // if (Array.isArray(extractedContent.images)) {
  //     //   for (const img of extractedContent.images) {
  //     //     const userPrompt = this.buildImagePrompt(extractedContent, img);
  //     //     const res = await callModel({ userPrompt, images: [img] });
  //     //     mergeResults(res);
  //     //   }
  //     // }

  //     // return {
  //     //   is_relevant: agg.is_relevant ?? (agg.patients.length > 0 || agg.shipments.length > 0),
  //     //   total_patients_found: agg.patients.length,
  //     //   total_shipments_found: agg.shipments.length,
  //     //   patients: agg.patients,
  //     //   shipments: agg.shipments,
  //     // };
  //     const runConcurrently = async (fns, limit = 5) => {
  //       let i = 0;
  //       const out = new Array(fns.length);
  //       const workers = Array(Math.min(limit, fns.length))
  //         .fill(null)
  //         .map(async () => {
  //           while (true) {
  //             const idx = i++;
  //             if (idx >= fns.length) break;
  //             try {
  //               const val = await fns[idx]();
  //               out[idx] = { ok: true, value: val };
  //             } catch (err) {
  //               out[idx] = { ok: false, error: err };
  //             }
  //           }
  //         });
  //       await Promise.all(workers);
  //       return out;
  //     };

  //     const tasks = [];

  //     // Body (keep one task)
  //     if (
  //       extractedContent.textContent &&
  //       extractedContent.textContent.trim().length > 0
  //     ) {
  //       tasks.push(() => {
  //         const userPrompt = this.buildBodyPrompt(extractedContent);
  //         return callModel({ userPrompt });
  //       });
  //     }

  //     // Attachments (each as a task)
  //     if (Array.isArray(extractedContent.attachmentContents)) {
  //       for (const a of extractedContent.attachmentContents) {
  //         if (!a?.content) continue;
  //         tasks.push(() => {
  //           const userPrompt = this.buildAttachmentPrompt(
  //             a.filename || "unknown",
  //             a.content,
  //           );
  //           return callModel({ userPrompt });
  //         });
  //       }
  //     }

  //     // Images (each as a task; can also group all images into one task if you prefer)
  //     if (Array.isArray(extractedContent.images)) {
  //       for (const img of extractedContent.images) {
  //         tasks.push(() => {
  //           const userPrompt = this.buildImagePrompt(extractedContent, img);
  //           return callModel({ userPrompt, images: [img] });
  //         });
  //       }
  //     }

  //     // Run with limited concurrency (tune limit to your rate limits)
  //     const results = await runConcurrently(tasks, 3);
  //     for (const r of results) {
  //       if (r?.ok && r.value) mergeResults(r.value);
  //     }

  //     return {
  //       is_relevant:
  //         agg.is_relevant ??
  //         (agg.patients.length > 0 || agg.shipments.length > 0),
  //       total_patients_found: agg.patients.length,
  //       total_shipments_found: agg.shipments.length,
  //       patients: agg.patients,
  //       shipments: agg.shipments,
  //     };
  //   } catch (error) {
  //     console.error("OpenAI extraction error:", error.message);
  //     throw new Error(`Failed to extract details: ${error.message}`);
  //   }
  // }
   async extractMedicalDetails(extractedContent) {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(extractedContent);
    
    const hasImages = extractedContent.images && extractedContent.images.length > 0;
    const hasFaxAttachments = extractedContent.faxattachments && extractedContent.faxattachments.length > 0;

    // If there are fax PDFs, use the response API
    if (hasFaxAttachments) {
      return await this.extractWithResponseAPI(systemPrompt, userPrompt, extractedContent);
    }

    // Otherwise use the chat completions API for images
    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    if (hasImages) {
      const content = [
        { type: 'text', text: userPrompt },
      ];

      for (const image of (extractedContent.images || [])) {
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
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      logCost('Gmail Chat Completion', config.openai.model, response.usage);

      const result = response.choices[0]?.message?.content;

      if (!result) {
        throw new Error('No response from OpenAI');
      }
      console.log("result", result);

      return JSON.parse(result);
    } catch (error) {
      console.error('OpenAI extraction error:', error.message);
      throw new Error(`Failed to extract details: ${error.message}`);
    }
  }

  async extractWithResponseAPI(systemPrompt, userPrompt, extractedContent) {
    try {
      const content = [
        {
          type: "input_text",
          text: `${systemPrompt}\n\n${userPrompt}`,
        },
      ];

      // Add fax PDFs using input_file with URLs
      for (const fax of (extractedContent.faxattachments || [])) {
        content.push({
          type: "input_file",
          file_url: fax.url,
        });
      }

      // Add images if any
      for (const image of (extractedContent.images || [])) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${image.mimeType};base64,${image.base64}`,
            detail: 'high',
          },
        });
      }

      const response = await this.client.responses.create({
        model: config.openai.gpt5model,
        input: [
          {
            role: "user",
            content: content,
          },
        ],
      });

      logCost('Gmail Response API', config.openai.gpt5model, response.usage);

      const result = response.output_text;

      if (!result) {
        throw new Error('No response from OpenAI Response API');
      }
      // console.log("result", result);

      return JSON.parse(result);
    } catch (error) {
      console.error('OpenAI Response API extraction error:', error.message);
      throw new Error(`Failed to extract details using Response API: ${error.message}`);
    }
  }

 buildSystemPrompt() {
    return `You are a medical and shipping document analyzer specialized in extracting structured information from healthcare documents, referrals, prescriptions, and manufacturer shipping notifications.

IMPORTANT: First, classify this email into one of three categories:
1. NOT RELEVANT — promotional emails, newsletters, personal messages, spam, general business correspondence
2. PATIENT DATA — medical/healthcare content such as patient referrals, prescriptions, medical records, compression garments, DME orders, etc.
3. SHIPMENT DATA — manufacturer shipping notifications, tracking updates, order confirmations related to medical supplies/orders

An email will NEVER contain both patient data and shipment data. It is always one or the other (or not relevant).

ABBREVIATIONS & ROLE MAPPINGS:
- "PT" or "P.T." or "Physical Therapist" refers to the therapist. Map to the "therapist" fields.
- "MD", "PCP", "Referring Physician", "Primary Care Physician", or "Doctor" refers to the primary_care_physician. Map to the "primary_care_physician" fields.

--- CATEGORY 1: NOT RELEVANT ---
If the email is not relevant, return:
{
  "is_relevant": false,
  "type": "not_relevant",
  "reason": "Brief explanation of why this is not a medical or shipment document"
}

--- CATEGORY 2: PATIENT DATA ---
If the email contains patient/medical data, return ONLY patient JSON. There is exactly ONE patient per email — never multiple. Collect that single patient's details across all sources (email body, attachments, images) and merge every field into one patient object.

Return:
{
  "is_relevant": true,
  "type": "patient",
  "patient": {
    "source": "string (e.g., 'email_body', 'attachment: filename.pdf', 'image: image.jpg', or comma-separated if merged from multiple sources)",
    "patient_first_name": "string or null",
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
      "id_number": "string or null (also: Member ID, Member #, Subscriber ID)",
      "name": "string or null",
      "group_number": "string or null (also: Group, Group #, Grp #, Plan ID)"
    },
    "tertiary_insurance": {
      "id_number": "string or null (also: Member ID, Member #, Subscriber ID)",
      "name": "string or null",
      "group_number": "string or null (also: Group, Group #, Grp #, Plan ID)"
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

--- CATEGORY 3: SHIPMENT DATA ---
If the email contains shipment/shipping data, return ONLY shipments JSON. A single email may contain MULTIPLE shipments with different tracking numbers, order numbers, ship dates, or line items. Shipping data headers can vary by template (e.g., Customer_Number/Customer, Row_Number, Invoice_Number, txtSalesOrderNo/Order, Customer_PO_Number/PO, Order_Date/Ship Date, POD_Tracking_Number/Tracking, Shipping/Ship Via, Name, Packlist, Ship To). You MUST infer equivalent fields and normalize them into the shipment schema below. Detect the manufacturer template if possible.

Shipment/order/quote documents may mention a patient name/address for delivery, but if the main content is about an order, quote, or shipment, classify as SHIPMENT.

Return:
{
  "is_relevant": true,
  "type": "shipment",
  "total_shipments_found": number,
  "shipments": [
    {
      "source": "string (e.g., 'email_body', 'attachment: filename.pdf')",
      "ship_date": "string or null (YYYY-MM-DD if possible)",
      "shipper": "string or null (e.g., UPS, FedEx, USPS)",
      "tracking_number": "string or null",
      "order_number": "string or null",
      "referral_status": "string or null (e.g., 'Shipped', 'Backordered', 'Partial Shipped')",
      "line_items": [
        {
          "sku": "string or null",
          "description": "string or null",
          "quantity": "number or null"
        }
      ],
      "extraction_warnings": ["array of any issues or uncertainties encountered"]
    }
  ]
}

Rules:
1. Classify the email into exactly ONE category: not_relevant, patient, or shipment
2. NEVER mix patient and shipment data in the same response
3. For patient emails: merge all patient details from every source (body, attachments, images) into the single "patient" object
4. For patient emails: if data is found in multiple sources, list all sources comma-separated in the "source" field (e.g., "email_body, attachment: referral.pdf")
5. For shipment emails: the "shipments" array may contain MULTIPLE objects — one per distinct shipment/tracking number found
6. Extract ALL shipping information when present, including tracking details and line item statuses
7. Detect manufacturer template when possible
8. Extract all available information, using null for missing fields
9. Be precise with medical terminology and codes
10. If text is unclear or partially legible, note it in extraction_warnings
11. Normalize phone numbers and dates where possible
12. If secondary or tertiary insurance are not explicitly present, set them to null and do NOT copy from primary insurance
13. Product ordered may appear in email body, attached POC, or referral cover sheet
14. Set line_items to [] when not present (preferred for schema stability)
15. For patient emails: populate "others" with any useful information found in the document that does not map to any defined field (e.g., allergies, height, weight, language preference, preferred contact method, notes from the referrer). Each entry is a single plain-text string. Do NOT drop information just because there is no dedicated field for it. Return [] if nothing extra was found.
16. For patient emails: populate "confidence_score" with an integer from 0 to 100 representing your overall confidence in this extraction. Lower the score when key fields are missing, OCR/text was unclear, values were ambiguous, or you had to guess. Raise it when most fields are clearly present and unambiguous in the source. This is your own self-assessment — be honest.
17. Always return valid JSON`;
  }

  buildUserPrompt(extractedContent) {
    let prompt =
      "Please analyze the following content and extract medical and shipping details as per the system instructions:\n\n";

    const hasAttachments =
      (extractedContent.attachmentContents &&
        extractedContent.attachmentContents.length > 0) ||
      (extractedContent.images && extractedContent.images.length > 0) ||
      (extractedContent.faxattachments && extractedContent.faxattachments.length > 0);

    prompt += `--- EMAIL METADATA ---\n`;
    prompt += `Subject: ${extractedContent.subject || "N/A"}\n`;
    prompt += `From: ${extractedContent.from || "N/A"}\n`;
    prompt += `Date: ${extractedContent.date || "N/A"}\n\n`;

    if (
      extractedContent.textContent &&
      extractedContent.textContent.trim().length > 0
    ) {
      prompt += `--- EMAIL BODY (IMPORTANT: This may contain primary medical or shipping information) ---\n`;
      prompt += `${extractedContent.textContent}\n\n`;

      if (!hasAttachments) {
        prompt += `NOTE: No attachments were found. Extract all medical and/or shipping information from the email body above.\n\n`;
      }
    }

    if (
      extractedContent.attachmentContents &&
      extractedContent.attachmentContents.length > 0
    ) {
      for (const attachment of extractedContent.attachmentContents) {
        prompt += `--- ATTACHMENT: ${attachment.filename} ---\n${attachment.content}\n\n`;
      }
    }

    if (extractedContent.images && extractedContent.images.length > 0) {
      prompt += `--- IMAGES ---\n`;
      prompt += `${extractedContent.images.length} image(s) attached for analysis.\n`;
      prompt += `Please examine the images carefully for any medical information, prescriptions, referral details, or shipping labels/tracking info.\n\n`;
    }

    if (extractedContent.faxattachments && extractedContent.faxattachments.length > 0) {
      prompt += `--- FAX ATTACHMENTS (PDF) ---\n`;
      prompt += `${extractedContent.faxattachments.length} fax PDF(s) attached for analysis.\n`;
      for (const fax of extractedContent.faxattachments) {
        prompt += `- ${fax.filename}\n`;
      }
      prompt += `NOTE: These are scanned fax documents and may contain visual noise, low resolution, skewed text, fax artifacts, watermarks, or partially legible characters. `;
      prompt += `Please do your best to interpret the content despite these quality issues, extract whatever information is legible, and note any uncertain or unclear fields in extraction_warnings.\n\n`;
    }

    prompt += `INSTRUCTIONS: 
  1. Check ALL sources (email body, each attachment, each image) for information.
  2. Classify the email into exactly ONE category: not_relevant, patient, or shipment.
  3. An email will contain EITHER patient data OR shipment data — NEVER both.
  4. If the email contains patient data, return type "patient" with a single "patient" object (merge details from all sources into that one object).
  5. If the email contains shipment data, return type "shipment" with a "shipments" array (one object per distinct order/tracking number).
  6. If the email is not relevant, return type "not_relevant" with a brief reason.
  7. Indicate the source where each patient's or shipment's data was found.
  8. Return valid JSON matching the system prompt schema.`;

    return prompt;
  }

  // buildBodyPrompt(extractedContent) {
  //   let prompt =
  //     "Analyze EMAIL BODY ONLY and extract medical and shipping details as per the system instructions.\n\n";
  //   prompt += `--- EMAIL METADATA ---\nSubject: ${extractedContent.subject || "N/A"}\nFrom: ${extractedContent.from || "N/A"}\nDate: ${extractedContent.date || "N/A"}\n\n`;
  //   prompt += `--- EMAIL BODY ---\n${extractedContent.textContent || "N/A"}\n\n`;
  //   prompt += `INSTRUCTIONS:\n- An email will contain EITHER patient data OR shipment data — NEVER both.\n- If patient data is present, extract exactly ONE patient and indicate source as "email_body".\n- If shipment data is present, extract all shipments and indicate source as "email_body".`;
  //   return prompt;
  // }

  // buildAttachmentPrompt(filename, content) {
  //   let prompt =
  //     "Analyze ATTACHMENT CONTENT ONLY and extract medical and shipping details as per the system instructions.\n\n";
  //   prompt += `--- ATTACHMENT ---\nFilename: ${filename}\nContent:\n${content}\n\n`;
  //   prompt += `INSTRUCTIONS:\n- An email will contain EITHER patient data OR shipment data — NEVER both.\n- If patient data is present in this attachment, extract exactly ONE patient and indicate source as "attachment: ${filename}".\n- If shipment data is present, extract all shipments found in this attachment and indicate source as "attachment: ${filename}".`;
  //   return prompt;
  // }

  // buildImagePrompt(extractedContent, image) {
  //   let prompt =
  //     "Analyze IMAGE ONLY and extract shipping labels, tracking info, or medical data as per the system instructions.\n\n";
  //   prompt += `--- IMAGE SOURCE ---\nFrom subject: ${extractedContent.subject || "N/A"}\nDate: ${extractedContent.date || "N/A"}\n\n`;
  //   prompt += `INSTRUCTIONS:\n- An email will contain EITHER patient data OR shipment data — NEVER both.\n- If patient data is present in this image, extract exactly ONE patient and indicate source as "image: ${image.filename || image.mimeType || "unknown"}".\n- If shipment data is present, extract all shipments found in this image and indicate source as "image: ${image.filename || image.mimeType || "unknown"}".`;
  //   return prompt;
  // }

  validateExtraction(data) {
    if (data.is_relevant === false) {
      return {
        isValid: true,
        missingFields: [],
        data,
      };
    }

    const hasPatientsArray = Array.isArray(data.patients);
    const hasShipmentsArray = Array.isArray(data.shipments);

    if (!hasPatientsArray && !hasShipmentsArray) {
      console.warn("Missing both patients and shipments arrays in extraction");
      return {
        isValid: false,
        missingFields: ["patients", "shipments"],
        data,
      };
    }

    const requiredPatientFields = ["patient", "prescription", "document_type"];
    const validationResults = [];

    if (hasPatientsArray) {
      for (let i = 0; i < data.patients.length; i++) {
        const patient = data.patients[i];
        const missingFields = requiredPatientFields.filter(
          (field) => !(field in patient),
        );

        if (missingFields.length > 0) {
          console.warn(
            `Patient ${i + 1}: Missing fields: ${missingFields.join(", ")}`,
          );
        }

        validationResults.push({
          patientIndex: i,
          patientName: patient.patient?.name || "Unknown",
          source: patient.source || "Unknown",
          isValid: missingFields.length === 0,
          missingFields,
        });
      }
    }

    const allValid =
      validationResults.length === 0
        ? true
        : validationResults.every((r) => r.isValid);

    return {
      isValid: allValid,
      totalPatients: hasPatientsArray ? data.patients.length : 0,
      totalShipments: hasShipmentsArray ? data.shipments.length : 0,
      validationResults,
      data,
    };
  }
}

export const openaiService = new OpenAIService();
export default openaiService;
