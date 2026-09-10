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
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();

const JWT_SECRET = 'cloudguard-super-secret-key';

// Configure CORS for Vite frontend
app.use(cors({
  origin: ['http://localhost:5173', 'https://cloud-guard-self.vercel.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());

// Automatically create /uploads and /storage directories if they do not exist
const tempDir = path.join(__dirname, 'uploads');
const storageDir = path.join(__dirname, 'storage');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
// File Metadata Schema
const FileSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: String,
  originalName: String,
  path: String,
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
  .then(() => {
    console.log('Connected to MongoDB');
    isDbConnected = true;
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
const usersFilePath = path.join(storageDir, 'users.json');
if (!fs.existsSync(usersFilePath)) {
  fs.writeFileSync(usersFilePath, JSON.stringify([]));
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const globalUsed = getDirSize(storageDir);
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
    const { email } = req.body;
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

    // Send email using Ethereal Email for testing
    const resetUrl = `http://localhost:5173/reset-password/${resetToken}`;
    
    // We create a test account every time since we didn't specify one
    let testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false, 
      auth: {
        user: testAccount.user, 
        pass: testAccount.pass, 
      },
    });

    const mailOptions = {
      from: '"CloudGuard Support" <support@cloudguard.com>',
      to: email,
      subject: 'Password Reset Request',
      text: `You requested a password reset. Please click on the following link or paste it into your browser to complete the process:\n\n${resetUrl}\n\nThis link will expire in 15 minutes.\nIf you did not request this, please ignore this email and your password will remain unchanged.\n`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email preview URL: %s", nodemailer.getTestMessageUrl(info));

    res.json({ message: 'Password reset link sent to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'There was an error sending the email. Try again later.' });
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

    // 1. Delete physical files
    const userStorageDir = path.join(storageDir, userId);
    if (fs.existsSync(userStorageDir)) {
      fs.rmSync(userStorageDir, { recursive: true, force: true });
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

// Storage Helper
function getDirSize(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += stats.size;
    }
  }
  return size;
}

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
    } else {
      const userStorageDir = path.join(storageDir, userId);
      usedBytes = getDirSize(userStorageDir);
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
  const globalUsed = getDirSize(storageDir);
  if (globalUsed > GLOBAL_MAX_BYTES) {
    req.files.forEach(f => {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
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
  } else {
    const userStorageDir = path.join(storageDir, userId);
    currentStorageUsed = getDirSize(userStorageDir);
  }

  if (currentStorageUsed + incomingSize > 5368709120) {
    req.files.forEach(f => {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
    return res.status(400).json({ error: "Upload Failed: Insufficient storage space. This file exceeds your 5 GB account limit." });
  }

  let results = [];
  let deletedFiles = [];
  let hasMalware = false;

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const tempFilePath = file.path;
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    try {
      // Call AI Microservice
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFilePath));

      let scanResult = 'Unknown';
      try {
        const aiResponse = await axios.post(`${aiServiceUrl}/scan`, form, {
          headers: { ...form.getHeaders() }
        });
        scanResult = aiResponse.data.status;
      } catch (scanErr) {
        console.error("Scanner error:", scanErr.message);
        scanResult = 'Pending';
      }

      const isMalware = (scanResult === 'malware' || scanResult === 'malicious');
      const securityStatus = isMalware ? 'Malicious' : (scanResult === 'safe' ? 'Safe' : 'Pending');

      const diskName = file.filename;
      let relativePath = '';
      if (req.body.relativePaths) {
        relativePath = Array.isArray(req.body.relativePaths) ? req.body.relativePaths[i] : req.body.relativePaths;
      }
      
      const userStorageDir = path.join(storageDir, userId);
      if (!fs.existsSync(userStorageDir)) fs.mkdirSync(userStorageDir, { recursive: true });

      let permanentPath = path.join(userStorageDir, diskName);
      let nestedRelativePath = diskName;

      if (relativePath) {
        const relativeDir = path.dirname(relativePath);
        if (relativeDir && relativeDir !== '.') {
          const targetDir = path.join(userStorageDir, relativeDir);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          permanentPath = path.join(targetDir, diskName);
          nestedRelativePath = path.posix.join(relativeDir.split(path.sep).join('/'), diskName);
        }
      }
      
      // Move file to permanent storage (we save it even if malware, but it is flagged in DB)
      fs.renameSync(tempFilePath, permanentPath);

      const fileData = {
        userId: userId,
        name: file.filename,
        diskName: nestedRelativePath,
        originalName: originalName,
        path: permanentPath,
        relativePath: relativePath,
        size: file.size,
        mimetype: file.mimetype,
        status: scanResult,
        securityStatus: securityStatus
      };

      // Handle MongoDB save errors as 500 errors
      if (isDbConnected || mongoose.connection.readyState === 1) {
        try {
          const newFile = new FileModel(fileData);
          await newFile.save();
          if (!isMalware) {
            results.push(newFile);
          }
        } catch (dbError) {
          console.error('MongoDB save error:', dbError);
          return res.status(500).json({ error: 'Database error while saving file metadata.' });
        }
      } else {
        if (!isMalware) results.push(fileData);
      }

      if (isMalware) {
        hasMalware = true;
        deletedFiles.push(originalName);
      }

    } catch (error) {
      console.error('File processing error:', error);
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
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
app.get('/api/view/:filename(*)', verifyToken, (req, res) => {
  const filename = req.params.filename;
  const userStorageDir = path.join(storageDir, req.user._id);
  const filePath = path.join(userStorageDir, filename);

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      
      if (start >= stats.size || end >= stats.size) {
        res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + stats.size);
        return;
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      
      let contentType = 'video/mp4';
      const ext = path.extname(filename).toLowerCase();
      if (ext === '.webm') contentType = 'video/webm';
      else if (ext === '.mov') contentType = 'video/quicktime';
      else if (ext === '.mkv') contentType = 'video/x-matroska';
      else if (ext === '.ogg') contentType = 'video/ogg';

      const head = {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      res.setHeader('Content-Disposition', 'inline');
      res.sendFile(filePath);
    }
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Download Endpoint (Attachment)
app.get('/api/download/:filename(*)', verifyToken, async (req, res) => {
  const filename = req.params.filename;
  const userStorageDir = path.join(storageDir, req.user._id);
  const filePath = path.join(userStorageDir, filename);

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}.zip"`);
      res.setHeader('Content-Type', 'application/zip');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      archive.directory(filePath, false);
      archive.finalize();
      return;
    }

    let originalName = path.basename(filename);
    try {
      if (isDbConnected || mongoose.connection.readyState === 1) {
        const fileRecord = await FileModel.findOne({ path: filePath });
        if (fileRecord && fileRecord.originalName) {
          originalName = fileRecord.originalName;
        }
      }
    } catch (e) {
      console.warn("Could not fetch original name from DB", e.message);
    }
    res.download(filePath, originalName);
  } else {
    res.status(404).json({ error: 'File not found' });
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
        // Exclude malicious files
        if (file.status === 'malware') return;

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

    // Fallback to local FS if DB is not connected
    const userStorageDir = path.join(storageDir, req.user._id);
    const targetDir = path.join(userStorageDir, queryPath);

    if (!targetDir.startsWith(userStorageDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(targetDir)) {
      return res.json([]);
    }

    const items = fs.readdirSync(targetDir);
    const mappedFiles = items.map(item => {
      const itemPath = path.join(targetDir, item);
      const stats = fs.statSync(itemPath);
      const relativePath = path.relative(userStorageDir, itemPath).split(path.sep).join('/');
      const isFolder = stats.isDirectory();
      
      let originalName = item;
      if (!isFolder && originalName.includes('-')) {
        originalName = originalName.substring(originalName.indexOf('-') + 1);
      }

      return {
        id: relativePath,
        name: isFolder ? item : originalName,
        diskName: relativePath,
        isFolder: isFolder,
        date: new Date(stats.mtime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        mtimeMs: stats.mtimeMs,
        size: isFolder ? '--' : (stats.size / (1024 * 1024)).toFixed(1) + ' MB',
        status: 'Safe', // Local fallback doesn't have securityStatus DB info readily available here
        type: isFolder ? 'folder' : originalName.split('.').pop()
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return res.json(mappedFiles);
  } catch (error) {
    console.error('Error listing files:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
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
      try {
          const fs = require('fs');
          if (file.path && fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
          }
      } catch (fsError) {
          console.log("Physical deletion skipped/failed, ignoring:", fsError.message);
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
