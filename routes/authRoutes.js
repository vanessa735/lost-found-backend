'use strict';

const express       = require('express');
const router        = express.Router();
const auth          = require('../controllers/authController');
const { protect }   = require('../middleware/auth');
const upload        = require('../middleware/upload');

// ── Public routes ─────────────────────────────────────────────────
router.post('/register',       auth.register);
router.post('/login',          auth.login);
router.post('/google',         auth.googleLogin);

// ── Protected routes ──────────────────────────────────────────────
router.get('/me',              protect, auth.getMe);
router.put('/profile',         protect, auth.updateProfile);
router.put('/change-password', protect, auth.changePassword);
router.post('/upload-avatar',  protect, upload.single('avatar'), auth.uploadProfileImage);

// ── Users directory (for messaging) ──────────────────────────────
router.get('/users/all',       protect, auth.getAllUsers);

module.exports = router;