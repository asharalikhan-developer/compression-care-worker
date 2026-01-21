import gmailService from './gmail.service.js';
import contentExtractorService from './content-extractor.service.js';
import openaiService from './openai.service.js';
import config from '../config/index.js';

class EmailProcessorService {
  constructor() {
    this.isProcessing = false;
    this.processedEmailIds = new Set();
  }


  async initialize() {
    console.log('🚀 Initializing Email Processor Service...\n');
    
    await gmailService.initialize();
    openaiService.initialize();
    
    console.log('\n✅ All services initialized successfully!\n');
    return this;
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
      console.log(`  👥 Found ${patientCount} patient(s) in this email`);
      
      if (medicalDetails.patients) {
        medicalDetails.patients.forEach((p, i) => {
          const name = p.patient?.name || 'Unknown';
          const source = p.source || 'Unknown source';
          console.log(`     ${i + 1}. ${name} (from: ${source})`);
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
        extractedData: medicalDetails,
        validation: {
          isValid: validation.isValid,
          totalPatients: validation.totalPatients,
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


  async processUnreadEmails() {
    if (this.isProcessing) {
      console.log('⏳ Already processing emails, skipping...');
      return [];
    }

    this.isProcessing = true;
    const results = [];

    try {
      console.log('📬 Fetching unread emails...');
      const emails = await gmailService.getUnreadEmails();
      
      if (emails.length === 0) {
        console.log('📭 No unread emails found.');
        return results;
      }

      console.log(`📨 Found ${emails.length} unread email(s)`);

      for (const email of emails) {
        if (this.processedEmailIds.has(email.id)) {
          console.log(`⏭️  Skipping already processed email: ${email.id}`);
          continue;
        }

        const result = await this.processEmail(email);
        
        if (result.isRelevant === true) {
          results.push(result);
        }

        this.processedEmailIds.add(email.id);

        try {
          await gmailService.markAsRead(email.id);
          console.log(`  ✓ Marked email as read: ${email.id}`);
        } catch (error) {
          console.error(`  ⚠️ Failed to mark email as read: ${error.message}`);
        }

       
      }

      return results;
    } catch (error) {
      console.error('Error processing emails:', error.message);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

 
  async processEmailById(emailId) {
    console.log(`📧 Fetching email with ID: ${emailId}`);
    
    const email = await gmailService.getEmailDetails(emailId);
    return this.processEmail(email);
  }

 
  startMonitoring(callback) {
    console.log(`\n🔄 Starting email monitoring (checking every ${config.processing.checkIntervalMs / 1000}s)...\n`);
    
    this.processUnreadEmails().then(results => {
      if (callback && results.length > 0) {
        callback(results);
      }
    });

    const intervalId = setInterval(async () => {
      try {
        const results = await this.processUnreadEmails();
        if (callback && results.length > 0) {
          callback(results);
        }
      } catch (error) {
        console.error('Monitoring error:', error.message);
      }
    }, config.processing.checkIntervalMs);

    return () => {
      console.log('🛑 Stopping email monitoring...');
      clearInterval(intervalId);
    };
  }

  async processEmailsFromSender(senderEmail, maxResults = 10) {
    console.log(`📧 Fetching emails from: ${senderEmail}`);
    
    const emails = await gmailService.getEmailsFromSender(senderEmail, maxResults);
    const results = [];

    for (const email of emails) {
      const result = await this.processEmail(email);
      if (result.isRelevant === true) {
        results.push(result);
      }
    }

    return results;
  }

  async setupGmailWatch() {
    const topicName = config.gmail.pubsubTopic || process.env.GMAIL_PUBSUB_TOPIC;
    
    if (!topicName) {
      throw new Error('GMAIL_PUBSUB_TOPIC not configured. Please set it in your .env file or config.');
    }

    console.log(`\n🔔 Setting up Gmail watch notifications...`);
    console.log(`📬 Pub/Sub Topic: ${topicName}`);
    
    const result = await gmailService.setupWatch(topicName);
    
    return result;
  }

  async stopGmailWatch() {
    console.log(`\n🛑 Stopping Gmail watch notifications...`);
    await gmailService.stopWatch();
  }
}

export const emailProcessorService = new EmailProcessorService();
export default emailProcessorService;

