import { Worker } from 'bullmq';
import Redis from 'ioredis';
import mongoose from 'mongoose';
import config from '../config/index.js';
import { getEnabledProcessors } from '../processors/index.js';

class WorkerService {
  constructor() {
    this.processors = null;
    this.deps = null;
    this.worker = null;
    this.redis = null;
    this.mongooseConnected = false;
    this.collection = null;
  }

  async initialize() {
    console.log('🚀 Initializing Worker Service...\n');

    this.processors = getEnabledProcessors();
    console.log(`🔌 Enabled processors: ${[...this.processors.keys()].join(', ')}`);

    if (config.mongo.uri) {
      try {
        await mongoose.connect(config.mongo.uri, { dbName: config.mongo.db, autoIndex: false });
        this.mongooseConnected = true;
        this.collection = mongoose.connection.db.collection(config.mongo.collection);
        console.log(`✅ Connected to MongoDB: ${config.mongo.db}.${config.mongo.collection}\n`);
      } catch (err) {
        console.warn('⚠️ Failed to connect to MongoDB:', err.message);
        this.mongooseConnected = false;
      }
    } else {
      console.log('ℹ️  MONGODB_URI not configured — skipping MongoDB persistence.');
    }

    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: null,
    });
    console.log(`✅ Redis config loaded: ${config.redis.host}:${config.redis.port}`);

    this.deps = {
      redis: this.redis,
      collection: this.collection,
      mongoose,
    };

    for (const processor of this.processors.values()) {
      if (typeof processor.init === 'function') {
        await processor.init(this.deps);
      }
    }

    console.log('\n✅ All services initialized successfully!\n');
    return this;
  }

  resolveProcessor(job) {
    const source = job.data?.source;
    if (!source) throw new Error(`Job ${job.id} missing data.source`);
    const processor = this.processors.get(source);
    if (!processor) {
      throw new Error(`No processor enabled for source="${source}". Enabled: ${[...this.processors.keys()].join(', ')}`);
    }
    return processor;
  }

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
        const source = job.data?.source || 'unknown';
        console.log(`\n📬 Job ${job.id} received - name: "${job.name}" source: "${source}"`);

        const processor = this.resolveProcessor(job);
        const result = await processor.handle(job, this.deps);

        console.log(`\n═══════════════════════════════════════════════════════════════`);
        console.log(`                    JOB COMPLETED: ${job.id} (${processor.source})`);
        console.log(`═══════════════════════════════════════════════════════════════\n`);
        return result;
      },
      {
        connection: this.redis,
        concurrency,
      },
    );

    this.worker.on('completed', async (job) => {
      console.log(`✅ Job ${job.id} completed successfully`);
      try {
        const processor = this.processors.get(job.data?.source);
        if (processor?.onCompleted) await processor.onCompleted(job, this.deps);
      } catch (err) {
        console.warn(`⚠️ onCompleted hook error for Job ${job.id}:`, err?.message || err);
      }
    });

    this.worker.on('failed', async (job, error) => {
      console.error(`❌ Job ${job?.id} failed:`, error?.message);
      try {
        const processor = this.processors.get(job?.data?.source);
        if (processor?.onFailed) await processor.onFailed(job, error, this.deps);
      } catch (err) {
        console.warn(`⚠️ onFailed hook error for Job ${job?.id}:`, err?.message || err);
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

  async stopWorker() {
    if (this.worker) {
      console.log('\n🛑 Stopping BullMQ Worker...');
      await this.worker.close();
      this.worker = null;
      console.log('✅ Worker stopped successfully');
    }
  }

  async shutdown() {
    console.log('\n🛑 Shutting down Worker Service...');
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

export const workerService = new WorkerService();
export default workerService;
