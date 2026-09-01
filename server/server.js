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
  isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const GLOBAL_MAX_BYTES = 1073741824; // 1 GB

// Auth Middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid or expired token.' });
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
        { $match: { userId: userId } },
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
      { $match: { userId: userId } },
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
    const originalName = file.originalname;

    try {
      // Call AI Microservice
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFilePath));

      const aiResponse = await axios.post(`${aiServiceUrl}/scan`, form, {
        headers: {
          ...form.getHeaders()
        }
      });

      if (aiResponse.data.status === 'safe') {
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
        
        // Move file to permanent storage
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
          status: 'safe'
        };

        // Handle MongoDB save errors as 500 errors
        if (isDbConnected || mongoose.connection.readyState === 1) {
          try {
            const newFile = new FileModel(fileData);
            await newFile.save();
            results.push(newFile);
          } catch (dbError) {
            console.error('MongoDB save error:', dbError);
            return res.status(500).json({ error: 'Database error while saving file metadata.' });
          }
        } else {
          results.push(fileData);
        }
      } else {
        // Malware detected
        hasMalware = true;
        deletedFiles.push(originalName);
        if (fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch (e) {} // Ignore EBUSY
        }
      }
    } catch (error) {
      console.error('File processing error:', error);
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
      return res.status(500).json({ error: 'Internal server error during file processing.' });
    }
  }

  if (hasMalware && results.length === 0) {
    let msg = req.files.length === 1 
      ? `Malicious file detected and deleted: ${deletedFiles[0]}`
      : `Security Alert: Detected and deleted malicious file(s): ${deletedFiles.join(', ')}`;
    return res.status(400).json({ 
      status: 'malware', 
      message: msg,
      uploadedFiles: results,
      deletedFiles: deletedFiles
    });
  }

  let msg = 'Upload successful';
  if (hasMalware && results.length > 0) {
    msg = `Partially successful. Deleted malicious files: ${deletedFiles.join(', ')}`;
  }

  return res.json({ 
    status: 'safe', 
    files: results, 
    uploadedFiles: results,
    deletedFiles: deletedFiles,
    message: msg,
    hasMalware 
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
    const userStorageDir = path.join(storageDir, req.user._id);
    const targetDir = path.join(userStorageDir, queryPath);

    // Prevent directory traversal
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
        status: 'Safe',
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
app.delete('/api/files/:filename(*)', verifyToken, async (req, res) => {
  const filename = req.params.filename;
  const userStorageDir = path.join(storageDir, req.user._id);
  const filePath = path.join(userStorageDir, filename);

  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      
      if (isDbConnected || mongoose.connection.readyState === 1) {
        await FileModel.deleteMany({ path: { $regex: `^${filePath}` }, userId: req.user._id });
      }
      
      return res.json({ success: true, message: 'Deleted successfully' });
    } else {
      return res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Error deleting file:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
