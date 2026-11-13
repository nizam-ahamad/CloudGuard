const express = require('express');
const axios = require('axios');
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

const CASHFREE_BASE_URL =
  process.env.CASHFREE_ENV === 'PRODUCTION'
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
  const daysRemaining = Math.max(1, Math.ceil((currentExpiresAt.getTime() - Date.now()) / 86400000));
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

  // Rule A — Deferred Downgrades (Capacity Reductions Only)
  if (targetPlan.storageGB < currentPlan.storageGB) {
    return {
      transitionType: 'SCHEDULED_DOWNGRADE',
      payableAmount: 0, // No payment today; deferred to cycle end
      targetExpiresAt: currentExpiresAt,
      effectiveDate: currentExpiresAt,
      isImmediateQuota: false
    };
  }

  // Rule B — Renewal-Window Tier Upgrades (Full new cycle stacked onto remaining days)
  if (targetPlan.storageGB > currentPlan.storageGB && currentCycle === targetBillingCycle && daysRemaining <= renewalWindowDays) {
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

  // Rule C — Annual to Monthly Switch on equal or higher storage (Prepay monthly & stack +30 days)
  if (currentCycle === 'annual' && targetBillingCycle === 'monthly' && targetPlan.storageGB >= currentPlan.storageGB) {
    return {
      transitionType: 'CYCLE_SWITCH_PREPAID',
      payableAmount: targetPlan.monthlyPrice,
      targetExpiresAt: new Date(currentExpiresAt.getTime() + 30 * 86400000),
      isImmediateQuota: true
    };
  }

  // Case 4: Monthly to Monthly Mid-Cycle Upgrade (Delta Price, Preserves Expiry)
  if (currentCycle === 'monthly' && targetBillingCycle === 'monthly' && targetPlan.storageGB > currentPlan.storageGB) {
    const deltaAmount = targetPlan.monthlyPrice - currentPlan.monthlyPrice;
    return {
      transitionType: 'MONTHLY_UPGRADE',
      payableAmount: Math.max(1, deltaAmount),
      targetExpiresAt: currentExpiresAt, // Retain existing cycle end
      isImmediateQuota: true
    };
  }

  // Case 5: Annual to Annual Mid-Cycle Upgrade (Co-Termed Delta Math)
  if (currentCycle === 'annual' && targetBillingCycle === 'annual' && targetPlan.storageGB > currentPlan.storageGB) {
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

  // Case 6: Monthly to Annual Switch (Additive Duration: Current End + 365 Days)
  if (currentCycle === 'monthly' && targetBillingCycle === 'annual') {
    return {
      transitionType: 'CYCLE_UPGRADE',
      payableAmount: targetPlan.annualPrice,
      targetExpiresAt: new Date(currentExpiresAt.getTime() + 365 * 86400000),
      isImmediateQuota: true
    };
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

    return res.json({
      success: true,
      orderId: response.data.order_id,
      paymentSessionId: response.data.payment_session_id,
      transitionType: transition.transitionType,
      payableAmount: transition.payableAmount
    });
  } catch (err) {
    console.error('[Cashfree Order Error]:', err.response?.data || err.message);
    return res.status(500).json({
      error: err.response?.data?.message || err.message || 'Failed to initialize payment order'
    });
  }
});

/**
 * GET /api/payments/verify/:orderId
 */
router.get('/verify/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const response = await axios.get(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01'
      }
    });

    const order = response.data;
    if (order.order_status === 'PAID') {
      const parts = (order.order_note || '').split('|');
      let planId = parts[1] || 'tier_50gb';
      if (planId === 'essential') planId = 'tier_50gb';
      if (planId === 'pro') planId = 'tier_100gb';
      if (planId === 'ultra') planId = 'tier_200gb';

      const cycle = parts[2] || (Number(order.order_amount) > 300 ? 'annual' : 'monthly');
      const transitionType = parts[4] || 'STANDARD';

      const userId = req.user?.id || req.user?._id;
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const targetPlan = PLAN_CATALOG[planId] || PLAN_CATALOG.tier_50gb;
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

      // Immediate quota expansion & clear any pending downgrade
      const isNewSubscription = !user.subscription || user.subscription.planId === 'free' || user.subscription.status === 'expired';
      user.plan = planId;
      user.storageLimit = targetPlan.storageBytes;
      user.subscription = {
        planId,
        billingCycle: cycle,
        status: 'active',
        startDate: isNewSubscription ? new Date() : (user.subscription?.startDate || new Date()),
        expiresAt: newExpiresAt,
        autoRenew: false,
        peakStorageBytes: isNewSubscription ? (user.storageUsed || 0) : Math.max(user.storageUsed || 0, user.subscription?.peakStorageBytes || 0),
        gracePeriodExpiresAt: null,
        dunningStep: 0,
        refundCount: user.subscription?.refundCount || 0,
        scheduledDowngrade: { targetPlanId: null, targetBillingCycle: null, scheduledAt: null }
      };
      await user.save();

      // Generate Invoice Record
      let paymentRecord = await Payment.findOne({ orderId });
      if (!paymentRecord) {
        const totalPaymentsCount = await Payment.countDocuments();
        const invoiceNumber = `CG-INV-${new Date().getFullYear()}-${String(totalPaymentsCount + 1).padStart(4, '0')}`;
        
        let lineItemTitle = `${targetPlan.name} (${targetPlan.storageGB} GB)`;
        if (transitionType === 'ANNUAL_UPGRADE') lineItemTitle += ' — Mid-Cycle Co-Termed Upgrade';
        else if (transitionType === 'MONTHLY_UPGRADE') lineItemTitle += ' — Mid-Cycle Monthly Upgrade Delta';
        else if (transitionType === 'RENEWAL_UPGRADE') lineItemTitle += ' — Tier Upgrade + Cycle Renewal';
        else if (transitionType === 'CYCLE_SWITCH_PREPAID') lineItemTitle += ' — Monthly Cycle Switch (+30 Days)';

        paymentRecord = await Payment.create({
          userId: user._id,
          invoiceNumber,
          orderId,
          paymentId: order.cf_order_id ? String(order.cf_order_id) : orderId,
          planId,
          planName: lineItemTitle,
          storageGB: targetPlan.storageGB,
          billingCycle: cycle,
          amount: Number(order.order_amount),
          currency: 'INR',
          status: 'PAID',
          customerDetails: {
            name: user.name || 'CloudGuard Subscriber',
            email: user.email
          },
          periodStart: new Date(),
          periodEnd: newExpiresAt
        });

        // 3. Dispatch Transactional Confirmation Email with Direct Invoice Link
        const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
        const baseUrl = process.env.CLIENT_URL || origin;
        const invoiceUrl = `${baseUrl}/api/payments/invoice/${orderId}`;

        if (transitionType === 'ANNUAL_UPGRADE' || transitionType === 'MONTHLY_UPGRADE') {
          // Scenario 2: Mid-Cycle Upgrade (Delta / Co-Termed)
          const { subject, html } = generateUpgradeEmail({
            user,
            targetPlan,
            cycle,
            deltaAmount: Number(order.order_amount),
            invoiceNumber,
            expiresAt: newExpiresAt,
            invoiceUrl
          });
          sendSubscriptionEmail({ to: user.email, subject, html }).catch(err => {
            console.error('[Upgrade Email Error]:', err.message);
          });
        } else {
          // Scenario 1: New Purchase / Activation / Stacked Renewal
          const { subject, html } = generatePurchaseEmail({
            user,
            targetPlan,
            cycle,
            orderAmount: Number(order.order_amount),
            invoiceNumber,
            expiresAt: newExpiresAt,
            invoiceUrl
          });
          sendSubscriptionEmail({ to: user.email, subject, html }).catch(err => {
            console.error('[Purchase Email Error]:', err.message);
          });
        }
      }

      return res.json({
        success: true,
        status: 'PAID',
        storageLimit: user.storageLimit,
        subscription: user.subscription,
        invoiceNumber: paymentRecord.invoiceNumber
      });
    }

    return res.json({ success: false, status: order.order_status });
  } catch (err) {
    console.error('[Cashfree Verify Error]:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to verify payment' });
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
      user.subscription = {
        planId: mappedPlan,
        billingCycle: user.subscription?.billingCycle && user.subscription.billingCycle !== 'none' 
          ? user.subscription.billingCycle 
          : 'monthly',
        status: 'active',
        startDate: user.subscription?.startDate || new Date(),
        expiresAt: user.subscription?.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenew: false
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

    sendSubscriptionEmail({
      to: user.email,
      subject: 'Subscription Cancelled — CloudGuard Vault',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
          <h2 style="color: #0f172a; margin-bottom: 8px;">Subscription Cancelled</h2>
          <p style="font-size: 14px; color: #475569; line-height: 1.5;">
            Your CloudGuard subscription has been successfully cancelled as requested. You will not be charged again.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Vault Access:</strong> Full access until <strong>${expiryDateStr}</strong></p>
            <p style="margin: 0; font-size: 13px; color: #64748b;">Your stored files will remain safe. You can resume your subscription anytime before this date to prevent interruption.</p>
          </div>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">CloudGuard Vault • Secure Cloud Storage</p>
        </div>
      `
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
    await user.save();

    const renewalDateStr = new Date(user.subscription.expiresAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    sendSubscriptionEmail({
      to: user.email,
      subject: 'Subscription Resumed — CloudGuard Vault',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
          <h2 style="color: #0f172a; margin-bottom: 8px;">Subscription Resumed</h2>
          <p style="font-size: 14px; color: #475569; line-height: 1.5;">
            Welcome back! Your CloudGuard subscription is active, and your vault storage will continue uninterrupted.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0; font-size: 13px;"><strong>Next Renewal / Cycle End:</strong> ${renewalDateStr}</p>
          </div>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">CloudGuard Vault • Secure Cloud Storage</p>
        </div>
      `
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
 * Renders an official, print-ready Bill of Supply (Invoice)
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
    const periodStart = new Date(payment.periodStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const periodEnd = new Date(payment.periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    // Allow inline print scripting by clearing CSP on this specific static invoice document
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', 'text/html');

    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice - ${payment.invoiceNumber}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; padding: 40px 20px; }
          .invoice-box { max-width: 800px; margin: auto; padding: 40px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
          .badge { font-size: 12px; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 6px; }
          .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px; font-size: 13px; line-height: 1.6; }
          .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 13px; }
          th { background: #f1f5f9; padding: 12px; text-align: left; font-weight: 600; border-bottom: 1px solid #cbd5e1; }
          td { padding: 14px 12px; border-bottom: 1px solid #e2e8f0; }
          .totals { margin-left: auto; width: 300px; font-size: 13px; margin-bottom: 30px; }
          .totals-row { display: flex; justify-content: space-between; padding: 6px 0; }
          .totals-row.grand { border-top: 2px solid #0f172a; font-weight: 700; font-size: 16px; padding-top: 10px; color: #0f172a; }
          .footer { font-size: 11px; color: #64748b; line-height: 1.6; border-top: 1px solid #e2e8f0; padding-top: 20px; }
          .print-btn { background: #0f172a; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; float: right; margin-bottom: 20px; transition: background 0.2s; }
          .print-btn:hover { background: #1e293b; }
          @media print {
            body { background: white; padding: 0; }
            .invoice-box { border: none; box-shadow: none; padding: 0; max-width: 100%; }
            .print-btn { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="invoice-box">
          <button id="printBtn" class="print-btn" type="button">Print / Save as PDF</button>
          <div style="clear: both;"></div>

          <div class="header">
            <div>
              <div class="logo">CloudGuard</div>
              <div class="badge">BILL OF SUPPLY / OFFICIAL RECEIPT</div>
            </div>
            <div style="text-align: right; font-size: 13px; line-height: 1.5;">
              <div><strong>Invoice No:</strong> ${payment.invoiceNumber}</div>
              <div><strong>Date:</strong> ${invoiceDate}</div>
              <div><strong>Order ID:</strong> ${payment.orderId}</div>
            </div>
          </div>

          <div class="details-grid">
            <div>
              <div class="section-title">Sold By (Supplier)</div>
              <strong>CloudGuard</strong> (Proprietor: Nizam Ahamad)<br>
              House No. 120, Main Market, Ward No. 3<br>
              Shaktifarm, Udham Singh Nagar<br>
              Uttarakhand - 263151, India<br>
              <strong>Udyam Reg:</strong> UDYAM-UK-12-0107479<br>
              <strong>GSTIN:</strong> Exempted (Under Threshold)
            </div>
            <div>
              <div class="section-title">Billed To (Customer)</div>
              <strong>${payment.customerDetails?.name || 'Subscriber'}</strong><br>
              Email: ${payment.customerDetails?.email || 'N/A'}<br>
              Country: India<br>
              <strong>Status:</strong> <span style="color: #16a34a; font-weight: 600;">PAID (Cashfree Gateway)</span>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>SAC Code</th>
                <th>Billing Period</th>
                <th style="text-align: right;">Amount (INR)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>${payment.planName} (${payment.storageGB} GB)</strong><br>
                  <span style="color: #64748b; font-size: 12px;">Cloud storage quota and automated AI malware threat inspection</span>
                </td>
                <td>998315</td>
                <td>${periodStart} – ${periodEnd}</td>
                <td style="text-align: right;">₹${payment.amount.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <div class="totals">
            <div class="totals-row">
              <span>Subtotal:</span>
              <span>₹${payment.amount.toFixed(2)}</span>
            </div>
            <div class="totals-row">
              <span>Taxes (GST Exempt):</span>
              <span>₹0.00</span>
            </div>
            <div class="totals-row grand">
              <span>Total Paid:</span>
              <span>₹${payment.amount.toFixed(2)}</span>
            </div>
          </div>

          <div class="footer">
            <strong>Terms & Notes:</strong><br>
            • This is an electronically generated Bill of Supply issued under Section 31(3)(c) of the CGST Act, 2017. No physical signature is required.<br>
            • Payment verified and settled via Cashfree Payments.<br>
            • For billing support or refund queries, contact support@cloudguard.site within 7 days of transaction date.
          </div>
        </div>

        <script>
          document.addEventListener('DOMContentLoaded', function() {
            var btn = document.getElementById('printBtn');
            if (btn) {
              btn.addEventListener('click', function() {
                window.print();
              });
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send('Failed to generate invoice');
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

module.exports = router;
module.exports.router = router;
module.exports.PLAN_CATALOG = PLAN_CATALOG;
module.exports.calculateTierTransition = calculateTierTransition;
module.exports.sendSubscriptionEmail = sendSubscriptionEmail;
module.exports.buildCloudGuardEmail = buildCloudGuardEmail;
