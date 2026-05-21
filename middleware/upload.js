'use strict';

const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════════════════════
//  UPLOADS DIRECTORY
//  On Render the filesystem is ephemeral — the dir may not exist
//  after a redeploy. Create it at middleware load time.
// ═══════════════════════════════════════════════════════════════════
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('[upload] Created uploads directory:', UPLOADS_DIR);
}

// ═══════════════════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════════════════
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Re-check existence on every request — Render can wipe it
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext        = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

// ═══════════════════════════════════════════════════════════════════
//  FILE FILTER
// ═══════════════════════════════════════════════════════════════════
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type "${file.mimetype}". ` +
        'Only JPEG, PNG, GIF and WebP are allowed.'
      ),
      false
    );
  }
};

// ═══════════════════════════════════════════════════════════════════
//  MULTER INSTANCE
// ═══════════════════════════════════════════════════════════════════
const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
});

module.exports = upload;