'use strict';

const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────
const generateToken = (id, email) =>
    jwt.sign(
        { id, email },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '7d' }
    );

const safeUser = (u) => {
    const { password, ...rest } = u;
    return rest;
};

// ─────────────────────────────────────────────────────────────────
//  REGISTER
// ─────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
    try {
        const {
            full_name, email, password, phone,
            country, city, preferred_language,
            user_type, organization_name,
        } = req.body;

        // ── Validation ────────────────────────────────────────────
        if (!full_name || !email || !password)
            return res.status(400).json({
                success: false,
                message: 'full_name, email, and password are required',
            });

        const name = String(full_name).trim();
        const mail = String(email).trim().toLowerCase();
        const pass = String(password);

        if (name.length < 2)
            return res.status(400).json({ success: false, message: 'Name must be at least 2 characters' });

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))
            return res.status(400).json({ success: false, message: 'Invalid email address' });

        if (pass.length < 6)
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

        const VALID_TYPES = ['individual', 'police', 'organization', 'admin'];
        const utype       = VALID_TYPES.includes(user_type) ? user_type : 'individual';

        // ── Duplicate check ───────────────────────────────────────
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [mail]);
        if (existing.length > 0)
            return res.status(400).json({ success: false, message: 'Email already registered' });

        // ── Insert ────────────────────────────────────────────────
        const hash     = await bcrypt.hash(pass, 10);
        const [result] = await db.query(
            `INSERT INTO users
                (full_name, email, password, phone, country, city,
                 preferred_language, user_type, organization_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name, mail, hash,
                phone             || null,
                country           || null,
                city              || null,
                preferred_language || 'en',
                utype,
                organization_name || null,
            ]
        );

        const token = generateToken(result.insertId, mail);
        console.log('✅ Registered:', mail);

        return res.status(201).json({
            success: true,
            message: 'Registration successful!',
            token,
            data: {
                id:                result.insertId,
                full_name:         name,
                email:             mail,
                phone:             phone             || null,
                country:           country           || null,
                city:              city              || null,
                preferred_language: preferred_language || 'en',
                user_type:         utype,
                organization_name: organization_name || null,
                is_verified:       0,
            },
        });
    } catch (err) {
        console.error('[Register]', err.message);
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(400).json({ success: false, message: 'Email already registered' });
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
};

// ─────────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ success: false, message: 'Email and password required' });

        const mail    = String(email).trim().toLowerCase();
        const [rows]  = await db.query(
            `SELECT id, full_name, email, password, phone, profile_image,
                    country, city, preferred_language, user_type,
                    organization_name, is_verified
             FROM users WHERE email = ?`,
            [mail]
        );

        if (!rows.length)
            return res.status(401).json({ success: false, message: 'Invalid email or password' });

        const user = rows[0];
        const ok   = await bcrypt.compare(String(password), user.password);
        if (!ok)
            return res.status(401).json({ success: false, message: 'Invalid email or password' });

        const token = generateToken(user.id, user.email);
        console.log('✅ Login:', mail);

        return res.json({
            success: true,
            message: 'Login successful!',
            token,
            data:    safeUser(user),
        });
    } catch (err) {
        console.error('[Login]', err.message);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─────────────────────────────────────────────────────────────────
//  GOOGLE LOGIN
// ─────────────────────────────────────────────────────────────────
exports.googleLogin = async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential)
            return res.status(400).json({ success: false, message: 'Google credential required' });

        // ── Decode JWT payload (no verification — Google already verified it) ──
        const parts = credential.split('.');
        if (parts.length !== 3)
            return res.status(400).json({ success: false, message: 'Invalid token format' });

        const base64  = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        const { email, name, picture } = payload;

        if (!email)
            return res.status(400).json({ success: false, message: 'No email in Google token' });

        const cleanEmail = email.toLowerCase();
        const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);

        let userId;
        let isNew = false;

        if (existing.length > 0) {
            userId = existing[0].id;
            // Update avatar if none stored yet
            if (picture && !existing[0].profile_image) {
                await db.query('UPDATE users SET profile_image = ? WHERE id = ?', [picture, userId]);
            }
        } else {
            const crypto = require('crypto');
            const hash   = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
            const [ins]  = await db.query(
                `INSERT INTO users (full_name, email, password, profile_image, is_verified)
                 VALUES (?, ?, ?, ?, 1)`,
                [name || 'Google User', cleanEmail, hash, picture || null]
            );
            userId = ins.insertId;
            isNew  = true;
        }

        const [userData] = await db.query(
            `SELECT id, full_name, email, phone, profile_image, country, city,
                    preferred_language, user_type, organization_name, is_verified
             FROM users WHERE id = ?`,
            [userId]
        );

        const token = generateToken(userId, cleanEmail);
        console.log(`✅ Google ${isNew ? 'register' : 'login'}: ${cleanEmail}`);

        return res.json({
            success: true,
            message: isNew ? 'Account created!' : 'Login successful!',
            token,
            data:    userData[0],
        });
    } catch (err) {
        console.error('[GoogleLogin]', err);
        return res.status(500).json({ success: false, message: 'Google authentication failed' });
    }
};

// ─────────────────────────────────────────────────────────────────
//  GET ME
// ─────────────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, full_name, email, phone, profile_image, country, city,
                    preferred_language, user_type, organization_name, is_verified,
                    notifications_email, notifications_sms, notifications_whatsapp,
                    privacy_public, privacy_show_phone, created_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        if (!rows.length)
            return res.status(404).json({ success: false, message: 'User not found' });

        // ── Activity stats ────────────────────────────────────────
        const [[{ c: lostCount }]]  = await db.query(
            "SELECT COUNT(*) AS c FROM items WHERE user_id = ? AND type = 'lost'",
            [req.user.id]
        );
        const [[{ c: foundCount }]] = await db.query(
            "SELECT COUNT(*) AS c FROM items WHERE user_id = ? AND type = 'found'",
            [req.user.id]
        );
        const [[{ c: matchCount }]] = await db.query(
            `SELECT COUNT(*) AS c FROM matches m
             JOIN items i ON (m.lost_item_id = i.id OR m.found_item_id = i.id)
             WHERE i.user_id = ? AND m.status = 'confirmed'`,
            [req.user.id]
        );

        return res.json({
            success: true,
            data: {
                ...rows[0],
                stats: {
                    lost_items:        lostCount,
                    found_items:       foundCount,
                    successful_matches: matchCount,
                },
            },
        });
    } catch (err) {
        console.error('[GetMe]', err.message);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─────────────────────────────────────────────────────────────────
//  UPDATE PROFILE
// ─────────────────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
    try {
        const {
            full_name, phone, country, city,
            preferred_language, organization_name,
            notifications_email, notifications_sms, notifications_whatsapp,
            privacy_public, privacy_show_phone,
        } = req.body;

        const [existing] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!existing.length)
            return res.status(404).json({ success: false, message: 'User not found' });

        const e = existing[0];

        await db.query(
            `UPDATE users SET
                full_name             = ?,
                phone                 = ?,
                country               = ?,
                city                  = ?,
                preferred_language    = ?,
                organization_name     = ?,
                notifications_email   = ?,
                notifications_sms     = ?,
                notifications_whatsapp = ?,
                privacy_public        = ?,
                privacy_show_phone    = ?
             WHERE id = ?`,
            [
                full_name              ?? e.full_name,
                phone                  ?? e.phone,
                country                ?? e.country,
                city                   ?? e.city,
                preferred_language     ?? e.preferred_language,
                organization_name      ?? e.organization_name,
                notifications_email    ?? e.notifications_email,
                notifications_sms      ?? e.notifications_sms,
                notifications_whatsapp ?? e.notifications_whatsapp,
                privacy_public         ?? e.privacy_public,
                privacy_show_phone     ?? e.privacy_show_phone,
                req.user.id,
            ]
        );

        const [updated] = await db.query(
            `SELECT id, full_name, email, phone, profile_image, country, city,
                    preferred_language, user_type, organization_name, is_verified, created_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        return res.json({ success: true, message: 'Profile updated successfully', data: updated[0] });
    } catch (err) {
        console.error('[UpdateProfile]', err.message);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─────────────────────────────────────────────────────────────────
//  UPLOAD PROFILE IMAGE
// ─────────────────────────────────────────────────────────────────
exports.uploadProfileImage = async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ success: false, message: 'No image file provided' });

        const imageUrl = `/uploads/${req.file.filename}`;

        await db.query('UPDATE users SET profile_image = ? WHERE id = ?', [imageUrl, req.user.id]);

        console.log('✅ Avatar uploaded for user:', req.user.id);

        return res.json({
            success: true,
            message: 'Profile image uploaded successfully',
            data:    { profile_image: imageUrl },
        });
    } catch (err) {
        console.error('[UploadAvatar]', err.message);
        return res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
};

// ─────────────────────────────────────────────────────────────────
//  CHANGE PASSWORD
// ─────────────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password)
            return res.status(400).json({ success: false, message: 'Both passwords are required' });

        if (String(new_password).length < 6)
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });

        const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
        if (!rows.length)
            return res.status(404).json({ success: false, message: 'User not found' });

        const ok = await bcrypt.compare(String(current_password), rows[0].password);
        if (!ok)
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });

        const hash = await bcrypt.hash(String(new_password), 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id]);

        console.log('✅ Password changed for user:', req.user.id);
        return res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('[ChangePassword]', err.message);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─────────────────────────────────────────────────────────────────
//  GET ALL USERS  (for messaging — shows all registered users)
// ─────────────────────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT
                id,
                full_name,
                email,
                profile_image,
                user_type,
                country,
                city,
                created_at
             FROM users
             WHERE id != ?
             ORDER BY full_name ASC
             LIMIT 500`,
            [req.user.id]
        );

        const data = users.map(u => ({
            id:            u.id,
            name:          u.full_name || u.email.split('@')[0],
            email:         u.email,
            profile_image: u.profile_image || null,
            user_type:     u.user_type    || 'individual',
            country:       u.country      || null,
            city:          u.city         || null,
            joined_at:     u.created_at,
        }));

        return res.json({
            success: true,
            count:   data.length,
            data,
        });
    } catch (err) {
        console.error('[GetAllUsers]', err.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
};