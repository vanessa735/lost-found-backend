const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER; // e.g. +1234567890
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM || `whatsapp:${fromNumber}`;

const normalizePhone = (phone) => {
    if (!phone || typeof phone !== 'string') return null;
    const cleaned = phone.trim().replace(/[^0-9+]/g, '');
    if (!cleaned) return null;
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
};

let client = null;
if (accountSid && authToken && accountSid.startsWith('AC')) {
    try {
        client = twilio(accountSid, authToken);
    } catch (err) {
        console.error('Twilio initialization error:', err);
        client = null;
    }
} else if (accountSid || authToken) {
    console.warn('Twilio configuration detected but invalid. Skipping Twilio client initialization.');
}

const sendSMS = async (to, body) => {
    if (!client) {
        console.warn('Twilio client not configured');
        return { success: false, error: 'Twilio not configured' };
    }

    const toNumber = normalizePhone(to);
    if (!toNumber) {
        return { success: false, error: 'Invalid phone number' };
    }

    try {
        const msg = await client.messages.create({
            body,
            from: fromNumber,
            to: toNumber
        });
        console.log('SMS sent:', msg.sid);
        return { success: true, sid: msg.sid };
    } catch (err) {
        console.error('SMS send error:', err);
        return { success: false, error: err.message };
    }
};

const sendWhatsApp = async (to, body) => {
    if (!client) {
        console.warn('Twilio client not configured');
        return { success: false, error: 'Twilio not configured' };
    }

    const phone = normalizePhone(to);
    if (!phone) {
        return { success: false, error: 'Invalid phone number' };
    }

    const whatsappTo = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;

    try {
        const msg = await client.messages.create({
            body,
            from: whatsappFrom,
            to: whatsappTo
        });
        console.log('WhatsApp sent:', msg.sid);
        return { success: true, sid: msg.sid };
    } catch (err) {
        console.error('WhatsApp send error:', err);
        return { success: false, error: err.message };
    }
};

module.exports = {
    sendSMS,
    sendWhatsApp
};
