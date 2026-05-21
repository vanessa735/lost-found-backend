'use strict';

// ═══════════════════════════════════════════════════════════════════
//  TWILIO SERVICE
//  Fully safe — if credentials are missing or invalid, every
//  function returns { success: false } without throwing.
//  The rest of the app continues normally.
// ═══════════════════════════════════════════════════════════════════

let client      = null;
let fromNumber  = null;
let waFrom      = null;
let initialized = false;

const init = () => {
  if (initialized) return;
  initialized = true;

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  fromNumber  = process.env.TWILIO_PHONE_NUMBER   || null;
  waFrom      = process.env.TWILIO_WHATSAPP_FROM  || (fromNumber ? `whatsapp:${fromNumber}` : null);

  // Validate — Twilio SIDs always start with 'AC'
  if (!sid || !token || !sid.startsWith('AC') || !fromNumber) {
    console.warn(
      '[twilioService] Credentials missing or invalid — SMS/WhatsApp disabled.\n' +
      '  Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env'
    );
    return;
  }

  try {
    const twilio = require('twilio');
    client = twilio(sid, token);
    console.log('[twilioService] ✔ Twilio client ready');
  } catch (err) {
    console.error('[twilioService] Init error:', err.message);
    client = null;
  }
};

// ── Phone normalizer ──────────────────────────────────────────────
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const cleaned = phone.trim().replace(/[^\d+]/g, '');
  if (cleaned.length < 7) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
};

// ═══════════════════════════════════════════════════════════════════
//  sendSMS — never throws
// ═══════════════════════════════════════════════════════════════════
const sendSMS = async (to, body) => {
  init();

  if (!client)     return { success: false, error: 'Twilio not configured' };
  if (!fromNumber) return { success: false, error: 'TWILIO_PHONE_NUMBER not set' };

  const toNumber = normalizePhone(to);
  if (!toNumber)   return { success: false, error: 'Invalid phone number' };

  try {
    const msg = await client.messages.create({
      body,
      from: fromNumber,
      to:   toNumber,
    });
    console.log('[twilioService] SMS sent:', msg.sid);
    return { success: true, sid: msg.sid };
  } catch (err) {
    // Log but NEVER re-throw — SMS failure must not crash item creation
    console.error('[twilioService] SMS error:', err.message);
    return { success: false, error: err.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
//  sendWhatsApp — never throws
// ═══════════════════════════════════════════════════════════════════
const sendWhatsApp = async (to, body) => {
  init();

  if (!client) return { success: false, error: 'Twilio not configured' };
  if (!waFrom) return { success: false, error: 'TWILIO_WHATSAPP_FROM not set' };

  const phone = normalizePhone(to);
  if (!phone)  return { success: false, error: 'Invalid phone number' };

  const toWA = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;

  try {
    const msg = await client.messages.create({
      body,
      from: waFrom,
      to:   toWA,
    });
    console.log('[twilioService] WhatsApp sent:', msg.sid);
    return { success: true, sid: msg.sid };
  } catch (err) {
    // Log but NEVER re-throw
    console.error('[twilioService] WhatsApp error:', err.message);
    return { success: false, error: err.message };
  }
};

module.exports = { sendSMS, sendWhatsApp };