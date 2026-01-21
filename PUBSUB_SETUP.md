# Gmail Pub/Sub Push Notifications Setup Guide

This guide will help you set up real-time Gmail notifications using Google Cloud Pub/Sub.

## 🎯 Overview

Instead of polling for new emails, your API will receive instant notifications from Gmail whenever a new email arrives. This is more efficient and provides real-time processing.

## 📋 Prerequisites

- Google Cloud Project with Gmail API enabled
- Gmail account authenticated (credentials.json and token.json)
- Your API running and accessible via ngrok

## 🚀 Setup Steps

### Step 1: Configure Your Pub/Sub Topic in .env

Add this to your `.env` file:

```env
GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/YOUR_TOPIC_NAME
```

Replace:
- `YOUR_PROJECT_ID` with your Google Cloud Project ID
- `YOUR_TOPIC_NAME` with the name of your Pub/Sub topic

Example:
```env
GMAIL_PUBSUB_TOPIC=projects/my-project-12345/topics/gmail-notifications
```

### Step 2: Grant Gmail API Permissions to Publish

In Google Cloud Console, grant the Gmail API service account permission to publish to your topic:

1. Go to your Pub/Sub topic in Google Cloud Console
2. Click "PERMISSIONS" tab
3. Click "ADD PRINCIPAL"
4. Add this service account:
   ```
   gmail-api-push@system.gserviceaccount.com
   ```
5. Assign the role: **Pub/Sub Publisher**
6. Click "SAVE"

### Step 3: Configure Push Subscription

Your Pub/Sub subscription should already be configured to push to:

```
https://your-ngrok-url.ngrok-free.app/api/gmail-webhook
```

Make sure:
- Subscription type: **Push**
- Endpoint URL: Your ngrok URL + `/api/gmail-webhook`
- Authentication: None (ngrok handles HTTPS)

### Step 4: Enable Gmail Watch

Call this endpoint once to start receiving notifications:

```bash
POST https://your-ngrok-url.ngrok-free.app/api/setup-watch
```

Using curl:
```bash
curl -X POST https://your-ngrok-url.ngrok-free.app/api/setup-watch
```

Using Postman:
1. Method: POST
2. URL: `https://your-ngrok-url.ngrok-free.app/api/setup-watch`
3. Click Send

**Response:**
```json
{
  "success": true,
  "message": "Gmail watch setup successfully",
  "historyId": "1234567",
  "expiration": "1234567890123"
}
```

**Note:** Gmail watch expires after 7 days. You'll need to call `/api/setup-watch` again to renew it.

## 📍 API Endpoints

### 1. Gmail Webhook (Pub/Sub calls this automatically)
```
POST /api/gmail-webhook
```
This is called automatically by Google Cloud Pub/Sub when a new email arrives.

### 2. Setup Gmail Watch
```
POST /api/setup-watch
```
Enable Gmail push notifications (valid for 7 days).

### 3. Manual Processing
```
POST /api/process-emails
```
Manually trigger email processing (for testing or backup).

### 4. Health Check
```
GET /api/health
```
Check if the API is running.

## 🔄 How It Works

1. **New Email Arrives** → Gmail detects it
2. **Gmail Notifies** → Sends notification to your Pub/Sub topic
3. **Pub/Sub Pushes** → Calls your `/api/gmail-webhook` endpoint
4. **Your API Processes** → Extracts patient data and marks email as read
5. **Done!** → All happens in real-time, automatically

## 🔧 Troubleshooting

### Watch Expired
Gmail watch expires after 7 days. Call `/api/setup-watch` again to renew.

### Not Receiving Notifications
1. Check that gmail-api-push@system.gserviceaccount.com has Publisher role
2. Verify your ngrok URL is correct in Pub/Sub subscription
3. Ensure GMAIL_PUBSUB_TOPIC is set correctly in .env
4. Check server logs for errors

### Testing Locally
Send a test email to your Gmail and watch the server logs. You should see:
```
📬 Gmail Notification Received from Pub/Sub
📨 Notification data: {...}
📧 Email Address: your-email@gmail.com
```

## 📊 Current ngrok URL

Your current public API URL:
```
https://glisky-untackling-ethel.ngrok-free.dev
```

Webhook endpoint for Pub/Sub:
```
https://glisky-untackling-ethel.ngrok-free.dev/api/gmail-webhook
```

**Important:** When ngrok restarts, you'll get a new URL. You'll need to update:
1. The Pub/Sub push subscription endpoint
2. Call `/api/setup-watch` again with the new setup

## 🎉 Success!

Once set up, your system will:
- ✅ Receive instant notifications for new emails
- ✅ Automatically process medical emails
- ✅ Extract patient information
- ✅ Mark emails as read
- ✅ All in real-time, with no polling!








