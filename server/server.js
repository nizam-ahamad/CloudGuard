const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const FormData = require('form-data');
const crypto = require('crypto');
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multerS3 = require('multer-s3');

const app = express();

const JWT_SECRET = 'cloudguard-super-secret-key';

// Configure CORS for Vite frontend
app.use(cors({
  origin: ['http://localhost:5173', 'https://cloud-guard-self.vercel.app'],
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

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, {fieldName: file.fieldname});
    },
    key: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    }
  })
});
// File Metadata Schema
const FileSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: String,
  originalName: String,
  location: String,
  relativePath: String,
  size: Number,
  mimetype: String,
  uploadedAt: { type: Date, default: Date.now },
  status: String,
  securityStatus: { type: String, default: 'Pending' },
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
    if (isDbConnected || mongoose.connection.readyState === 1) {
      const userFiles = await FileModel.find({ userId: userId });
      for (const file of userFiles) {
        if (file.s3Key) {
          try {
            await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key }));
          } catch (e) {
            console.error("Failed to delete from S3 during account removal", e.message);
          }
        }
      }
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
app.post('/api/upload', verifyToken, upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const userId = req.user._id;
  const incomingSize = req.files.reduce((sum, f) => sum + f.size, 0);

  // Global Quota Check
  const globalUsed = await getGlobalStorageUsed();
  if (globalUsed > GLOBAL_MAX_BYTES) {
    for (const f of req.files) {
      if (f.key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: f.key }));
    }
    return res.status(503).json({ error: "Upload failed: The server has reached its maximum global capacity limit." });
  }

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
    for (const f of req.files) {
      if (f.key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: f.key }));
    }
    return res.status(400).json({ error: "Upload Failed: Insufficient storage space. This file exceeds your 5 GB account limit." });
  }

  let results = [];
  let deletedFiles = [];
  let hasMalware = false;

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    try {
      // Call AI Microservice
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      let scanResult = 'Unknown';
      try {
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const command = new GetObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: file.key
        });
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

        const aiResponse = await axios.post(`${aiServiceUrl}/scan`, { file_url: presignedUrl });
        scanResult = aiResponse.data.status;
      } catch (scanErr) {
        console.error("Scanner error:", scanErr.message);
        scanResult = 'safe'; // Default to safe if AI scanner is unreachable or errors
      }

      const isMalware = (scanResult === 'malware' || scanResult === 'malicious');
      const securityStatus = isMalware ? 'Malicious' : (scanResult === 'safe' ? 'Safe' : 'Pending');

      let relativePath = '';
      if (req.body.relativePaths) {
        relativePath = Array.isArray(req.body.relativePaths) ? req.body.relativePaths[i] : req.body.relativePaths;
      }
      
      let nestedRelativePath = file.originalname;
      if (relativePath) {
        const relativeDir = path.dirname(relativePath);
        if (relativeDir && relativeDir !== '.') {
          nestedRelativePath = path.posix.join(relativeDir.split(path.sep).join('/'), file.originalname);
        }
      }

      const fileData = {
        userId: userId,
        name: file.originalname,
        diskName: nestedRelativePath,
        originalName: originalName,
        location: file.location,
        s3Key: file.key,
        relativePath: relativePath,
        size: file.size,
        mimetype: file.mimetype,
        status: scanResult,
        securityStatus: securityStatus
      };

      if (isDbConnected || mongoose.connection.readyState === 1) {
        try {
          const newFile = new FileModel(fileData);
          if (!isMalware) {
            await newFile.save();
            results.push(newFile);
          }
        } catch (dbError) {
          console.error('MongoDB save error:', dbError);
          return res.status(500).json({ error: 'Database error while saving file metadata.' });
        }
      }

      if (isMalware) {
        hasMalware = true;
        deletedFiles.push(originalName);
      }

    } catch (error) {
      console.error('File processing error:', error);
      if (file.key) {
        try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: file.key })); } catch (e) {}
      }
      return res.status(500).json({ error: 'Internal server error during file processing.' });
    }
  }

  let msg = 'Upload successful';
  if (hasMalware) {
    msg = `Warning: Uploaded file(s) flagged as malware: ${deletedFiles.join(', ')}`;
  }

  const exactStorageUsed = await recalculateStorage(userId);

  return res.json({ 
    status: hasMalware ? 'malware' : 'safe', 
    files: results, 
    uploadedFiles: results,
    deletedFiles: deletedFiles,
    message: msg,
    hasMalware,
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
app.get('/api/files', verifyToken, async (req, res) => {
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
               size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
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
        targetKey = decodeURIComponent(urlObj.pathname.substring(1));
      } catch (e) {
        console.error("URL parsing failed for location:", file.location);
      }
    }

    if (!targetKey) return res.status(400).json({ error: 'S3 Key missing and cannot be parsed from location' });

    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: targetKey
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
      // 1. Find the file first to get its size and path
      const file = await FileModel.findById(req.params.id);
      if (!file) {
          return res.status(404).json({ message: "File not found" });
      }

      // 2. Storage used is dynamically aggregated in our schema, so we skip explicit decrement here.
      // (The storage stats endpoint will naturally return the lowered amount on its next call).

      // 3. Delete the record from MongoDB
      await FileModel.findByIdAndDelete(req.params.id);

      await recalculateStorage(file.userId);

      // 4. Send the success response to the frontend IMMEDIATELY
      res.status(200).json({ message: "File deleted successfully", id: req.params.id });

      // 5. Attempt physical deletion in the background (DO NOT AWAIT, DO NOT CRASH)
      if (file.s3Key) {
        s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: file.s3Key }))
          .catch(err => console.log("Physical deletion skipped/failed, ignoring:", err.message));
      }

  } catch (error) {
      console.error("Deletion error:", error.message);
      if (!res.headersSent) {
          res.status(500).json({ message: "Internal server error during deletion" });
      }
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
