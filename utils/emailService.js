'use strict';

const nodemailer = require('nodemailer');

// ═══════════════════════════════════════════════════════════════════
//  TRANSPORTER
//  Lazy-initialised — if SMTP env vars are missing we skip silently
//  instead of crashing the whole server.
// ═══════════════════════════════════════════════════════════════════
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);

  if (!user || !pass) {
    console.warn('[emailService] SMTP credentials not set — emails disabled');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // Prevent unhandled promise rejections from crashing the server
    socketTimeout: 10_000,
    connectionTimeout: 10_000,
  });

  return transporter;
};

// ═══════════════════════════════════════════════════════════════════
//  BASE SEND — never throws, always returns { success, ... }
// ═══════════════════════════════════════════════════════════════════
const sendEmail = async (to, subject, html, text = '') => {
  const t = getTransporter();
  if (!t) return { success: false, error: 'SMTP not configured' };

  try {
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const info = await t.sendMail({
      from:    `"FindIt Lost & Found" <${user}>`,
      to,
      subject,
      html,
      text,
    });
    console.log('[emailService] Sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    // Log but NEVER re-throw — email failure must not crash item creation
    console.error('[emailService] Send error:', err.message);
    return { success: false, error: err.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATES
// ═══════════════════════════════════════════════════════════════════
const BASE_STYLE = `
  font-family: Arial, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  padding: 24px;
  background: #f9fafb;
  border-radius: 12px;
`;

const sendItemSubmissionNotification = async (
  userEmail, userName, itemTitle, itemType
) => {
  if (!userEmail) return { success: false, error: 'No email provided' };

  const subject = `✅ Item Report Submitted — ${itemTitle}`;
  const html = `
    <div style="${BASE_STYLE}">
      <h2 style="color:#1d4ed8;">Item Report Submitted</h2>
      <p>Hi <strong>${userName}</strong>,</p>
      <p>
        Your <strong>${itemType}</strong> item report for
        "<strong>${itemTitle}</strong>" has been submitted successfully.
      </p>
      <p>
        We will notify you as soon as we find a potential match.
        Thank you for using FindIt!
      </p>
      <br/>
      <p style="color:#6b7280;font-size:13px;">— The FindIt Team</p>
    </div>
  `;

  return sendEmail(userEmail, subject, html);
};

const sendMatchFoundNotification = async (
  userEmail, userName, itemTitle, itemType, _matchType
) => {
  if (!userEmail) return { success: false, error: 'No email provided' };

  const subject = `🔗 Potential Match Found — ${itemTitle}`;
  const html = `
    <div style="${BASE_STYLE}">
      <h2 style="color:#16a34a;">Potential Match Found!</h2>
      <p>Hi <strong>${userName}</strong>,</p>
      <p>
        We found a potential match for your <strong>${itemType}</strong> item
        "<strong>${itemTitle}</strong>".
      </p>
      <p>
        Please log in to your FindIt dashboard to view the details
        and get in touch with the other party safely.
      </p>
      <br/>
      <p style="color:#6b7280;font-size:13px;">— The FindIt Team</p>
    </div>
  `;

  return sendEmail(userEmail, subject, html);
};

const sendItemRecoveredNotification = async (
  userEmail, userName, itemTitle
) => {
  if (!userEmail) return { success: false, error: 'No email provided' };

  const subject = `🎉 Item Recovered — ${itemTitle}`;
  const html = `
    <div style="${BASE_STYLE}">
      <h2 style="color:#16a34a;">Item Recovered!</h2>
      <p>Hi <strong>${userName}</strong>,</p>
      <p>
        Congratulations! Your lost item
        "<strong>${itemTitle}</strong>" has been recovered.
      </p>
      <p>
        Please check your FindIt dashboard to arrange collection.
      </p>
      <br/>
      <p style="color:#6b7280;font-size:13px;">— The FindIt Team</p>
    </div>
  `;

  return sendEmail(userEmail, subject, html);
};

module.exports = {
  sendEmail,
  sendItemSubmissionNotification,
  sendMatchFoundNotification,
  sendItemRecoveredNotification,
};