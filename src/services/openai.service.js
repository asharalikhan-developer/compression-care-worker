// import OpenAI from 'openai';
// import config from '../config/index.js';

// class OpenAIService {
//   constructor() {
//     this.client = null;
//   }

//   initialize() {
//     if (!config.openai.apiKey) {
//       throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in .env file');
//     }

//     this.client = new OpenAI({
//       apiKey: config.openai.apiKey,
//     });

//     console.log('✅ OpenAI service initialized successfully');
//     return this;
//   }

//   async extractMedicalDetails(extractedContent) {
//     const systemPrompt = this.buildSystemPrompt();
//     const agg = { is_relevant: null, patients: [], shipments: [] };
//     const patientIndex = new Map();
//     const shipmentIndex = new Map();

//     // Function to merge partial extraction results into aggregate
//     const mergeResults = (partial) => {
//       if (!partial || partial.is_relevant === false) return;
//       if (agg.is_relevant !== false) agg.is_relevant = partial.is_relevant ?? agg.is_relevant;

//       if (Array.isArray(partial.patients)) {
//         for (const p of partial.patients) {
//           const key = `${(p.patient?.name || '').toLowerCase()}|${p.patient?.date_of_birth || ''}`;
//           const idx = patientIndex.get(key);
//           if (idx == null) {
//             patientIndex.set(key, agg.patients.length);
//             agg.patients.push(p);
//           } else {
//             const e = agg.patients[idx];
//             agg.patients[idx] = {
//               ...e,
//               referrer: { ...(e.referrer || {}), ...(p.referrer || {}) },
//               patient: { ...(e.patient || {}), ...(p.patient || {}) },
//               prescription: {
//                 ...(e.prescription || {}),
//                 items: [ ...(e.prescription?.items || []), ...(p.prescription?.items || []) ],
//                 diagnosis: [ ...new Set([ ...(e.prescription?.diagnosis || []), ...(p.prescription?.diagnosis || []) ]) ],
//                 icd_codes: [ ...new Set([ ...(e.prescription?.icd_codes || []), ...(p.prescription?.icd_codes || []) ]) ],
//               },
//               additional_notes: p.additional_notes || e.additional_notes || null,
//               document_type: p.document_type || e.document_type || null,
//               extraction_warnings: [ ...(e.extraction_warnings || []), ...(p.extraction_warnings || []) ],
//             };
//           }
//         }
//       }

//       if (Array.isArray(partial.shipments)) {
//         for (const s of partial.shipments) {
//           const key =
//             (s.tracking_number || '').toLowerCase() ||
//             `${(s.shipper || '').toLowerCase()}|${s.ship_date || ''}|${(s.source || '').toLowerCase()}`;
//           const idx = shipmentIndex.get(key);
//           if (idx == null) {
//             shipmentIndex.set(key, agg.shipments.length);
//             agg.shipments.push(s);
//           } else {
//             const e = agg.shipments[idx];
//             agg.shipments[idx] = {
//               ...e,
//               manufacturer_template: s.manufacturer_template || e.manufacturer_template,
//               ship_date: s.ship_date || e.ship_date,
//               shipper: s.shipper || e.shipper,
//               tracking_number: s.tracking_number || e.tracking_number,
//               tracking_url: s.tracking_url || e.tracking_url,
//               expected_delivery_date: s.expected_delivery_date || e.expected_delivery_date,
//               referral_status: s.referral_status || e.referral_status,
//               line_items: [ ...(e.line_items || []), ...(s.line_items || []) ],
//               notes: s.notes || e.notes || null,
//               extraction_warnings: [ ...(e.extraction_warnings || []), ...(s.extraction_warnings || []) ],
//             };
//           }
//         }
//       }
//     };

//     // Function to call OpenAI with given prompt and optional images
//     const callModel = async ({ userPrompt, images = [] }) => {
//       const messages = [{ role: 'system', content: systemPrompt }];
//       if (images.length > 0) {
//         const content = [{ type: 'text', text: userPrompt }];
//         for (const image of images) {
//           content.push({
//             type: 'image_url',
//             image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: 'high' },
//           });
//         }
//         messages.push({ role: 'user', content });
//       } else {
//         messages.push({ role: 'user', content: userPrompt });
//       }

//       const response = await this.client.chat.completions.create({
//         model: config.openai.model,
//         messages,
//         temperature: config.openai.temperature,
//         max_tokens: 4096,
//         response_format: { type: 'json_object' },
//       });

//       const raw = response.choices[0]?.message?.content;
//       if (!raw) throw new Error('No response from OpenAI');
//       return JSON.parse(raw);
//     };

//     try {
//       // Process email body first
//       // if (extractedContent.textContent && extractedContent.textContent.trim().length > 0) {
//       //   const userPrompt = this.buildBodyPrompt(extractedContent);
//       //   const res = await callModel({ userPrompt });
//       //   mergeResults(res);
//       // }

//       // // Process each attachment separately
//       // if (Array.isArray(extractedContent.attachmentContents)) {
//       //   for (const a of extractedContent.attachmentContents) {
//       //     if (!a?.content) continue;
//       //     const userPrompt = this.buildAttachmentPrompt(a.filename || 'unknown', a.content);
//       //     const res = await callModel({ userPrompt });
//       //     mergeResults(res);
//       //   }
//       // }

//       // // Process images if any
//       // if (Array.isArray(extractedContent.images)) {
//       //   for (const img of extractedContent.images) {
//       //     const userPrompt = this.buildImagePrompt(extractedContent, img);
//       //     const res = await callModel({ userPrompt, images: [img] });
//       //     mergeResults(res);
//       //   }
//       // }

//       // return {
//       //   is_relevant: agg.is_relevant ?? (agg.patients.length > 0 || agg.shipments.length > 0),
//       //   total_patients_found: agg.patients.length,
//       //   total_shipments_found: agg.shipments.length,
//       //   patients: agg.patients,
//       //   shipments: agg.shipments,
//       // };
//     } catch (error) {
//       console.error('OpenAI extraction error:', error.message);
//       throw new Error(`Failed to extract details: ${error.message}`);
//     }
//   }

//   buildSystemPrompt() {
//     return `You are a medical and shipping document analyzer specialized in extracting structured information from healthcare documents, referrals, prescriptions, and manufacturer shipping notifications.

// IMPORTANT: First, determine if this email is related to medical/healthcare needs (patient referrals, prescriptions, medical records, compression garments, DME orders, etc.) OR manufacturer shipping notifications for those medical items.

// If the email is NOT medical-related (e.g., promotional emails, newsletters, personal messages, spam, general business correspondence), return:
// {
//   "is_relevant": false,
//   "reason": "Brief explanation of why this is not a medical document"
// }

// If the email IS medical-related OR is a manufacturer shipping notification related to a medical referral/order, extract and return a JSON object. Shipping data headers can vary by template (e.g., Customer_Number/Customer, Row_Number, Invoice_Number, txtSalesOrderNo/Order, Customer_PO_Number/PO, Order_Date/Ship Date, POD_Tracking_Number/Tracking, Shipping/Ship Via, Name, Packlist, Ship To). You MUST infer equivalent fields and normalize them into the shipment schema below.

// CRITICAL:
// - An email may contain data for MULTIPLE PATIENTS — for example, one patient's info in the email body, another in a PDF attachment, and another in an image. You MUST extract ALL patients found across ALL sources (email body, attachments, images).
// - Shipping emails may include multiple line items, tracking numbers, template-specific fields, and referral-level status updates. Detect the manufacturer template if possible and extract structured shipping information.

// Return structure:

// {
//   "is_relevant": true,
//   "total_patients_found": number,
//   "total_shipments_found": number,
//   "patients": [
//     {
//       "source": "string (e.g., 'email_body', 'attachment: filename.pdf', 'image: image.jpg')",
//       "referrer": {
//         "name": "string or null",
//         "title": "string or null (e.g., Dr., MD, NP)",
//         "specialty": "string or null",
//         "organization": "string or null",
//         "address": "string or null",
//         "phone": "string or null",
//         "fax": "string or null",
//         "email": "string or null",
//         "npi": "string or null (National Provider Identifier)",
//         "license_number": "string or null"
//       },
//       "patient": {
//         "name": "string or null",
//         "date_of_birth": "string or null (format: YYYY-MM-DD if possible)",
//         "age": "number or null",
//         "gender": "string or null",
//         "address": "string or null",
//         "phone": "string or null",
//         "email": "string or null",
//         "insurance_provider": "string or null",
//         "insurance_id": "string or null",
//         "medical_record_number": "string or null"
//       },
//       "prescription": {
//         "diagnosis": ["array of diagnosis strings"],
//         "icd_codes": ["array of ICD codes if present"],
//         "items": [
//           {
//             "name": "string",
//             "type": "string (e.g., medication, compression garment, DME)",
//             "specifications": "string or null (size, strength, details)",
//             "quantity": "string or null",
//             "frequency": "string or null",
//             "duration": "string or null",
//             "instructions": "string or null"
//           }
//         ],
//         "medical_necessity": "string or null",
//         "date_prescribed": "string or null",
//         "valid_until": "string or null"
//       },
//       "additional_notes": "string or null",
//       "document_type": "string (e.g., referral, prescription, medical_record, fax)",
//       "confidence_score": "number between 0 and 1 indicating extraction confidence",
//       "extraction_warnings": ["array of any issues or uncertainties encountered"]
//     }
//   ],
//   "shipments": [
//     {
//       "source": "string (e.g., 'email_body', 'attachment: filename.pdf')",
//       "manufacturer_template": {
//         "name": "string or null (e.g., 'Sigvaris', 'Juzo', 'Medi', etc.)",
//         "confidence": "number between 0 and 1"
//       },
//       "ship_date": "string or null (YYYY-MM-DD if possible)",
//       "shipper": "string or null (e.g., UPS, FedEx, USPS)",
//       "tracking_number": "string or null",
//       "expected_delivery_date": "string or null (YYYY-MM-DD if provided)",
//       "referral_status": "string or null (e.g., 'Shipped', 'Backordered', 'Partial Shipped')",
//       "line_items": [
//         {
//           "sku": "string or null",
//           "name": "string or null",
//           "quantity": "number or null",
//           "status": "string or null (e.g., 'Shipped', 'Backorder', 'Cancelled')"
//         }
//       ],
//       "notes": "string or null",
//       "confidence_score": "number between 0 and 1",
//       "extraction_warnings": ["array of any issues or uncertainties encountered"]
//     }
//   ]
// }

// Rules:
// 1. Extract ALL patients found — each patient should be a separate object in the "patients" array
// 2. Identify the source of each patient's data (email body, specific attachment filename, or image)
// 3. If the same patient appears in multiple sources, merge their data into one entry
// 4. Extract ALL shipping information when present, including tracking details and line item statuses
// 5. Detect manufacturer template when possible; include name and confidence
// 6. Extract all available information, using null for missing fields
// 7. Be precise with medical terminology and codes
// 8. If text is unclear or partially legible, note it in extraction_warnings
// 9. Normalize phone numbers and dates where possible
// 10. If multiple prescriptions/items exist for a patient, include all in their items array
// 11. Always return valid JSON`;
//   }

//   buildUserPrompt(extractedContent) {
//     let prompt = 'Please analyze the following content and extract medical and shipping details as per the system instructions:\n\n';

//     const hasAttachments = (extractedContent.attachmentContents && extractedContent.attachmentContents.length > 0) ||
//                           (extractedContent.images && extractedContent.images.length > 0);

//     prompt += `--- EMAIL METADATA ---\n`;
//     prompt += `Subject: ${extractedContent.subject || 'N/A'}\n`;
//     prompt += `From: ${extractedContent.from || 'N/A'}\n`;
//     prompt += `Date: ${extractedContent.date || 'N/A'}\n\n`;

//     if (extractedContent.textContent && extractedContent.textContent.trim().length > 0) {
//       prompt += `--- EMAIL BODY (IMPORTANT: This may contain primary medical or shipping information) ---\n`;
//       prompt += `${extractedContent.textContent}\n\n`;

//       if (!hasAttachments) {
//         prompt += `NOTE: No attachments were found. Extract all medical and/or shipping information from the email body above.\n\n`;
//       }
//     }

//     if (extractedContent.attachmentContents && extractedContent.attachmentContents.length > 0) {
//       for (const attachment of extractedContent.attachmentContents) {
//         prompt += `--- ATTACHMENT: ${attachment.filename} ---\n${attachment.content}\n\n`;
//       }
//     }

//     if (extractedContent.images && extractedContent.images.length > 0) {
//       prompt += `--- IMAGES ---\n`;
//       prompt += `${extractedContent.images.length} image(s) attached for analysis.\n`;
//       prompt += `Please examine the images carefully for any medical information, prescriptions, referral details, or shipping labels/tracking info.\n\n`;
//     }

//     prompt += `INSTRUCTIONS:
// 1. Check ALL sources (email body, each attachment, each image) for patient and shipping information
// 2. An email may contain MULTIPLE PATIENTS — extract ALL of them
// 3. An email may contain shipping details — extract ALL tracking, line items, and statuses
// 4. Indicate the source where each patient's or shipment's data was found
// 5. Return valid JSON including both patients and shipments arrays as applicable.`;

//     return prompt;
//   }

//   buildBodyPrompt(extractedContent) {
//     let prompt = 'Analyze EMAIL BODY ONLY and extract medical and shipping details as per the system instructions.\n\n';
//     prompt += `--- EMAIL METADATA ---\nSubject: ${extractedContent.subject || 'N/A'}\nFrom: ${extractedContent.from || 'N/A'}\nDate: ${extractedContent.date || 'N/A'}\n\n`;
//     prompt += `--- EMAIL BODY ---\n${extractedContent.textContent || 'N/A'}\n\n`;
//     prompt += `INSTRUCTIONS:\n- Keep "patients" and "shipments" strictly separate.\n- Indicate source as "email_body".`;
//     return prompt;
//   }

//   buildAttachmentPrompt(filename, content) {
//     let prompt = 'Analyze ATTACHMENT CONTENT ONLY and extract medical and shipping details as per the system instructions.\n\n';
//     prompt += `--- ATTACHMENT ---\nFilename: ${filename}\nContent:\n${content}\n\n`;
//     prompt += `INSTRUCTIONS:\n- Keep "patients" and "shipments" strictly separate.\n- Indicate source as "attachment: ${filename}".`;
//     return prompt;
//   }

//   buildImagePrompt(extractedContent, image) {
//     let prompt = 'Analyze IMAGE ONLY and extract shipping labels, tracking info, or medical data as per the system instructions.\n\n';
//     prompt += `--- IMAGE SOURCE ---\nFrom subject: ${extractedContent.subject || 'N/A'}\nDate: ${extractedContent.date || 'N/A'}\n\n`;
//     prompt += `INSTRUCTIONS:\n- Keep "patients" and "shipments" strictly separate.\n- Indicate source as "image: ${image.filename || image.mimeType || 'unknown'}".`;
//     return prompt;
//   }

//   validateExtraction(data) {
//     if (data.is_relevant === false) {
//       return {
//         isValid: true,
//         missingFields: [],
//         data,
//       };
//     }

//     const hasPatientsArray = Array.isArray(data.patients);
//     const hasShipmentsArray = Array.isArray(data.shipments);

//     if (!hasPatientsArray && !hasShipmentsArray) {
//       console.warn('Missing both patients and shipments arrays in extraction');
//       return {
//         isValid: false,
//         missingFields: ['patients', 'shipments'],
//         data,
//       };
//     }

//     const requiredPatientFields = ['patient', 'prescription', 'document_type'];
//     const validationResults = [];

//     if (hasPatientsArray) {
//       for (let i = 0; i < data.patients.length; i++) {
//         const patient = data.patients[i];
//         const missingFields = requiredPatientFields.filter(field => !(field in patient));

//         if (missingFields.length > 0) {
//           console.warn(`Patient ${i + 1}: Missing fields: ${missingFields.join(', ')}`);
//         }

//         validationResults.push({
//           patientIndex: i,
//           patientName: patient.patient?.name || 'Unknown',
//           source: patient.source || 'Unknown',
//           isValid: missingFields.length === 0,
//           missingFields,
//         });
//       }
//     }

//     const allValid = validationResults.length === 0 ? true : validationResults.every(r => r.isValid);

//     return {
//       isValid: allValid,
//       totalPatients: hasPatientsArray ? data.patients.length : 0,
//       totalShipments: hasShipmentsArray ? data.shipments.length : 0,
//       validationResults,
//       data,
//     };
//   }
// }

// export const openaiService = new OpenAIService();
// export default openaiService;

import OpenAI from "openai";
import config from "../config/index.js";

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

  async extractMedicalDetails(extractedContent) {
    const systemPrompt = this.buildSystemPrompt();
    const agg = { is_relevant: null, patients: [], shipments: [] };
    const patientIndex = new Map();
    const shipmentIndex = new Map();

    // Function to merge partial extraction results into aggregate
    const mergeResults = (partial) => {
      if (!partial || partial.is_relevant === false) return;
      if (agg.is_relevant !== false)
        agg.is_relevant = partial.is_relevant ?? agg.is_relevant;

      if (Array.isArray(partial.patients)) {
        for (const p of partial.patients) {
          const first = (p.patient_first_name || "").toLowerCase();
          const last = (p.patient_last_name || "").toLowerCase();
          const dob = p.patient_date_of_birth || "";
          const key =
            first || last || dob
              ? `${first}|${last}|${dob}`
              : `${(p.source || "").toLowerCase()}|unknown_patient`;
          const idx = patientIndex.get(key);
          if (idx == null) {
            patientIndex.set(key, agg.patients.length);
            agg.patients.push(p);
          } else {
            const e = agg.patients[idx];
            agg.patients[idx] = {
              ...e,
              primary_insurance: {
                ...(e.primary_insurance || {}),
                ...(p.primary_insurance || {}),
              },
              secondary_insurance: {
                ...(e.secondary_insurance || {}),
                ...(p.secondary_insurance || {}),
              },
              tertiary_insurance: {
                ...(e.tertiary_insurance || {}),
                ...(p.tertiary_insurance || {}),
              },
              therapist: { ...(e.therapist || {}), ...(p.therapist || {}) },
              primary_care_physician: {
                ...(e.primary_care_physician || {}),
                ...(p.primary_care_physician || {}),
              },
              product_ordered:
                p.product_ordered || e.product_ordered || null,
              document_type: p.document_type || e.document_type || null,
              extraction_warnings: [
                ...(e.extraction_warnings || []),
                ...(p.extraction_warnings || []),
              ],
            };
          }
        }
      }

      if (Array.isArray(partial.shipments)) {
        for (const s of partial.shipments) {
          const key =
            (s.tracking_number || "").toLowerCase() ||
            `${(s.shipper || "").toLowerCase()}|${s.ship_date || ""}|${(s.source || "").toLowerCase()}`;
          const idx = shipmentIndex.get(key);
          if (idx == null) {
            shipmentIndex.set(key, agg.shipments.length);
            agg.shipments.push(s);
          } else {
            const e = agg.shipments[idx];
            agg.shipments[idx] = {
              ...e,
              manufacturer_template:
                s.manufacturer_template || e.manufacturer_template,
              ship_date: s.ship_date || e.ship_date,
              shipper: s.shipper || e.shipper,
              tracking_number: s.tracking_number || e.tracking_number,
              tracking_url: s.tracking_url || e.tracking_url,
              expected_delivery_date:
                s.expected_delivery_date || e.expected_delivery_date,
              referral_status: s.referral_status || e.referral_status,
              line_items: [...(e.line_items || []), ...(s.line_items || [])],
              notes: s.notes || e.notes || null,
              extraction_warnings: [
                ...(e.extraction_warnings || []),
                ...(s.extraction_warnings || []),
              ],
            };
          }
        }
      }
    };

    // Function to call OpenAI with given prompt and optional images
    const callModel = async ({ userPrompt, images = [] }) => {
      const messages = [{ role: "system", content: systemPrompt }];
      if (images.length > 0) {
        const content = [{ type: "text", text: userPrompt }];
        for (const image of images) {
          content.push({
            type: "image_url",
            image_url: {
              url: `data:${image.mimeType};base64,${image.base64}`,
              detail: "high",
            },
          });
        }
        messages.push({ role: "user", content });
      } else {
        messages.push({ role: "user", content: userPrompt });
      }

      const response = await this.client.chat.completions.create({
        model: config.openai.model,
        messages,
        temperature: config.openai.temperature,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      });
      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error("No response from OpenAI");
      return JSON.parse(raw);
    };

    try {
      // Process email body first
      // if (extractedContent.textContent && extractedContent.textContent.trim().length > 0) {
      //   const userPrompt = this.buildBodyPrompt(extractedContent);
      //   const res = await callModel({ userPrompt });
      //   mergeResults(res);
      // }

      // // Process each attachment separately
      // if (Array.isArray(extractedContent.attachmentContents)) {
      //   for (const a of extractedContent.attachmentContents) {
      //     if (!a?.content) continue;
      //     const userPrompt = this.buildAttachmentPrompt(a.filename || 'unknown', a.content);
      //     const res = await callModel({ userPrompt });
      //     mergeResults(res);
      //   }
      // }

      // // Process images if any
      // if (Array.isArray(extractedContent.images)) {
      //   for (const img of extractedContent.images) {
      //     const userPrompt = this.buildImagePrompt(extractedContent, img);
      //     const res = await callModel({ userPrompt, images: [img] });
      //     mergeResults(res);
      //   }
      // }

      // return {
      //   is_relevant: agg.is_relevant ?? (agg.patients.length > 0 || agg.shipments.length > 0),
      //   total_patients_found: agg.patients.length,
      //   total_shipments_found: agg.shipments.length,
      //   patients: agg.patients,
      //   shipments: agg.shipments,
      // };
      const runConcurrently = async (fns, limit = 5) => {
        let i = 0;
        const out = new Array(fns.length);
        const workers = Array(Math.min(limit, fns.length))
          .fill(null)
          .map(async () => {
            while (true) {
              const idx = i++;
              if (idx >= fns.length) break;
              try {
                const val = await fns[idx]();
                out[idx] = { ok: true, value: val };
              } catch (err) {
                out[idx] = { ok: false, error: err };
              }
            }
          });
        await Promise.all(workers);
        return out;
      };

      const tasks = [];

      // Body (keep one task)
      if (
        extractedContent.textContent &&
        extractedContent.textContent.trim().length > 0
      ) {
        tasks.push(() => {
          const userPrompt = this.buildBodyPrompt(extractedContent);
          return callModel({ userPrompt });
        });
      }

      // Attachments (each as a task)
      if (Array.isArray(extractedContent.attachmentContents)) {
        for (const a of extractedContent.attachmentContents) {
          if (!a?.content) continue;
          tasks.push(() => {
            const userPrompt = this.buildAttachmentPrompt(
              a.filename || "unknown",
              a.content,
            );
            return callModel({ userPrompt });
          });
        }
      }

      // Images (each as a task; can also group all images into one task if you prefer)
      if (Array.isArray(extractedContent.images)) {
        for (const img of extractedContent.images) {
          tasks.push(() => {
            const userPrompt = this.buildImagePrompt(extractedContent, img);
            return callModel({ userPrompt, images: [img] });
          });
        }
      }

      // Run with limited concurrency (tune limit to your rate limits)
      const results = await runConcurrently(tasks, 3);
      for (const r of results) {
        if (r?.ok && r.value) mergeResults(r.value);
      }

      return {
        is_relevant:
          agg.is_relevant ??
          (agg.patients.length > 0 || agg.shipments.length > 0),
        total_patients_found: agg.patients.length,
        total_shipments_found: agg.shipments.length,
        patients: agg.patients,
        shipments: agg.shipments,
      };
    } catch (error) {
      console.error("OpenAI extraction error:", error.message);
      throw new Error(`Failed to extract details: ${error.message}`);
    }
  }

//   buildSystemPrompt() {
//     return `You are a medical and shipping document analyzer specialized in extracting structured information from healthcare documents, referrals, prescriptions, and manufacturer shipping notifications.

// IMPORTANT: First, determine if this email is related to medical/healthcare needs (patient referrals, prescriptions, medical records, compression garments, DME orders, etc.) OR  manufacturer shipping notifications (including template-based shipment
//      updates).

// If the email is NOT medical-related (e.g., promotional emails, newsletters, personal messages, spam, general business correspondence), return:
// {
//   "is_relevant": false,
//   "reason": "Brief explanation of why this is not a medical document"
// }

// If the email IS medical-related OR is a manufacturer shipping notification related to a medical referral/order, extract and return a JSON object. Shipping data headers can vary by template (e.g., Customer_Number/Customer, Row_Number, Invoice_Number, txtSalesOrderNo/Order, Customer_PO_Number/PO, Order_Date/Ship Date, POD_Tracking_Number/Tracking, Shipping/Ship Via, Name, Packlist, Ship To). You MUST infer equivalent fields and normalize them into the shipment schema below.

// CRITICAL:
// - For PATIENT data only: assume a single patient per email. Collect that single patient's details across all sources (email body, attachments, images) and return exactly one patient object when patient data is present.
// - When body/attachment/image contain partial details for the same person, treat them as ONE patient and merge fields. Do not create duplicate patient entries for split/partial data.
// - Create multiple patient entries only when there is clear evidence of different people (different full name and/or date of birth).
// - Shipping emails may include multiple line items, tracking numbers, template-specific fields, and referral-level status updates. Detect the manufacturer template if possible and extract structured shipping information.

// Return structure:

// {
//   "is_relevant": true,
//   "total_patients_found": number,
//   "total_shipments_found": number,
//   "patients": [
//     {
//       "source": "string (e.g., 'email_body', 'attachment: filename.pdf', 'image: image.jpg')",
//       "patient_first_name": "string or null",
//       "patient_last_name": "string or null",
//       "patient_address": "string or null",
//       "patient_gender": "string or null",
//       "patient_date_of_birth": "string or null (format: YYYY-MM-DD if possible)",
//       "patient_email_address": "string or null",
//       "primary_insurance": {
//         "id_number": "string or null",
//         "name": "string or null",
//         "group_number": "string or null"
//       },
//       "secondary_insurance": {
//         "id_number": "string or null",
//         "name": "string or null",
//         "group_number": "string or null"
//       },
//       "tertiary_insurance": {
//         "id_number": "string or null",
//         "name": "string or null",
//         "group_number": "string or null"
//       },
//       "product_ordered": "string or null",
//       "therapist": {
//         "first_name": "string or null",
//         "last_name": "string or null",
//         "email_address": "string or null"
//       },
//       "primary_care_physician": {
//         "first_name": "string or null",
//         "last_name": "string or null"
//       },
//       "document_type": "string (e.g., referral, prescription, medical_record, fax)",
//       "extraction_warnings": ["array of any issues or uncertainties encountered"]
//     }
//   ],
//   "shipments": [
//     {
//       "source": "string (e.g., 'email_body', 'attachment: filename.pdf')",
//       "ship_date": "string or null (YYYY-MM-DD if possible)",
//       "shipper": "string or null (e.g., UPS, FedEx, USPS)",
//       "tracking_number": "string or null",
//       "order_number": "string or null",
//       "referral_status": "string or null (e.g., 'Shipped', 'Backordered', 'Partial Shipped')",
//       "line_items": [
//         {
//           "sku": "string or null",
//           "description": "string or null",
//           "quantity": "number or null",
//         }
//       ],
//       "extraction_warnings": ["array of any issues or uncertainties encountered"]
//     }
//   ]
// }

// Rules:
// 1. For patient data, return at most ONE patient object per email and merge details from all available sources into that single patient
// 2. Identify the source of each patient's data (email body, specific attachment filename, or image)
// 3. If the patient appears in multiple sources, merge the details into one entry and do not duplicate
// 4. Do not treat a body patient and an attachment patient as separate if identifiers are compatible (same or overlapping name, DOB, address, insurance ID, or therapist/referrer context)
// 5. Extract ALL shipping information when present, including tracking details and line item statuses
// 6. Detect manufacturer template when possible; include name and confidence
// 7. Extract all available information, using null for missing fields
// 8. Be precise with medical terminology and codes
// 9. If text is unclear or partially legible, note it in extraction_warnings
// 10. Normalize phone numbers and dates where possible
// 11. Secondary and tertiary insurance should mirror primary insurance when separate secondary/tertiary values are not explicitly present
// 12. Product ordered may appear in email body, attached POC, or referral cover sheet
// 13. Set line_items to [] when not present (preferred for schema stability)
// 14. Always return valid JSON`;
//   }
buildSystemPrompt() {
    return `You are a medical and shipping document analyzer specialized in extracting structured information from healthcare documents, referrals, prescriptions, and manufacturer shipping notifications.

IMPORTANT: First, determine if this email is related to medical/healthcare needs (patient referrals, prescriptions, medical records, compression garments, DME orders, etc.) OR  manufacturer shipping notifications (including template-based shipment
     updates).

If the email is NOT medical-related (e.g., promotional emails, newsletters, personal messages, spam, general business correspondence), return:
{
  "is_relevant": false,
  "reason": "Brief explanation of why this is not a medical document"
}

If the email IS medical-related OR is a manufacturer shipping notification related to a medical referral/order, extract and return a JSON object. Shipping data headers can vary by template (e.g., Customer_Number/Customer, Row_Number, Invoice_Number, txtSalesOrderNo/Order, Customer_PO_Number/PO, Order_Date/Ship Date, POD_Tracking_Number/Tracking, Shipping/Ship Via, Name, Packlist, Ship To). You MUST infer equivalent fields and normalize them into the shipment schema below.

CRITICAL — PATIENT DATA:
- Each email contains data for exactly ONE patient. There will never be multiple patients in a single email.
- Collect that single patient's details across all sources (email body, attachments, images) and return exactly one patient object in the "patients" array.
- When body, attachment, and/or image contain partial details, they all belong to the SAME patient — merge every field into one patient object. Never create duplicate entries.

CRITICAL — SHIPMENT DATA:
- A single email may contain MULTIPLE shipments with different tracking numbers, order numbers, ship dates, or line items.
- Extract ALL shipments found across all sources (email body, attachments, images) as separate objects in the "shipments" array.
- Shipping emails may include multiple line items, tracking numbers, template-specific fields, and referral-level status updates. Detect the manufacturer template if possible and extract structured shipping information.

Return structure:

{
  "is_relevant": true,
  "total_patients_found": 0 or 1,
  "total_shipments_found": number,
  "patients": [
    {
      "source": "string (e.g., 'email_body', 'attachment: filename.pdf', 'image: image.jpg', or comma-separated if merged from multiple sources)",
      "patient_first_name": "string or null",
      "patient_last_name": "string or null",
      "patient_address": "string or null",
      "patient_gender": "string or null",
      "patient_date_of_birth": "string or null (format: YYYY-MM-DD if possible)",
      "patient_email_address": "string or null",
      "primary_insurance": {
        "id_number": "string or null",
        "name": "string or null",
        "group_number": "string or null"
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
      "document_type": "string (e.g., referral, prescription, medical_record, fax)",
      "extraction_warnings": ["array of any issues or uncertainties encountered"]
    }
  ],
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
1. The "patients" array MUST contain at most ONE object — never more than one patient per email
2. Merge all patient-related details from every source (body, attachments, images) into that single patient object
3. If patient data is found in multiple sources, list all sources comma-separated in the "source" field (e.g., "email_body, attachment: referral.pdf")
4. The "shipments" array may contain MULTIPLE objects — one per distinct shipment/tracking number found
5. Extract ALL shipping information when present, including tracking details and line item statuses
6. Detect manufacturer template when possible
7. Extract all available information, using null for missing fields
8. Be precise with medical terminology and codes
9. If text is unclear or partially legible, note it in extraction_warnings
10. Normalize phone numbers and dates where possible
11. Secondary and tertiary insurance should mirror primary insurance when separate secondary/tertiary values are not explicitly present
12. Product ordered may appear in email body, attached POC, or referral cover sheet
13. Set line_items to [] when not present (preferred for schema stability)
14. Always return valid JSON`;
  }
  
  buildUserPrompt(extractedContent) {
    let prompt =
      "Please analyze the following content and extract medical and shipping details as per the system instructions:\n\n";

    const hasAttachments =
      (extractedContent.attachmentContents &&
        extractedContent.attachmentContents.length > 0) ||
      (extractedContent.images && extractedContent.images.length > 0);

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

prompt += `INSTRUCTIONS: 
1. Check ALL sources (email body, each attachment, each image) for patient and shipping information
2. For PATIENT data, assume only a SINGLE patient per email and return only one patient object
3. If the same patient has details split between body and attachments, merge those details into that one patient record
4. Create another patient object only if identifiers clearly point to a different person
5. An email may contain shipping details — extract ALL tracking, line items, and statuses
6. Indicate the source where each patient's or shipment's data was found
7. Return valid JSON including both patients and shipments arrays as applicable.`;

    return prompt;
  }

  buildBodyPrompt(extractedContent) {
    let prompt =
      "Analyze EMAIL BODY ONLY and extract medical and shipping details as per the system instructions.\n\n";
    prompt += `--- EMAIL METADATA ---\nSubject: ${extractedContent.subject || "N/A"}\nFrom: ${extractedContent.from || "N/A"}\nDate: ${extractedContent.date || "N/A"}\n\n`;
    prompt += `--- EMAIL BODY ---\n${extractedContent.textContent || "N/A"}\n\n`;
    prompt += `INSTRUCTIONS:\n- Keep "patients" and "shipments" strictly separate.\n- Indicate source as "email_body".`;
    return prompt;
  }

  buildAttachmentPrompt(filename, content) {
    let prompt =
      "Analyze ATTACHMENT CONTENT ONLY and extract medical and shipping details as per the system instructions.\n\n";
    prompt += `--- ATTACHMENT ---\nFilename: ${filename}\nContent:\n${content}\n\n`;
    prompt += `INSTRUCTIONS:\n- Keep "patients" and "shipments" strictly separate.\n- Indicate source as "attachment: ${filename}".`;
    return prompt;
  }

  buildImagePrompt(extractedContent, image) {
    let prompt =
      "Analyze IMAGE ONLY and extract shipping labels, tracking info, or medical data as per the system instructions.\n\n";
    prompt += `--- IMAGE SOURCE ---\nFrom subject: ${extractedContent.subject || "N/A"}\nDate: ${extractedContent.date || "N/A"}\n\n`;
    prompt += `INSTRUCTIONS:\n- Keep "patients" and "shipments" strictly separate.\n- Indicate source as "image: ${image.filename || image.mimeType || "unknown"}".`;
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

    const requiredPatientFields = [
      "patient_first_name",
      "patient_last_name",
      "patient_address",
      "patient_gender",
      "patient_date_of_birth",
      "patient_email_address",
      "primary_insurance",
      "secondary_insurance",
      "tertiary_insurance",
      "product_ordered",
      "therapist",
      "primary_care_physician",
      "document_type",
    ];
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
          patientName:
            `${patient.patient_first_name || ""} ${patient.patient_last_name || ""}`.trim() ||
            "Unknown",
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
