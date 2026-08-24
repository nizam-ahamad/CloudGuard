const fs = require('fs');
const filePath = 'c:/Users/Sanu/Desktop/CloudGuard/client/src/App.jsx';
let code = fs.readFileSync(filePath, 'utf8');

// Insert constant
if (!code.includes('const API_BASE_URL')) {
  code = code.replace(
    /import axios from 'axios';\r?\n/, 
    "import axios from 'axios';\n\nconst API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';\n"
  );
}

// Replace single-quoted URLs
code = code.replace(/'http:\/\/localhost:5000(.*?)'/g, '`${API_BASE_URL}$1`');

// Replace remaining URLs (which are inside backticks)
code = code.replace(/http:\/\/localhost:5000/g, '${API_BASE_URL}');

fs.writeFileSync(filePath, code);
console.log('Update complete.');
