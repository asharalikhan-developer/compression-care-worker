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
    temperature: 0.7,
  },
  gmail: {
    credentialsPath: path.join(ROOT_DIR, 'credentials.json'),
    tokenPath: path.join(ROOT_DIR, 'token.json'),
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC,
  },
  processing: {
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS) || 60000,
    maxEmailsPerCheck: parseInt(process.env.MAX_EMAILS_PER_CHECK) || 10,
  },
};

export default config;

