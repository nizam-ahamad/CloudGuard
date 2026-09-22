require('dotenv').config();
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

const JWT_SECRET = 'cloudguard-super-secret-key';

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
  resetPasswordExpire: Date
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

const GLOBAL_MAX_BYTES = 1073741824; // 1 GB

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
    
    let emailExists = false;
    
    if (isDbConnected || mongoose.connection.readyState === 1) {
      emailExists = await User.findOne({ email });
    } else {
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      emailExists = users.find(u => u.email === email);
    }
    
    if (emailExists) return res.status(400).json({ error: 'Email already exists' });
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    if (isDbConnected || mongoose.connection.readyState === 1) {
      const user = new User({ name, email, password: hashedPassword });
      await user.save();
    } else {
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      users.push({ _id: Date.now().toString(), name, email, password: hashedPassword });
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }
    
    res.json({ message: 'User created successfully' });
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
          secret: "super_secret_password_123" 
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
    
    res.json({ signedUrl, fileKey });
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
    
    try {
      const ext = targetFile.originalname.split('.').pop().toLowerCase();
      const isAI = ['exe', 'dll', 'zip'].includes(ext);

      let scanResult = 'Unknown';
      let securityStatus = 'Pending';
      let isMalware = false;

      if (isAI) {
        console.log('[Routing] AI Target: ' + targetFile.originalname);
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        try {
          const aiResponse = await axios.post(`${aiServiceUrl}/scan`, {
              fileKey: targetFile.key,
              filename: targetFile.originalname
          }, {
              timeout: 120000 // Increased to 2 minutes for processing large files
          });
          
          scanResult = aiResponse.data.status;

          if (scanResult === 'unverified' || scanResult === 'malware' || scanResult === 'malicious') {
             if (targetFile.key) {
               try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key })); } catch (e) {}
             }
             blockedFiles.push(targetFile.originalname);
             continue;
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
          const fileData = {
            userId: userId,
            name: targetFile.originalname,
            diskName: nestedRelativePath,
            originalName: originalName,
            location: targetFile.location,
            s3Key: targetFile.key || `${userId}/${targetFile.originalname}`,
            relativePath: relativePath,
            size: exactFileSize,
            mimetype: targetFile.mimetype,
            status: 'safe',
            securityStatus: 'Safe'
          };
          const newFile = new FileModel(fileData);
          await newFile.save();
          uploadedFiles.push(newFile);
          
        } catch (scanErr) {
          console.error('[AI Connection Error]:', scanErr.message);
          if (targetFile.key) {
            try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key })); } catch (e) {}
          }
          blockedFiles.push(targetFile.originalname);
        }
      } else {
        console.log('[Routing] Standard File: ' + targetFile.originalname);
        try {
          const command = new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key });
          const response = await s3.send(command);
          
          const crypto = require('crypto');
          const hash = crypto.createHash('sha256');
          for await (const chunk of response.Body) {
            hash.update(chunk);
          }
          const sha256 = hash.digest('hex');

          const vtResponse = await axios.get("https://www.virustotal.com/api/v3/files/" + sha256, {
            headers: { 'x-apikey': process.env.VT_API_KEY },
            timeout: 15000
          });
          const stats = vtResponse.data.data.attributes.last_analysis_stats;

          if (stats.malicious > 0 || stats.suspicious > 0) {
             if (targetFile.key) {
               try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key })); } catch (e) {}
             }
             blockedFiles.push(targetFile.originalname);
             continue;
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
          const fileData = {
            userId: userId,
            name: targetFile.originalname,
            diskName: nestedRelativePath,
            originalName: originalName,
            location: targetFile.location,
            s3Key: targetFile.key || `${userId}/${targetFile.originalname}`,
            relativePath: relativePath,
            size: exactFileSize,
            mimetype: targetFile.mimetype,
            status: 'safe',
            securityStatus: 'Safe'
          };
          const newFile = new FileModel(fileData);
          await newFile.save();
          uploadedFiles.push(newFile);
          
        } catch (error) {
           if (error.response && error.response.status === 404) {
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
               const fileData = {
                 userId: userId,
                 name: targetFile.originalname,
                 diskName: nestedRelativePath,
                 originalName: originalName,
                 location: targetFile.location,
                 s3Key: targetFile.key || `${userId}/${targetFile.originalname}`,
                 relativePath: relativePath,
                 size: exactFileSize,
                 mimetype: targetFile.mimetype,
                 status: 'safe',
                 securityStatus: 'Safe'
               };
               const newFile = new FileModel(fileData);
               await newFile.save();
               uploadedFiles.push(newFile);
           } else {
               if (targetFile.key) {
                 try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key })); } catch (e) {}
               }
               blockedFiles.push(targetFile.originalname);
           }
        }
      }
    } catch (error) {
      console.error('File processing error:', error);
      if (targetFile.key) {
        try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: targetFile.key })); } catch (e) {}
      }
      blockedFiles.push(targetFile.originalname);
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
    const fileRecord = await FileModel.findOne({ userId: req.user._id, diskName: filename });
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
    const fileRecord = await FileModel.findOne({ userId: req.user._id, diskName: filename });
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
      const dbFiles = await FileModel.find({ userId: userId });
      
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
    const file = await FileModel.findById(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    
    if (file.userId !== req.user._id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

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
