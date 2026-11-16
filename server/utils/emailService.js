const { Resend } = require('resend');

if (!process.env.RESEND_API_KEY) {
  console.warn('[EmailService Warning]: RESEND_API_KEY is not defined in environment variables. Operating in dry-run mode.');
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.EMAIL_FROM || 'CloudGuard <noreply@cloudguard.site>';
const REFUND_MAX_PEAK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (2,147,483,648 bytes)

// -------------------------------------------------------------
// Format & Safety Helpers
// -------------------------------------------------------------
function formatDate(d) {
  if (!d) return 'N/A';
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return 'N/A';
  return dateObj.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatGB(val) {
  if (val === undefined || val === null) return '0.00';
  const num = Number(val);
  return isNaN(num) ? '0.00' : num.toFixed(2);
}

function formatAmount(val) {
  if (val === undefined || val === null) return '0';
  const num = Number(val);
  return isNaN(num) ? '0' : String(num);
}

/**
 * Core Mail Delivery Dispatcher (Resend + Dry-Run Fallback)
 */
async function sendSubscriptionEmail({ to, subject, html }) {
  if (!to) {
    console.warn('[EmailService]: Recipient address is empty. Skipping dispatch.');
    return { success: false, error: 'Recipient missing' };
  }

  if (!resend) {
    console.log(`[EmailService Dry-Run] To: ${to} | Subject: ${subject}`);
    return { success: true, dryRun: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html
    });

    if (error) {
      console.error('[Resend Error]:', error);
      return { success: false, error };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('[Resend Exception]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Generates uniform, branded CloudGuard transactional email HTML
 */
function buildCloudGuardEmail({ title, badge, contentHtml, ctaText, ctaUrl, isUrgent = false }) {
  const accentColor = isUrgent ? '#dc2626' : '#2563eb';
  const badgeBg = isUrgent ? '#fef2f2' : '#eff6ff';
  const badgeBorder = isUrgent ? '#fee2e2' : '#dbeafe';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title || 'CloudGuard Notification'}</title>
    </head>
    <body style="margin: 0; padding: 30px 15px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <tr>
          <td style="padding: 32px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #0f172a;">CloudGuard</span>
                </td>
                <td align="right">
                  <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; color: ${accentColor}; background: ${badgeBg}; border: 1px solid ${badgeBorder}; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    ${badge || 'SECURITY NOTICE'}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 32px;">
            <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #0f172a;">${title}</h2>
            <div style="font-size: 14px; line-height: 1.6; color: #334155;">
              ${contentHtml}
            </div>
            ${ctaText && ctaUrl ? `
              <div style="margin-top: 28px; text-align: left;">
                <a href="${ctaUrl}" style="display: inline-block; background-color: ${accentColor}; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 12px 24px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.08);">
                  ${ctaText} &rarr;
                </a>
              </div>
            ` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b; line-height: 1.5;">
            CloudGuard Vault • Zero-Knowledge AI-Protected Cloud Storage<br>
            For support or questions, reach us at <a href="mailto:support@cloudguard.site" style="color: #2563eb; text-decoration: none;">support@cloudguard.site</a>.
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// -------------------------------------------------------------
// 10-Point Transactional Email Template Generators
// -------------------------------------------------------------

/**
 * Scenario 1: New Purchase / Activation
 */
function generatePurchaseEmail({ user, targetPlan, cycle, orderAmount, invoiceNumber, expiresAt, invoiceUrl }) {
  const planName = targetPlan?.name || 'Vault Subscription';
  const storageGB = targetPlan?.storageGB || 50;
  const cycleStr = cycle || 'monthly';
  const amountStr = formatAmount(orderAmount);
  const formattedExpiry = formatDate(expiresAt);
  const invNumber = invoiceNumber || 'CG-INV-PENDING';

  const subject = `Payment Confirmed: ${planName} (${storageGB} GB) is Active`;
  const contentHtml = `
    <p>Thank you for subscribing to <strong>${planName}</strong>. Your payment of <strong>₹${amountStr}</strong> has been successfully processed via Cashfree.</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Invoice Number:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${invNumber}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Allocated Storage:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${storageGB} GB</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Billing Cycle:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a; text-transform: capitalize;">${cycleStr}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Valid Until:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${formattedExpiry}</td>
        </tr>
        <tr style="border-top: 1px dashed #cbd5e1;">
          <td style="padding: 10px 0 4px; font-weight: 600; color: #0f172a;">Total Paid:</td>
          <td style="padding: 10px 0 4px; font-weight: 700; text-align: right; color: #2563eb; font-size: 15px;">₹${amountStr}</td>
        </tr>
      </table>
    </div>
  `;

  const html = buildCloudGuardEmail({
    title: 'Payment Receipt & Subscription Active',
    badge: 'SUBSCRIPTION ACTIVE',
    contentHtml,
    ctaText: 'Download Official Invoice',
    ctaUrl: invoiceUrl,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 2: Mid-Cycle Upgrade (Delta / Co-Termed)
 */
function generateUpgradeEmail({ user, targetPlan, cycle, deltaAmount, invoiceNumber, expiresAt, invoiceUrl }) {
  const planName = targetPlan?.name || 'Vault Upgrade';
  const storageGB = targetPlan?.storageGB || 100;
  const cycleStr = cycle || 'monthly';
  const amountStr = formatAmount(deltaAmount);
  const formattedExpiry = formatDate(expiresAt);
  const invNumber = invoiceNumber || 'CG-INV-PENDING';

  const subject = `Plan Upgraded: ${planName} (${storageGB} GB) Now Active`;
  const contentHtml = `
    <p>Your CloudGuard vault has been successfully upgraded to <strong>${planName}</strong> with <strong>${storageGB} GB</strong> of ultra-secure storage unlocked immediately.</p>
    <p>Your prorated delta payment of <strong>₹${amountStr}</strong> has been confirmed. Your billing anniversary date remains co-termed and unchanged.</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Invoice Number:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${invNumber}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">New Storage Limit:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${storageGB} GB</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Billing Cycle:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a; text-transform: capitalize;">${cycleStr}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Cycle Anniversary Date:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${formattedExpiry}</td>
        </tr>
        <tr style="border-top: 1px dashed #cbd5e1;">
          <td style="padding: 10px 0 4px; font-weight: 600; color: #0f172a;">Prorated Delta Charged:</td>
          <td style="padding: 10px 0 4px; font-weight: 700; text-align: right; color: #2563eb; font-size: 15px;">₹${amountStr}</td>
        </tr>
      </table>
    </div>
  `;

  const html = buildCloudGuardEmail({
    title: 'Storage Tier Upgrade Confirmed',
    badge: 'UPGRADE SUCCESSFUL',
    contentHtml,
    ctaText: 'Download Bill of Supply',
    ctaUrl: invoiceUrl,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 3: Scheduled Downgrade Confirmation
 */
function generateScheduledDowngradeEmail({ user, targetPlan, expiresAt, clientUrl }) {
  const planName = targetPlan?.name || 'Free Vault';
  const targetGB = targetPlan?.storageGB || 5;
  const formattedExpiry = formatDate(expiresAt);
  const baseUrl = clientUrl || process.env.CLIENT_URL || 'https://cloudguard.site';

  const subject = `Scheduled Plan Transition: ${planName} — CloudGuard`;
  const contentHtml = `
    <p>You have scheduled a plan transition to <strong>${planName}</strong> (${targetGB} GB).</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Amount Charged Today:</strong> ₹0</p>
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Effective Transition Date:</strong> ${formattedExpiry}</p>
      <p style="margin: 0; font-size: 13px; color: #64748b;">You retain your current higher storage quota until this date with zero disruption.</p>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #475569;">
      <strong>How Quota Gate Works:</strong> On ${formattedExpiry}, our automated Quota Gate will check your stored vault files. If your stored files total <strong>${targetGB} GB or less</strong>, the transition will complete automatically. If your storage exceeds ${targetGB} GB, a 7-day grace window will activate to let you download or delete excess files.
    </p>
    <p style="font-size: 13px; color: #64748b;">You may cancel this scheduled transition anytime from your Profile Settings before ${formattedExpiry}.</p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Scheduled Plan Downgrade Confirmed',
    badge: 'DOWNGRADE SCHEDULED',
    contentHtml,
    ctaText: 'Manage Subscription',
    ctaUrl: `${baseUrl}/pricing`,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 4: Scheduled Downgrade Cancellation
 */
function generateDowngradeRevocationEmail({ user, activePlanName, expiresAt, clientUrl }) {
  const currentPlan = activePlanName || 'Active Vault Plan';
  const formattedExpiry = formatDate(expiresAt);
  const baseUrl = clientUrl || process.env.CLIENT_URL || 'https://cloudguard.site';

  const subject = `Scheduled Downgrade Cancelled — CloudGuard Vault`;
  const contentHtml = `
    <p>Your request to cancel the scheduled plan downgrade has been processed successfully.</p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #166534;"><strong>Status:</strong> Active Tier Retained</p>
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Current Plan:</strong> ${currentPlan}</p>
      <p style="margin: 0; font-size: 13px; color: #166534;">Your current storage quota and active subscription will continue uninterrupted through ${formattedExpiry}.</p>
    </div>
    <p style="font-size: 13px; color: #475569;">Thank you for continuing with CloudGuard Vault.</p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Scheduled Downgrade Revoked',
    badge: 'SUBSCRIPTION RETAINED',
    contentHtml,
    ctaText: 'Open CloudGuard Vault',
    ctaUrl: `${baseUrl}/dashboard`,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 5: Downgrade Quota Gate Pass (Clean Transition)
 */
function generateQuotaGatePassEmail({ user, targetPlanName, storageUsedGB, targetQuotaGB, clientUrl }) {
  const planName = targetPlanName || 'Free Vault';
  const usedGB = formatGB(storageUsedGB);
  const quotaGB = targetQuotaGB || 5;
  const baseUrl = clientUrl || process.env.CLIENT_URL || 'https://cloudguard.site';

  const subject = `Plan Transition Completed — CloudGuard Vault`;
  const contentHtml = `
    <p>Your subscription cycle has ended and your vault has transitioned smoothly to <strong>${planName}</strong>.</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Current Storage Used:</strong> ${usedGB} GB</p>
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>New Quota Limit:</strong> ${quotaGB} GB</p>
      <p style="margin: 0; font-size: 13px; color: #16a34a;"><strong>Quota Gate Check:</strong> Passed (No files affected)</p>
    </div>
    <p style="font-size: 13px; color: #475569;">All your stored files are secure and immediately accessible. You can upgrade again anytime if you need more storage.</p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Plan Transition Completed',
    badge: 'TIER TRANSITION',
    contentHtml,
    ctaText: 'Access Your Vault',
    ctaUrl: `${baseUrl}/dashboard`,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 6: Downgrade Quota Gate Blocked (Over-Quota)
 */
function generateQuotaGateBlockedEmail({ user, targetPlanName, targetQuotaGB, storageUsedGB, excessGB, gracePeriodExpiresAt, clientUrl }) {
  const planName = targetPlanName || 'Free Vault';
  const usedGB = formatGB(storageUsedGB);
  const quotaGB = targetQuotaGB || 5;
  const excessStr = formatGB(excessGB);
  const formattedGrace = formatDate(gracePeriodExpiresAt);
  const baseUrl = clientUrl || process.env.CLIENT_URL || 'https://cloudguard.site';

  const subject = `Action Required: Storage Quota Exceeded — CloudGuard Vault`;
  const contentHtml = `
    <p>Your subscription has ended and was scheduled to transition to <strong>${planName}</strong> (${quotaGB} GB).</p>
    <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Target Quota:</strong> ${quotaGB} GB</p>
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Current Storage Used:</strong> ${usedGB} GB</p>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #b91c1c;"><strong>Excess Storage to Remove:</strong> ${excessStr} GB</p>
      <p style="margin: 0; font-size: 13px; color: #991b1b;"><strong>7-Day Rescue Cutoff Date:</strong> ${formattedGrace}</p>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      <strong>Upload Write-Lock Active:</strong> New uploads have been temporarily locked. Please download and delete at least <strong>${excessStr} GB</strong> of files, or upgrade your plan before <strong>${formattedGrace}</strong> to prevent automated data deletion under our Zero-Parking storage policy.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Vault Over-Quota: Action Required',
    badge: 'ACTION REQUIRED',
    contentHtml,
    ctaText: 'Upgrade or Free Up Space',
    ctaUrl: `${baseUrl}/pricing`,
    isUrgent: true
  });

  return { subject, html };
}

function resolveUserPlanInfo(user) {
  const planId = user?.subscription?.planId || user?.plan || 'free';
  const PLAN_MAP = {
    tier_50gb: { name: 'Essential Vault', storageGB: 50 },
    tier_100gb: { name: 'Pro Vault', storageGB: 100 },
    tier_200gb: { name: 'Ultra Vault', storageGB: 200 },
    trial: { name: '14-Day Evaluation Trial', storageGB: 5 },
    free: { name: 'Free Evaluation Vault', storageGB: 5 },
  };
  const info = PLAN_MAP[planId] || { name: 'CloudGuard Vault', storageGB: 50 };
  const expiresAt = (planId === 'trial' || user?.plan === 'trial') && user?.trialExpiresAt
    ? user.trialExpiresAt
    : (user?.subscription?.expiresAt || user?.trialExpiresAt);
  return { planName: info.name, storageGB: info.storageGB, expiresAt };
}

/**
 * Scenario 11: Annual Plan 7-Day Renewal Reminder
 */
function generateAnnual7DayReminderEmail({ user, planName, storageGB, expiresAt, renewalUrl }) {
  const plan = planName || 'Annual Vault Plan';
  const quotaGB = storageGB || 50;
  const formattedExpiry = formatDate(expiresAt);
  const url = renewalUrl || `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;

  const subject = `Your Annual CloudGuard Plan Renews in 7 Days`;
  const contentHtml = `
    <p>This is a friendly early reminder that your annual subscription for <strong>${plan}</strong> (${quotaGB} GB) is set to renew in <strong>7 days</strong> on <strong>${formattedExpiry}</strong>.</p>
    <div style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Plan:</strong> ${plan} (${quotaGB} GB)</p>
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Renewal Date:</strong> ${formattedExpiry}</p>
      <p style="margin: 0; font-size: 13px; color: #1e40af;">Renewing early extends your vault by a full 365 days without losing any of your remaining time.</p>
    </div>
    <p style="font-size: 13px; color: #475569;">
      CloudGuard operates on transparent prepaid billing with zero hidden surcharges. Click below to secure your next year with uninterrupted protection.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Annual Plan Renews in 7 Days',
    badge: 'ANNUAL RENEWAL',
    contentHtml,
    ctaText: 'Renew Early',
    ctaUrl: url,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 7: Prepaid Expiry Warning (T-3 Days)
 */
function generatePrepaidExpiryWarningEmail({ user, planName, storageGB, expiresAt, renewalUrl }) {
  const plan = planName || 'Paid Vault Plan';
  const quotaGB = storageGB || 50;
  const formattedExpiry = formatDate(expiresAt);
  const url = renewalUrl || `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;

  const subject = `Action Needed: Your CloudGuard Plan Expires in 3 Days`;
  const contentHtml = `
    <p>This is an important reminder that your CloudGuard subscription for <strong>${plan}</strong> (${quotaGB} GB) expires in <strong>3 days</strong> on <strong>${formattedExpiry}</strong>.</p>
    <div style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Plan:</strong> ${plan} (${quotaGB} GB)</p>
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Expiry Date:</strong> ${formattedExpiry}</p>
      <p style="margin: 0; font-size: 13px; color: #1e40af;">Renew today to prevent an upload write-lock and ensure seamless vault access.</p>
    </div>
    <p style="font-size: 13px; color: #475569;">
      CloudGuard operates on prepaid billing without silent recurring charges. Renew now to stack your subscription cleanly and keep full upload privileges.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Subscription Ending in 3 Days',
    badge: 'RENEWAL REMINDER',
    contentHtml,
    ctaText: 'Renew Subscription Now',
    ctaUrl: url,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 12: 24-Hour Pre-Expiry Urgent Warning (Yearly, Monthly & Trial)
 */
function generate24HourPreExpiryEmail({ user, planName, storageGB, expiresAt, renewalUrl }) {
  const plan = planName || 'Vault Plan';
  const quotaGB = storageGB || 50;
  const formattedExpiry = formatDate(expiresAt);
  const url = renewalUrl || `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;

  const subject = `Urgent: Your CloudGuard Plan Expires in 24 Hours`;
  const contentHtml = `
    <p style="color: #991b1b; font-weight: 600;">URGENT: Your CloudGuard plan will expire in less than 24 hours on ${formattedExpiry}.</p>
    <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Plan:</strong> ${plan} (${quotaGB} GB)</p>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #b91c1c;"><strong>Expiry Deadline:</strong> ${formattedExpiry}</p>
      <p style="margin: 0; font-size: 13px; color: #991b1b;">Upon expiry, your vault transitions to read-only status and file uploads are write-locked.</p>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      Renew your subscription now to maintain uninterrupted upload access and prevent any storage disruptions.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Plan Expires in Under 24 Hours',
    badge: 'ACTION REQUIRED',
    contentHtml,
    ctaText: 'Renew Now',
    ctaUrl: url,
    isUrgent: true
  });

  return { subject, html };
}

/**
 * Scenario 13: Day 0 Grace Period Started Notice
 */
function generateGracePeriodStartedEmail({ user, gracePeriodExpiresAt, renewalUrl }) {
  const formattedGrace = formatDate(gracePeriodExpiresAt);
  const url = renewalUrl || `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;

  const subject = `Vault Write-Locked: 7-Day Grace Period Started — CloudGuard`;
  const contentHtml = `
    <p style="color: #991b1b; font-weight: 600;">Your CloudGuard plan has expired and your vault is now write-locked.</p>
    <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Status:</strong> Read-Only Grace Period (Uploads Locked)</p>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #b91c1c;"><strong>Grace Period Cutoff:</strong> ${formattedGrace}</p>
      <p style="margin: 0; font-size: 13px; color: #991b1b;">All existing files remain safe and downloadable. New file uploads are disabled.</p>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      You have <strong>7 days</strong> (until ${formattedGrace}) to renew or upgrade your plan. Under our Zero-Parking storage policy, uncompensated vaults exceeding the baseline quota are permanently deleted after the grace period ends.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Vault Write-Locked (7-Day Grace)',
    badge: 'VAULT WRITE-LOCKED',
    contentHtml,
    ctaText: 'Restore Uploads',
    ctaUrl: url,
    isUrgent: true
  });

  return { subject, html };
}

/**
 * Scenario 8: Day 6 (24-Hour Final Purge Alert)
 */
function generate24HourPurgeAlertEmail({ user, excessGB, purgeDate, deleteUrl }) {
  const excessStr = formatGB(excessGB);
  const formattedCutoff = formatDate(purgeDate);
  const url = deleteUrl || `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;

  const subject = `Urgent: Your Vault Files Will Be Permanently Deleted in 24 Hours`;
  const contentHtml = `
    <p style="color: #991b1b; font-weight: 600;">URGENT: This is your final 24-hour warning before permanent file deletion.</p>
    <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Excess Uncompensated Storage:</strong> ${excessStr} GB</p>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #b91c1c;"><strong>Permanent Deletion Cutoff:</strong> ${formattedCutoff}</p>
      <p style="margin: 0; font-size: 13px; color: #991b1b;">After this cutoff, files exceeding the free quota will be permanently evicted from AWS S3 object storage.</p>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      To safeguard your data, either upgrade your subscription immediately or download and delete at least <strong>${excessStr} GB</strong> of stored files before the deadline.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: '24 Hours Remaining Before Permanent Deletion',
    badge: 'FINAL DELETION NOTICE',
    contentHtml,
    ctaText: 'Resolve Excess Storage Now',
    ctaUrl: url,
    isUrgent: true
  });

  return { subject, html };
}

/**
 * Scenario 9: Hard Cloud Purge Completed (Day 7 Cutoff)
 */
function generateHardPurgeCompletedEmail({ user, clientUrl }) {
  const baseUrl = clientUrl || process.env.CLIENT_URL || 'https://cloudguard.site';

  const subject = `Vault Files Deleted — CloudGuard Account Notice`;
  const contentHtml = `
    <p>Your 7-day past-due grace period has ended without subscription renewal or excess file removal.</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Policy Enforced:</strong> Zero-Parking Infrastructure Protection</p>
      <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Storage Usage Reset:</strong> 0 B used</p>
      <p style="margin: 0; font-size: 13px; color: #64748b;"><strong>Account Tier:</strong> Free Evaluation Tier (5 GB limit)</p>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #475569;">
      Uncompensated stored files have been permanently and irreversibly deleted from cloud object storage. Your account credentials remain active, and you are welcome to store new files within the 5 GB free quota or reactivate a premium plan at any time.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Delinquent Storage Reset to 0 B',
    badge: 'SECURITY NOTICE',
    contentHtml,
    ctaText: 'Open CloudGuard Vault',
    ctaUrl: `${baseUrl}/dashboard`,
    isUrgent: false
  });

  return { subject, html };
}

/**
 * Scenario 10: Manual Refund Acknowledgment
 */
function generateRefundAcknowledgmentEmail({ user, planName, refundAmount, orderId, processedDate, clientUrl }) {
  const plan = planName || 'Vault Subscription';
  const amountStr = formatAmount(refundAmount);
  const ordId = orderId || 'N/A';
  const dateStr = formatDate(processedDate || new Date());
  const baseUrl = clientUrl || process.env.CLIENT_URL || 'https://cloudguard.site';

  const subject = `Refund Processed — CloudGuard Vault`;
  const contentHtml = `
    <p>We have processed a refund for your CloudGuard subscription order <strong>${ordId}</strong>.</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Order ID:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${ordId}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Plan:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${plan}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Processed Date:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${dateStr}</td>
        </tr>
        <tr style="border-top: 1px dashed #cbd5e1;">
          <td style="padding: 10px 0 4px; font-weight: 600; color: #0f172a;">Refund Amount:</td>
          <td style="padding: 10px 0 4px; font-weight: 700; text-align: right; color: #2563eb; font-size: 15px;">₹${amountStr}</td>
        </tr>
      </table>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #475569;">
      <strong>Settlement Timeline:</strong> The refunded amount will credit back to your original payment method via Cashfree within <strong>5–7 business days</strong> depending on your banking provider.
    </p>
    <p style="font-size: 13px; color: #64748b;">
      Your vault has been adjusted to the baseline 5 GB evaluation tier. Any files already safely stored within 5 GB remain intact.
    </p>
  `;

  const html = buildCloudGuardEmail({
    title: 'Subscription Refund Confirmation',
    badge: 'REFUND ACKNOWLEDGED',
    contentHtml,
    ctaText: 'View Vault Dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    isUrgent: false
  });

  return { subject, html };
}

// -------------------------------------------------------------
// Transactional Dispatchers for Direct Integration
// -------------------------------------------------------------
async function sendScheduledDowngradeEmail(user, targetPlan, expiresAt, clientUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const { subject, html } = generateScheduledDowngradeEmail({ user, targetPlan, expiresAt, clientUrl });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function sendDowngradeRevocationEmail(user, activePlanName, expiresAt, clientUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const { subject, html } = generateDowngradeRevocationEmail({ user, activePlanName, expiresAt, clientUrl });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function sendAnnual7DayReminderEmail(user, planName, storageGB, expiresAt, renewalUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const resolved = resolveUserPlanInfo(user);
  const pName = typeof planName === 'string' ? planName : resolved.planName;
  const sGB = typeof storageGB === 'number' ? storageGB : resolved.storageGB;
  const expAt = expiresAt || resolved.expiresAt;
  const url = typeof renewalUrl === 'string' ? renewalUrl : `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;
  const { subject, html } = generateAnnual7DayReminderEmail({ user, planName: pName, storageGB: sGB, expiresAt: expAt, renewalUrl: url });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function sendPrepaidExpiryWarningEmail(user, planName, storageGB, expiresAt, renewalUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const resolved = resolveUserPlanInfo(user);
  const pName = typeof planName === 'string' ? planName : resolved.planName;
  const sGB = typeof storageGB === 'number' ? storageGB : resolved.storageGB;
  const expAt = expiresAt || resolved.expiresAt;
  const url = typeof renewalUrl === 'string' ? renewalUrl : `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;
  const { subject, html } = generatePrepaidExpiryWarningEmail({ user, planName: pName, storageGB: sGB, expiresAt: expAt, renewalUrl: url });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function send24HourPreExpiryEmail(user, planName, storageGB, expiresAt, renewalUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const resolved = resolveUserPlanInfo(user);
  const pName = typeof planName === 'string' ? planName : resolved.planName;
  const sGB = typeof storageGB === 'number' ? storageGB : resolved.storageGB;
  const expAt = expiresAt || resolved.expiresAt;
  const url = typeof renewalUrl === 'string' ? renewalUrl : `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;
  const { subject, html } = generate24HourPreExpiryEmail({ user, planName: pName, storageGB: sGB, expiresAt: expAt, renewalUrl: url });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function sendGracePeriodStartedEmail(user, gracePeriodExpiresAt, renewalUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const graceEnd = gracePeriodExpiresAt || user.subscription?.gracePeriodExpiresAt || new Date(Date.now() + 7 * 86400000);
  const url = typeof renewalUrl === 'string' ? renewalUrl : `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;
  const { subject, html } = generateGracePeriodStartedEmail({ user, gracePeriodExpiresAt: graceEnd, renewalUrl: url });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function send24HourPurgeAlertEmail(user, excessGB, purgeDate, deleteUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const computedExcess = excessGB !== undefined
    ? excessGB
    : Math.max(0, ((user.storageUsed || 0) - (user.storageLimit || 5368709120)) / (1024 ** 3));
  const pDate = purgeDate || user.subscription?.gracePeriodExpiresAt || new Date(Date.now() + 24 * 3600 * 1000);
  const dUrl = deleteUrl || `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;
  const { subject, html } = generate24HourPurgeAlertEmail({ user, excessGB: computedExcess, purgeDate: pDate, deleteUrl: dUrl });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function sendHardPurgeCompletedEmail(user, clientUrl) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const { subject, html } = generateHardPurgeCompletedEmail({ user, clientUrl });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

async function sendRefundAcknowledgmentEmail(user, refundDetails) {
  if (!user?.email) return { success: false, error: 'User email missing' };
  const { subject, html } = generateRefundAcknowledgmentEmail({
    user,
    planName: refundDetails?.planName,
    refundAmount: refundDetails?.refundAmount,
    orderId: refundDetails?.orderId,
    processedDate: refundDetails?.processedDate,
    clientUrl: refundDetails?.clientUrl
  });
  return sendSubscriptionEmail({ to: user.email, subject, html });
}

// -------------------------------------------------------------
// Legacy Auth & Onboarding Notifications
// -------------------------------------------------------------
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

  return sendSubscriptionEmail({ to: email, subject, html });
}

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

  return sendSubscriptionEmail({ to: email, subject, html });
}

async function sendWelcomeEmail(email, name = '') {
  const trimmedName = name ? name.trim() : '';
  const subject = `Welcome to CloudGuard${trimmedName ? ', ' + trimmedName : ''}`;
  const html = getWelcomeEmailHtml(trimmedName);

  return sendSubscriptionEmail({ to: email, subject, html });
}

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
  sendSubscriptionEmail,
  buildCloudGuardEmail,
  resolveUserPlanInfo,
  // Template generators
  generatePurchaseEmail,
  generateUpgradeEmail,
  generateScheduledDowngradeEmail,
  generateDowngradeRevocationEmail,
  generateQuotaGatePassEmail,
  generateQuotaGateBlockedEmail,
  generateAnnual7DayReminderEmail,
  generatePrepaidExpiryWarningEmail,
  generate24HourPreExpiryEmail,
  generateGracePeriodStartedEmail,
  generate24HourPurgeAlertEmail,
  generateHardPurgeCompletedEmail,
  generateRefundAcknowledgmentEmail,
  // Transactional dispatchers
  sendAnnual7DayReminderEmail,
  sendScheduledDowngradeEmail,
  sendDowngradeRevocationEmail,
  sendPrepaidExpiryWarningEmail,
  send24HourPreExpiryEmail,
  sendGracePeriodStartedEmail,
  send24HourPurgeAlertEmail,
  sendHardPurgeCompletedEmail,
  sendRefundAcknowledgmentEmail,
};