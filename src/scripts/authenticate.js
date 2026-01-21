
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CREDENTIALS_PATH = path.join(ROOT_DIR, 'credentials.json');
const TOKEN_PATH = path.join(ROOT_DIR, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  
  await fs.writeFile(TOKEN_PATH, payload);
  console.log('✅ Token saved to', TOKEN_PATH);
}

async function main() {
  console.log('🔐 Gmail Authentication Setup\n');
  
  try {
    await fs.access(CREDENTIALS_PATH);
  } catch {
    console.error('❌ Error: credentials.json not found!');
    console.log('\nPlease follow these steps:');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Create a new project or select existing one');
    console.log('3. Enable Gmail API');
    console.log('4. Go to Credentials > Create Credentials > OAuth 2.0 Client ID');
    console.log('5. Download the credentials and save as credentials.json in the project root');
    process.exit(1);
  }

  console.log('📄 Found credentials.json');
  console.log('🌐 Opening browser for authentication...\n');

  try {
    const client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });

    if (client.credentials) {
      await saveCredentials(client);
    }

    // Test the connection
    const gmail = google.gmail({ version: 'v1', auth: client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    console.log('\n✅ Authentication successful!');
    console.log(`📧 Authenticated as: ${profile.data.emailAddress}`);
    console.log(`📬 Total messages: ${profile.data.messagesTotal}`);
    console.log('\nYou can now run the application with: npm start');
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    process.exit(1);
  }
}

main();

