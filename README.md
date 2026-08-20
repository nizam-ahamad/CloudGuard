# CloudGuard 🛡️
An AI-powered, enterprise-grade secure cloud storage platform designed to detect, quarantine, and prevent malicious file uploads in real time.

## 🚀 Key Features
* **Automated Malware Analysis:** Pre-ingestion file scanning pipeline leveraging static structural analysis to detect and quarantine threats before permanent storage.
* **Modern File Management:** Seamless drag-and-drop support for both individual files and directory hierarchies with a 15-item safety limit per batch.
* **In-Browser Previews & Media Streaming:** Full support for inline document viewing (PDF, Markdown, Images) and chunked HTTP 206 Range video streaming (MP4, WebM) without forced local downloads.
* **Directory Lifecycle Management:** Dynamic folder compression (ZIP) on download, deep recursive folder deletion, and millisecond-precision file sorting.

## 🛠️ Architecture & Tech Stack
* **Frontend:** React 19, Vite, Tailwind CSS v4, Lucide Icons, Axios
* **Backend Gateway:** Node.js, Express.js, Multer, Archiver, Mongoose
* **AI Microservice:** Python 3, FastAPI, Uvicorn, Scikit-learn, Pefile
* **Database:** MongoDB (Local / Atlas)
