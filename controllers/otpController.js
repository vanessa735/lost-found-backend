'use strict';

const nodemailer = require('nodemailer');

// In-memory OTP store
const otpStore = new Map();

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const getTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('[OTP] EMAIL_USER or EMAIL_PASS missing from environment!');
    return null;
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// ─────────────────────────────────────────────
//  SEND OTP
// ─────────────────────────────────────────────
exports.sendOTP = async (req, res) => {
  try {
    console.log('[OTP] sendOTP called by user:', req.user?.id, req.user?.email);

    if (!req.user || !req.user.id || !req.user.email) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userId  = req.user.id;
    const email   = req.user.email;
    const purpose = req.body.purpose || 'report';

    const code      = generateCode();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    otpStore.set(String(userId), { code, expiresAt, purpose });

    const transporter = getTransporter();

    if (!transporter) {
      return res.status(500).json({
        success: false,
        message: 'Email service not configured on server',
      });
    }

    try {
      await transporter.sendMail({
        from: `"FindIt" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🔐 Your FindIt Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #3b82f6, #10b981); padding: 30px; border-radius: 20px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 26px;">🔍 FindIt</h1>
              <p style="margin: 8px 0 0; opacity: 0.9;">Email Verification</p>
            </div>
            <div style="background: #f9fafb; padding: 30px; border-radius: 20px; margin-top: 20px; text-align: center;">
              <p style="color: #374151; font-size: 15px;">Hi ${req.user.full_name || 'there'}!</p>
              <p style="color: #6b7280;">Use the code below to confirm your report submission:</p>
              <div style="background: white; border: 2px dashed #3b82f6; padding: 20px; border-radius: 15px; margin: 20px 0;">
                <div style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #3b82f6;">${code}</div>
              </div>
              <p style="color: #9ca3af; font-size: 13px;">This code expires in 10 minutes.</p>
              <p style="color: #ef4444; font-size: 12px;">If you didn't request this, please ignore this email.</p>
            </div>
            <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
              © ${new Date().getFullYear()} FindIt — Lost & Found Platform
            </p>
          </div>
        `,
      });
      console.log(`✅ [OTP] Sent to ${email}: ${code}`);
    } catch (emailErr) {
      console.error('[OTP] Email send failed:', emailErr.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please check your email settings.',
      });
    }

    return res.json({
      success: true,
      message: `Verification code sent to ${email}`,
      expires_in: 600,
    });
  } catch (err) {
    console.error('[OTP:sendOTP] ERROR:', err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to send code',
    });
  }
};

// ─────────────────────────────────────────────
//  VERIFY OTP
// ─────────────────────────────────────────────
exports.verifyOTP = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Code is required' });
    }

    const record = otpStore.get(userId);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'No verification code found. Please request a new one.',
      });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(userId);
      return res.status(400).json({
        success: false,
        message: 'Code expired. Please request a new one.',
      });
    }

    if (String(code).trim() !== record.code) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code',
      });
    }

    otpStore.delete(userId);

    return res.json({
      success: true,
      message: 'Verified successfully',
      verification_token: Buffer.from(`${userId}:${Date.now()}`).toString('base64'),
    });
  } catch (err) {
    console.error('[OTP:verifyOTP] ERROR:', err.message);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
};