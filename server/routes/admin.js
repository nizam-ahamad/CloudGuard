const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { isAdminEmail } = require('../middleware/requireAdmin');
const User = require('../models/User');
const Payment = require('../models/Payment');

const REFUND_MAX_PEAK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function formatPlanLabel(planId) {
  if (!planId) return 'Free';
  const id = String(planId).toLowerCase().trim();
  switch (id) {
    case 'tier_50gb':
    case 'essential':
      return 'Essential (50 GB)';
    case 'tier_100gb':
    case 'pro':
      return 'Pro (100 GB)';
    case 'tier_200gb':
    case 'ultra':
      return 'Ultra (200 GB)';
    case 'max':
      return 'Max';
    case 'trial':
      return 'Trial';
    case 'free':
      return 'Free';
    default:
      return id.charAt(0).toUpperCase() + id.slice(1);
  }
}

/**
 * GET /api/admin/me
 * Authenticated via auth: returns 200 { success: true, isAdmin: boolean }
 * Never throws 404 for logged-in users to eliminate console errors.
 */
router.get('/me', auth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(200).json({ success: true, isAdmin: false });
    }
    const user = await User.findById(userId).select('email').lean();
    return res.status(200).json({
      success: true,
      isAdmin: isAdminEmail(user?.email)
    });
  } catch (err) {
    return res.status(200).json({ success: true, isAdmin: false });
  }
});

// Guard all subsequent admin endpoints with requireAdmin (cloaked 404 for non-admins)
router.use(requireAdmin);

/**
 * GET /api/admin/overview
 * Returns aggregate metrics and enriched user roster with 2GB peak roof and 7-day refund status
 */
router.get('/overview', async (req, res) => {
  try {
    const [users, paidPayments, refundedPayments] = await Promise.all([
      User.find({}).select('-password -resetPasswordToken -resetPasswordExpire').sort({ createdAt: -1 }).lean(),
      Payment.find({ status: 'PAID' }).sort({ createdAt: -1 }).lean(),
      Payment.find({ status: 'REFUNDED' }).select('userId customerDetails.email').lean()
    ]);

    const refundedUserIds = new Set(refundedPayments.map(p => String(p.userId)));
    const refundedEmails = new Set(
      refundedPayments
        .map(p => p.customerDetails?.email?.toLowerCase()?.trim())
        .filter(Boolean)
    );

    // Build map of payments by user ID
    const paymentsByUser = new Map();
    for (const payment of paidPayments) {
      const uid = String(payment.userId);
      if (!paymentsByUser.has(uid)) {
        paymentsByUser.set(uid, []);
      }
      paymentsByUser.get(uid).push(payment);
    }

    const enrichedUsers = users.map((user) => {
      const userPayments = paymentsByUser.get(String(user._id)) || [];
      const latestPayment = userPayments[0] || null;

      const latestOrder = latestPayment
        ? {
            orderId: latestPayment.orderId,
            invoiceNumber: latestPayment.invoiceNumber,
            amount: latestPayment.amount,
            paidAt: latestPayment.createdAt,
            planName: latestPayment.planName,
            billingCycle: latestPayment.billingCycle
          }
        : null;

      const purchaseDate = latestPayment?.createdAt || user.subscription?.startDate || null;
      const peakBytes = Math.max(user.subscription?.peakStorageBytes || 0, user.storageUsed || 0);
      const exceeded2GBRoof = peakBytes > REFUND_MAX_PEAK_BYTES;
      const ageDays = purchaseDate
        ? Number(((Date.now() - new Date(purchaseDate).getTime()) / 86400000).toFixed(2))
        : null;

      const normalizedStatus = user.subscription?.status || 'active';
      const rawPlanId = user.subscription?.planId || user.plan || 'free';
      const planLabel = formatPlanLabel(rawPlanId);

      const isAnnual = user.subscription?.billingCycle === 'annual';
      const isActive = normalizedStatus === 'active';
      const isPaid = rawPlanId && rawPlanId !== 'free' && rawPlanId !== 'trial';

      const userEmail = (user.email || '').toLowerCase().trim();
      const hasPriorRefund = (user.subscription?.refundCount || 0) >= 1 ||
        refundedUserIds.has(String(user._id)) ||
        refundedEmails.has(userEmail);

      let refundEligible = Boolean(
        isAnnual &&
        isActive &&
        isPaid &&
        ageDays !== null &&
        ageDays <= 7 &&
        !exceeded2GBRoof &&
        !hasPriorRefund
      );

      let refundIneligibleReason = null;
      if (hasPriorRefund) {
        refundEligible = false;
        refundIneligibleReason = 'Prior Refund Already Claimed';
      } else if (!refundEligible) {
        if (!isPaid || !isActive) {
          refundIneligibleReason = 'Free / Inactive';
        } else if (!isAnnual) {
          refundIneligibleReason = 'Monthly Plan';
        } else if (exceeded2GBRoof) {
          refundIneligibleReason = 'Peak > 2 GB Roof';
        } else if (ageDays !== null && ageDays > 7) {
          refundIneligibleReason = 'Window > 7 Days';
        } else {
          refundIneligibleReason = 'Ineligible';
        }
      }

      return {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        plan: user.plan,
        planLabel,
        storageUsed: user.storageUsed || 0,
        storageLimit: user.storageLimit || 5368709120,
        subscription: {
          ...(user.subscription || {}),
          status: normalizedStatus
        },
        peakBytes,
        exceeded2GBRoof,
        purchaseDate,
        ageDays,
        refundEligible,
        refundIneligibleReason,
        hasPriorRefund,
        refundCount: user.subscription?.refundCount || 0,
        latestOrder
      };
    });

    // Aggregate metrics
    const totalUsers = users.length;
    const activePaidUsers = users.filter((u) => {
      const st = u.subscription?.status || 'active';
      const pid = u.subscription?.planId || u.plan;
      return st === 'active' && pid && pid !== 'free' && pid !== 'trial';
    }).length;
    const pastDueUsers = users.filter((u) => u.subscription?.status === 'past_due').length;
    const expiredUsers = users.filter((u) => u.subscription?.status === 'expired').length;
    const totalStorageUsedBytes = users.reduce((sum, u) => sum + (u.storageUsed || 0), 0);
    const totalStorageAllocatedBytes = users.reduce((sum, u) => sum + (u.storageLimit || 0), 0);

    // Backblaze B2 Pricing: $0.006 / GB / month at ~₹87/$
    const totalStorageUsedGB = totalStorageUsedBytes / (1024 * 1024 * 1024);
    const estimatedB2MonthlyINR = Number((totalStorageUsedGB * 0.006 * 87).toFixed(2));

    const totalRevenueINR = paidPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const refundEligibleCount = enrichedUsers.filter((u) => u.refundEligible).length;

    return res.json({
      success: true,
      metrics: {
        totalUsers,
        activePaidUsers,
        pastDueUsers,
        expiredUsers,
        totalStorageUsedBytes,
        totalStorageAllocatedBytes,
        estimatedB2MonthlyINR,
        totalRevenueINR,
        refundEligibleCount
      },
      users: enrichedUsers
    });
  } catch (err) {
    console.error('[Admin Overview Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve admin overview' });
  }
});

/**
 * POST /api/admin/users/:userId/reset-refund
 * Resets user vault baseline to expired 5 GB after a manual refund
 */
router.post('/users/:userId/reset-refund', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user already claimed a prior refund
    let hasPriorRefund = (user.subscription?.refundCount || 0) >= 1;
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

    if (hasPriorRefund) {
      return res.status(400).json({
        error: 'This account has already claimed its one-time refund and cannot be reset again.'
      });
    }

    // Mark the user's latest PAID Payment document as REFUNDED
    await Payment.findOneAndUpdate(
      { userId: user._id, status: 'PAID' },
      { status: 'REFUNDED' },
      { sort: { createdAt: -1 } }
    );

    const hasStoredFiles = (user.storageUsed || 0) > 0;
    const newRefundCount = (user.subscription?.refundCount || 0) + 1;

    const updateFields = {
      plan: 'free',
      storageLimit: 5 * 1024 * 1024 * 1024,
      trialExpiresAt: null,
      'subscription.planId': 'free',
      'subscription.billingCycle': 'none',
      'subscription.peakStorageBytes': 0,
      'subscription.refundCount': newRefundCount,
      'subscription.scheduledDowngrade': { targetPlanId: null, targetBillingCycle: null, scheduledAt: null }
    };

    if (hasStoredFiles) {
      updateFields['subscription.status'] = 'past_due';
      updateFields['subscription.gracePeriodExpiresAt'] = new Date(Date.now() + 7 * 86400000);
      updateFields['subscription.dunningStep'] = 1;
    } else {
      updateFields['subscription.status'] = 'expired';
      updateFields['subscription.gracePeriodExpiresAt'] = null;
      updateFields['subscription.dunningStep'] = 0;
    }

    const updated = await User.findByIdAndUpdate(userId, updateFields, { new: true });

    return res.json({
      success: true,
      message: hasStoredFiles
        ? 'User vault set to 7-day grace period (past_due) for download before scheduled B2 cleanup.'
        : 'User vault reset to expired 5 GB baseline after manual refund.',
      user: {
        id: updated._id,
        email: updated.email,
        plan: updated.plan,
        storageLimit: updated.storageLimit,
        trialExpiresAt: updated.trialExpiresAt,
        subscription: updated.subscription
      }
    });
  } catch (err) {
    console.error('[Admin Reset-Refund Error]:', err);
    return res.status(500).json({ error: 'Failed to reset user after refund' });
  }
});

module.exports = router;

