'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/passwordResetController');

// Debug route
router.get('/ping', (_req, res) => {
  res.json({ success: true, message: 'Password Reset route is live', timestamp: new Date().toISOString() });
});

router.post('/request', ctrl.requestReset);
router.post('/verify',  ctrl.verifyResetCode);
router.post('/reset',   ctrl.resetPassword);

module.exports = router;