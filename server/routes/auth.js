const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const File = require('../models/File');
const Folder = require('../models/Folder');
const authMiddleware = require('../middleware/auth');
const { sendActivationOtp, sendResetOtp, sendWelcomeEmail, sendNotificationEmail } = require('../utils/emailService');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { permanentlyDeleteS3Keys } = require('../utils/s3Delete');

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

// User verification middleware for authenticated routes (e.g. PUT /password)
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = verified;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

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
});

// ==========================================
// 1. GOOGLE SOCIAL AUTH (Auto-verified)
// ==========================================
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
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
        modified = true;
      }
      if (modified) await user.save();
    } else {
      user = await User.create({
        name: name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        googleId,
        avatar: picture || null,
        authProvider: 'google',
        isVerified: true,
        password: null,
        storageUsed: 0,
        storageLimit: 5368709120,
      });

      // Send wholesome welcome email for brand new Google signups
      sendWelcomeEmail(user.email, user.name);
    }

    const token = jwt.sign(
      { id: user._id, _id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin || false },
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
    const { name, email, password, consentGiven, isAdultConfirmed } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });

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

    const normalizedEmail = email.toLowerCase().trim();
    let existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      if (existingUser.isVerified) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
      }
      // If user exists but wasn't verified, regenerate OTP and update password
      const salt = await bcrypt.genSalt(10);
      existingUser.password = await bcrypt.hash(password, salt);
      existingUser.name = name.trim();
      existingUser.otp = generateOtp();
      existingUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
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

    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      authProvider: 'local',
      isVerified: false,
      otp,
      otpExpires: new Date(Date.now() + 10 * 60 * 1000),
      storageUsed: 0,
      storageLimit: 5368709120,
      consentGiven: true,
      isAdultConfirmed: true,
      consentTimestamp: new Date(),
      consentVersion: '1.0',
    });

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
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account is already verified. Please log in.' });

    if (!user.otp || user.otp !== otp.trim() || new Date() > user.otpExpires) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Activate account
    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    // Send Wholesome Welcome Email upon successful activation
    sendWelcomeEmail(user.email, user.name);

    const token = jwt.sign(
      { id: user._id, _id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin || false },
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
    const { email, otp, type } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ error: 'Account not found' });

    if (type === 'reset') {
      const isOtpMatch =
        (user.otp && user.otp === otp.trim() && new Date() <= user.otpExpires) ||
        (user.resetPasswordToken && user.resetPasswordToken === otp.trim() && new Date() <= user.resetPasswordExpire);
      if (!isOtpMatch) {
        return res.status(400).json({ error: 'Invalid or expired reset code' });
      }
      return res.status(200).json({ success: true, message: 'Reset code valid' });
    }

    // Default: Activation OTP
    if (user.isVerified) return res.status(400).json({ error: 'Account is already verified. Please log in.' });

    if (!user.otp || user.otp !== otp.trim() || new Date() > user.otpExpires) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    sendWelcomeEmail(user.email, user.name);

    const token = jwt.sign(
      { id: user._id, _id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin || false },
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
    const { email, type } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    if (type === 'reset') {
      user.resetPasswordToken = otp;
      user.resetPasswordExpire = user.otpExpires;
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter both email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();
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

    if (!user.isVerified) {
      // Regenerate activation code if logging in before verifying
      const otp = generateOtp();
      user.otp = otp;
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
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
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Generate JWT Session Token
    const token = jwt.sign(
      { id: user._id, _id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin || false },
      process.env.JWT_SECRET || 'cloudguard_fallback_secret',
      { expiresIn: '7d' }
    );

    console.log(`[Auth Success] User logged in successfully: ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        authProvider: user.authProvider,
        hasPassword: !!user.password,
        isVerified: user.isVerified,
        storageUsed: user.storageUsed,
        storageLimit: user.storageLimit,
      },
    });
  } catch (err) {
    console.error('[Auth Error] Server error during login:', err);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

// ==========================================
// 5. FORGOT PASSWORD -> SENDS RESET OTP
// ==========================================
router.post('/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.toLowerCase().trim();
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
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    const isOtpValid = user && (
      (user.otp && user.otp === otp.trim() && new Date() <= user.otpExpires) ||
      (user.resetPasswordToken && user.resetPasswordToken === otp.trim() && new Date() <= user.resetPasswordExpire)
    );

    if (!isOtpValid) {
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.authProvider = user.googleId ? 'hybrid' : 'local';
    user.otp = null;
    user.otpExpires = null;
    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;
    user.isVerified = true; // Setting password verifies account
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
    const { password, email } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Please provide a new password' });
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
    user.isVerified = true;
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
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
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
    await User.findByIdAndDelete(rawUserId);

    return res.status(200).json({
      success: true,
      message: 'Account and all associated personal data permanently erased.',
    });
  } catch (err) {
    console.error('Account erasure error:', err);
    return res.status(500).json({ error: 'Failed to erase account and data' });
  }
});

module.exports = router;
