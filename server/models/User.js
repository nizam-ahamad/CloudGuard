const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      default: null,
    },
    googleId: {
      type: String,
      sparse: true,
      default: null,
    },
    avatar: {
      type: String,
      default: null,
    },
    authProvider: {
      type: String,
      enum: ['local', 'google', 'hybrid'],
      default: 'local',
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpires: {
      type: Date,
      default: null,
    },
    storageUsed: {
      type: Number,
      default: 0,
    },
    storageLimit: {
      type: Number,
      default: 5368709120, // 5 GB
    },
    plan: {
      type: String,
      default: 'free',
    },
    trialExpiresAt: {
      type: Date,
      default: null,
    },
    subscription: {
      planId: { 
        type: String, 
        enum: ['free', 'tier_50gb', 'tier_100gb', 'tier_200gb'], 
        default: 'free' 
      },
      billingCycle: { 
        type: String, 
        enum: ['monthly', 'annual', 'none'], 
        default: 'none' 
      },
      status: { 
        type: String, 
        enum: ['active', 'cancelled', 'past_due', 'expired'], 
        default: 'active' 
      },
      startDate: { 
        type: Date, 
        default: null 
      },
      expiresAt: { 
        type: Date, 
        default: null 
      },
      autoRenew: { 
        type: Boolean, 
        default: false 
      },
      peakStorageBytes: {
        type: Number,
        default: 0
      },
      gracePeriodExpiresAt: {
        type: Date,
        default: null
      },
      dunningStep: {
        type: Number,
        default: 0
      },
      refundCount: {
        type: Number,
        default: 0
      },
      scheduledDowngrade: {
        targetPlanId: { 
          type: String, 
          enum: ['free', 'tier_50gb', 'tier_100gb', null], 
          default: null 
        },
        targetBillingCycle: { 
          type: String, 
          enum: ['monthly', 'annual', null], 
          default: null 
        },
        scheduledAt: { type: Date, default: null }
      }
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpire: {
      type: Date,
      default: null,
    },
    consentGiven: {
      type: Boolean,
      default: true,
    },
    consentTimestamp: {
      type: Date,
      default: Date.now,
    },
    consentVersion: {
      type: String,
      default: '1.0',
    },
    isAdultConfirmed: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
