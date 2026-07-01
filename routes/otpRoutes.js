'use strict';

const express = require('express');
const router  = express.Router();
const otp     = require('../controllers/otpController');
const { protect } = require('../middleware/auth');

// Debug route to confirm mounting
router.get('/ping', (_req, res) => {
  res.json({ success: true, message: 'OTP route is live', timestamp: new Date().toISOString() });
});

router.post('/send',   protect, otp.sendOTP);
router.post('/verify', protect, otp.verifyOTP);

module.exports = router;