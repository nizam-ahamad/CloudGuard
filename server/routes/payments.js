const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Payment = require('../models/Payment');
const {
  sendSubscriptionEmail,
  buildCloudGuardEmail,
  generatePurchaseEmail,
  generateUpgradeEmail,
  generateScheduledDowngradeEmail,
  generateDowngradeRevocationEmail,
  sendScheduledDowngradeEmail,
  sendDowngradeRevocationEmail,
  sendRefundAcknowledgmentEmail
} = require('../utils/emailService');

const router = express.Router();

const isProductionCashfree =
  String(process.env.CASHFREE_ENV || '').trim().toUpperCase() === 'PRODUCTION';

const CASHFREE_BASE_URL = isProductionCashfree
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

const REFUND_MAX_PEAK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (2,147,483,648 bytes)

const PLAN_CATALOG = {
  tier_50gb: {
    id: 'tier_50gb',
    name: 'Essential Vault',
    storageGB: 50,
    storageBytes: 50 * 1024 * 1024 * 1024,
    monthlyPrice: 49,
    annualPrice: 499
  },
  tier_100gb: {
    id: 'tier_100gb',
    name: 'Pro Vault',
    storageGB: 100,
    storageBytes: 100 * 1024 * 1024 * 1024,
    monthlyPrice: 99,
    annualPrice: 999
  },
  tier_200gb: {
    id: 'tier_200gb',
    name: 'Ultra Vault',
    storageGB: 200,
    storageBytes: 200 * 1024 * 1024 * 1024,
    monthlyPrice: 189,
    annualPrice: 1899
  }
};

const PLAN_QUOTAS = {
  tier_50gb: 50 * 1024 * 1024 * 1024,
  tier_100gb: 100 * 1024 * 1024 * 1024,
  tier_200gb: 200 * 1024 * 1024 * 1024,
};

/**
 * Calculates transition type, payable amount, and target expiration
 */
function calculateTierTransition(user, targetPlanId, targetBillingCycle) {
  const currentPlanId = user.subscription?.planId || user.plan || 'free';
  const currentCycle = user.subscription?.billingCycle || 'none';
  const currentExpiresAt = user.subscription?.expiresAt ? new Date(user.subscription.expiresAt) : null;
  const isCurrentlyActive = user.subscription?.status === 'active' && currentExpiresAt && currentExpiresAt > new Date();

  const targetPlan = PLAN_CATALOG[targetPlanId];
  if (!targetPlan) throw new Error('Invalid target plan identifier');

  // Case 1: Fresh Purchase or Expired/Free User
  if (!isCurrentlyActive || currentPlanId === 'free' || !PLAN_CATALOG[currentPlanId]) {
    const amount = targetBillingCycle === 'annual' ? targetPlan.annualPrice : targetPlan.monthlyPrice;
    const durationDays = targetBillingCycle === 'annual' ? 365 : 30;
    return {
      transitionType: 'NEW_SUBSCRIPTION',
      payableAmount: amount,
      targetExpiresAt: new Date(Date.now() + durationDays * 86400000),
      isImmediateQuota: true
    };
  }

  const currentPlan = PLAN_CATALOG[currentPlanId];
  const daysRemaining = Math.max(0, Math.ceil((currentExpiresAt.getTime() - Date.now()) / 86400000));
  const renewalWindowDays = currentCycle === 'annual' ? 15 : 7;

  // Case 2: Same Plan & Same Cycle (Renewal)
  if (currentPlanId === targetPlanId && currentCycle === targetBillingCycle) {
    const amount = targetBillingCycle === 'annual' ? targetPlan.annualPrice : targetPlan.monthlyPrice;
    const durationDays = targetBillingCycle === 'annual' ? 365 : 30;
    return {
      transitionType: 'STACKED_RENEWAL',
      payableAmount: amount,
      targetExpiresAt: new Date(currentExpiresAt.getTime() + durationDays * 86400000),
      isImmediateQuota: true
    };
  }

  // Rule 1: Block Mid-Cycle Annual -> Monthly Conversion (Option A — Zero Loophole)
  if (currentCycle === 'annual' && targetBillingCycle === 'monthly') {
    if (daysRemaining > 15) {
      return {
        transitionType: 'BLOCKED_ANNUAL_TO_MONTHLY',
        allowed: false,
        effectiveDate: currentExpiresAt,
        message: 'Annual plans cannot switch to monthly mid-cycle. Upgrade to an Annual tier today or switch to Monthly within 15 days of renewal.'
      };
    }

    // Renewal window (daysRemaining <= 15)
    if (targetPlan.storageGB < currentPlan.storageGB) {
      return {
        transitionType: 'SCHEDULED_DOWNGRADE',
        payableAmount: 0,
        targetExpiresAt: currentExpiresAt,
        effectiveDate: currentExpiresAt,
        isImmediateQuota: false
      };
    }

    return {
      transitionType: 'CYCLE_SWITCH_PREPAID',
      payableAmount: targetPlan.monthlyPrice,
      targetExpiresAt: new Date(currentExpiresAt.getTime() + 30 * 86400000),
      isImmediateQuota: true,
      daysRemaining
    };
  }

  // Rule 3: All Capacity Downgrades (targetPlan.storageGB < currentPlan.storageGB)
  if (targetPlan.storageGB < currentPlan.storageGB) {
    return {
      transitionType: 'SCHEDULED_DOWNGRADE',
      payableAmount: 0, // No payment today; deferred to cycle end
      targetExpiresAt: currentExpiresAt,
      effectiveDate: currentExpiresAt,
      isImmediateQuota: false
    };
  }

  // Rule 2: Monthly -> Annual Upgrades / Same-Tier Switches (targetPlan.storageGB >= currentPlan.storageGB)
  if (currentCycle === 'monthly' && targetBillingCycle === 'annual' && targetPlan.storageGB >= currentPlan.storageGB) {
    return {
      transitionType: 'CYCLE_UPGRADE',
      payableAmount: targetPlan.annualPrice,
      targetExpiresAt: new Date(currentExpiresAt.getTime() + 365 * 86400000),
      isImmediateQuota: true
    };
  }

  // Rule 4: Same-Cycle Upgrades (targetPlan.storageGB > currentPlan.storageGB && currentCycle === targetBillingCycle)
  if (targetPlan.storageGB > currentPlan.storageGB && currentCycle === targetBillingCycle) {
    if (daysRemaining <= renewalWindowDays) {
      const amount = targetBillingCycle === 'annual' ? targetPlan.annualPrice : targetPlan.monthlyPrice;
      const durationDays = targetBillingCycle === 'annual' ? 365 : 30;
      return {
        transitionType: 'RENEWAL_UPGRADE',
        payableAmount: amount,
        targetExpiresAt: new Date(currentExpiresAt.getTime() + durationDays * 86400000),
        daysRemaining,
        isImmediateQuota: true
      };
    }

    // Monthly to Monthly Mid-Cycle Upgrade (Delta Price, Preserves Expiry)
    if (currentCycle === 'monthly') {
      const deltaAmount = targetPlan.monthlyPrice - currentPlan.monthlyPrice;
      return {
        transitionType: 'MONTHLY_UPGRADE',
        payableAmount: Math.max(1, deltaAmount),
        targetExpiresAt: currentExpiresAt, // Retain existing cycle end
        daysRemaining,
        isImmediateQuota: true
      };
    }

    // Annual to Annual Mid-Cycle Upgrade (Co-Termed Delta Math)
    if (currentCycle === 'annual') {
      const annualPriceDiff = targetPlan.annualPrice - currentPlan.annualPrice;
      const coTermedDelta = Math.round((annualPriceDiff / 365) * daysRemaining);
      const payableAmount = Math.max(50, coTermedDelta); // Gateway floor ₹50
      return {
        transitionType: 'ANNUAL_UPGRADE',
        payableAmount,
        targetExpiresAt: currentExpiresAt, // Preserve annual anniversary
        daysRemaining,
        isImmediateQuota: true
      };
    }
  }

  // Fallback default
  const defaultAmount = targetBillingCycle === 'annual' ? targetPlan.annualPrice : targetPlan.monthlyPrice;
  return {
    transitionType: 'STANDARD_PURCHASE',
    payableAmount: defaultAmount,
    targetExpiresAt: new Date(Date.now() + (targetBillingCycle === 'annual' ? 365 : 30) * 86400000),
    isImmediateQuota: true
  };
}

/**
 * POST /api/payments/preview-transition
 * Returns prorated payable amounts, quota actions, and target expiry dates
 */
router.post('/preview-transition', auth, async (req, res) => {
  try {
    const { targetPlanId, targetBillingCycle } = req.body;
    const userId = req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const transition = calculateTierTransition(user, targetPlanId, targetBillingCycle);
    const targetPlan = PLAN_CATALOG[targetPlanId];

    return res.json({
      success: true,
      currentPlanId: user.subscription?.planId || user.plan,
      currentBillingCycle: user.subscription?.billingCycle,
      targetPlanId,
      targetBillingCycle,
      targetStorageGB: targetPlan?.storageGB,
      ...transition
    });
  } catch (err) {
    console.error('[Preview Transition Error]:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to calculate plan transition' });
  }
});

/**
 * POST /api/payments/create-order
 */
router.post('/create-order', auth, async (req, res) => {
  try {
    const { planId, billingCycle } = req.body;
    const userId = req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const targetCycle = billingCycle === 'annual' ? 'annual' : 'monthly';
    const transition = calculateTierTransition(user, planId, targetCycle);

    // Reject blocked mid-cycle Annual -> Monthly transitions
    if (transition.transitionType === 'BLOCKED_ANNUAL_TO_MONTHLY' || transition.allowed === false) {
      return res.status(400).json({
        error: transition.message || 'Annual plans cannot switch to monthly mid-cycle. Upgrade to an Annual tier today or switch to Monthly within 15 days of renewal.',
        transitionType: transition.transitionType,
        effectiveDate: transition.effectiveDate
      });
    }

    // If transition is a deferred downgrade (Payable = 0)
    if (transition.payableAmount === 0 || transition.transitionType === 'SCHEDULED_DOWNGRADE') {
      if (!user.subscription) user.subscription = {};
      user.subscription.scheduledDowngrade = {
        targetPlanId: planId,
        targetBillingCycle: targetCycle,
        scheduledAt: new Date()
      };
      await user.save();

      // Scenario 3: Dispatch Scheduled Downgrade Confirmation Email
      const targetPlanObj = PLAN_CATALOG[planId] || { name: planId, storageGB: 5 };
      const clientBaseUrl = process.env.CLIENT_URL || req.headers.origin;
      sendScheduledDowngradeEmail(user, targetPlanObj, user.subscription.expiresAt, clientBaseUrl).catch(err => {
        console.error('[Scheduled Downgrade Email Error]:', err.message);
      });

      return res.json({
        success: true,
        isDowngradeScheduled: true,
        message: `Your downgrade to ${PLAN_CATALOG[planId]?.name || planId} is scheduled for ${new Date(user.subscription.expiresAt).toLocaleDateString('en-IN')}. You will retain your current storage until then.`,
        effectiveDate: user.subscription.expiresAt
      });
    }

    // Otherwise, generate a Cashfree order for the exact payable delta
    const orderId = `order_${Date.now()}_${user._id.toString().slice(-6)}`;
    const storageGB = PLAN_CATALOG[planId]?.storageGB || 50;

    const payload = {
      order_id: orderId,
      order_amount: Number(transition.payableAmount),
      order_currency: 'INR',
      customer_details: {
        customer_id: user._id.toString(),
        customer_email: user.email || 'support@cloudguard.site',
        customer_phone: user.phone || '9999999999',
        customer_name: user.name || 'CloudGuard User'
      },
      order_meta: {
        return_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/dashboard?order_id={order_id}`
      },
      order_note: `CloudGuard|${planId}|${targetCycle}|${storageGB}GB|${transition.transitionType}`
    };

    const response = await axios.post(`${CASHFREE_BASE_URL}/orders`, payload, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json'
      }
    });

    // Pre-create pending payment record so it is tracked immediately
    try {
      const totalPaymentsCount = await Payment.countDocuments();
      const invoiceNumber = `CG-INV-${new Date().getFullYear()}-${String(totalPaymentsCount + 1).padStart(4, '0')}`;
      await Payment.create({
        userId: user._id,
        invoiceNumber,
        orderId: response.data.order_id,
        planId,
        planName: `${PLAN_CATALOG[planId]?.name || planId} (${storageGB} GB)`,
        storageGB,
        billingCycle: targetCycle,
        amount: Number(transition.payableAmount),
        currency: 'INR',
        status: 'PENDING',
        customerDetails: {
          name: user.name || 'CloudGuard User',
          email: user.email
        },
        periodStart: new Date(),
        periodEnd: transition.targetExpiresAt || new Date(Date.now() + (targetCycle === 'annual' ? 365 : 30) * 86400000)
      });
    } catch (saveErr) {
      console.warn('[Create Order Payment Record Warning]:', saveErr.message);
    }

    return res.json({
      success: true,
      orderId: response.data.order_id,
      paymentSessionId: response.data.payment_session_id,
      transitionType: transition.transitionType,
      payableAmount: transition.payableAmount,
      cashfreeEnv: isProductionCashfree ? 'production' : 'sandbox',
    });
  } catch (err) {
    console.error('[Cashfree Order Error]:', err.response?.data || err.message);
    return res.status(500).json({
      error: err.response?.data?.message || err.message || 'Failed to initialize payment order'
    });
  }
});

/**
 * Idempotent order fulfillment helper
 * Guarantees that even with concurrent verify and webhook calls,
 * subscription is extended exactly once using atomic Payment status transition.
 */
async function fulfillCashfreeOrder(orderId, orderDetails = null, clientOrigin = '') {
  let order = orderDetails;
  if (!order || !order.order_status || !order.order_note) {
    const response = await axios.get(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01'
      }
    });
    order = response.data;
  }

  if (order.order_status !== 'PAID') {
    return { success: false, status: order.order_status };
  }

  const parts = (order.order_note || '').split('|');
  let planId = parts[1] || 'tier_50gb';
  if (planId === 'essential') planId = 'tier_50gb';
  if (planId === 'pro') planId = 'tier_100gb';
  if (planId === 'ultra') planId = 'tier_200gb';

  const cycle = parts[2] || (Number(order.order_amount) > 300 ? 'annual' : 'monthly');
  const transitionType = parts[4] || 'STANDARD';
  const targetPlan = PLAN_CATALOG[planId] || PLAN_CATALOG.tier_50gb;

  // 1. Check if already claimed and paid
  let paymentRecord = await Payment.findOne({ orderId });
  if (paymentRecord && paymentRecord.status === 'PAID') {
    const user = await User.findById(paymentRecord.userId);
    return {
      success: true,
      status: 'PAID',
      storageLimit: user?.storageLimit,
      subscription: user?.subscription,
      invoiceNumber: paymentRecord.invoiceNumber,
      alreadyFulfilled: true
    };
  }

  // 2. Ensure Payment record exists before attempting atomic claim
  let userId = order.customer_details?.customer_id;
  if (!userId && paymentRecord) userId = paymentRecord.userId;

  let lineItemTitle = `${targetPlan.name} (${targetPlan.storageGB} GB)`;
  if (transitionType === 'ANNUAL_UPGRADE') lineItemTitle += ' — Mid-Cycle Co-Termed Upgrade';
  else if (transitionType === 'MONTHLY_UPGRADE') lineItemTitle += ' — Mid-Cycle Monthly Upgrade Delta';
  else if (transitionType === 'RENEWAL_UPGRADE') lineItemTitle += ' — Tier Upgrade + Cycle Renewal';
  else if (transitionType === 'CYCLE_SWITCH_PREPAID') lineItemTitle += ' — Monthly Cycle Switch (+30 Days)';
  else if (transitionType === 'CYCLE_UPGRADE') lineItemTitle += ' — Annual Upgrade (+365 Days)';

  if (!paymentRecord) {
    try {
      const totalPaymentsCount = await Payment.countDocuments();
      const invoiceNumber = `CG-INV-${new Date().getFullYear()}-${String(totalPaymentsCount + 1).padStart(4, '0')}`;
      paymentRecord = await Payment.create({
        userId,
        invoiceNumber,
        orderId,
        paymentId: order.cf_order_id ? String(order.cf_order_id) : orderId,
        planId,
        planName: lineItemTitle,
        storageGB: targetPlan.storageGB,
        billingCycle: cycle,
        amount: Number(order.order_amount),
        currency: 'INR',
        status: 'PENDING',
        customerDetails: {
          name: order.customer_details?.customer_name || 'CloudGuard Subscriber',
          email: order.customer_details?.customer_email
        },
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + (cycle === 'annual' ? 365 : 30) * 86400000)
      });
    } catch (dupErr) {
      if (dupErr.code === 11000) {
        paymentRecord = await Payment.findOne({ orderId });
      } else {
        throw dupErr;
      }
    }
  }

  // 3. Atomically claim the payment. Only the FIRST caller matching status !== 'PAID' wins!
  const claimedPayment = await Payment.findOneAndUpdate(
    { orderId, status: { $ne: 'PAID' } },
    {
      $set: {
        status: 'PAID',
        paymentId: order.cf_order_id ? String(order.cf_order_id) : orderId,
        planName: lineItemTitle,
        paidAt: new Date()
      }
    },
    { new: true }
  );

  if (!claimedPayment) {
    // Another concurrent call already claimed & fulfilled this order
    const existingPayment = await Payment.findOne({ orderId });
    const user = await User.findById(existingPayment?.userId || userId);
    return {
      success: true,
      status: 'PAID',
      storageLimit: user?.storageLimit,
      subscription: user?.subscription,
      invoiceNumber: existingPayment?.invoiceNumber,
      alreadyFulfilled: true
    };
  }

  // 4. Fulfillment execution (runs strictly ONCE per orderId)
  const user = await User.findById(claimedPayment.userId || userId);
  if (!user) {
    throw new Error('User not found for payment fulfillment');
  }

  const currentExpiresAt = user.subscription?.expiresAt ? new Date(user.subscription.expiresAt) : null;
  let newExpiresAt = new Date();

  // Apply target expiration based on verified transition type
  if ((transitionType === 'MONTHLY_UPGRADE' || transitionType === 'ANNUAL_UPGRADE') && currentExpiresAt && currentExpiresAt > new Date()) {
    newExpiresAt = currentExpiresAt; // Preserve existing cycle anniversary
  } else if (transitionType === 'CYCLE_UPGRADE' && currentExpiresAt && currentExpiresAt > new Date()) {
    newExpiresAt = new Date(currentExpiresAt.getTime() + 365 * 86400000); // Additive 365 days
  } else if (
    (transitionType === 'STACKED_RENEWAL' ||
      transitionType === 'RENEWAL_UPGRADE' ||
      transitionType === 'CYCLE_SWITCH_PREPAID') &&
    currentExpiresAt &&
    currentExpiresAt > new Date()
  ) {
    newExpiresAt = new Date(currentExpiresAt.getTime() + (cycle === 'annual' ? 365 : 30) * 86400000);
  } else {
    newExpiresAt = new Date(Date.now() + (cycle === 'annual' ? 365 : 30) * 86400000);
  }

  // Update periodEnd on claimedPayment
  claimedPayment.periodEnd = newExpiresAt;
  await claimedPayment.save();

  // Immediate quota expansion & clear any pending downgrade
  const isNewSubscription = !user.subscription || user.subscription.planId === 'free' || user.subscription.status === 'expired';
  user.plan = planId;
  user.storageLimit = targetPlan.storageBytes;
  user.trialAlreadyUsed = false;
  user.trialExpiresAt = null; // Clear stale evaluation trial timer on plan purchase
  user.subscription = {
    planId,
    billingCycle: cycle,
    status: 'active',
    startDate: isNewSubscription ? new Date() : (user.subscription?.startDate || new Date()),
    expiresAt: newExpiresAt,
    autoRenew: false,
    peakStorageBytes: isNewSubscription ? (user.storageUsed || 0) : Math.max(user.storageUsed || 0, user.subscription?.peakStorageBytes || 0),
    gracePeriodExpiresAt: null, // Clear stale grace period timer
    dunningStep: 0, // Reset dunning cycle to 0
    refundCount: user.subscription?.refundCount || 0,
    scheduledDowngrade: { targetPlanId: null, targetBillingCycle: null, scheduledAt: null }
  };
  await user.save();

  // Dispatch Transactional Confirmation Email
  const baseUrl = process.env.CLIENT_URL || clientOrigin || 'http://localhost:5173';
  const invoiceUrl = `${baseUrl}/api/payments/invoice/${orderId}`;

  if (transitionType === 'ANNUAL_UPGRADE' || transitionType === 'MONTHLY_UPGRADE') {
    const { subject, html } = generateUpgradeEmail({
      user,
      targetPlan,
      cycle,
      deltaAmount: Number(order.order_amount),
      invoiceNumber: claimedPayment.invoiceNumber,
      expiresAt: newExpiresAt,
      invoiceUrl
    });
    sendSubscriptionEmail({ to: user.email, subject, html }).catch(err => {
      console.error('[Upgrade Email Error]:', err.message);
    });
  } else {
    const { subject, html } = generatePurchaseEmail({
      user,
      targetPlan,
      cycle,
      orderAmount: Number(order.order_amount),
      invoiceNumber: claimedPayment.invoiceNumber,
      expiresAt: newExpiresAt,
      invoiceUrl
    });
    sendSubscriptionEmail({ to: user.email, subject, html }).catch(err => {
      console.error('[Purchase Email Error]:', err.message);
    });
  }

  return {
    success: true,
    status: 'PAID',
    storageLimit: user.storageLimit,
    subscription: user.subscription,
    invoiceNumber: claimedPayment.invoiceNumber,
    alreadyFulfilled: false
  };
}

/**
 * GET /api/payments/verify/:orderId
 */
router.get('/verify/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const clientOrigin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const result = await fulfillCashfreeOrder(orderId, null, clientOrigin);
    if (!result.success) {
      return res.json({ success: false, status: result.status });
    }
    return res.json({
      success: true,
      status: 'PAID',
      storageLimit: result.storageLimit,
      subscription: result.subscription,
      invoiceNumber: result.invoiceNumber
    });
  } catch (err) {
    console.error('[Cashfree Verify Error]:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to verify payment' });
  }
});

/**
 * POST /api/payments/webhook
 * Idempotent Cashfree PG webhook handler
 */
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    const orderData = payload.data?.order || payload.order || payload;
    const orderId = orderData?.order_id || payload.order_id || payload.data?.order_id;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing order_id in webhook payload' });
    }

    const clientOrigin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const result = await fulfillCashfreeOrder(orderId, orderData.order_status === 'PAID' ? orderData : null, clientOrigin);

    return res.json({ received: true, status: result.status || 'PAID' });
  } catch (err) {
    console.error('[Cashfree Webhook Error]:', err.message);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
});

/**
 * GET /api/payments/subscription-status
 * Returns subscription state and auto-reconciles legacy accounts with upgraded storage
 */
router.get('/subscription-status', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const GB_BYTES = 1024 * 1024 * 1024;
    const currentLimitGB = Math.round((user.storageLimit || 0) / GB_BYTES);

    // Self-heal: If user has >5 GB storage but subscription.planId is still 'free' or missing
    if (currentLimitGB > 5 && (!user.subscription || user.subscription.planId === 'free')) {
      let mappedPlan = 'tier_50gb';
      if (currentLimitGB >= 200) mappedPlan = 'tier_200gb';
      else if (currentLimitGB >= 100) mappedPlan = 'tier_100gb';

      user.plan = mappedPlan;
      user.trialExpiresAt = null;
      user.subscription = {
        planId: mappedPlan,
        billingCycle: user.subscription?.billingCycle && user.subscription.billingCycle !== 'none' 
          ? user.subscription.billingCycle 
          : 'monthly',
        status: 'active',
        startDate: user.subscription?.startDate || new Date(),
        expiresAt: user.subscription?.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenew: false,
        gracePeriodExpiresAt: null,
        dunningStep: 0,
      };

      await user.save();
    }

    const sub = user.subscription;
    const isAnnual = sub?.billingCycle === 'annual';
    const isPaid = sub?.planId && sub.planId !== 'free';
    const startDate = sub?.startDate ? new Date(sub.startDate) : null;
    const daysSinceStart = startDate ? (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24) : Infinity;
    const peakBytes = sub?.peakStorageBytes !== undefined ? sub.peakStorageBytes : (user.storageUsed || 0);

    // Check if user has claimed a prior refund
    let hasPriorRefund = (sub?.refundCount || 0) >= 1;
    if (!hasPriorRefund) {
      const userEmailRegex = user.email ? new RegExp(`^${user.email.trim()}$`, 'i') : null;
      const priorRefundPayment = await Payment.findOne({
        status: 'REFUNDED',
        $or: [
          { userId: user._id },
          ...(userEmailRegex ? [{ 'customerDetails.email': userEmailRegex }] : [])
        ]
      }).select('_id').lean();
      if (priorRefundPayment) {
        hasPriorRefund = true;
      }
    }

    let refundEligible = Boolean(isPaid && isAnnual && daysSinceStart <= 7 && peakBytes <= REFUND_MAX_PEAK_BYTES && !hasPriorRefund);
    let refundIneligibleReason = null;
    if (hasPriorRefund) {
      refundEligible = false;
      refundIneligibleReason = 'Prior Refund Already Claimed';
    } else if (!refundEligible) {
      if (!isPaid) refundIneligibleReason = 'Free / Non-paying Plan';
      else if (!isAnnual) refundIneligibleReason = 'Monthly Plan';
      else if (peakBytes > REFUND_MAX_PEAK_BYTES) refundIneligibleReason = 'Peak Storage Exceeded 2 GB';
      else if (daysSinceStart > 7) refundIneligibleReason = '7-Day Window Expired';
      else refundIneligibleReason = 'Ineligible';
    }

    return res.json({
      success: true,
      subscription: user.subscription,
      plan: user.plan,
      trialExpiresAt: user.trialExpiresAt,
      trialAlreadyUsed: Boolean(user.trialAlreadyUsed),
      storageLimit: user.storageLimit,
      storageUsed: user.storageUsed,
      peakStorageBytes: peakBytes,
      refundEligible,
      refundIneligibleReason,
      hasPriorRefund,
      refundCount: sub?.refundCount || 0,
      refundMaxPeakBytes: REFUND_MAX_PEAK_BYTES,
      userId: user._id
    });
  } catch (err) {
    console.error('[Subscription Status Error]:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve subscription status' });
  }
});

/**
 * POST /api/payments/cancel-subscription
 * Safe cancellation: retains paid storage until expiresAt
 */
router.post('/cancel-subscription', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.subscription || user.subscription.status !== 'active') {
      return res.status(400).json({ error: 'No active subscription found to cancel' });
    }

    user.subscription.status = 'cancelled';
    user.subscription.autoRenew = false;
    await user.save();

    const expiryDateStr = new Date(user.subscription.expiresAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const cancelHtml = buildCloudGuardEmail({
      title: 'Subscription Cancelled',
      badge: 'SUBSCRIPTION CANCELLED',
      isUrgent: false,
      contentHtml: `
        <p>Your CloudGuard subscription has been successfully cancelled as requested. You will not be charged again.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Vault Access:</strong> Full access until <strong>${expiryDateStr}</strong></p>
          <p style="margin: 0; font-size: 13px; color: #64748b;">Your stored files will remain safe. You can resume your subscription anytime before this date to prevent interruption.</p>
        </div>
      `,
      ctaText: 'Resume Subscription',
      ctaUrl: `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`
    });

    sendSubscriptionEmail({
      to: user.email,
      subject: 'Subscription Cancelled — CloudGuard Vault',
      html: cancelHtml
    });

    return res.json({
      success: true,
      message: 'Subscription cancelled. You will continue to have full access to your vault storage until your paid period ends.',
      expiresAt: user.subscription.expiresAt
    });
  } catch (err) {
    console.error('[Cancel Subscription Error]:', err);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * POST /api/payments/reactivate-subscription
 * Re-activates a cancelled subscription before expiresAt without new payment
 */
router.post('/reactivate-subscription', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.subscription || user.subscription.status !== 'cancelled') {
      return res.status(400).json({ error: 'No cancelled subscription eligible for reactivation' });
    }

    if (user.subscription.expiresAt && new Date(user.subscription.expiresAt) <= new Date()) {
      return res.status(400).json({ error: 'Subscription has already expired. Please select a new plan.' });
    }

    user.subscription.status = 'active';
    user.subscription.gracePeriodExpiresAt = null;
    user.subscription.dunningStep = 0;
    user.trialExpiresAt = null;
    await user.save();

    const renewalDateStr = new Date(user.subscription.expiresAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const resumeHtml = buildCloudGuardEmail({
      title: 'Subscription Resumed',
      badge: 'SUBSCRIPTION ACTIVE',
      isUrgent: false,
      contentHtml: `
        <p>Welcome back! Your CloudGuard subscription is active, and your vault storage will continue uninterrupted.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0; font-size: 13px;"><strong>Next Renewal / Cycle End:</strong> ${renewalDateStr}</p>
        </div>
      `,
      ctaText: 'Open Vault',
      ctaUrl: `${process.env.CLIENT_URL || 'https://cloudguard.site'}/dashboard`
    });

    sendSubscriptionEmail({
      to: user.email,
      subject: 'Subscription Resumed — CloudGuard Vault',
      html: resumeHtml
    });

    return res.json({
      success: true,
      message: 'Subscription reactivated successfully. Your vault will continue uninterrupted.',
      subscription: user.subscription
    });
  } catch (err) {
    console.error('[Reactivate Subscription Error]:', err);
    return res.status(500).json({ error: 'Failed to reactivate subscription' });
  }
});

/**
 * GET /api/payments/history
 * Returns list of user invoices and payment records
 */
router.get('/history', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const history = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve billing history' });
  }
});

/**
 * GET /api/payments/invoice/:orderId
 * Generates an official, print-ready Bill of Supply (Invoice) as a binary vector PDF
 */
router.get('/invoice/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const payment = await Payment.findOne({ orderId }).populate('userId', 'name email');
    if (!payment) return res.status(404).send('Invoice not found');

    const invoiceDate = new Date(payment.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const periodStart = payment.periodStart
      ? new Date(payment.periodStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : invoiceDate;
    const periodEnd = payment.periodEnd
      ? new Date(payment.periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'N/A';

    const customerName = payment.customerDetails?.name || payment.userId?.name || 'Subscriber';
    const customerEmail = payment.customerDetails?.email || payment.userId?.email || 'N/A';
    const planName = payment.planName || 'CloudGuard Storage';
    const storageGB = payment.storageGB ? `${payment.storageGB} GB` : 'Standard';
    const amountVal = typeof payment.amount === 'number' ? payment.amount : Number(payment.amount || 0);
    const amountFormatted = amountVal.toFixed(2);

    const safeFilename = `${payment.invoiceNumber || orderId}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const leftMargin = 40;
    const rightMargin = 555;
    const pageWidth = rightMargin - leftMargin;

    // --- HEADER ---
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#0f172a').text('CloudGuard', leftMargin, 40);

    // Badge below logo
    const badgeY = 68;
    doc.roundedRect(leftMargin, badgeY, 195, 18, 4).fillAndStroke('#e0f2fe', '#bae6fd');
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0369a1').text('BILL OF SUPPLY / OFFICIAL RECEIPT', leftMargin + 8, badgeY + 4.5);

    // Invoice Details Top Right
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text(`Invoice No: ${payment.invoiceNumber || 'N/A'}`, leftMargin, 40, { align: 'right', width: pageWidth });
    doc.fontSize(9).font('Helvetica').fillColor('#334155').text(`Date: ${invoiceDate}`, leftMargin, 55, { align: 'right', width: pageWidth });
    doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text(`Order ID: ${payment.orderId}`, leftMargin, 70, { align: 'right', width: pageWidth });

    // Header Divider
    const dividerY = 100;
    doc.moveTo(leftMargin, dividerY).lineTo(rightMargin, dividerY).lineWidth(1.5).strokeColor('#0f172a').stroke();

    // --- TWO-COLUMN DETAILS ---
    const detailsY = 115;

    // Left Column: Supplier
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b').text('SOLD BY (SUPPLIER)', leftMargin, detailsY);
    let currY = detailsY + 14;

    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text('CloudGuard', leftMargin, currY, { continued: true });
    doc.font('Helvetica').fillColor('#334155').text(' (Proprietor: Nizam Ahamad)');
    currY += 13;

    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    doc.text('House No. 120, Main Market, Ward No. 2', leftMargin, currY);
    currY += 12;
    doc.text('Shaktifarm, Udham Singh Nagar', leftMargin, currY);
    currY += 12;
    doc.text('Uttarakhand - 263151, India', leftMargin, currY);
    currY += 12;
    doc.font('Helvetica-Bold').text('Udyam Reg: ', leftMargin, currY, { continued: true });
    doc.font('Helvetica').text('UDYAM-UK-12-0107479');
    currY += 12;
    doc.font('Helvetica-Bold').text('GSTIN: ', leftMargin, currY, { continued: true });
    doc.font('Helvetica').text('Exempted (Under Threshold)');

    // Right Column: Customer
    const rightColX = 310;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b').text('BILLED TO (CUSTOMER)', rightColX, detailsY);
    let rCurrY = detailsY + 14;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text(customerName, rightColX, rCurrY);
    rCurrY += 14;

    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    doc.text(`Email: ${customerEmail}`, rightColX, rCurrY);
    rCurrY += 13;
    doc.text('Country: India', rightColX, rCurrY);
    rCurrY += 13;

    doc.font('Helvetica-Bold').text('Status: ', rightColX, rCurrY, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#16a34a').text('PAID (Cashfree Gateway)');

    // --- LINE-ITEM TABLE ---
    const tableTop = 230;
    const tableHeaderH = 22;

    // Header background fill
    doc.rect(leftMargin, tableTop, pageWidth, tableHeaderH).fillColor('#f1f5f9').fill();
    doc.moveTo(leftMargin, tableTop + tableHeaderH).lineTo(rightMargin, tableTop + tableHeaderH).lineWidth(1).strokeColor('#cbd5e1').stroke();

    // Table header texts
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#334155');
    doc.text('Description', leftMargin + 8, tableTop + 6);
    doc.text('SAC Code', leftMargin + 240, tableTop + 6);
    doc.text('Billing Period', leftMargin + 310, tableTop + 6);
    doc.text('Amount (INR)', leftMargin, tableTop + 6, { align: 'right', width: pageWidth - 8 });

    // Row contents
    const rowY = tableTop + tableHeaderH + 10;
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text(`${planName} (${storageGB})`, leftMargin + 8, rowY);
    doc.fontSize(8).font('Helvetica').fillColor('#64748b').text('Cloud storage quota and automated AI malware threat inspection', leftMargin + 8, rowY + 13);

    doc.fontSize(9).font('Helvetica').fillColor('#334155').text('998315', leftMargin + 240, rowY);
    doc.fontSize(8.5).font('Helvetica').fillColor('#334155').text(`${periodStart} - ${periodEnd}`, leftMargin + 310, rowY);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text(`INR ${amountFormatted}`, leftMargin, rowY, { align: 'right', width: pageWidth - 8 });

    // Bottom border of item row
    const rowBottom = rowY + 32;
    doc.moveTo(leftMargin, rowBottom).lineTo(rightMargin, rowBottom).lineWidth(0.5).strokeColor('#e2e8f0').stroke();

    // --- TOTALS SECTION ---
    let totalY = rowBottom + 12;
    const totalsWidth = 200;
    const totalsX = rightMargin - totalsWidth;

    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('Subtotal:', totalsX, totalY);
    doc.font('Helvetica').fillColor('#0f172a').text(`INR ${amountFormatted}`, totalsX, totalY, { align: 'right', width: totalsWidth - 8 });
    totalY += 16;

    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('Taxes (GST Exempt):', totalsX, totalY);
    doc.font('Helvetica').fillColor('#0f172a').text('INR 0.00', totalsX, totalY, { align: 'right', width: totalsWidth - 8 });
    totalY += 16;

    doc.moveTo(totalsX, totalY).lineTo(rightMargin, totalY).lineWidth(1.5).strokeColor('#0f172a').stroke();
    totalY += 8;

    doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#0f172a').text('Total Paid:', totalsX, totalY);
    doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#0f172a').text(`INR ${amountFormatted}`, totalsX, totalY, { align: 'right', width: totalsWidth - 8 });
    totalY += 28;

    // --- FOOTER / TERMS & NOTES ---
    const footerY = 420;
    doc.moveTo(leftMargin, footerY).lineTo(rightMargin, footerY).lineWidth(0.75).strokeColor('#e2e8f0').stroke();

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#475569').text('Terms & Notes:', leftMargin, footerY + 12);
    doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(
      '• This is an electronically generated Bill of Supply issued under Section 31(3)(c) of the CGST Act, 2017. No physical signature is required.\n' +
      '• Payment verified and settled via Cashfree Payments.\n' +
      '• For billing support or refund queries, contact support@cloudguard.site within 7 days of transaction date.',
      leftMargin,
      footerY + 26,
      { lineGap: 3.5, width: pageWidth }
    );

    doc.end();
  } catch (err) {
    console.error('Invoice PDF Generation Error:', err);
    if (!res.headersSent) {
      return res.status(500).send('Failed to generate invoice');
    }
  }
});

/**
 * POST /api/payments/cancel-scheduled-downgrade
 * Allows user to revoke a pending downgrade and retain their active tier
 */
router.post('/cancel-scheduled-downgrade', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.subscription?.scheduledDowngrade?.targetPlanId) {
      return res.status(400).json({ error: 'No scheduled downgrade found on this account.' });
    }

    user.subscription.scheduledDowngrade = {
      targetPlanId: null,
      targetBillingCycle: null,
      scheduledAt: null
    };

    await user.save();

    // Scenario 4: Dispatch Scheduled Downgrade Cancellation Notice
    const activePlanName = PLAN_CATALOG[user.subscription?.planId]?.name || user.plan || 'Active Vault Plan';
    const baseUrl = process.env.CLIENT_URL || req.headers.origin;
    sendDowngradeRevocationEmail(user, activePlanName, user.subscription?.expiresAt, baseUrl).catch(err => {
      console.error('[Downgrade Cancellation Email Error]:', err.message);
    });

    return res.json({
      success: true,
      message: 'Scheduled downgrade cancelled. You will continue on your current plan on renewal.'
    });
  } catch (err) {
    console.error('[Cancel Downgrade Error]:', err.message);
    return res.status(500).json({ error: 'Failed to cancel scheduled downgrade' });
  }
});

router.calculateTierTransition = calculateTierTransition;
router.PLAN_CATALOG = PLAN_CATALOG;
router.sendSubscriptionEmail = sendSubscriptionEmail;
router.buildCloudGuardEmail = buildCloudGuardEmail;
router.fulfillCashfreeOrder = fulfillCashfreeOrder;

module.exports = router;
module.exports.router = router;
module.exports.PLAN_CATALOG = PLAN_CATALOG;
module.exports.calculateTierTransition = calculateTierTransition;
module.exports.sendSubscriptionEmail = sendSubscriptionEmail;
module.exports.buildCloudGuardEmail = buildCloudGuardEmail;
module.exports.fulfillCashfreeOrder = fulfillCashfreeOrder;
