import { Worker } from 'bullmq';
import gmailService from './gmail.service.js';
import contentExtractorService from './content-extractor.service.js';
import openaiService from './openai.service.js';
import config from '../config/index.js';
import mongoose from 'mongoose';


class EmailProcessorService {
  constructor() {
    this.isProcessing = false;
    this.processedEmailIds = new Set();
    this.mongooseConnected = false;
    this.ProcessedResult = null;
    this.worker = null;
    this.redisConnection = null;
  }


  async initialize() {
    console.log('🚀 Initializing Email Processor Service...\n');
    
    await gmailService.initialize();
    openaiService.initialize();
    
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

    // Setup Redis connection for BullMQ
    this.redisConnection = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    };

    console.log(`\n✅ Redis config loaded: ${config.redis.host}:${config.redis.port}`);
    console.log('\n✅ All services initialized successfully!\n');
    return this;
  }

   async saveResult(result) {
    if (!this.mongooseConnected || !this.ProcessedResult) return null;
    try {
      const doc = await this.ProcessedResult.insertMany(result);
      console.log(`  💾 Saved result to MongoDB with _id=${doc.length}`);
      return doc._id;
    } catch (err) {
      console.error('  ❌ Failed to save result to MongoDB (mongoose):', err.message);
      return null;
    }
  }
 
  async processEmail(email) {
    console.log(`\n📧 Processing email: "${email.subject}" from ${email.from}`);
    
    try {
      console.log('  📄 Extracting content...');
      const extractedContent = await contentExtractorService.extractContent(email);
      
      console.log('  🤖 Analyzing with OpenAI...');
      const medicalDetails = await openaiService.extractMedicalDetails(extractedContent);
      
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
      
      const validation = openaiService.validateExtraction(medicalDetails);
      
      const patientCount = medicalDetails.total_patients_found || medicalDetails.patients?.length || 0;
      const shipmentCount = medicalDetails.total_shipments_found || medicalDetails.shipments?.length || 0;
      console.log(`  👥 Found ${patientCount} patient(s)`);
      console.log(`  📦 Found ${shipmentCount} shipment(s)`);
      
      if (medicalDetails.patients) {
        medicalDetails.patients.forEach((p, i) => {
          const name = p.patient?.name || 'Unknown';
          const source = p.source || 'Unknown source';
          console.log(`     ${i + 1}. ${name} (from: ${source})`);
        });
      }
      if (medicalDetails.shipments) {
        medicalDetails.shipments.forEach((s, i) => {
          const shipper = s.shipper || 'Unknown Shipper';
          const tracking = s.tracking_number || 'No Tracking';
          const shipDate = s.ship_date || 'Unknown Date';
          console.log(`     ${i + 1}. Shipment via ${shipper} on ${shipDate} (Tracking: ${tracking})`);
        });
      }
      
      const result = {
        success: true,
        isRelevant: true,
        emailId: email.id,
        emailSubject: email.subject,
        emailFrom: email.from,
        emailDate: email.date,
        processedAt: new Date().toISOString(),
        totalPatientsFound: patientCount,
        totalShipmentsFound: shipmentCount,
        extractedData: medicalDetails,
        validation: {
          isValid: validation.isValid,
          totalPatients: validation.totalPatients,
          totalShipments: validation.totalShipments,
          validationResults: validation.validationResults,
        },
      };

      console.log('  ✅ Email processed successfully!');
      
      return result;
    } catch (error) {
      console.error(`  ❌ Error processing email: ${error.message}`);
      
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
    console.log(`📧 Fetching email with ID: ${messageId}`);
    
    try {
      const email = await gmailService.getEmailDetails(messageId);
      const result = await this.processEmail(email);
      
      // Save result to MongoDB if relevant
      if (result.isRelevant === true) {
        await this.saveResult([result]);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Error processing email ${messageId}:`, error.message);
      throw error;
    }
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
        connection: this.redisConnection,
        concurrency: concurrency,
      }
    );

    // Worker event listeners
    this.worker.on('completed', (job, result) => {
      console.log(`✅ Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, error) => {
      console.error(`❌ Job ${job?.id} failed:`, error.message);
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
    
    if (this.mongooseConnected) {
      await mongoose.disconnect();
      console.log('✅ MongoDB disconnected');
    }
    
    console.log('✅ Shutdown complete');
  }
}

export const emailProcessorService = new EmailProcessorService();
export default emailProcessorService;

