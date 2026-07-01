'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/passwordResetController');

router.post('/request', ctrl.requestReset);
router.post('/verify',  ctrl.verifyResetCode);
router.post('/reset',   ctrl.resetPassword);

module.exports = router;