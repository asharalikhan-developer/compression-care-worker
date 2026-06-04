import { Worker } from 'bullmq';
import Redis from 'ioredis';
import gmailService from './gmail.service.js';
import contentExtractorService from './content-extractor.service.js';
import openaiService from './openai.service.js';
import config from '../config/index.js';
import mongoose from 'mongoose';
import cloudinaryService from './cloudinary.service.js';
import { recordRun } from '../utils/test-case-recorder.js';
import bus from '../utils/processing-events.js';
import { runWithLogContext, flushLogs } from '../utils/processing-logger.js';

function emit(documentId, type, payload = {}) {
  bus.emit('event', { documentId, type, ts: Date.now(), ...payload });
}

const PROCESSED_EMAILS_KEY = 'processed-email-ids';


class EmailProcessorService {
  constructor() {
    this.isProcessing = false;
    this.processedEmailIds = new Set();
    this.mongooseConnected = false;
    this.ProcessedResult = null;
    this.worker = null;
    this.redis = null;
  }


  async initialize() {
    console.log('🚀 Initializing Email Processor Service...\n');
    
    await gmailService.initialize();
    openaiService.initialize();
    cloudinaryService.initialize(); // <-- add this

    
    const mongoUri = process.env.MONGODB_URI;
    const mongoDbName = process.env.MONGODB_DB || 'compressioncare';
    const mongoCollectionName = process.env.MONGODB_COLLECTION || 'processed_results';

    if (mongoUri) {
      try {
        await mongoose.connect(mongoUri, { dbName: mongoDbName, autoIndex: false });
        this.mongooseConnected = true;
        // Flexible schema to store the full result object as-is
        const ProcessedResultSchema = new mongoose.Schema({}, { strict: false });
        this.ProcessedResult = mongoose.model('ProcessedResult', ProcessedResultSchema, mongoCollectionName);
        console.log(`\n✅ Connected to MongoDB via mongoose: ${mongoDbName}.${mongoCollectionName}\n`);
      } catch (err) {
        console.warn('⚠️ Failed to connect to MongoDB (mongoose):', err.message);
        this.mongooseConnected = false;
      }
    } else {
      console.log('ℹ️  MONGODB_URI not configured — skipping MongoDB persistence.');
    }

    // Single ioredis client shared by BullMQ worker and ZSET operations
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: null,
    });

    console.log(`\n✅ Redis config loaded: ${config.redis.host}:${config.redis.port}`);
    console.log('\n✅ All services initialized successfully!\n');
    return this;
  }

   async saveResult(result) {
    if (!this.mongooseConnected || !this.ProcessedResult) return null;
    try {
      const docs = await this.ProcessedResult.insertMany(result);
      console.log(`  💾 Saved ${docs.length} result(s) to MongoDB`);
      return docs[0]?._id || null;
    } catch (err) {
      console.error('  ❌ Failed to save result to MongoDB (mongoose):', err.message);
      return null;
    }
  }
 
  async processEmail(email) {
    const docId = email.id;
    const log = (msg) => console.log(msg);
    log(`\n📧 Processing email: "${email.subject}" from ${email.from}`);

    emit(docId, 'email_received', { subject: email.subject, from: email.from, date: email.date });

    try {
      log('  📄 Extracting content...');
      const t0 = Date.now();
      emit(docId, 'extracting');
      const extractedContent = await contentExtractorService.extractContent(email);

      // Emit attachment info
      const attachments = extractedContent.attachmentContents?.map(a => a.filename) || [];
      const images = extractedContent.images?.map(i => i.filename) || [];
      const faxes = extractedContent.faxattachments?.map(f => ({ filename: f.filename, url: f.url })) || [];
      if (attachments.length) log(`  📎 Attachments: ${attachments.join(', ')}`);
      if (images.length) log(`  🖼  Images: ${images.join(', ')}`);
      if (faxes.length) log(`  📠 Fax PDFs: ${faxes.map(f => f.filename).join(', ')}`);
      emit(docId, 'extracted', { attachments, images, faxCount: faxes.length });

      // Cloudinary uploads (fax PDFs) — emit URL for each
      if (faxes.length) {
        log(`  ☁️  Uploading ${faxes.length} fax PDF(s) to Cloudinary...`);
        emit(docId, 'cloudinary_uploading', { files: faxes.map(f => f.filename) });
        for (const f of faxes) log(`     🔗 ${f.url}`);
        emit(docId, 'cloudinary_uploaded', { files: faxes });
      }

      const model = faxes.length ? 'gpt-5 (Response API)' : 'gpt-4.1-mini (Chat Completions)';
      log(`  🤖 Analyzing with OpenAI (${model})...`);
      emit(docId, 'openai_processing', { model });
      const medicalDetails = await openaiService.extractMedicalDetails(extractedContent);
      log(`  ⏱️ Content Extraction: ${Date.now() - t0}ms`);

      if (medicalDetails.is_relevant === false) {
        log(`  ⏭️  Skipping non-medical email: ${medicalDetails.reason || 'Not relevant'}`);
        emit(docId, 'complete', { type: 'not_relevant', reason: medicalDetails.reason });
        await recordRun(email.id, medicalDetails, { logs: flushLogs(docId) }).catch(() => ({}));
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
      log(`  👥 Found ${patientCount} patient(s)`);
      log(`  📦 Found ${shipmentCount} shipment(s)`);

      if (medicalDetails.patient) {
        const name = medicalDetails.patient?.patient_first_name || 'Unknown';
        const source = medicalDetails.patient?.source || 'Unknown source';
        log(`     1. ${name} (from: ${source})`);
        medicalDetails.patient.file_url = (extractedContent.faxattachments || []).map(f => f.url).filter(Boolean);
        if (typeof medicalDetails.patient.confidence_score === 'number') {
          log(`  🧠 AI self-rated confidence: ${medicalDetails.patient.confidence_score}/100`);
        }
        log('  ✅ Email processed successfully!');
        const patientResult = {
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
        const { comparison } = await recordRun(email.id, medicalDetails, { logs: flushLogs(docId) }).catch(() => ({ comparison: null }));
        emit(docId, 'payload', { document: patientResult });
        emit(docId, 'complete', { type: 'patient', confidenceScore: comparison?.confidenceScore ?? null, label: comparison?.label ?? null, aiConfidence: medicalDetails.patient?.confidence_score ?? null });
        return patientResult;
      }

      if (medicalDetails.shipments) {
        medicalDetails.shipments.forEach((s, i) => {
          const shipper = s.shipper || 'Unknown Shipper';
          const tracking = s.tracking_number || 'No Tracking';
          const shipDate = s.ship_date || 'Unknown Date';
          log(`     ${i + 1}. Shipment via ${shipper} on ${shipDate} (Tracking: ${tracking})`);
        });
        log('  ✅ Email processed successfully!');
        const shipmentResult = {
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
        const { comparison } = await recordRun(email.id, medicalDetails, { logs: flushLogs(docId) }).catch(() => ({ comparison: null }));
        emit(docId, 'payload', { document: shipmentResult });
        emit(docId, 'complete', { type: 'shipment', confidenceScore: comparison?.confidenceScore ?? null, label: comparison?.label ?? null });
        return shipmentResult;
      }
    } catch (error) {
      log(`  ❌ Error processing email: ${error.message}`, 'error');
      flushLogs(docId);
      emit(docId, 'error', { message: error.message });
      return {
        success: false,
        isRelevant: null,
        emailId: email.id,
        emailSubject: email.subject,
        emailFrom: email.from,
        emailDate: email.date,
        processedAt: new Date().toISOString(),
        error: error.message,
      };
    }
  }


  /**
   * Process a single email by its message ID
   * Fetches email from Gmail API, processes it, and saves to MongoDB
   */
  async processEmailById(messageId) {
    return runWithLogContext(messageId, async () => {
      console.log(`📧 Fetching email with ID: ${messageId}`);

      try {
        const email = await gmailService.getEmailDetails(messageId);
        const result = await this.processEmail(email);

        // Save result to MongoDB if relevant
        if (result.isRelevant === true) {
          const mongoId = await this.saveResult([result]);
          if (mongoId) {
            console.log(`  💾 MongoDB document id: ${mongoId}`);
            emit(messageId, 'saved', {
              mongoId: String(mongoId),
              savedAt: new Date().toISOString(),
              document: result,
            });
          }
        }

        return result;
      } catch (error) {
        console.error(`❌ Error processing email ${messageId}:`, error.message);
        throw error;
      }
    });
  }

  /**
   * Start BullMQ Worker to listen for message IDs from Redis
   * This will process emails as they come in from the other server
   */
  startWorker() {
    const queueName = config.redis.queueName;
    const concurrency = config.processing.concurrency;

    console.log(`\n🔄 Starting BullMQ Worker...`);
    console.log(`   Queue: ${queueName}`);
    console.log(`   Concurrency: ${concurrency}`);
    console.log(`   Redis: ${config.redis.host}:${config.redis.port}\n`);

    this.worker = new Worker(
      queueName,
      async (job) => {
        const messageId = job.data.messageId;
        console.log(`\n📬 Job ${job.id} received - Message ID: ${messageId}`);

        try {
          const result = await this.processEmailById(messageId);
          
          console.log(`\n═══════════════════════════════════════════════════════════════`);
          console.log(`                    JOB COMPLETED: ${job.id}`);
          console.log(`═══════════════════════════════════════════════════════════════`);
          console.log(`   Email: ${result.emailSubject || 'N/A'}`);
          console.log(`   From: ${result.emailFrom || 'N/A'}`);
          console.log(`   Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
          console.log(`   Relevant: ${result.isRelevant ? 'Yes' : 'No'}`);
          
          if (result.success && result.isRelevant) {
            if (result.totalPatientsFound) {
              console.log(`   Patients Found: ${result.totalPatientsFound}`);
            }
            if (result.totalShipmentsFound) {
              console.log(`   Shipments Found: ${result.totalShipmentsFound}`);
            }
          }
          console.log(`───────────────────────────────────────────────────────────────\n`);

          return result;
        } catch (error) {
          console.error(`❌ Job ${job.id} failed:`, error.message);
          throw error;
        }
      },
      {
        connection: this.redis,
        concurrency: concurrency,
      }
    );

    // Worker event listeners
    this.worker.on('completed', async (job, result) => {
      console.log(`✅ Job ${job.id} completed successfully`);
      try {
        const messageId = job.data?.messageId;
        // Remove messageId from the processed-email-ids ZSET so the producer
        // won't skip it with "already queued" if the same email appears again.
        if (messageId) {
          await this.redis.zrem(PROCESSED_EMAILS_KEY, messageId);
          console.log(`🗑️  Removed messageId ${messageId} from ${PROCESSED_EMAILS_KEY} ZSET`);
        }
        // Remove the BullMQ job itself from Redis
        await job.remove();
        console.log(`🗑️  Removed Job ${job.id} from Redis`);
      } catch (err) {
        console.warn(`⚠️ Cleanup error for Job ${job.id}:`, err?.message || err);
      }
    });

    this.worker.on('failed', async (job, error) => {
      console.error(`❌ Job ${job?.id} failed:`, error.message);
      try {
        const messageId = job?.data?.messageId;
        // Remove messageId from ZSET so the producer can re-enqueue it
        if (messageId) {
          await this.redis.zrem(PROCESSED_EMAILS_KEY, messageId);
          console.log(`🗑️  Removed failed messageId ${messageId} from ${PROCESSED_EMAILS_KEY} ZSET`);
        }
        await job?.remove();
        console.log(`🗑️  Removed failed Job ${job?.id} from Redis`);
      } catch (err) {
        console.warn(`⚠️ Cleanup error for failed Job ${job?.id}:`, err?.message || err);
      }
    });

    this.worker.on('error', (error) => {
      console.error('❌ Worker error:', error.message);
    });

    this.worker.on('ready', () => {
      console.log('🟢 Worker is ready and listening for jobs...\n');
    });

    return this.worker;
  }

  /**
   * Stop the BullMQ Worker
   */
  async stopWorker() {
    if (this.worker) {
      console.log('\n🛑 Stopping BullMQ Worker...');
      await this.worker.close();
      this.worker = null;
      console.log('✅ Worker stopped successfully');
    }
  }

  /**
   * Graceful shutdown - close all connections
   */
  async shutdown() {
    console.log('\n🛑 Shutting down Email Processor Service...');
    
    await this.stopWorker();

    if (this.redis) {
      await this.redis.quit();
      console.log('✅ Redis disconnected');
    }
    
    if (this.mongooseConnected) {
      await mongoose.disconnect();
      console.log('✅ MongoDB disconnected');
    }
    
    console.log('✅ Shutdown complete');
  }
}

export const emailProcessorService = new EmailProcessorService();
export default emailProcessorService;

