import express from 'express';
import cors from 'cors';
import emailProcessorService from './services/email-processor.service.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

console.log('═══════════════════════════════════════════════════════════════');
console.log('       COMPRESSION CARE - EMAIL PROCESSOR API');
console.log('═══════════════════════════════════════════════════════════════\n');

await emailProcessorService.initialize();

if (process.env.GMAIL_PUBSUB_TOPIC) {
  try {
    console.log('🔔 Setting up Gmail push notifications...');
    const watchResult = await emailProcessorService.setupGmailWatch();
    console.log(`✅ Gmail watch enabled successfully!`);
    console.log(`   Expires: ${new Date(parseInt(watchResult.expiration)).toISOString()}`);
  } catch (error) {
    console.log('⚠️  Gmail watch setup failed:', error.message);
    console.log('   You can set it up manually by calling: POST /api/setup-watch');
  }
} else {
  console.log('⚠️  GMAIL_PUBSUB_TOPIC not configured');
  console.log('   Set it in your .env file or call: POST /api/setup-watch');
}

app.post('/api/gmail-webhook', async (req, res) => {
  try {
    res.status(200).send('OK');

    console.log('\n📬 Gmail Notification Received from Pub/Sub');
    
    const pubsubMessage = req.body.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      console.log('⚠️  No message data received');
      return;
    }

    const decodedData = Buffer.from(pubsubMessage.data, 'base64').toString();
    console.log('📨 Notification data:', decodedData);
    
    const notification = JSON.parse(decodedData);
    console.log(`📧 Email Address: ${notification.emailAddress}`);
    console.log(`🔔 History ID: ${notification.historyId}`);

    console.log('\n--- Processing New Emails ---\n');
    const results = await emailProcessorService.processUnreadEmails();
    
    if (results.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('                    EXTRACTION RESULTS');
      console.log('═══════════════════════════════════════════════════════════════\n');
      
      for (const result of results) {
        console.log(`\n📧 Email: ${result.emailSubject}`);
        console.log(`   From: ${result.emailFrom}`);
        console.log(`   Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
        
        if (result.success && result.totalPatientsFound) {
          console.log(`   Patients Found: ${result.totalPatientsFound}`);
        }
        
        console.log('\n───────────────────────────────────────────────────────────────');
      }
      
      console.log(`\n✅ Processed ${results.length} relevant email(s) from notification`);
    } else {
      console.log('📭 No new relevant medical emails to process.');
    }

  } catch (error) {
    console.error('\n❌ Error processing Gmail webhook:', error.message);
    console.error(error.stack);
  }
});

app.post('/api/setup-watch', async (req, res) => {
  try {
    const topicName = req.body.topicName || process.env.GMAIL_PUBSUB_TOPIC;
    
    if (!topicName) {
      return res.status(400).json({
        success: false,
        error: 'GMAIL_PUBSUB_TOPIC not configured. Please provide topicName in request body or set GMAIL_PUBSUB_TOPIC environment variable.',
        example: {
          topicName: 'projects/your-project-id/topics/gmail-notifications'
        }
      });
    }

    console.log(`\n🔔 Setting up Gmail watch for topic: ${topicName}`);
    const result = await emailProcessorService.setupGmailWatch();
    
    res.json({
      success: true,
      message: 'Gmail watch setup successfully',
      historyId: result.historyId,
      expiration: new Date(parseInt(result.expiration)).toISOString(),
      expiresIn: '7 days',
      note: 'You will need to renew this watch after 7 days'
    });
  } catch (error) {
    console.error('❌ Error setting up Gmail watch:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log('\n✅ Server initialized successfully!');
  console.log(`\n🚀 API Server running on: http://localhost:${PORT}`);
  console.log(`\n📍 Endpoints:`);
  console.log(`   POST http://localhost:${PORT}/api/gmail-webhook  - Gmail notification webhook`);
  console.log(`   POST http://localhost:${PORT}/api/setup-watch     - Setup Gmail watch`);
  console.log('\n═══════════════════════════════════════════════════════════════\n');
});

export { emailProcessorService };
