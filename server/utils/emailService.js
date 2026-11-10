const { Resend } = require('resend');

if (!process.env.RESEND_API_KEY) {
  console.error('[EmailService Error]: RESEND_API_KEY is not defined in environment variables.');
}

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM || 'CloudGuard <noreply@cloudguard.site>';

/**
 * Sends an activation OTP verification email
 */
async function sendActivationOtp(email, otp, name = '') {
  const trimmedName = name ? name.trim() : '';
  const subject = `${otp} is your CloudGuard verification code`;
  const html = getOtpEmailHtml({
    title: "Verify your email",
    subtitle: trimmedName ? `Hi ${trimmedName},` : "Hello,",
    message: "Enter the code below to complete your registration and activate your vault.",
    otp: otp,
    footerNotice: "This code expires in 10 minutes. If you did not sign up for CloudGuard, you can safely ignore this message."
  });

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: subject,
      html: html
    });

    if (error) {
      console.error('[Resend Activation Error]:', error);
      return { success: false, error };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('[Resend Activation Exception]:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Sends a password reset OTP email
 */
async function sendResetOtp(email, otp, name = '') {
  const trimmedName = name ? name.trim() : '';
  const subject = `${otp} is your CloudGuard reset code`;
  const html = getOtpEmailHtml({
    title: "Reset your password",
    subtitle: trimmedName ? `Hi ${trimmedName},` : "Hello,",
    message: "We received a request to reset your password. Use the code below to proceed.",
    otp: otp,
    footerNotice: "This code expires in 10 minutes. If you didn't request a reset, you can safely ignore this message."
  });

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: subject,
      html: html
    });

    if (error) {
      console.error('[Resend Reset Error]:', error);
      return { success: false, error };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('[Resend Reset Exception]:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Sends a welcome email upon successful vault creation
 */
async function sendWelcomeEmail(email, name = '') {
  const trimmedName = name ? name.trim() : '';
  const subject = `Welcome to CloudGuard${trimmedName ? ', ' + trimmedName : ''}`;
  const html = getWelcomeEmailHtml(trimmedName);

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: subject,
      html: html
    });

    if (error) {
      console.error('[Resend Welcome Error]:', error);
      return { success: false, error };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('[Resend Welcome Exception]:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Backward compatibility dispatcher
 */
async function sendNotificationEmail({ type, to, name, otp }) {
  if (type === 'activation') {
    return sendActivationOtp(to, otp, name);
  } else if (type === 'reset') {
    return sendResetOtp(to, otp, name);
  } else if (type === 'welcome') {
    return sendWelcomeEmail(to, name);
  }
  return { success: false, error: `Unknown email type: ${type}` };
}

// -------------------------------------------------------------
// Verbatim HTML Templates
// -------------------------------------------------------------
function getWelcomeEmailHtml(name) {
  const greeting = name ? `Welcome aboard, ${name}.` : "Welcome aboard.";
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a; padding: 48px 16px;">
      <tr>
        <td align="center">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 460px; background-color: #141414; border: 1px solid #262626; border-radius: 14px; overflow: hidden;">
            <tr>
              <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #222222;">
                <span style="font-size: 17px; font-weight: 700; letter-spacing: -0.4px; color: #ffffff;">
                  CloudGuard
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px 32px 28px 32px;">
                <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 600; color: #f5f5f5; letter-spacing: -0.3px;">
                  ${greeting}
                </h1>
                <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #a1a1a1;">
                  Your digital vault is ready. Start storing, organizing, and accessing your files securely from anywhere.
                </p>
                <table border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td>
                      <a href="https://cloudguard.site/dashboard" target="_blank" style="display: inline-block; background-color: #ffffff; color: #0a0a0a; font-size: 13px; font-weight: 600; text-decoration: none; padding: 10px 22px; border-radius: 8px;">
                        Open Vault →
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 32px; border-top: 1px solid #222222;">
                <p style="margin: 0; font-size: 11px; color: #525252;">
                  © CloudGuard • Secure cloud storage
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}

function getOtpEmailHtml(params) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a; padding: 48px 16px;">
      <tr>
        <td align="center">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 460px; background-color: #141414; border: 1px solid #262626; border-radius: 14px; overflow: hidden;">
            <tr>
              <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #222222;">
                <span style="font-size: 17px; font-weight: 700; letter-spacing: -0.4px; color: #ffffff;">
                  CloudGuard
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px 32px 28px 32px;">
                <h2 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 600; color: #f5f5f5;">
                  ${params.title}
                </h2>
                <p style="margin: 0 0 14px 0; font-size: 13px; color: #737373;">
                  ${params.subtitle}
                </p>
                <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.5; color: #a1a1a1;">
                  ${params.message}
                </p>
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0d0d0d; border: 1px solid #262626; border-radius: 8px; margin: 0 0 22px 0;">
                  <tr>
                    <td align="center" style="padding: 16px 10px;">
                      <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 28px; font-weight: 700; letter-spacing: 8px; color: #ffffff; padding-left: 8px;">
                        ${params.otp}
                      </span>
                    </td>
                  </tr>
                </table>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #666666;">
                  ${params.footerNotice}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 32px; border-top: 1px solid #222222;">
                <p style="margin: 0; font-size: 11px; color: #525252;">
                  Never share this code with anyone. CloudGuard will never ask for it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}

module.exports = {
  sendActivationOtp,
  sendResetOtp,
  sendWelcomeEmail,
  sendNotificationEmail,
};
