import emailProcessorService from './services/email-processor.service.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('       COMPRESSION CARE - EMAIL PROCESSOR WORKER');
console.log('═══════════════════════════════════════════════════════════════\n');

// Initialize the email processor service
await emailProcessorService.initialize();

// Start the BullMQ worker to listen for message IDs from Redis
emailProcessorService.startWorker();

console.log('═══════════════════════════════════════════════════════════════');
console.log('   Worker is now listening for email message IDs from Redis');
console.log('   Waiting for jobs from the gmail-message-queue...');
console.log('═══════════════════════════════════════════════════════════════\n');

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`\n📌 Received ${signal}. Starting graceful shutdown...`);
  await emailProcessorService.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export { emailProcessorService };
