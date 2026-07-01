'use strict';

const express = require('express');
const router  = express.Router();
const otp     = require('../controllers/otpController');
const { protect } = require('../middleware/auth');

router.post('/send',   protect, otp.sendOTP);
router.post('/verify', protect, otp.verifyOTP);

module.exports = router;