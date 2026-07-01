'use strict';

const db         = require('../config/db');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const dns        = require('dns');

// ✅ CRITICAL: Force IPv4 to avoid ENETUNREACH on IPv6-disabled hosts
dns.setDefaultResultOrder('ipv4first');

const generateCode  = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateToken = () => crypto.randomBytes(32).toString('hex');

// ── Transporter with retry + IPv4 force ──────────────────────────────────────
let _transporter = null;
let _transporterCreatedAt = 0;
const TRANSPORTER_TTL = 5 * 60 * 1000; // recreate every 5 min

const getTransporter = () => {
  const now = Date.now();

  // Validate env
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('[Email] ❌ EMAIL_USER or EMAIL_PASS missing in .env!');
    return null;
  }

  // Reuse cached transporter
  if (_transporter && (now - _transporterCreatedAt) < TRANSPORTER_TTL) {
    return _transporter;
  }

  console.log(`[Email] Creating transporter for: ${process.env.EMAIL_USER}`);

  _transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',   // ✅ explicit host instead of service:'gmail'
    port:   587,                // ✅ TLS port (465 = SSL, 587 = STARTTLS)
    secure: false,              // ✅ false for port 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    // ✅ Force IPv4 — fixes ENETUNREACH on hosts without IPv6
    family: 4,
    // ✅ Reasonable timeouts
    connectionTimeout: 10000,   // 10s to connect
    greetingTimeout:   10000,
    socketTimeout:     30000,
    // ✅ TLS options
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    // ✅ Connection pool for faster subsequent sends
    pool:           true,
    maxConnections: 3,
    maxMessages:    100,
    rateDelta:      1000,
    rateLimit:      5,          // max 5 emails/second
  });

  _transporterCreatedAt = now;
  return _transporter;
};

// ── Verify transporter on startup ────────────────────────────────────────────
const verifyTransporter = async () => {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.verify();
    console.log(`[Email] ✅ SMTP connection verified — ready to send`);
    return true;
  } catch (err) {
    console.error(`[Email] ❌ SMTP verify failed: ${err.message}`);
    _transporter = null; // reset so it recreates
    return false;
  }
};

// Verify on module load
verifyTransporter();

// ── Email sender with retry logic ────────────────────────────────────────────
const sendMailWithRetry = async (mailOptions, maxRetries = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const t = getTransporter();
      if (!t) throw new Error('Transporter not available');

      const info = await t.sendMail(mailOptions);
      console.log(`[Email] ✅ Sent (attempt ${attempt}): ${info.messageId}`);
      return info;
    } catch (err) {
      lastError = err;
      console.warn(`[Email] ⚠️ Attempt ${attempt}/${maxRetries} failed: ${err.message}`);

      // Reset transporter on connection errors so next attempt recreates it
      if (
        err.code === 'ENETUNREACH' ||
        err.code === 'ECONNRESET'  ||
        err.code === 'ETIMEDOUT'   ||
        err.code === 'ECONNREFUSED'
      ) {
        _transporter = null;
      }

      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`[Email] Retrying in ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
};

// ── Email template ────────────────────────────────────────────────────────────
const buildResetEmail = (name, code, resetLink) => `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3b82f6, #10b981);
                padding: 30px; border-radius: 20px; text-align: center; color: white;">
      <h1 style="margin: 0; font-size: 26px;">🔍 FindIt</h1>
      <p style="margin: 8px 0 0; opacity: 0.9;">Password Reset Request</p>
    </div>
    <div style="background: #f9fafb; padding: 30px; border-radius: 20px; margin-top: 20px;">
      <p style="color: #374151; font-size: 15px;">Hi ${name || 'there'},</p>
      <p style="color: #6b7280;">
        You requested to reset your password. Use the code below
        <strong>or</strong> click the link:
      </p>
      <div style="background: white; border: 2px dashed #3b82f6;
                  padding: 20px; border-radius: 15px; margin: 20px 0; text-align: center;">
        <div style="color: #9ca3af; font-size: 12px; margin-bottom: 8px;">YOUR RESET CODE</div>
        <div style="font-size: 36px; font-weight: bold;
                    letter-spacing: 10px; color: #3b82f6;">${code}</div>
      </div>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${resetLink}"
           style="display: inline-block;
                  background: linear-gradient(135deg, #3b82f6, #10b981);
                  color: white; text-decoration: none; padding: 14px 32px;
                  border-radius: 12px; font-weight: bold;">
          Reset Password →
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 13px; text-align: center;">
        This code expires in <strong>15 minutes</strong>.
      </p>
      <p style="color: #ef4444; font-size: 12px; text-align: center; margin-top: 15px;">
        ⚠️ If you didn't request this, please ignore this email.
      </p>
    </div>
    <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
      © ${new Date().getFullYear()} FindIt — Lost & Found Platform
    </p>
  </div>
`;

// ═══════════════════════════════════════════════════════════════════
//  REQUEST RESET
// ═══════════════════════════════════════════════════════════════════
exports.requestReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const [users] = await db.query(
      'SELECT id, full_name, email FROM users WHERE email = ?',
      [cleanEmail]
    );

    // Always return 200 to prevent email enumeration
    if (!users.length) {
      console.log(`[PasswordReset] No user for: ${cleanEmail}`);
      return res.json({
        success: true,
        message: 'If an account exists with this email, a reset code has been sent.',
      });
    }

    const user      = users[0];
    const code      = generateCode();
    const token     = generateToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Invalidate old tokens
    await db.query(
      'UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0',
      [user.id]
    );

    // Insert new token
    await db.query(
      'INSERT INTO password_resets (user_id, code, token, expires_at) VALUES (?, ?, ?, ?)',
      [user.id, code, token, expiresAt]
    );

    const frontendURL = process.env.FRONTEND_URL || 'https://finditbridge.vercel.app';
    const resetLink   = `${frontendURL}/reset-password?token=${token}`;

    try {
      await sendMailWithRetry({
        from:    `"FindIt Security" <${process.env.EMAIL_USER}>`,
        to:      user.email,
        subject: '🔐 Reset Your FindIt Password',
        html:    buildResetEmail(user.full_name, code, resetLink),
      });
      console.log(`✅ [PasswordReset] Code sent to ${cleanEmail}: ${code}`);
    } catch (emailErr) {
      console.error('[PasswordReset] Email failed after retries:', emailErr.message);
      return res.status(500).json({
        success: false,
        message: 'Could not send reset email. Please try again in a moment.',
        debug:   process.env.NODE_ENV !== 'production' ? emailErr.message : undefined,
      });
    }

    return res.json({
      success: true,
      message: 'Reset code sent to your email',
      email:   cleanEmail,
    });
  } catch (err) {
    console.error('[RequestReset] ERROR:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  VERIFY RESET CODE
// ═══════════════════════════════════════════════════════════════════
exports.verifyResetCode = async (req, res) => {
  try {
    const { email, code, token } = req.body;

    if (!code && !token) {
      return res.status(400).json({ success: false, message: 'Code or token required' });
    }

    let record;

    if (token) {
      const [rows] = await db.query(
        `SELECT pr.*, u.email FROM password_resets pr
         JOIN users u ON pr.user_id = u.id
         WHERE pr.token = ? AND pr.used = 0
         ORDER BY pr.created_at DESC LIMIT 1`,
        [token]
      );
      if (!rows.length) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset link',
        });
      }
      record = rows[0];
    } else {
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email required with code' });
      }
      const cleanEmail = String(email).trim().toLowerCase();
      const [rows] = await db.query(
        `SELECT pr.*, u.email FROM password_resets pr
         JOIN users u ON pr.user_id = u.id
         WHERE u.email = ? AND pr.code = ? AND pr.used = 0
         ORDER BY pr.created_at DESC LIMIT 1`,
        [cleanEmail, String(code).trim()]
      );
      if (!rows.length) {
        return res.status(400).json({ success: false, message: 'Invalid code' });
      }
      record = rows[0];
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Code has expired. Please request a new one.',
      });
    }

    return res.json({
      success: true,
      message: 'Code verified',
      token:   record.token,
      email:   record.email,
    });
  } catch (err) {
    console.error('[VerifyReset] ERROR:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  RESET PASSWORD
// ═══════════════════════════════════════════════════════════════════
exports.resetPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password required',
      });
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    const [rows] = await db.query(
      `SELECT pr.*, u.email, u.full_name FROM password_resets pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.token = ? AND pr.used = 0
       ORDER BY pr.created_at DESC LIMIT 1`,
      [token]
    );

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or used reset link',
      });
    }

    const record = rows[0];

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Link expired. Request a new one.',
      });
    }

    const hash = await bcrypt.hash(String(new_password), 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, record.user_id]);
    await db.query('UPDATE password_resets SET used = 1 WHERE id = ?', [record.id]);

    console.log(`✅ [PasswordReset] Password changed for: ${record.email}`);

    // Send confirmation email (non-blocking, best-effort)
    sendMailWithRetry({
      from:    `"FindIt Security" <${process.env.EMAIL_USER}>`,
      to:      record.email,
      subject: '✅ Your FindIt Password Was Changed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px;
                    margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981, #3b82f6);
                      padding: 30px; border-radius: 20px;
                      text-align: center; color: white;">
            <h1 style="margin: 0;">✅ Password Changed</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px;
                      border-radius: 20px; margin-top: 20px;">
            <p style="color: #374151;">Hi ${record.full_name || 'there'},</p>
            <p style="color: #6b7280;">
              Your FindIt password was changed on
              <strong>${new Date().toLocaleString()}</strong>.
            </p>
            <p style="color: #ef4444; font-size: 13px; margin-top: 20px;">
              ⚠️ If you didn't do this, please contact support immediately.
            </p>
          </div>
        </div>
      `,
    }).catch(e => console.warn('[PasswordReset] Confirmation email failed:', e.message));

    return res.json({
      success: true,
      message: 'Password reset successfully! You can now log in.',
      email:   record.email,
    });
  } catch (err) {
    console.error('[ResetPassword] ERROR:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// Export verifyTransporter for use in server.js boot check
exports.verifyTransporter = verifyTransporter;