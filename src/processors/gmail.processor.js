import gmailService from '../services/gmail.service.js';
import contentExtractorService from '../services/content-extractor.service.js';
import openaiService from '../services/openai.service.js';
import s3Service from '../services/s3.service.js';

const PROCESSED_EMAILS_KEY = 'processed-email-ids';

async function init() {
  await gmailService.initialize();
  openaiService.initialize();
  s3Service.initialize();
}

async function processEmail(email) {
  console.log(`\n📧 Processing email: "${email.subject}" from ${email.from}`);

  console.log('  📄 Extracting content...');
  const t0 = Date.now();
  const extractedContent = await contentExtractorService.extractContent(email);

  const attachments = extractedContent.attachmentContents?.map((a) => a.filename) || [];
  const images = extractedContent.images?.map((i) => i.filename) || [];
  const faxes = extractedContent.faxattachments?.map((f) => ({ filename: f.filename, url: f.url })) || [];
  if (attachments.length) console.log(`  📎 Attachments: ${attachments.join(', ')}`);
  if (images.length) console.log(`  🖼  Images: ${images.join(', ')}`);
  if (faxes.length) console.log(`  📠 Fax PDFs: ${faxes.map((f) => f.filename).join(', ')}`);

  if (faxes.length) {
    console.log(`  ☁️  Uploaded ${faxes.length} fax PDF(s) to S3`);
    for (const f of faxes) console.log(`     🔗 ${f.url}`);
  }

  const model = faxes.length ? 'gpt-5 (Response API)' : 'gpt-4.1-mini (Chat Completions)';
  console.log(`  🤖 Analyzing with OpenAI (${model})...`);
  const medicalDetails = await openaiService.extractMedicalDetails(extractedContent);
  console.log(`  ⏱️ Content Extraction: ${Date.now() - t0}ms`);

  if (medicalDetails.is_relevant === false) {
    console.log(`  ⏭️  Skipping non-medical email: ${medicalDetails.reason || 'Not relevant'}`);
    return {
      success: true,
      isRelevant: false,
      emailId: email.id,
      emailSubject: email.subject,
      emailFrom: email.from,
      emailDate: email.date,
      processedAt: new Date().toISOString(),
      reason: medicalDetails.reason,
    };
  }

  const patientCount = medicalDetails.patient ? 1 : 0;
  const shipmentCount = medicalDetails.total_shipments_found || medicalDetails.shipments?.length || 0;
  console.log(`  👥 Found ${patientCount} patient(s)`);
  console.log(`  📦 Found ${shipmentCount} shipment(s)`);

  if (medicalDetails.patient) {
    const name = medicalDetails.patient?.patient_first_name || 'Unknown';
    const source = medicalDetails.patient?.source || 'Unknown source';
    console.log(`     1. ${name} (from: ${source})`);
    medicalDetails.patient.file_url = (extractedContent.faxattachments || []).map((f) => f.url).filter(Boolean);
    if (typeof medicalDetails.patient.confidence_score === 'number') {
      console.log(`  🧠 AI self-rated confidence: ${medicalDetails.patient.confidence_score}/100`);
    }
    console.log('  ✅ Email processed successfully!');
    return {
      success: true,
      isRelevant: true,
      emailId: email.id,
      emailSubject: email.subject,
      emailFrom: email.from,
      emailDate: email.date,
      processedAt: new Date().toISOString(),
      totalPatientsFound: patientCount,
      extractedData: medicalDetails,
    };
  }

  if (medicalDetails.shipments) {
    medicalDetails.shipments.forEach((s, i) => {
      const shipper = s.shipper || 'Unknown Shipper';
      const tracking = s.tracking_number || 'No Tracking';
      const shipDate = s.ship_date || 'Unknown Date';
      console.log(`     ${i + 1}. Shipment via ${shipper} on ${shipDate} (Tracking: ${tracking})`);
    });
    console.log('  ✅ Email processed successfully!');
    return {
      success: true,
      isRelevant: true,
      emailId: email.id,
      emailSubject: email.subject,
      emailFrom: email.from,
      emailDate: email.date,
      processedAt: new Date().toISOString(),
      totalShipmentsFound: shipmentCount,
      extractedData: medicalDetails,
    };
  }

  return {
    success: true,
    isRelevant: false,
    emailId: email.id,
    emailSubject: email.subject,
    emailFrom: email.from,
    emailDate: email.date,
    processedAt: new Date().toISOString(),
    reason: 'Classified relevant but no patient or shipment object returned',
  };
}

async function handle(job, deps) {
  const messageId = job.data.messageId;
  if (!messageId) throw new Error('Gmail job missing messageId');
  console.log(`📧 Fetching email with ID: ${messageId}`);

  const email = await gmailService.getEmailDetails(messageId);
  const result = await processEmail(email);

  if (result.isRelevant === true) {
    const docs = await deps.collection.insertMany([result]);
    const mongoId = docs[0]?._id || null;
    if (mongoId) console.log(`  💾 MongoDB document id: ${mongoId}`);
  }

  return result;
}

async function onCompleted(job, deps) {
  try {
    const messageId = job.data?.messageId;
    if (messageId) {
      await deps.redis.zrem(PROCESSED_EMAILS_KEY, messageId);
      console.log(`🗑️  Removed messageId ${messageId} from ${PROCESSED_EMAILS_KEY} ZSET`);
    }
    await job.remove();
    console.log(`🗑️  Removed Job ${job.id} from Redis`);
  } catch (err) {
    console.warn(`⚠️ Cleanup error for Job ${job.id}:`, err?.message || err);
  }
}

async function onFailed(job, _err, deps) {
  try {
    const messageId = job?.data?.messageId;
    if (messageId) {
      await deps.redis.zrem(PROCESSED_EMAILS_KEY, messageId);
      console.log(`🗑️  Removed failed messageId ${messageId} from ${PROCESSED_EMAILS_KEY} ZSET`);
    }
    await job?.remove();
    console.log(`🗑️  Removed failed Job ${job?.id} from Redis`);
  } catch (err) {
    console.warn(`⚠️ Cleanup error for failed Job ${job?.id}:`, err?.message || err);
  }
}

export default {
  source: 'gmail',
  jobName: 'gmail-message',
  init,
  handle,
  onCompleted,
  onFailed,
};
