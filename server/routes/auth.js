const express = require('express');
const router = express.Router();
const dns = require('node:dns');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');

authenticator.options = { window: 1 }; // ±30s clock-skew tolerance

const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const File = require('../models/File');
const Folder = require('../models/Folder');
const Payment = require('../models/Payment');
const DeletedAccountLog = require('../models/DeletedAccountLog');
const authMiddleware = require('../middleware/auth');
const { sendActivationOtp, sendResetOtp, sendWelcomeEmail, sendNotificationEmail, sendAccountDeletedEmail } = require('../utils/emailService');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { permanentlyDeleteS3Keys } = require('../utils/s3Delete');
const {
  validateDisplayName,
  validateVaultItemName,
  validatePasswordInput,
  validateCodeInput,
  validateEmailInput,
  sanitizePlainText,
} = require('../middleware/sanitize');

const get2faEncryptionKey = () =>
  crypto.createHash('sha256').update(process.env.JWT_SECRET || 'cloudguard_fallback_secret').digest();

function encrypt2faSecret(plainText) {
  if (!plainText) return null;
  const iv = crypto.randomBytes(12);
  const key = get2faEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt2faSecret(cipherString) {
  if (!cipherString) return null;
  const parts = cipherString.split(':');
  if (parts.length !== 3) return null;
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = get2faEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const hashNormalizedEmail = (email) =>
  crypto.createHash('sha256').update(String(email || '').toLowerCase().trim()).digest('hex');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Cryptographically secure 6-digit OTP generator (prevents PRNG state reconstruction)
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

// High-risk disposable / temporary email service domain roots
const DISPOSABLE_EMAIL_ROOTS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.biz',
  'guerrillamail.org',
  'sharklasers.com',
  'grr.la',
  'mailinator.com',
  'yopmail.com',
  'yopmail.net',
  'trashmail.com',
  'trashmail.net',
  'dispostable.com',
  'throwawaymail.com',
  'getairmail.com',
  'maildrop.cc',
  'inboxkitten.com',
  'fakemailgenerator.com',
  'mohmal.com',
  'crazymailing.com',
  'tempail.com',
  'mytemp.email',
  'nada.ltd',
  'getnada.com',
  'emailondeck.com',
  'burners.me',
]);

const isDisposableDomain = (domain) => {
  if (!domain || typeof domain !== 'string') return true;
  const cleanDomain = domain.toLowerCase().trim();
  if (DISPOSABLE_EMAIL_ROOTS.has(cleanDomain)) return true;
  for (const root of DISPOSABLE_EMAIL_ROOTS) {
    if (cleanDomain.endsWith(`.${root}`)) return true;
  }
  return false;
};

/**
 * Validates domain legitimacy via disposable blocklist and DNS MX records.
 * Fails open on 2500ms timeout or transient errors to prevent false rejections.
 */
const validateEmailDomain = async (email) => {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Valid email address is required' };
  }
  const parts = email.split('@');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid email address format' };
  }
  const domain = parts[1].toLowerCase().trim();
  if (!domain || domain.length < 3 || !domain.includes('.')) {
    return { valid: false, error: 'Invalid email domain' };
  }

  if (isDisposableDomain(domain)) {
    return {
      valid: false,
      error: 'Disposable email addresses are not permitted. Please use a permanent email provider.',
    };
  }

  try {
    const mxPromise = dns.promises.resolveMx(domain);
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        const err = new Error('DNS resolution timeout');
        err.code = 'ETIMEOUT';
        reject(err);
      }, 2500);
      if (timer.unref) timer.unref();
    });

    const records = await Promise.race([mxPromise, timeoutPromise]);
    if (!records || records.length === 0) {
      return {
        valid: false,
        error: 'The provided email domain does not have valid mail server (MX) records.',
      };
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'SERVFAIL') {
      return {
        valid: false,
        error: 'The email domain does not exist or cannot receive email.',
      };
    }
    // Fail open on timeouts (ETIMEOUT) and transient network errors
    console.warn(`[DNS MX Warning] MX check for ${domain} failed open: ${err.message || err.code}`);
  }

  return { valid: true };
};

// User verification middleware for authenticated routes (e.g. PUT /password)
const verifyToken = authMiddleware;

// Formatter for consistent user response
const formatUserResponse = (user) => ({
  id: user._id,
  _id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  authProvider: user.authProvider || 'local',
  hasPassword: !!user.password,
  isVerified: user.isVerified || false,
  storageUsed: user.storageUsed || 0,
  storageLimit: user.storageLimit || 5368709120,
  isAdmin: user.isAdmin || false,
  twoFactorEnabled: Boolean(user.twoFactorEnabled),
});

// ==========================================
// 1. GOOGLE SOCIAL AUTH (Auto-verified)
// ==========================================
router.post('/google', async (req, res) => {
  try {
    const { credential, consentGiven, isAdultConfirmed } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential required' });

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email_verified) return res.status(400).json({ error: 'Unverified Google account' });

    const { email, name, sub: googleId, picture } = payload;
    const normalizedEmail = email.toLowerCase().trim();

    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      let modified = false;
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = user.password ? 'hybrid' : 'google';
        modified = true;
      } else if (user.password && user.authProvider !== 'hybrid') {
        user.authProvider = 'hybrid';
        modified = true;
      }
      if (!user.avatar && picture) {
        user.avatar = picture;
        modified = true;
      }
      if (!user.isVerified) {
        user.isVerified = true;
        user.unverifiedExpiresAt = undefined;
        modified = true;
      }
      if (user.unverifiedExpiresAt) {
        user.unverifiedExpiresAt = undefined;
        modified = true;
      }
      if (modified) await user.save();
    } else {
      if (consentGiven !== true || isAdultConfirmed !== true) {
        return res.status(200).json({
          requiresConsent: true,
          isNewUser: true,
          email: normalizedEmail,
          name: name || normalizedEmail.split('@')[0],
        });
      }

      const priorDeletedLog = await DeletedAccountLog.findOne({
        emailHash: hashNormalizedEmail(normalizedEmail),
      }).lean();

      const newGoogleUser = {
        name: name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        googleId,
        avatar: picture || null,
        authProvider: 'google',
        isVerified: true,
        password: null,
        storageUsed: 0,
        storageLimit: 5 * 1024 * 1024 * 1024,
        consentGiven: true,
        isAdultConfirmed: true,
        consentTimestamp: new Date(),
        consentVersion: '1.0',
      };

      if (priorDeletedLog) {
        newGoogleUser.trialAlreadyUsed = true;
        newGoogleUser.plan = 'free';
        newGoogleUser.trialExpiresAt = null;
        newGoogleUser.subscription = {
          planId: 'free',
          billingCycle: 'none',
          status: 'expired',
          expiresAt: null,
          refundCount: priorDeletedLog.refundCount || 0,
        };
      } else {
        const trialExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        newGoogleUser.trialAlreadyUsed = false;
        newGoogleUser.plan = 'trial';
        newGoogleUser.trialExpiresAt = trialExpiresAt;
        newGoogleUser.subscription = {
          planId: 'trial',
          billingCycle: 'none',
          status: 'active',
          expiresAt: trialExpiresAt,
          startDate: new Date(),
        };
      }

      user = await User.create(newGoogleUser);

      // Send wholesome welcome email for brand new Google signups
      sendWelcomeEmail(user.email, user.name);
    }

    if (user.twoFactorEnabled) {
      const tempToken = jwt.sign(
        { id: user._id, purpose: '2fa_pending' },
        process.env.JWT_SECRET || 'cloudguard_fallback_secret',
        { expiresIn: '5m' }
      );
      return res.status(200).json({
        requires2FA: true,
        tempToken,
        email: user.email,
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        _id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin || false,
        tokenVersion: user.tokenVersion || 0,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(200).json({ token, user: formatUserResponse(user) });
  } catch (err) {
    console.error('Google Auth Error:', err);
    return res.status(500).json({ error: 'Google sign-in failed' });
  }
});

// ==========================================
// 2. EMAIL SIGNUP -> SENDS ACTIVATION OTP
// ==========================================
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, consentGiven, isAdultConfirmed } = req.body || {};
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }

    const nameVal = validateDisplayName(name);
    if (!nameVal.valid) {
      return res.status(400).json({ error: nameVal.error, message: nameVal.error });
    }
    const trimmedName = nameVal.sanitized;

    const emailVal = validateEmailInput(email);
    if (!emailVal.valid) {
      return res.status(400).json({ error: emailVal.error, message: emailVal.error });
    }
    const normalizedEmail = emailVal.sanitized;

    const pwdVal = validatePasswordInput(password);
    if (!pwdVal.valid) {
      return res.status(400).json({ error: pwdVal.error, message: pwdVal.error });
    }
    if (normalizedEmail.length > 254) return res.status(400).json({ error: 'Email cannot exceed 254 characters' });

    // Verify email domain via disposable blocklist and MX lookup
    const domainVal = await validateEmailDomain(normalizedEmail);
    if (!domainVal.valid) {
      return res.status(400).json({
        error: domainVal.error,
        message: domainVal.error,
      });
    }

    // Statutory DPDP Act 2023 Consent & Age-Gating Verification
    if (!consentGiven || !isAdultConfirmed) {
      return res.status(400).json({
        error: 'Under the DPDP Act 2023, you must confirm you are 18+ and explicitly accept the privacy notice.',
      });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    let existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      if (existingUser.isVerified) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
      }
      // If user exists but wasn't verified, regenerate OTP, refresh 1-hour TTL, and update password
      const salt = await bcrypt.genSalt(10);
      existingUser.password = await bcrypt.hash(password, salt);
      existingUser.name = trimmedName;
      existingUser.otp = generateOtp();
      existingUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
      existingUser.otpAttempts = 0;
      existingUser.unverifiedExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour TTL
      existingUser.consentGiven = true;
      existingUser.isAdultConfirmed = true;
      existingUser.consentTimestamp = new Date();
      existingUser.consentVersion = '1.0';
      await existingUser.save();

      sendActivationOtp(existingUser.email, existingUser.otp, existingUser.name);

      return res.status(200).json({
        message: 'Verification code resent. Please verify your email.',
        requireOtp: true,
        email: existingUser.email,
      });
    }

    // New unverified user registration
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const otp = generateOtp();

    const priorDeletedLog = await DeletedAccountLog.findOne({
      emailHash: hashNormalizedEmail(normalizedEmail),
    }).lean();

    const newUserPayload = {
      name: trimmedName,
      email: normalizedEmail,
      password: hashedPassword,
      authProvider: 'local',
      isVerified: false,
      unverifiedExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour TTL
      otp,
      otpExpires: new Date(Date.now() + 10 * 60 * 1000),
      otpAttempts: 0,
      storageUsed: 0,
      storageLimit: 5 * 1024 * 1024 * 1024,
      consentGiven: true,
      isAdultConfirmed: true,
      consentTimestamp: new Date(),
      consentVersion: '1.0',
    };

    if (priorDeletedLog) {
      newUserPayload.trialAlreadyUsed = true;
      newUserPayload.plan = 'free';
      newUserPayload.trialExpiresAt = null;
      newUserPayload.subscription = {
        planId: 'free',
        billingCycle: 'none',
        status: 'expired',
        expiresAt: null,
        refundCount: priorDeletedLog.refundCount || 0,
      };
    } else {
      const trialExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      newUserPayload.trialAlreadyUsed = false;
      newUserPayload.plan = 'trial';
      newUserPayload.trialExpiresAt = trialExpiresAt;
      newUserPayload.subscription = {
        planId: 'trial',
        billingCycle: 'none',
        status: 'active',
        expiresAt: trialExpiresAt,
        startDate: new Date(),
      };
    }

    const newUser = await User.create(newUserPayload);

    // Send Activation OTP email
    sendActivationOtp(newUser.email, otp, newUser.name);

    return res.status(201).json({
      message: 'Verification code sent to your email.',
      requireOtp: true,
      email: newUser.email,
    });
  } catch (err) {
    console.error('Register Error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ==========================================
// 3. VERIFY ACTIVATION OTP -> WELCOME EMAIL
// ==========================================
router.post('/verify-activation-otp', otpLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (typeof email !== 'string' || typeof otp !== 'string') {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }
    const codeVal = validateCodeInput(otp);
    if (!codeVal.valid) {
      return res.status(400).json({ error: codeVal.error, message: codeVal.error });
    }
    const cleanOtp = codeVal.sanitized;
    if (cleanOtp.length > 8) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account is already verified. Please log in.' });

    const isMatch = Boolean(user.otp && user.otp === otp.trim() && user.otpExpires && new Date() <= user.otpExpires);

    if (!isMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= 5) {
        user.otp = undefined;
        user.otpExpires = undefined;
        user.otpAttempts = 0;
        await user.save();
        return res.status(429).json({
          error: 'Too many invalid OTP attempts. Please request a new code.',
          message: 'Too many invalid OTP attempts. Please request a new code.',
        });
      }
      await user.save();
      return res.status(400).json({ error: 'Invalid or expired verification code', message: 'Invalid or expired verification code' });
    }

    // Activate account
    user.isVerified = true;
    user.unverifiedExpiresAt = undefined;
    user.otp = null;
    user.otpExpires = null;
    user.otpAttempts = 0;

    const priorDeletedLog = await DeletedAccountLog.findOne({
      emailHash: hashNormalizedEmail(normalizedEmail),
    }).lean();

    if (priorDeletedLog) {
      user.trialAlreadyUsed = true;
      user.plan = 'free';
      user.trialExpiresAt = null;
      user.storageLimit = 5 * 1024 * 1024 * 1024;
      user.subscription = {
        planId: 'free',
        billingCycle: 'none',
        status: 'expired',
        expiresAt: null,
        refundCount: priorDeletedLog.refundCount || 0,
      };
    } else if (!user.trialExpiresAt && user.plan !== 'free') {
      const trialExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      user.trialAlreadyUsed = false;
      user.plan = 'trial';
      user.trialExpiresAt = trialExpiresAt;
      user.subscription = {
        ...(user.subscription || {}),
        planId: 'trial',
        billingCycle: 'none',
        status: 'active',
        expiresAt: trialExpiresAt,
        startDate: new Date(),
      };
    }

    await user.save();

    // Send Wholesome Welcome Email upon successful activation
    sendWelcomeEmail(user.email, user.name);

    const token = jwt.sign(
      {
        id: user._id,
        _id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin || false,
        tokenVersion: user.tokenVersion || 0,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(200).json({
      token,
      user: formatUserResponse(user),
    });
  } catch (err) {
    console.error('Verify Activation Error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// Alias: /verify-otp (supports both reset code validation and activation verification)
router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { email, otp, type } = req.body || {};
    if (typeof email !== 'string' || typeof otp !== 'string' || (type !== undefined && typeof type !== 'string')) {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }
    const codeVal = validateCodeInput(otp);
    if (!codeVal.valid) {
      return res.status(400).json({ error: codeVal.error, message: codeVal.error });
    }
    const cleanOtp = codeVal.sanitized;
    if (cleanOtp.length > 8) return res.status(400).json({ error: 'Invalid verification code' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ error: 'Account not found' });

    if (type === 'reset') {
      const isOtpMatch =
        (user.otp && user.otp === otp.trim() && user.otpExpires && new Date() <= user.otpExpires) ||
        (user.resetPasswordToken && user.resetPasswordToken === otp.trim() && user.resetPasswordExpire && new Date() <= user.resetPasswordExpire);
      if (!isOtpMatch) {
        user.otpAttempts = (user.otpAttempts || 0) + 1;
        if (user.otpAttempts >= 5) {
          user.otp = undefined;
          user.otpExpires = undefined;
          user.resetPasswordToken = undefined;
          user.resetPasswordExpire = undefined;
          user.otpAttempts = 0;
          await user.save();
          return res.status(429).json({
            error: 'Too many invalid OTP attempts. Please request a new code.',
            message: 'Too many invalid OTP attempts. Please request a new code.',
          });
        }
        await user.save();
        return res.status(400).json({ error: 'Invalid or expired reset code', message: 'Invalid or expired reset code' });
      }
      return res.status(200).json({ success: true, message: 'Reset code valid' });
    }

    // Default: Activation OTP
    if (user.isVerified) return res.status(400).json({ error: 'Account is already verified. Please log in.' });

    const isActivationMatch = Boolean(user.otp && user.otp === otp.trim() && user.otpExpires && new Date() <= user.otpExpires);
    if (!isActivationMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= 5) {
        user.otp = undefined;
        user.otpExpires = undefined;
        user.otpAttempts = 0;
        await user.save();
        return res.status(429).json({
          error: 'Too many invalid OTP attempts. Please request a new code.',
          message: 'Too many invalid OTP attempts. Please request a new code.',
        });
      }
      await user.save();
      return res.status(400).json({ error: 'Invalid or expired verification code', message: 'Invalid or expired verification code' });
    }

    user.isVerified = true;
    user.unverifiedExpiresAt = undefined;
    user.otp = null;
    user.otpExpires = null;
    user.otpAttempts = 0;

    const priorDeletedLog = await DeletedAccountLog.findOne({
      emailHash: hashNormalizedEmail(normalizedEmail),
    }).lean();

    if (priorDeletedLog) {
      user.trialAlreadyUsed = true;
      user.plan = 'free';
      user.trialExpiresAt = null;
      user.storageLimit = 5 * 1024 * 1024 * 1024;
      user.subscription = {
        planId: 'free',
        billingCycle: 'none',
        status: 'expired',
        expiresAt: null,
        refundCount: priorDeletedLog.refundCount || 0,
      };
    } else if (!user.trialExpiresAt && user.plan !== 'free') {
      const trialExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      user.trialAlreadyUsed = false;
      user.plan = 'trial';
      user.trialExpiresAt = trialExpiresAt;
      user.subscription = {
        ...(user.subscription || {}),
        planId: 'trial',
        billingCycle: 'none',
        status: 'active',
        expiresAt: trialExpiresAt,
        startDate: new Date(),
      };
    }

    await user.save();

    sendWelcomeEmail(user.email, user.name);

    const token = jwt.sign(
      {
        id: user._id,
        _id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin || false,
        tokenVersion: user.tokenVersion || 0,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(200).json({
      message: 'Email verified successfully!',
      token,
      user: formatUserResponse(user),
    });
  } catch (err) {
    console.error('Verify OTP Error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// Resend OTP endpoint
router.post('/resend-otp', otpLimiter, async (req, res) => {
  try {
    const { email, type } = req.body || {};
    if (typeof email !== 'string' || (type !== undefined && typeof type !== 'string')) {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' });

    // Verify email domain via disposable blocklist and MX lookup
    const domainVal = await validateEmailDomain(normalizedEmail);
    if (!domainVal.valid) {
      return res.status(400).json({
        error: domainVal.error,
        message: domainVal.error,
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.otpAttempts = 0;
    if (type === 'reset') {
      user.resetPasswordToken = otp;
      user.resetPasswordExpire = user.otpExpires;
    } else if (!user.isVerified) {
      user.unverifiedExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour TTL
    }
    await user.save();

    if (type === 'reset') {
      sendResetOtp(user.email, otp, user.name);
    } else {
      sendActivationOtp(user.email, otp, user.name);
    }

    return res.status(200).json({ message: 'A new code has been sent.' });
  } catch (err) {
    console.error('Resend OTP Error:', err);
    return res.status(500).json({ error: 'Failed to resend code' });
  }
});

// ==========================================
// 4. MANUAL LOGIN CHECK VERIFICATION
// ==========================================
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }

    const emailVal = validateEmailInput(email);
    if (!emailVal.valid) {
      return res.status(400).json({ error: emailVal.error, message: emailVal.error });
    }
    const normalizedEmail = emailVal.sanitized;

    const pwdVal = validatePasswordInput(password);
    if (!pwdVal.valid) {
      return res.status(400).json({ error: pwdVal.error, message: pwdVal.error });
    }
    if (normalizedEmail.length > 254) {
      return res.status(400).json({ error: 'Email cannot exceed 254 characters' });
    }

    // Explicitly include +password in query
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      console.warn(`[Auth Warning] Login failed: User not found for ${normalizedEmail}`);
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Handle Google account without password set
    if (!user.password && user.googleId) {
      return res.status(400).json({
        error: 'This account was created with Google Sign-In. Please sign in with Google or use "Forgot Password" to set a password.',
        isGoogleAccount: true,
      });
    }

    if (!user.password) {
      return res.status(400).json({ error: 'No password configured for this account' });
    }

    // Check account password lockout (15 minutes after 7 consecutive failed attempts)
    if (user.lockUntil && user.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.lockUntil.getTime() - Date.now()) / (60 * 1000));
      return res.status(429).json({
        error: `Too many failed password attempts. Please try again in ${remainingMinutes || 15} minute${remainingMinutes === 1 ? '' : 's'} or reset your password.`,
        message: `Too many failed password attempts. Please try again in ${remainingMinutes || 15} minute${remainingMinutes === 1 ? '' : 's'} or reset your password.`,
        locked: true,
      });
    }

    if (!user.isVerified) {
      // Regenerate activation code if logging in before verifying
      const otp = generateOtp();
      user.otp = otp;
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      user.otpAttempts = 0;
      user.unverifiedExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour TTL
      await user.save();

      sendActivationOtp(user.email, otp, user.name);

      return res.status(403).json({
        error: 'Please verify your email before logging in. A new OTP has been sent.',
        requireOtp: true,
        email: user.email,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn(`[Auth Warning] Password mismatch for user: ${normalizedEmail}`);
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 7) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();
        return res.status(429).json({
          error: 'Too many failed password attempts. Please try again in 15 minutes or reset your password.',
          message: 'Too many failed password attempts. Please try again in 15 minutes or reset your password.',
          locked: true,
        });
      }
      await user.save();
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Reset failed login attempts on successful password verification
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();
    }

    if (user.twoFactorEnabled) {
      const tempToken = jwt.sign(
        { id: user._id, purpose: '2fa_pending' },
        process.env.JWT_SECRET || 'cloudguard_fallback_secret',
        { expiresIn: '5m' }
      );
      return res.status(200).json({
        requires2FA: true,
        tempToken,
        email: user.email,
      });
    }

    // Generate JWT Session Token
    const token = jwt.sign(
      {
        id: user._id,
        _id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin || false,
        tokenVersion: user.tokenVersion || 0,
      },
      process.env.JWT_SECRET || 'cloudguard_fallback_secret',
      { expiresIn: '7d' }
    );

    console.log(`[Auth Success] User logged in successfully: ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      token,
      user: formatUserResponse(user),
    });
  } catch (err) {
    console.error('[Auth Error] Server error during login:', err);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

// ==========================================
// 4b. LOGOUT -> REVOKES ALL SESSIONS
// ==========================================
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id || req.user?.userId;
    if (rawUserId) {
      await User.updateOne({ _id: rawUserId }, { $inc: { tokenVersion: 1 } });
    }
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout Error:', err);
    return res.status(500).json({ error: 'Failed to logout' });
  }
});

// ==========================================
// 5. FORGOT PASSWORD -> SENDS RESET OTP
// ==========================================
router.post('/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (typeof email !== 'string') {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' });
    if (normalizedEmail.length > 120) return res.status(400).json({ error: 'Email cannot exceed 120 characters' });

    const user = await User.findOne({ email: normalizedEmail });

    // Always respond with success to prevent email enumeration
    if (!user) {
      return res.status(200).json({ message: 'If that email exists, an OTP was dispatched.' });
    }

    const otp = generateOtp();
    user.otp = otp;
    user.resetPasswordToken = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.resetPasswordExpire = user.otpExpires;
    user.otpAttempts = 0;
    await user.save();

    sendResetOtp(user.email, otp, user.name);

    return res.status(200).json({ message: 'Password reset code sent to your email.' });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    return res.status(500).json({ error: 'Failed to process password reset' });
  }
});

// ==========================================
// 6. RESET PASSWORD WITH OTP (POST /reset-password)
// ==========================================
router.post('/reset-password', otpLimiter, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    if (typeof email !== 'string' || typeof otp !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }
    const emailVal = validateEmailInput(email);
    if (!emailVal.valid) {
      return res.status(400).json({ error: emailVal.error, message: emailVal.error });
    }
    const normalizedEmail = emailVal.sanitized;

    const codeVal = validateCodeInput(otp);
    if (!codeVal.valid) {
      return res.status(400).json({ error: codeVal.error, message: codeVal.error });
    }
    const cleanOtp = codeVal.sanitized;

    const pwdVal = validatePasswordInput(newPassword);
    if (!pwdVal.valid) {
      return res.status(400).json({ error: pwdVal.error, message: pwdVal.error });
    }
    if (cleanOtp.length > 8) {
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset code', message: 'Invalid or expired reset code' });
    }

    const isOtpValid = (
      (user.otp && user.otp === otp.trim() && user.otpExpires && new Date() <= user.otpExpires) ||
      (user.resetPasswordToken && user.resetPasswordToken === otp.trim() && user.resetPasswordExpire && new Date() <= user.resetPasswordExpire)
    );

    if (!isOtpValid) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= 5) {
        user.otp = undefined;
        user.otpExpires = undefined;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        user.otpAttempts = 0;
        await user.save();
        return res.status(429).json({
          error: 'Too many invalid OTP attempts. Please request a new code.',
          message: 'Too many invalid OTP attempts. Please request a new code.',
        });
      }
      await user.save();
      return res.status(400).json({ error: 'Invalid or expired reset code', message: 'Invalid or expired reset code' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.authProvider = user.googleId ? 'hybrid' : 'local';
    user.otp = null;
    user.otpExpires = null;
    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;
    user.otpAttempts = 0;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.isVerified = true; // Setting password verifies account
    user.unverifiedExpiresAt = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    return res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// PUT /reset-password/:token (for component compatibility)
router.put('/reset-password/:token', otpLimiter, async (req, res) => {
  try {
    const token = req.params.token;
    const { password, email } = req.body || {};
    if (typeof password !== 'string' || (email !== undefined && typeof email !== 'string')) {
      return res.status(400).json({ error: 'Invalid input format', message: 'Invalid input format' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Please provide a new password' });
    }
    const pwdVal = validatePasswordInput(password);
    if (!pwdVal.valid) {
      return res.status(400).json({ error: pwdVal.error, message: pwdVal.error });
    }
    if (email && email.trim().length > 254) {
      return res.status(400).json({ error: 'Email cannot exceed 254 characters' });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const query = {
      $or: [
        { otp: token, otpExpires: { $gt: new Date() } },
        { resetPasswordToken: token, resetPasswordExpire: { $gt: new Date() } },
      ],
    };
    if (email) {
      query.email = email.toLowerCase().trim();
    }

    const user = await User.findOne(query);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.authProvider = user.googleId ? 'hybrid' : 'local';
    user.otp = null;
    user.otpExpires = null;
    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;
    user.otpAttempts = 0;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.isVerified = true;
    user.unverifiedExpiresAt = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    return res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset Password PUT Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. PROFILE SETTINGS PASSWORD UPDATE (PUT /password)
// ==========================================
router.put('/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }
    const newPwdVal = validatePasswordInput(newPassword);
    if (!newPwdVal.valid) {
      return res.status(400).json({ error: newPwdVal.error, message: newPwdVal.error });
    }
    if (currentPassword) {
      const curPwdVal = validatePasswordInput(currentPassword);
      if (!curPwdVal.valid) {
        return res.status(400).json({ error: curPwdVal.error, message: curPwdVal.error });
      }
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If user already has an existing password, verify currentPassword
    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const validPass = await bcrypt.compare(currentPassword, user.password);
      if (!validPass) {
        return res.status(400).json({ error: 'Invalid current password' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    user.authProvider = user.googleId ? 'hybrid' : 'local';
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    return res.status(200).json({ message: 'Password updated successfully', hasPassword: true });
  } catch (err) {
    console.error('Password update error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update password' });
  }
});

// Alias: POST /change-password
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }
    const newPwdVal = validatePasswordInput(newPassword);
    if (!newPwdVal.valid) {
      return res.status(400).json({ error: newPwdVal.error, message: newPwdVal.error });
    }
    if (currentPassword) {
      const curPwdVal = validatePasswordInput(currentPassword);
      if (!curPwdVal.valid) {
        return res.status(400).json({ error: curPwdVal.error, message: curPwdVal.error });
      }
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const validPass = await bcrypt.compare(currentPassword, user.password);
      if (!validPass) {
        return res.status(400).json({ error: 'Invalid current password' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    user.authProvider = user.googleId ? 'hybrid' : 'local';
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    return res.status(200).json({ message: 'Password updated successfully', hasPassword: true });
  } catch (err) {
    console.error('Password update error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update password' });
  }
});

// ==========================================
// 8. ACCOUNT DELETION & RIGHT TO ERASURE (DPDP Act 2023 Section 12)
// ==========================================
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const { password, confirmText } = req.body || {};

    if (confirmText !== 'DELETE') {
      return res.status(400).json({ error: 'Please type DELETE in capital letters to confirm.' });
    }

    const user = await User.findById(rawUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify password ONLY if account has a password set (non-OAuth)
    if (user.password && user.authProvider !== 'google') {
      if (!password) {
        return res.status(400).json({ error: 'Please enter your account password to confirm deletion.' });
      }
      const pwdVal = validatePasswordInput(password);
      if (!pwdVal.valid) {
        return res.status(400).json({ error: pwdVal.error, message: pwdVal.error });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Incorrect password. Deletion cancelled.' });
      }
    }

    const userIdStr = String(rawUserId);
    const prefixes = [
      `uploads/${userIdStr}/`,
      `thumbnails/${userIdStr}/`,
      `${userIdStr}/`,
    ];

    // Purge AWS S3 objects in batches of 1,000
    for (const prefix of prefixes) {
      let token = null;
      do {
        const listRes = await s3Client.send(new ListObjectsV2Command({
          Bucket: process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME,
          Prefix: prefix,
          ContinuationToken: token,
        }));

        const items = listRes.Contents || [];
        if (items.length > 0) {
          const keys = items.map((i) => i.Key).filter(Boolean);
          const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;
          await permanentlyDeleteS3Keys(s3Client, bucket, keys).catch((e) => console.warn(`[Auth S3 Purge Warning] ${e.message}`));
        }
        token = listRes.NextContinuationToken;
      } while (token);
    }

    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: rawUserId },
        { user: rawUserId },
        { userId: userIdStr },
        { user: userIdStr },
      ],
    };

    // Purge database records
    await File.deleteMany(userMatch);
    await Folder.deleteMany(userMatch);

    const emailHash = hashNormalizedEmail(user.email);
    const refundedPaymentsCount = await Payment.countDocuments({
      $or: [
        { userId: user._id },
        { userEmail: user.email.toLowerCase().trim() },
        { 'customerDetails.email': user.email.toLowerCase().trim() },
      ],
      status: 'REFUNDED',
    });
    const priorRefundCount = Math.max(user.subscription?.refundCount || 0, refundedPaymentsCount);

    await DeletedAccountLog.findOneAndUpdate(
      { emailHash },
      {
        $set: { hadTrial: true, deletedAt: new Date() },
        $max: {
          refundCount: priorRefundCount,
        },
      },
      { upsert: true, new: true }
    );

    const userEmail = user.email;
    const userName = user.name || 'User';

    await User.findByIdAndDelete(rawUserId);

    sendAccountDeletedEmail(userEmail, userName).catch((err) =>
      console.error('[Account Deleted Email Error]', err.message)
    );

    return res.status(200).json({
      success: true,
      message: 'Account and all associated personal data permanently erased.',
    });
  } catch (err) {
    console.error('Account erasure error:', err);
    return res.status(500).json({ error: 'Failed to erase account and data' });
  }
});

// ==========================================
// 9. TWO-FACTOR AUTHENTICATION (TOTP) & ME
// ==========================================

// GET /api/auth/me - Return authenticated user profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id;
    const user = await User.findById(rawUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user: formatUserResponse(user) });
  } catch (err) {
    console.error('Fetch me error:', err);
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// POST /api/auth/2fa/setup - Generate TOTP secret and QR code Data URL
router.post('/2fa/setup', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id;
    const user = await User.findById(rawUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const secret = authenticator.generateSecret();
    const serviceName = 'CloudGuard';
    const otpauth = authenticator.keyuri(user.email, serviceName, secret);
    const qrCodeUrl = await qrcode.toDataURL(otpauth);

    return res.status(200).json({
      success: true,
      qrCodeUrl,
      manualKey: secret,
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    return res.status(500).json({ error: 'Failed to initiate 2FA setup' });
  }
});

// POST /api/auth/2fa/verify-setup - Verify initial 6-digit code, activate 2FA, generate 8 backup codes
router.post('/2fa/verify-setup', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id;
    const { secret, code } = req.body || {};

    if (!secret || typeof secret !== 'string' || !code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Secret and verification code are required' });
    }

    const cleanCode = code.trim().replace(/\s+/g, '');
    const codeVal = validateCodeInput(cleanCode);
    if (!codeVal.valid) {
      return res.status(400).json({ error: codeVal.error, message: codeVal.error });
    }
    const isValid = authenticator.check(cleanCode, secret.trim());
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code. Please check your authenticator app.' });
    }

    const user = await User.findById(rawUserId).select('+twoFactorSecret +twoFactorBackupCodes');
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Generate 8 single-use recovery backup codes formatted as XXXX-XXXX
    const rawBackupCodes = [];
    for (let i = 0; i < 8; i++) {
      const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
      rawBackupCodes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
    }

    const hashedCodes = await Promise.all(
      rawBackupCodes.map((c) => bcrypt.hash(c, 10))
    );

    user.twoFactorEnabled = true;
    user.twoFactorSecret = encrypt2faSecret(secret.trim());
    user.twoFactorBackupCodes = hashedCodes;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Two-factor authentication successfully enabled.',
      backupCodes: rawBackupCodes,
      user: formatUserResponse(user),
    });
  } catch (err) {
    console.error('2FA verify-setup error:', err);
    return res.status(500).json({ error: 'Failed to complete 2FA setup' });
  }
});

// POST /api/auth/2fa/verify-login - Verify 6-digit TOTP code or single-use recovery code during login
router.post('/2fa/verify-login', otpLimiter, async (req, res) => {
  try {
    const { tempToken, code } = req.body || {};

    if (!tempToken || typeof tempToken !== 'string' || !code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Verification token and code are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET || 'cloudguard_fallback_secret');
    } catch (e) {
      return res.status(401).json({ error: 'Login session expired. Please sign in again.' });
    }

    if (decoded.purpose !== '2fa_pending' || !decoded.id) {
      return res.status(401).json({ error: 'Invalid verification token.' });
    }

    const user = await User.findById(decoded.id).select('+twoFactorSecret +twoFactorBackupCodes');
    if (!user || !user.twoFactorEnabled) {
      return res.status(400).json({ error: 'Two-factor authentication is not active for this account.' });
    }

    const cleanCode = code.trim().replace(/\s+/g, '');
    const codeVal = validateCodeInput(cleanCode);
    if (!codeVal.valid) {
      return res.status(400).json({ error: codeVal.error, message: codeVal.error });
    }
    const decryptedSecret = decrypt2faSecret(user.twoFactorSecret);

    let isTotpValid = false;
    if (decryptedSecret && cleanCode.length === 6 && /^\d+$/.test(cleanCode)) {
      isTotpValid = authenticator.check(cleanCode, decryptedSecret);
    }

    let usedBackupCodeIndex = -1;
    if (!isTotpValid && user.twoFactorBackupCodes && user.twoFactorBackupCodes.length > 0) {
      const normalizedCode = cleanCode.toUpperCase();
      const formattedCode = normalizedCode.includes('-')
        ? normalizedCode
        : `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`;

      for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
        const hashed = user.twoFactorBackupCodes[i];
        const match = (await bcrypt.compare(normalizedCode, hashed)) || (await bcrypt.compare(formattedCode, hashed));
        if (match) {
          usedBackupCodeIndex = i;
          break;
        }
      }
    }

    if (!isTotpValid && usedBackupCodeIndex === -1) {
      return res.status(400).json({ error: 'Invalid authentication or recovery code.' });
    }

    // Single-use enforcement: if a recovery backup code was used, remove it
    if (usedBackupCodeIndex !== -1) {
      user.twoFactorBackupCodes.splice(usedBackupCodeIndex, 1);
      await user.save();
    }

    // Generate full 7-day session token
    const token = jwt.sign(
      {
        id: user._id,
        _id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin || false,
        tokenVersion: user.tokenVersion || 0,
      },
      process.env.JWT_SECRET || 'cloudguard_fallback_secret',
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      token,
      user: formatUserResponse(user),
    });
  } catch (err) {
    console.error('2FA verify-login error:', err);
    return res.status(500).json({ error: 'Failed to verify 2FA code' });
  }
});

// POST /api/auth/2fa/disable - Disable 2FA with password or authenticator/recovery code confirmation
router.post('/2fa/disable', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id;
    const { password, code } = req.body || {};

    const user = await User.findById(rawUserId).select('+password +twoFactorSecret +twoFactorBackupCodes');
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: 'Two-factor authentication is not currently enabled.' });
    }

    if (user.password) {
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Please enter your password to disable 2FA.' });
      }
      const pwdVal = validatePasswordInput(password);
      if (!pwdVal.valid) {
        return res.status(400).json({ error: pwdVal.error, message: pwdVal.error });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Incorrect password.' });
      }
    } else {
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Please enter your authenticator or backup code to disable 2FA.' });
      }
      const cleanCode = code.trim().replace(/\s+/g, '');
      const codeVal = validateCodeInput(cleanCode);
      if (!codeVal.valid) {
        return res.status(400).json({ error: codeVal.error, message: codeVal.error });
      }
      const decryptedSecret = decrypt2faSecret(user.twoFactorSecret);
      let isValid = false;

      if (decryptedSecret && cleanCode.length === 6 && /^\d+$/.test(cleanCode)) {
        isValid = authenticator.check(cleanCode, decryptedSecret);
      }

      if (!isValid && user.twoFactorBackupCodes?.length) {
        const normalizedCode = cleanCode.toUpperCase();
        const formattedCode = normalizedCode.includes('-')
          ? normalizedCode
          : `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`;

        for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
          const match = (await bcrypt.compare(normalizedCode, user.twoFactorBackupCodes[i])) ||
                        (await bcrypt.compare(formattedCode, user.twoFactorBackupCodes[i]));
          if (match) {
            isValid = true;
            break;
          }
        }
      }

      if (!isValid) {
        return res.status(400).json({ error: 'Invalid authentication or recovery code.' });
      }
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.twoFactorBackupCodes = [];
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Two-factor authentication has been disabled.',
      user: formatUserResponse(user),
    });
  } catch (err) {
    console.error('2FA disable error:', err);
    return res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// ==========================================
// 10. PROFILE UPDATE (PUT /profile & PUT /name)
// ==========================================
const handleProfileUpdate = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const { name } = req.body || {};
    const validation = validateDisplayName(name);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error, message: validation.error });
    }
    const user = await User.findById(rawUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.name = validation.sanitized;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Display name updated successfully',
      user: formatUserResponse(user),
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
};

router.put('/profile', authMiddleware, handleProfileUpdate);
router.put('/name', authMiddleware, handleProfileUpdate);

// ==========================================
// 11. CONTACT & SUPPORT ENDPOINTS
// ==========================================
const handleContactInAuth = (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    const cleanName = sanitizePlainText(name, 60);
    const cleanSubject = sanitizePlainText(subject, 120);
    const cleanMessage = sanitizePlainText(message, 2000);

    if (!cleanName || !cleanSubject || !cleanMessage) {
      return res.status(400).json({
        error: 'Name, subject, and message are required and cannot be empty or script-only.',
        message: 'Name, subject, and message are required and cannot be empty or script-only.',
      });
    }

    if (typeof email !== 'string' || email.trim().length === 0 || email.length > 254) {
      return res.status(400).json({
        error: 'A valid email address is required (maximum 254 characters).',
        message: 'A valid email address is required (maximum 254 characters).',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        error: 'Invalid email address format.',
        message: 'Invalid email address format.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Thank you for contacting CloudGuard support. Your message has been received.',
    });
  } catch (err) {
    console.error('Contact endpoint error:', err);
    return res.status(500).json({ error: 'Failed to process message' });
  }
};

router.post('/contact', handleContactInAuth);
router.post('/support', handleContactInAuth);

module.exports = router;
