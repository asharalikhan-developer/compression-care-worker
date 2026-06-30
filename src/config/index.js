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
    model: 'gpt-4.1-mini',
    gpt5model: 'gpt-5.5',
    // gpt5model: 'gpt-5-2025-08-07',
    // gpt5model: 'gpt-5.1-2025-11-13',
    // gpt5model: 'gpt-5.2-2025-12-11',
    // gpt5model: 'gpt-5.4-2026-03-05',
    // model: 'gpt-4o-mini',
    temperature: 0.2,
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY,
    ocrModel: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
  },
  gmail: {
    credentialsPath: path.join(ROOT_DIR, 'credentialsv2.json'),
    tokenPath: path.join(ROOT_DIR, 'token.json'),
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC,
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASS || undefined,
    queueName: process.env.REDIS_QUEUE_NAME,
  },
  processing: {
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS) || 60000,
    maxEmailsPerCheck: parseInt(process.env.MAX_EMAILS_PER_CHECK) || 10,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 5,
  },
  mongo: {
    uri: process.env.MONGODB_URI,
    db: process.env.MONGODB_DB,
    collection: process.env.MONGODB_COLLECTION ,
  },
  processors: (process.env.PROCESSORS || 'gmail,client')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

export default config;

