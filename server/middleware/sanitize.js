/**
 * Defense-in-depth sanitization and per-field character validation module
 * Protects against NoSQL operator injection, control-byte corruption, XSS, and filesystem-breaking names.
 */

// Keys whose string values must preserve raw special characters (e.g. passwords for bcrypt, tokens)
const EXCLUDED_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'credential',
  'tempToken',
  'token',
]);

// Non-printable ASCII control characters excluding standard tab/newline/carriage-return where needed,
// but for strict inputs removes \0 and [\x00-\x08\x0B\x0C\x0E-\x1F\x7F]
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Recursively cleans an object or array:
 * 1. Strips any key that starts with '$' or contains '.' (prevents MongoDB query selector injection)
 * 2. Strips null bytes and control characters from string values (unless the key is in EXCLUDED_KEYS)
 */
function cleanPayload(payload, currentKey = '') {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      const item = payload[i];
      if (typeof item === 'string') {
        if (!EXCLUDED_KEYS.has(currentKey)) {
          payload[i] = item.replace(/\0/g, '').replace(CONTROL_CHARS_REGEX, '');
        }
      } else if (item && typeof item === 'object') {
        cleanPayload(item, currentKey);
      }
    }
    return payload;
  }

  for (const key of Object.keys(payload)) {
    // Strip MongoDB operator keys or path navigation in object keys
    if (key.startsWith('$') || key.includes('.')) {
      delete payload[key];
      continue;
    }

    const val = payload[key];
    if (typeof val === 'string') {
      if (!EXCLUDED_KEYS.has(key)) {
        payload[key] = val.replace(/\0/g, '').replace(CONTROL_CHARS_REGEX, '');
      }
    } else if (val && typeof val === 'object') {
      cleanPayload(val, key);
    }
  }

  return payload;
}

/**
 * Global Express middleware to recursively sanitize req.body, req.query, and req.params
 */
function globalSanitizeMiddleware(req, res, next) {
  try {
    if (req.body) cleanPayload(req.body);
    if (req.query) cleanPayload(req.query);
    if (req.params) cleanPayload(req.params);
  } catch (err) {
    console.error('[Sanitizer Error]:', err);
  }
  next();
}

/**
 * Plaintext sanitizer for freeform text (contact, message, feedback):
 * Strips HTML tags, script URI schemes, inline event handlers, and slices to maxLen
 */
function sanitizePlainText(str, maxLen = 2000) {
  if (typeof str !== 'string') return '';
  let cleaned = str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Strip script tags and their contents
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Strip style tags and their contents
    .replace(/<[^>]*>/g, '') // Strip remaining HTML tags
    .replace(/javascript:/gi, '')
    .replace(/data:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/on\w+\s*=/gi, '') // Strip inline event handlers like onclick=
    .replace(/[<>]/g, '') // Strip residual angle brackets
    .trim();

  if (typeof maxLen === 'number' && maxLen > 0) {
    cleaned = cleaned.slice(0, maxLen);
  }
  return cleaned;
}

/**
 * Validator for user Display Name:
 * Must be a string, 2..60 characters, rejecting script tags and < > { } [ ] ;
 */
function validateDisplayName(name) {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Display name must be a string' };
  }
  if (/[<>{}[\];]|<script/i.test(name)) {
    return { valid: false, error: 'Display name cannot contain script tags or special characters (<, >, {, }, [, ], ;)' };
  }
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) {
    return { valid: false, error: 'Display name must be between 2 and 60 characters' };
  }
  return { valid: true, sanitized: trimmed };
}

/**
 * Validator for vault item names (files and folders):
 * Rejects filesystem and script forbidden characters [<>:"/\\|?*\x00-\x1F] and '.' / '..'
 * Enforces length 1..120 characters
 */
function validateVaultItemName(name) {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Item name must be a string' };
  }
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 1 || trimmed.length > 120) {
    return { valid: false, error: 'Item name must be between 1 and 120 characters' };
  }
  if (trimmed === '.' || trimmed === '..') {
    return { valid: false, error: 'Item name cannot be "." or ".."' };
  }
  if (/[<>:"/\\|?*\x00-\x1F]/.test(trimmed)) {
    return { valid: false, error: 'Item name cannot contain forbidden characters (< > : " / \\ | ? *) or control characters' };
  }
  return { valid: true, sanitized: trimmed };
}

/**
 * Validator for password input fields:
 * Enforces string type and length <= 128 (rejects objects/arrays/empty strings).
 * NEVER alters password characters so bcrypt handles symbols accurately.
 */
function validatePasswordInput(pw) {
  if (typeof pw !== 'string') {
    return { valid: false, error: 'Password must be a valid string' };
  }
  if (pw.length === 0) {
    return { valid: false, error: 'Password cannot be empty' };
  }
  if (pw.length > 128) {
    return { valid: false, error: 'Password cannot exceed 128 characters' };
  }
  return { valid: true };
}

/**
 * Validator for one-time passcodes, TOTP tokens, and backup codes:
 * Enforces string type, alphanumeric + hyphens, length <= 16
 */
function validateCodeInput(code) {
  if (typeof code !== 'string') {
    return { valid: false, error: 'Code must be a valid string' };
  }
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Code cannot be empty' };
  }
  if (trimmed.length > 16) {
    return { valid: false, error: 'Code cannot exceed 16 characters' };
  }
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) {
    return { valid: false, error: 'Code can only contain alphanumeric characters and hyphens' };
  }
  return { valid: true, sanitized: trimmed };
}

/**
 * Validator for email inputs
 */
function validateEmailInput(email) {
  if (typeof email !== 'string') {
    return { valid: false, error: 'Email must be a valid string' };
  }
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) {
    return { valid: false, error: 'Email must be between 1 and 254 characters' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email address format' };
  }
  return { valid: true, sanitized: trimmed };
}

module.exports = {
  globalSanitizeMiddleware,
  sanitizePlainText,
  validateDisplayName,
  validateVaultItemName,
  validatePasswordInput,
  validateCodeInput,
  validateEmailInput,
  cleanPayload,
  EXCLUDED_KEYS,
};
