import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4.1',
    // model: 'gpt-4o-mini',
    temperature: 0.2,
  },
  gmail: {
    credentialsPath: path.join(ROOT_DIR, 'credentialsv2.json'),
    tokenPath: path.join(ROOT_DIR, 'token.json'),
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    queueName: process.env.REDIS_QUEUE_NAME || 'gmail-message-queue',
  },
  processing: {
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS) || 60000,
    maxEmailsPerCheck: parseInt(process.env.MAX_EMAILS_PER_CHECK) || 10,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 5,
  },
};

export default config;

