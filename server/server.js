require('dotenv').config();

const requiredEnv = ['JWT_SECRET', 'GAS_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_BUCKET_NAME', 'MONGO_URI'];
const missing = requiredEnv.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`FATAL ERROR: Missing critical environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const FormData = require('form-data');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;

// Configure CORS for Vite frontend
app.use(cors({
  origin: ['http://localhost:5173', 'https://cloud-guard-self.vercel.app', 'https://cloudguard-app.duckdns.org'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

// File Metadata Schema
const FileSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  originalName: { type: String },
  s3Key: { type: String, required: true },
  location: { type: String },
  relativePath: { type: String },
  size: { type: Number },
  mimetype: { type: String },
  status: { type: String, default: 'safe' },
  securityStatus: { type: String, default: 'Safe' },
  uploadedAt: { type: Date, default: Date.now }
});
const FileModel = mongoose.model('File', FileSchema);

// Connect to MongoDB
let isDbConnected = false;
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/cloudguard';
mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    console.log('Connected to MongoDB');
    isDbConnected = true;
    
    // DB Cleanup: Clear pending files from earlier crashes
    try {
      const deleted = await FileModel.deleteMany({ securityStatus: 'Pending' });
      console.log(`Cleaned up ${deleted.deletedCount} pending files from DB.`);
    } catch(err) {
      console.error("Cleanup error:", err.message);
    }
  })
  .catch(err => {
    console.error('MongoDB connection warning: Database is offline. Files will still be processed and saved locally.', err.message);
  });

// User Schema
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  storageUsed: { type: Number, default: 0 },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  isVerified: { type: Boolean, default: false },
  otpHash: String,
  otpExpire: Date,
  otpAttempts: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

async function recalculateStorage(userId) {
  if (isDbConnected || mongoose.connection.readyState === 1) {
    try {
      const result = await FileModel.aggregate([
        { $match: { userId: userId, securityStatus: 'Safe' } },
        { $group: { _id: null, totalSize: { $sum: "$size" } } }
      ]);
      const totalSize = result.length > 0 ? result[0].totalSize : 0;
      await User.findByIdAndUpdate(userId, { storageUsed: totalSize });
      return totalSize;
    } catch (err) {
      console.error('Error recalculating storage:', err);
    }
  }
}

const GLOBAL_MAX_BYTES = 107374182400; // 100GB limit calculated to stay within the AWS $100 credit budget for 6 months

// Auth Middleware
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    
    // Check if user still exists in database
    if (isDbConnected || mongoose.connection.readyState === 1) {
      const user = await User.findById(verified._id);
      if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    } else {
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      const userExists = users.some(u => u._id === verified._id);
      if (!userExists) return res.status(401).json({ error: 'Account no longer exists.' });
    }

    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'active', message: 'CloudGuard Backend is running' });
});

// Auth Routes
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const usersFilePath = path.join(dataDir, 'users.json');
if (!fs.existsSync(usersFilePath)) {
  fs.writeFileSync(usersFilePath, JSON.stringify([]));
}

async function getGlobalStorageUsed() {
  if (isDbConnected || mongoose.connection.readyState === 1) {
    const result = await FileModel.aggregate([
      { $match: { securityStatus: 'Safe' } },
      { $group: { _id: null, totalSize: { $sum: "$size" } } }
    ]);
    return result.length > 0 ? result[0].totalSize : 0;
  }
  return 0;
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const globalUsed = await getGlobalStorageUsed();
    if (globalUsed > GLOBAL_MAX_BYTES) {
      return res.status(503).json({ error: "Registration disabled: CloudGuard global server capacity has been reached." });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }
    
    let existingUser = null;
    let users = [];
    let userIndex = -1;
    
    if (isDbConnected || mongoose.connection.readyState === 1) {
      existingUser = await User.findOne({ email });
    } else {
      users = JSON.parse(fs.readFileSync(usersFilePath));
      userIndex = users.findIndex(u => u.email === email);
      if (userIndex !== -1) existingUser = users[userIndex];
    }
    
    if (existingUser && existingUser.isVerified !== false) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpire = new Date(Date.now() + 10 * 60000); // 10 minutes

    if (isDbConnected || mongoose.connection.readyState === 1) {
      if (existingUser) {
        existingUser.name = name;
        existingUser.password = hashedPassword;
        existingUser.otpHash = otpHash;
        existingUser.otpExpire = otpExpire;
        existingUser.otpAttempts = 0;
        await existingUser.save();
      } else {
        const user = new User({ 
          name, 
          email, 
          password: hashedPassword, 
          isVerified: false,
          otpHash,
          otpExpire
        });
        await user.save();
      }
    } else {
      if (existingUser) {
        users[userIndex].name = name;
        users[userIndex].password = hashedPassword;
        users[userIndex].otpHash = otpHash;
        users[userIndex].otpExpire = otpExpire;
        users[userIndex].otpAttempts = 0;
      } else {
        users.push({ 
          _id: Date.now().toString(), 
          name, 
          email, 
          password: hashedPassword,
          isVerified: false,
          otpHash,
          otpExpire,
          otpAttempts: 0
        });
      }
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }

    const scriptUrl = "https://script.google.com/macros/s/AKfycbwUtMYORet8Y6mkUtoNJ1ofJRr0Iq8UrGeYcIOjAVnXiVR2sSRSTdmVJ19cc7q3yS79/exec";
    fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        to: email, 
        otp: otp,
        type: 'otp',
        secret: "cloudguard-secure-secret-2024" 
      })
    }).catch(fetchErr => {
      console.error('Error sending OTP webhook:', fetchErr);
    });
    
    res.json({ message: 'User created. Please verify your email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Missing email or OTP' });

    let user = null;
    let userIndex = -1;
    let users = [];
    
    if (isDbConnected || mongoose.connection.readyState === 1) {
      user = await User.findOne({ email });
    } else {
      users = JSON.parse(fs.readFileSync(usersFilePath));
      userIndex = users.findIndex(u => u.email === email);
      if (userIndex !== -1) user = users[userIndex];
    }

    if (!user) return res.status(400).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'User already verified' });
    
    if (user.otpAttempts >= 3) {
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
    }

    if (!user.otpExpire || new Date(user.otpExpire) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    const isMatch = await bcrypt.compare(otp, user.otpHash);
    if (!isMatch) {
      const attempts = (user.otpAttempts || 0) + 1;
      if (isDbConnected || mongoose.connection.readyState === 1) {
        user.otpAttempts = attempts;
        await user.save();
      } else {
        users[userIndex].otpAttempts = attempts;
        fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
      }
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    if (isDbConnected || mongoose.connection.readyState === 1) {
      user.isVerified = true;
      user.otpHash = undefined;
      user.otpExpire = undefined;
      user.otpAttempts = 0;
      await user.save();
    } else {
      users[userIndex].isVerified = true;
      delete users[userIndex].otpHash;
      delete users[userIndex].otpExpire;
      users[userIndex].otpAttempts = 0;
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    let user = null;
    let userIndex = -1;
    let users = [];
    
    if (isDbConnected || mongoose.connection.readyState === 1) {
      user = await User.findOne({ email });
    } else {
      users = JSON.parse(fs.readFileSync(usersFilePath));
      userIndex = users.findIndex(u => u.email === email);
      if (userIndex !== -1) user = users[userIndex];
    }

    if (!user) return res.status(400).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'User is already verified' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpire = new Date(Date.now() + 10 * 60000); // 10 minutes

    if (isDbConnected || mongoose.connection.readyState === 1) {
      user.otpHash = otpHash;
      user.otpExpire = otpExpire;
      user.otpAttempts = 0;
      await user.save();
    } else {
      users[userIndex].otpHash = otpHash;
      users[userIndex].otpExpire = otpExpire;
      users[userIndex].otpAttempts = 0;
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }

    const scriptUrl = "https://script.google.com/macros/s/AKfycbwUtMYORet8Y6mkUtoNJ1ofJRr0Iq8UrGeYcIOjAVnXiVR2sSRSTdmVJ19cc7q3yS79/exec";
    fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        to: email, 
        otp: otp,
        type: 'otp',
        secret: "cloudguard-secure-secret-2024" 
      })
    }).catch(fetchErr => {
      console.error('Error sending OTP webhook:', fetchErr);
    });

    res.json({ message: 'A new verification code has been sent to your email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    let user = null;
    
    if (isDbConnected || mongoose.connection.readyState === 1) {
      user = await User.findOne({ email });
    } else {
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      user = users.find(u => u.email === email);
    }
    
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    if (user.isVerified === false) {
      return res.status(403).json({ error: 'Please verify your email before logging in.', unverified: true });
    }
    
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ _id: user._id, name: user.name, isAdmin: user.isAdmin || false }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { name: user.name, email: user.email, isAdmin: user.isAdmin || false } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot Password Route
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email, frontendUrl } = req.body;
    let user = null;
    
    if (isDbConnected || mongoose.connection.readyState === 1) {
      user = await User.findOne({ email });
    } else {
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      user = users.find(u => u.email === email);
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create reset token
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes

    if (isDbConnected || mongoose.connection.readyState === 1) {
      user.resetPasswordToken = resetPasswordToken;
      user.resetPasswordExpire = resetPasswordExpire;
      await user.save();
    } else {
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      const userIndex = users.findIndex(u => u.email === email);
      users[userIndex].resetPasswordToken = resetPasswordToken;
      users[userIndex].resetPasswordExpire = resetPasswordExpire;
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }

    const origin = frontendUrl || req.get('origin') || process.env.CLIENT_URL || 'http://localhost:5173';
    const cleanOrigin = origin.replace(/\/$/, '');
    const resetUrl = `${cleanOrigin}/reset-password/${resetToken}`;
    
    const scriptUrl = "https://script.google.com/macros/s/AKfycbwUtMYORet8Y6mkUtoNJ1ofJRr0Iq8UrGeYcIOjAVnXiVR2sSRSTdmVJ19cc7q3yS79/exec";
  
    try {
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          to: email, 
          link: resetUrl,
          secret: "cloudguard-secure-secret-2024" 
        })
      });

      // Google Apps Script returns a redirect, so we don't necessarily need to parse JSON if it succeeds
      if (!response.ok) {
        throw new Error('Failed to reach Google Script');
      }
    } catch (error) {
      console.error('GAS Email Error:', error);
      
      if (isDbConnected || mongoose.connection.readyState === 1) {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save({ validateBeforeSave: false });
      } else {
        const users = JSON.parse(fs.readFileSync(usersFilePath));
        const userIndex = users.findIndex(u => u.email === email);
        if (userIndex !== -1) {
          delete users[userIndex].resetPasswordToken;
          delete users[userIndex].resetPasswordExpire;
          fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
        }
      }
      return res.status(500).json({ error: 'Email could not be sent' });
    }

    res.json({ message: 'Password reset link sent to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'There was an error processing your request. Try again later.' });
  }
});

// Reset Password Route
app.put('/api/auth/reset-password/:token', async (req, res) => {
  try {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    let user = null;
    let userIndex = -1;
    let users = [];

    if (isDbConnected || mongoose.connection.readyState === 1) {
      user = await User.findOne({
        resetPasswordToken,
        resetPasswordExpire: { $gt: Date.now() }
      });
    } else {
      users = JSON.parse(fs.readFileSync(usersFilePath));
      userIndex = users.findIndex(u => u.resetPasswordToken === resetPasswordToken && u.resetPasswordExpire > Date.now());
      if (userIndex !== -1) user = users[userIndex];
    }

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Please provide a new password' });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    if (isDbConnected || mongoose.connection.readyState === 1) {
      user.password = hashedPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();
    } else {
      users[userIndex].password = hashedPassword;
      delete users[userIndex].resetPasswordToken;
      delete users[userIndex].resetPasswordExpire;
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }

    res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' });

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    let userPass = null;
    let userIndex = -1;
    let users = [];

    if (isDbConnected || mongoose.connection.readyState === 1) {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      userPass = user.password;
    } else {
      users = JSON.parse(fs.readFileSync(usersFilePath));
      userIndex = users.findIndex(u => u._id === req.user._id);
      if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
      userPass = users[userIndex].password;
    }

    const validPass = await bcrypt.compare(currentPassword, userPass);
    if (!validPass) return res.status(400).json({ error: 'Invalid current password' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    if (isDbConnected || mongoose.connection.readyState === 1) {
      await User.findByIdAndUpdate(req.user._id, { password: hashedPassword });
    } else {
      users[userIndex].password = hashedPassword;
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/auth/account', verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Delete physical files from S3
    try {
      const listedObjects = await s3.send(new ListObjectsV2Command({ 
          Bucket: process.env.AWS_BUCKET_NAME, 
          Prefix: `${userId}/` 
      }));
      if (listedObjects.Contents && listedObjects.Contents.length > 0) {
          const deleteParams = {
              Bucket: process.env.AWS_BUCKET_NAME,
              Delete: { Objects: listedObjects.Contents.map(obj => ({ Key: obj.Key })) }
          };
          await s3.send(new DeleteObjectsCommand(deleteParams));
      }
    } catch (e) {
      console.error("Failed to delete from S3 during account removal", e.message);
    }

    // 2. Delete user and files from DB / JSON
    if (isDbConnected || mongoose.connection.readyState === 1) {
      await FileModel.deleteMany({ userId: userId });
      await User.findByIdAndDelete(userId);
    } else {
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      const updatedUsers = users.filter(u => u._id !== userId);
      fs.writeFileSync(usersFilePath, JSON.stringify(updatedUsers, null, 2));
    }

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Storage Stats Endpoint
app.get('/api/storage-stats', verifyToken, async (req, res) => {
  try {
    let usedBytes = 0;
    const userId = req.user._id;

    if (isDbConnected || mongoose.connection.readyState === 1) {
      const result = await FileModel.aggregate([
        { $match: { userId: userId, securityStatus: 'Safe' } },
        { $group: { _id: null, totalSize: { $sum: "$size" } } }
      ]);
      if (result.length > 0) {
        usedBytes = result[0].totalSize;
      }
    }
    
    const totalLimitBytes = 5 * 1024 * 1024 * 1024; // 5 GB
    const usedPercentage = ((usedBytes / totalLimitBytes) * 100).toFixed(1);
    res.json({ usedBytes, totalLimitBytes, usedPercentage });
  } catch (error) {
    res.status(500).json({ error: 'Error calculating storage stats' });
  }
});

// Upload Endpoint
// Upload Endpoint
// Presign Endpoint
app.post('/api/presign', verifyToken, async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const userId = req.user?._id || req.user?.id || req.userId || 'anonymous';
    const fileKey = `${userId}/${Date.now()}-${filename}`;
    
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType || 'application/octet-stream'
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    
    const fileData = {
      userId: userId,
      name: filename,
      originalName: filename,
      s3Key: fileKey,
      mimetype: contentType || 'application/octet-stream',
      status: 'uploading',
      securityStatus: 'UPLOADING'
    };
    const newFile = new FileModel(fileData);
    await newFile.save();

    res.json({ signedUrl, fileKey, fileId: newFile._id });
  } catch (err) {
    console.error('Presign Error:', err);
    res.status(500).json({ error: 'Failed to generate pre-signed URL' });
  }
});

// Upload Endpoint
app.post('/api/upload', verifyToken, async (req, res) => {
  const { fileKey, originalName, fileSize } = req.body;
  if (!fileKey || !originalName) return res.status(400).json({ error: "No file data provided" });

  const filesToProcess = [{ key: fileKey, originalname: originalName, size: fileSize || 0 }];
  console.log('[Upload Hit] File data for direct upload:', originalName);

  const userId = req.user._id;
  const incomingSize = filesToProcess.reduce((sum, f) => sum + f.size, 0);

  // Global Quota Check
  // const globalUsed = await getGlobalStorageUsed();
  // if (globalUsed > GLOBAL_MAX_BYTES) {
  //   for (const f of filesToProcess) {
  //     if (f.key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: f.key }));
  //   }
  //   return res.status(503).json({ error: "Upload failed: The server has reached its maximum global capacity limit." });
  // }

  // Check User Quota
  let currentStorageUsed = 0;
  if (isDbConnected || mongoose.connection.readyState === 1) {
    const result = await FileModel.aggregate([
      { $match: { userId: userId, securityStatus: 'Safe' } },
      { $group: { _id: null, totalSize: { $sum: "$size" } } }
    ]);
    if (result.length > 0) {
      currentStorageUsed = result[0].totalSize;
    }
  }

  if (currentStorageUsed + incomingSize > 5368709120) {
    for (const f of filesToProcess) {
      if (f.key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: f.key }));
    }
    return res.status(400).json({ error: "Upload Failed: Insufficient storage space. This file exceeds your 5 GB account limit." });
  }

  const uploadedFiles = [];
  const blockedFiles = [];

  for (let i = 0; i < filesToProcess.length; i++) {
    const targetFile = filesToProcess[i];
    const originalName = targetFile.originalname;
    
    let fileRecord = null;
    try {
      let scanResult = 'Unknown';
      let securityStatus = 'Pending';
      let isMalware = false;

      fileRecord = await FileModel.findOne({ s3Key: targetFile.key, userId: req.user._id, securityStatus: 'UPLOADING' });
      if (!fileRecord) {
        console.error('[Upload Error] Invalid or unauthorized file record for:', targetFile.key);
        if (targetFile.key) {
          try {
            await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key }));
          } catch (e) {
            console.error('[Upload Error] S3 Cleanup Failed for orphaned object:', targetFile.key, 'Error:', e.message);
          }
        }
        return res.status(404).json({ error: "File record not found or already processed" });
      }

      fileRecord.securityStatus = 'SCANNING';
      await fileRecord.save();

      console.log('[Routing] Processing through AI Microservice: ' + targetFile.originalname);
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        try {
          const aiResponse = await axios.post(`${aiServiceUrl}/scan`, {
              fileKey: targetFile.key,
              filename: targetFile.originalname
          }, {
              timeout: 120000 // Increased to 2 minutes for processing large files
          });
          
          scanResult = aiResponse.data.status;

          if (scanResult === 'rate_limited') {
             if (targetFile.key) {
               try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key })); } catch (e) { console.error('[Upload Error] S3 Cleanup Failed for rate limited object:', targetFile.key, 'Error:', e.message); }
             }
             await FileModel.deleteOne({ _id: fileRecord._id });
             return res.status(429).json({ error: "Scanner busy, please try again" });
          }

          if (scanResult === 'malicious') {
             if (targetFile.key) {
               try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key })); } catch (e) { console.error('[Upload Error] S3 Cleanup Failed for malicious object:', targetFile.key, 'Error:', e.message); }
             }
             fileRecord.securityStatus = 'MALICIOUS';
             await fileRecord.save();
             return res.status(406).json({ error: "File blocked: Malicious content detected" });
          }

          if (scanResult !== 'safe') {
             throw new Error(`AI Service returned unexpected status: ${scanResult}`);
          }

          let relativePath = '';
          if (req.body.relativePaths) {
            relativePath = Array.isArray(req.body.relativePaths) ? req.body.relativePaths[i] : req.body.relativePaths;
          }
          let nestedRelativePath = targetFile.originalname;
          if (relativePath) {
            const relativeDir = path.dirname(relativePath);
            if (relativeDir && relativeDir !== '.') {
              nestedRelativePath = path.posix.join(relativeDir.split(path.sep).join('/'), targetFile.originalname);
            }
          }

          let exactFileSize = targetFile.size;
          if (!exactFileSize) {
              try {
                  const headData = await s3.send(new HeadObjectCommand({
                      Bucket: process.env.AWS_BUCKET_NAME,
                      Key: targetFile.key || targetFile.s3Key
                  }));
                  exactFileSize = headData.ContentLength;
              } catch (err) {
                  console.error("[S3 Size Check Error]:", err);
                  exactFileSize = 0;
              }
          }
          
          fileRecord.diskName = nestedRelativePath;
          fileRecord.relativePath = relativePath;
          fileRecord.size = exactFileSize;
          fileRecord.status = 'safe';
          fileRecord.securityStatus = 'Safe';
          await fileRecord.save();
          uploadedFiles.push(fileRecord);
          
        } catch (scanErr) {
          console.error('[AI Connection Error]:', scanErr.message);
          if (targetFile.key) {
            try {
              await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key }));
            } catch (e) {
              console.error('[Upload Error] S3 Cleanup Failed during AI scan error:', targetFile.key, 'Error:', e.message);
            }
          }
          if (fileRecord && fileRecord._id) {
            await FileModel.deleteOne({ _id: fileRecord._id });
          }
          return res.status(500).json({ error: "Upload failed: Security scan error" });
        }

    } catch (error) {
      console.error('File processing error:', error);
      if (targetFile.key) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key }));
        } catch (e) {
          console.error('[Upload Error] S3 Cleanup Failed during file processing error:', targetFile.key, 'Error:', e.message);
        }
      }
      if (fileRecord && fileRecord._id) {
        await FileModel.deleteOne({ _id: fileRecord._id });
      }
      return res.status(500).json({ error: "Upload failed: Security scan error" });
    }
  }
  
  const exactStorageUsed = await recalculateStorage(userId);
  return res.status(uploadedFiles.length > 0 ? 200 : 403).json({
    status: uploadedFiles.length > 0 ? 'success' : 'blocked',
    uploadedFiles,
    blockedFiles,
    message: uploadedFiles.length > 0 ? 'Upload processed' : 'All files blocked',
    storageUsed: exactStorageUsed
  });
});



// View Endpoint (Inline)
app.get('/api/view/:filename(*)', verifyToken, async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileRecord = await FileModel.findOne({ userId: req.user._id, diskName: filename, securityStatus: 'Safe' });
    if (!fileRecord || !fileRecord.s3Key) return res.status(404).json({ error: 'File not found' });
    
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileRecord.s3Key,
    });
    
    const response = await s3.send(command);
    res.setHeader('Content-Type', response.ContentType);
    res.setHeader('Content-Disposition', 'inline');
    response.Body.pipe(res);
  } catch (error) {
    console.error('S3 View Error:', error);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// Download Endpoint (Attachment)
app.get('/api/download/:filename(*)', verifyToken, async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileRecord = await FileModel.findOne({ userId: req.user._id, diskName: filename, securityStatus: 'Safe' });
    if (!fileRecord || !fileRecord.s3Key) return res.status(404).json({ error: 'File not found' });
    
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileRecord.s3Key,
    });
    
    const response = await s3.send(command);
    res.setHeader('Content-Type', response.ContentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.originalName}"`);
    response.Body.pipe(res);
  } catch (error) {
    console.error('S3 Download Error:', error);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// List Files Endpoint
// Sync DB with S3
app.get('/api/files/sync', verifyToken, async (req, res) => {
  try {
    const files = await FileModel.find({ userId: req.user._id });
    const removedIds = [];

    for (const file of files) {
      const keyToCheck = file.s3Key || (file.location ? new URL(file.location).pathname.slice(1) : null);
      if (keyToCheck) {
        try {
          await s3.send(new HeadObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: keyToCheck
          }));
        } catch (s3Err) {
          if (s3Err.name === 'NotFound' || s3Err.$metadata?.httpStatusCode === 404) {
            console.log(`[Sync] S3 object missing for DB file ${file._id}, deleting from DB...`);
            await FileModel.deleteOne({ _id: file._id });
            removedIds.push(file._id);
          }
        }
      }
    }

    if (removedIds.length > 0) {
      await recalculateStorage(req.user._id);
    }

    return res.status(200).json({
      message: "Sync complete",
      removedMissingFiles: removedIds.length,
      removedIds
    });
  } catch (err) {
    console.error('[Sync Error]:', err);
    return res.status(500).json({ error: "Failed to sync files" });
  }
});

app.get('/api/files', verifyToken, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const queryPath = req.query.path || '';
    const userId = req.user._id;

    if (isDbConnected || mongoose.connection.readyState === 1) {
      // Query MongoDB to ensure all files (including non-images) are returned
      // regardless of ephemeral disk state on Render.
      const dbFiles = await FileModel.find({ userId: userId, securityStatus: 'Safe' });
      
      const mappedFiles = [];
      const folders = new Set();

      dbFiles.forEach(file => {

        const relativeToUser = file.diskName || file.name;
        const qp = queryPath ? (queryPath.endsWith('/') ? queryPath : queryPath + '/') : '';
        
        if (relativeToUser.startsWith(qp)) {
           const remainder = relativeToUser.substring(qp.length);
           if (remainder.includes('/')) {
             const folderName = remainder.split('/')[0];
             folders.add(folderName);
           } else {
             mappedFiles.push({
               id: relativeToUser,
               _id: file._id.toString(),
               name: file.originalName || file.name,
               diskName: relativeToUser,
               isFolder: false,
               date: new Date(file.uploadedAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
               mtimeMs: new Date(file.uploadedAt || Date.now()).getTime(),
               size: file.size,
               status: file.securityStatus || 'Safe',
               type: (file.originalName || file.name).split('.').pop()
             });
           }
        }
      });

      folders.forEach(folder => {
        mappedFiles.push({
          id: queryPath ? `${queryPath}/${folder}` : folder,
          name: folder,
          diskName: queryPath ? `${queryPath}/${folder}` : folder,
          isFolder: true,
          date: '--',
          mtimeMs: 0,
          size: '--',
          status: 'Safe',
          type: 'folder'
        });
      });

      mappedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return res.json(mappedFiles);
    }
    
    return res.json([]);
  } catch (error) {
    console.error('Error listing files:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Access File Endpoint (Presigned URL)
app.get('/api/files/:id/access', verifyToken, async (req, res) => {
  try {
    let query = { _id: req.params.id, securityStatus: 'Safe' };
    if (!req.user.isAdmin) {
      query.userId = req.user._id;
    }
    const file = await FileModel.findOne(query);
    if (!file) return res.status(404).json({ error: 'File not found' });

    let targetKey = file.s3Key;
    if (!targetKey && file.location) {
      try {
        const urlObj = new URL(file.location);
        targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
      } catch (e) {
        console.error("URL parsing failed for location:", file.location);
      }
    }

    if (!targetKey) return res.status(400).json({ error: 'S3 Key missing and cannot be parsed from location' });

    const isDownload = req.query.download === 'true';
    const originalFileName = file.originalName || file.name;
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: targetKey,
      ResponseContentDisposition: isDownload ? `attachment; filename*=UTF-8''${encodeURIComponent(originalFileName)}` : 'inline'
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 60 });
    res.json({ url });
  } catch (error) {
    console.error('Access URL generation error:', error);
    res.status(500).json({ error: 'Failed to generate access URL' });
  }
});

// Delete File Endpoint
app.delete('/api/files/:id', verifyToken, async (req, res) => {
  try {
    const file = await FileModel.findOne({ _id: req.params.id, userId: req.user._id });
    if (!file) return res.status(404).json({ error: "File not found" });

    // Determine target S3 key
    const keyToDelete = file.s3Key || (file.location ? new URL(file.location).pathname.slice(1) : null);

    if (keyToDelete) {
      console.log('[S3 Deleting Key]:', keyToDelete);
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: keyToDelete
      }));
    }

    await FileModel.deleteOne({ _id: req.params.id });
    const exactStorageUsed = await recalculateStorage(req.user._id);

    return res.status(200).json({
      message: "File deleted successfully from DB and S3",
      deletedId: req.params.id,
      storageUsed: exactStorageUsed
    });
  } catch (err) {
    console.error('[Delete Error]:', err);
    return res.status(500).json({ error: "Failed to delete file" });
  }
});

// Bulk Delete Files Endpoint
app.post('/api/files/bulk-delete', verifyToken, async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'No file IDs provided' });
    }
    const objectIds = fileIds.map(id => new mongoose.Types.ObjectId(id));

    const files = await FileModel.find({ _id: { $in: objectIds }, userId: req.user._id });
    if (files.length === 0) {
      return res.status(404).json({ message: "No files found to delete" });
    }

    const s3KeysToDelete = files.map(f => f.s3Key).filter(key => key);

    await Promise.all(s3KeysToDelete.map(key => 
      s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }))
    ));

    await FileModel.deleteMany({ _id: { $in: objectIds }, userId: req.user._id });
    await recalculateStorage(req.user._id);

    res.status(200).json({ message: "Files deleted successfully" });

  } catch (error) {
    console.error("Bulk deletion error:", error.message);
    res.status(500).json({ error: "Server error during bulk deletion" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
