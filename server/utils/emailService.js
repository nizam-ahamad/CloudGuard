const axios = require('axios');

async function sendNotificationEmail({ type, to, name, otp }) {
  const webhookUrl = process.env.GOOGLE_SCRIPT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('GOOGLE_SCRIPT_WEBHOOK_URL not configured. Skipping email dispatch.');
    return;
  }

  try {
    await axios.post(webhookUrl, {
      secret: process.env.GAS_SECRET || process.env.EMAIL_SECRET || 'cloudguard-secure-secret-2024',
      type,
      to,
      name: name || '',
      otp: otp || '',
    });
    console.log(`[Email Service] ${type} notification successfully dispatched to ${to}`);
  } catch (error) {
    console.error(`Failed to dispatch ${type} email to ${to}:`, error.message);
  }
}

module.exports = { sendNotificationEmail };
