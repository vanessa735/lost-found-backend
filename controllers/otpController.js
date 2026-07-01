'use strict';

const nodemailer = require('nodemailer');

// In-memory OTP store (userId -> { code, expiresAt })
// For production, use Redis or DB
const otpStore = new Map();

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const getTransporter = () => nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─────────────────────────────────────────────
//  SEND OTP
// ─────────────────────────────────────────────
exports.sendOTP = async (req, res) => {
  try {
    const userId = req.user.id;
    const email  = req.user.email;
    const purpose = req.body.purpose || 'report';

    const code = generateCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(String(userId), { code, expiresAt, purpose });

    const transporter = getTransporter();

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

    console.log(`✅ OTP sent to ${email}: ${code}`);

    return res.json({
      success: true,
      message: `Verification code sent to ${email}`,
      expires_in: 600,
    });
  } catch (err) {
    console.error('[SendOTP]', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to send verification email. Please try again.',
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
    console.error('[VerifyOTP]', err.message);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
};