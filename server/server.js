const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const app = express();

// Configure CORS for Vite frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());

// Automatically create /temp and /storage directories if they do not exist
const tempDir = path.join(__dirname, 'temp');
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
mongoose.connect('mongodb://localhost:27017/cloudguard', { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('Connected to MongoDB');
    isDbConnected = true;
  })
  .catch(err => {
    console.warn('MongoDB connection warning: Database is offline. Files will still be processed and saved locally.', err.message);
  });

// Upload Endpoint
app.post('/api/upload', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  let results = [];
  let hasMalware = false;

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const tempFilePath = file.path;
    const originalName = file.originalname;

    try {
      // Call AI Microservice
      const aiResponse = await axios.post('http://localhost:8000/scan', {
        file_path: tempFilePath
      });

      if (aiResponse.data.status === 'safe') {
        const diskName = file.filename;
        let relativePath = '';
        if (req.body.relativePaths) {
          relativePath = Array.isArray(req.body.relativePaths) ? req.body.relativePaths[i] : req.body.relativePaths;
        }
        
        let permanentPath = path.join(storageDir, diskName);
        let nestedRelativePath = diskName;

        if (relativePath) {
          const relativeDir = path.dirname(relativePath);
          if (relativeDir && relativeDir !== '.') {
            const targetDir = path.join(storageDir, relativeDir);
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
          name: file.filename,
          diskName: nestedRelativePath,
          originalName: originalName,
          path: permanentPath,
          relativePath: relativePath,
          size: file.size,
          mimetype: file.mimetype,
          status: 'safe'
        };

        // Wrap MongoDB save in try/catch to allow fallback
        try {
          if (isDbConnected || mongoose.connection.readyState === 1) {
            const newFile = new FileModel(fileData);
            await newFile.save();
            results.push(newFile);
          } else {
            results.push(fileData);
          }
        } catch (dbError) {
          results.push(fileData);
        }
      } else {
        // Malware detected
        hasMalware = true;
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath); // Delete file from temp
        }
      }
    } catch (error) {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  if (hasMalware && results.length === 0) {
    return res.status(400).json({ status: 'malware', message: 'Malware detected in all files' });
  }

  return res.json({ status: 'safe', files: results, hasMalware });
});

// View Endpoint (Inline)
app.get('/api/view/:filename(*)', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(storageDir, filename);

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
app.get('/api/download/:filename(*)', async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(storageDir, filename);

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
app.get('/api/files', async (req, res) => {
  try {
    const queryPath = req.query.path || '';
    const targetDir = path.join(storageDir, queryPath);

    // Prevent directory traversal
    if (!targetDir.startsWith(storageDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(targetDir)) {
      return res.json([]);
    }

    const items = fs.readdirSync(targetDir);
    const mappedFiles = items.map(item => {
      const itemPath = path.join(targetDir, item);
      const stats = fs.statSync(itemPath);
      const relativePath = path.relative(storageDir, itemPath).split(path.sep).join('/');
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
app.delete('/api/files/:filename(*)', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(storageDir, filename);

  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
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

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Gateway running on http://localhost:${PORT}`);
});
