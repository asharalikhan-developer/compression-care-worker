import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import fs from 'fs/promises';
import path from 'path';
import config from '../config/index.js';

class GmailService {
  constructor() {
    this.gmail = null;
    this.auth = null;
  }


  async loadSavedCredentials() {
    try {
      const content = await fs.readFile(config.gmail.tokenPath, 'utf-8');
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

 
  async saveCredentials(client) {
    const content = await fs.readFile(config.gmail.credentialsPath, 'utf-8');
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    
    await fs.writeFile(config.gmail.tokenPath, payload);
  }


  async initialize() {
    this.auth = await this.loadSavedCredentials();
    
    if (!this.auth) {
      this.auth = await authenticate({
        scopes: config.gmail.scopes,
        keyfilePath: config.gmail.credentialsPath,
      });
      
      if (this.auth.credentials) {
        await this.saveCredentials(this.auth);
      }
    }

    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
    console.log('✅ Gmail service initialized successfully');
    return this;
  }

  async getUnreadEmails(maxResults = config.processing.maxEmailsPerCheck) {
    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults,
    });

    const messages = response.data.messages || [];
    const emails = [];

    for (const message of messages) {
      const email = await this.getEmailDetails(message.id);
      emails.push(email);
    }

    return emails;
  }

 
  async getEmailDetails(messageId) {
    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const message = response.data;
    const headers = message.payload.headers;
    
    const email = {
      id: message.id,
      threadId: message.threadId,
      subject: this.getHeader(headers, 'Subject'),
      from: this.getHeader(headers, 'From'),
      to: this.getHeader(headers, 'To'),
      date: this.getHeader(headers, 'Date'),
      body: {
        text: null,
        html: null,
      },
      attachments: [],
    };

    await this.parseMessageParts(message.payload, email, messageId);

    return email;
  }

  getHeader(headers, name) {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : null;
  }


  async parseMessageParts(payload, email, messageId) {
    if (payload.body?.data) {
      const content = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      
      if (payload.mimeType === 'text/plain') {
        email.body.text = content;
      } else if (payload.mimeType === 'text/html') {
        email.body.html = content;
      }
    }

    if (payload.body?.attachmentId) {
      const attachment = await this.getAttachment(messageId, payload.body.attachmentId);
      email.attachments.push({
        filename: payload.filename,
        mimeType: payload.mimeType,
        size: payload.body.size,
        data: attachment,
      });
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        await this.parseMessageParts(part, email, messageId);
      }
    }
  }


  async getAttachment(messageId, attachmentId) {
    const response = await this.gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });

    return Buffer.from(response.data.data, 'base64');
  }


  async markAsRead(messageId) {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });
  }


  async getEmailsFromSender(senderEmail, maxResults = 10) {
    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: `from:${senderEmail}`,
      maxResults,
    });

    const messages = response.data.messages || [];
    const emails = [];

    for (const message of messages) {
      const email = await this.getEmailDetails(message.id);
      emails.push(email);
    }

    return emails;
  }

  async setupWatch(topicName) {
    try {
      const response = await this.gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName: topicName,
          labelIds: ['INBOX'],
          labelFilterAction: 'include'
        }
      });

      console.log('✅ Gmail watch setup successful');
      console.log(`📬 History ID: ${response.data.historyId}`);
      console.log(`⏰ Expiration: ${new Date(parseInt(response.data.expiration)).toISOString()}`);

      return {
        historyId: response.data.historyId,
        expiration: response.data.expiration
      };
    } catch (error) {
      console.error('❌ Failed to setup Gmail watch:', error.message);
      throw error;
    }
  }

  async stopWatch() {
    try {
      await this.gmail.users.stop({
        userId: 'me'
      });
      console.log('✅ Gmail watch stopped');
    } catch (error) {
      console.error('❌ Failed to stop Gmail watch:', error.message);
      throw error;
    }
  }
}

export const gmailService = new GmailService();
export default gmailService;

