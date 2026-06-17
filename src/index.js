import workerService from './services/worker.service.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('       COMPRESSION CARE - WORKER');
console.log('═══════════════════════════════════════════════════════════════\n');

await workerService.initialize();
workerService.startWorker();

console.log('═══════════════════════════════════════════════════════════════');
console.log('   Worker is now listening for jobs from the queue...');
console.log('═══════════════════════════════════════════════════════════════\n');

const gracefulShutdown = async (signal) => {
  console.log(`\n📌 Received ${signal}. Starting graceful shutdown...`);
  await workerService.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export { workerService };
