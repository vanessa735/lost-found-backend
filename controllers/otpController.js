'use strict';

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // ✅ Fix ENETUNREACH

const db         = require('../config/db');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

// ── Reuse same transporter pattern ───────────────────────────────────────────
let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('[OTP] ❌ EMAIL_USER or EMAIL_PASS not set');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host:              'smtp.gmail.com',
    port:              587,
    secure:            false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    family:            4,           // ✅ Force IPv4
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     30000,
    tls: { rejectUnauthorized: false },
    pool:              true,
    maxConnections:    3,
  });

  return _transporter;
};

// Verify on load
(async () => {
  const t = getTransporter();
  if (!t) return;
  try {
    await t.verify();
    console.log('[OTP] ✅ SMTP ready');
  } catch (e) {
    console.error('[OTP] ❌ SMTP verify failed:', e.message);
    _transporter = null;
  }
})();

const sendMailWithRetry = async (opts, retries = 3) => {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const t = getTransporter();
      if (!t) throw new Error('No transporter');
      const info = await t.sendMail(opts);
      console.log(`[OTP] ✅ Email sent (try ${i}): ${info.messageId}`);
      return info;
    } catch (err) {
      lastErr = err;
      console.warn(`[OTP] Attempt ${i}/${retries} failed: ${err.message}`);
      if (['ENETUNREACH','ECONNRESET','ETIMEDOUT'].includes(err.code)) {
        _transporter = null;
      }
      if (i < retries) await new Promise(r => setTimeout(r, i * 1000));
    }
  }
  throw lastErr;
};

// ── Generate 6-digit OTP ─────────────────────────────────────────────────────
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── OTP email template ───────────────────────────────────────────────────────
const buildOTPEmail = (otp, purpose = 'verify your account') => `
  <div style="font-family: Arial, sans-serif; max-width: 480px;
              margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3b82f6, #10b981);
                padding: 28px; border-radius: 18px;
                text-align: center; color: white;">
      <h1 style="margin: 0; font-size: 24px;">🔍 FindIt</h1>
      <p style="margin: 6px 0 0; opacity: .9;">Verification Code</p>
    </div>
    <div style="background: #f9fafb; padding: 28px;
                border-radius: 18px; margin-top: 16px;">
      <p style="color: #374151;">Use the code below to ${purpose}:</p>
      <div style="background: white; border: 2px dashed #3b82f6;
                  padding: 20px; border-radius: 14px;
                  text-align: center; margin: 18px 0;">
        <div style="color: #9ca3af; font-size: 12px; margin-bottom: 6px;">
          YOUR CODE
        </div>
        <div style="font-size: 38px; font-weight: bold;
                    letter-spacing: 10px; color: #3b82f6;">${otp}</div>
      </div>
      <p style="color: #9ca3af; font-size: 13px; text-align: center;">
        Expires in <strong>10 minutes</strong>.
      </p>
      <p style="color: #ef4444; font-size: 12px; text-align: center;">
        ⚠️ If you didn't request this, ignore this email.
      </p>
    </div>
    <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 14px;">
      © ${new Date().getFullYear()} FindIt — Lost & Found Platform
    </p>
  </div>
`;

// ══════════════════════════════════════════════════════════════════
//  POST /api/otp/send
// ══════════════════════════════════════════════════════════════════
exports.sendOTP = async (req, res) => {
  try {
    const { email, purpose } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const otp        = generateOTP();
    const expiresAt  = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Upsert OTP — invalidate old ones first
    await db.query(
      'DELETE FROM otps WHERE email = ?',
      [cleanEmail]
    );
    await db.query(
      'INSERT INTO otps (email, code, expires_at) VALUES (?, ?, ?)',
      [cleanEmail, otp, expiresAt]
    );

    console.log(`[OTP] Sending to ${cleanEmail}…`);

    try {
      await sendMailWithRetry({
        from:    `"FindIt" <${process.env.EMAIL_USER}>`,
        to:      cleanEmail,
        subject: '🔐 Your FindIt Verification Code',
        html:    buildOTPEmail(otp, purpose || 'verify your account'),
      });
    } catch (emailErr) {
      console.error('[OTP] Failed to send email:', emailErr.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code. Please try again.',
        debug:   process.env.NODE_ENV !== 'production' ? emailErr.message : undefined,
      });
    }

    console.log(`[OTP] ✅ Sent to ${cleanEmail}: ${otp}`);

    return res.json({
      success:  true,
      message:  'Verification code sent to your email',
      email:    cleanEmail,
      // Never expose OTP in production!
      ...(process.env.NODE_ENV !== 'production' && { _dev_otp: otp }),
    });
  } catch (err) {
    console.error('[SendOTP] ERROR:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ══════════════════════════════════════════════════════════════════
//  POST /api/otp/verify
// ══════════════════════════════════════════════════════════════════
exports.verifyOTP = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Email and code are required',
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode  = String(code).trim();

    const [rows] = await db.query(
      `SELECT * FROM otps
       WHERE email = ? AND code = ?
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, cleanCode]
    );

    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    const record = rows[0];

    if (new Date(record.expires_at) < new Date()) {
      await db.query('DELETE FROM otps WHERE email = ?', [cleanEmail]);
      return res.status(400).json({
        success: false,
        message: 'Code has expired. Please request a new one.',
      });
    }

    // Code is valid — delete it (one-time use)
    await db.query('DELETE FROM otps WHERE email = ?', [cleanEmail]);

    return res.json({ success: true, message: 'Code verified successfully' });
  } catch (err) {
    console.error('[VerifyOTP] ERROR:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};