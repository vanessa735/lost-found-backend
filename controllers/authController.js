"use strict";
const db     = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const path   = require("path");

const generateToken = (id, email) =>
    jwt.sign({ id, email }, process.env.JWT_SECRET || "fallback_secret", { expiresIn: "7d" });

// ─── REGISTER ───
exports.register = async (req, res) => {
    try {
        const { full_name, email, password, phone, country, city,
                preferred_language, user_type, organization_name } = req.body;

        if (!full_name || !email || !password)
            return res.status(400).json({ success: false, message: "full_name, email, and password are required" });

        const name = String(full_name).trim();
        const mail = String(email).trim().toLowerCase();
        const pass = String(password);

        if (name.length < 2) return res.status(400).json({ success: false, message: "Name must be at least 2 characters" });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ success: false, message: "Invalid email" });
        if (pass.length < 6) return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });

        const types = ["individual", "police", "organization", "admin"];
        const utype = types.includes(user_type) ? user_type : "individual";

        const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [mail]);
        if (existing.length > 0) return res.status(400).json({ success: false, message: "Email already registered" });

        const hash = await bcrypt.hash(pass, 10);
        const [result] = await db.query(
            `INSERT INTO users (full_name, email, password, phone, country, city,
             preferred_language, user_type, organization_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, mail, hash, phone||null, country||null, city||null,
             preferred_language||"en", utype, organization_name||null]
        );

        const token = generateToken(result.insertId, mail);
        console.log("✅ Registered:", mail);

        return res.status(201).json({
            success: true, message: "Registration successful!", token,
            data: { id: result.insertId, full_name: name, email: mail, phone: phone||null,
                    country: country||null, city: city||null, preferred_language: preferred_language||"en",
                    user_type: utype, organization_name: organization_name||null, is_verified: 0 }
        });
    } catch (err) {
        console.error("Register error:", err.message);
        if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ success: false, message: "Email already registered" });
        return res.status(500).json({ success: false, message: err.message || "Server error" });
    }
};

// ─── LOGIN ───
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

        const mail = String(email).trim().toLowerCase();
        const [rows] = await db.query(
            `SELECT id, full_name, email, password, phone, profile_image, country, city,
                    preferred_language, user_type, organization_name, is_verified
             FROM users WHERE email=?`, [mail]
        );
        if (!rows.length) return res.status(401).json({ success: false, message: "Invalid email or password" });

        const user = rows[0];
        const ok = await bcrypt.compare(String(password), user.password);
        if (!ok) return res.status(401).json({ success: false, message: "Invalid email or password" });

        const token = generateToken(user.id, user.email);
        console.log("✅ Login:", mail);
        const { password: _, ...safe } = user;
        return res.json({ success: true, message: "Login successful!", token, data: safe });
    } catch (err) {
        console.error("Login error:", err.message);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ─── GOOGLE LOGIN ───
exports.googleLogin = async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) return res.status(400).json({ success: false, message: "Google credential required" });

        const parts = credential.split('.');
        if (parts.length !== 3) return res.status(400).json({ success: false, message: "Invalid token" });

        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString());
        const { email, name, picture } = payload;
        if (!email) return res.status(400).json({ success: false, message: "No email from Google" });

        const cleanEmail = email.toLowerCase();
        const [existing] = await db.query("SELECT * FROM users WHERE email = ?", [cleanEmail]);

        let userId, isNew = false;
        if (existing.length > 0) {
            userId = existing[0].id;
            if (picture && !existing[0].profile_image)
                await db.query("UPDATE users SET profile_image = ? WHERE id = ?", [picture, userId]);
        } else {
            const crypto = require('crypto');
            const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
            const [result] = await db.query(
                `INSERT INTO users (full_name, email, password, profile_image, is_verified) VALUES (?, ?, ?, ?, 1)`,
                [name || 'Google User', cleanEmail, hash, picture || null]
            );
            userId = result.insertId;
            isNew = true;
        }

        const [userData] = await db.query(
            `SELECT id, full_name, email, phone, profile_image, country, city,
                    preferred_language, user_type, organization_name, is_verified
             FROM users WHERE id = ?`, [userId]
        );

        const token = generateToken(userId, cleanEmail);
        console.log(`✅ Google ${isNew ? 'register' : 'login'}: ${cleanEmail}`);
        return res.json({ success: true, message: isNew ? "Account created!" : "Login successful!", token, data: userData[0] });
    } catch (err) {
        console.error("Google login error:", err);
        return res.status(500).json({ success: false, message: "Google auth failed" });
    }
};

// ─── GET ME ───
exports.getMe = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, full_name, email, phone, profile_image, country, city, preferred_language,
                    user_type, organization_name, is_verified, notifications_email, notifications_sms,
                    notifications_whatsapp, privacy_public, privacy_show_phone, created_at
             FROM users WHERE id=?`, [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: "User not found" });

        const [lost] = await db.query("SELECT COUNT(*) as c FROM items WHERE user_id=? AND type='lost'", [req.user.id]);
        const [found] = await db.query("SELECT COUNT(*) as c FROM items WHERE user_id=? AND type='found'", [req.user.id]);
        const [match] = await db.query(
            `SELECT COUNT(*) as c FROM matches m JOIN items i ON (m.lost_item_id=i.id OR m.found_item_id=i.id)
             WHERE i.user_id=? AND m.status='confirmed'`, [req.user.id]
        );

        return res.json({
            success: true,
            data: { ...rows[0], stats: { lost_items: lost[0].c, found_items: found[0].c, successful_matches: match[0].c } }
        });
    } catch (err) {
        console.error("GetMe error:", err.message);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ─── UPDATE PROFILE ───
exports.updateProfile = async (req, res) => {
    try {
        const { full_name, phone, country, city, preferred_language, organization_name,
                notifications_email, notifications_sms, notifications_whatsapp,
                privacy_public, privacy_show_phone } = req.body;

        const [existing] = await db.query("SELECT * FROM users WHERE id=?", [req.user.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: "User not found" });

        const e = existing[0];

        await db.query(
            `UPDATE users SET full_name=?, phone=?, country=?, city=?, preferred_language=?,
             organization_name=?, notifications_email=?, notifications_sms=?,
             notifications_whatsapp=?, privacy_public=?, privacy_show_phone=? WHERE id=?`,
            [full_name??e.full_name, phone??e.phone, country??e.country, city??e.city,
             preferred_language??e.preferred_language, organization_name??e.organization_name,
             notifications_email??e.notifications_email, notifications_sms??e.notifications_sms,
             notifications_whatsapp??e.notifications_whatsapp, privacy_public??e.privacy_public,
             privacy_show_phone??e.privacy_show_phone, req.user.id]
        );

        const [updated] = await db.query(
            `SELECT id, full_name, email, phone, profile_image, country, city, preferred_language,
                    user_type, organization_name, is_verified, created_at FROM users WHERE id=?`, [req.user.id]
        );

        return res.json({ success: true, message: "Profile updated", data: updated[0] });
    } catch (err) {
        console.error("UpdateProfile error:", err.message);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ─── UPLOAD PROFILE IMAGE ───
exports.uploadProfileImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No image file provided" });
        }

        const imageUrl = `/uploads/${req.file.filename}`;

        await db.query(
            "UPDATE users SET profile_image = ? WHERE id = ?",
            [imageUrl, req.user.id]
        );

        console.log("✅ Profile image uploaded for user:", req.user.id);

        return res.json({
            success: true,
            message: "Profile image uploaded successfully",
            data: { profile_image: imageUrl }
        });
    } catch (err) {
        console.error("Upload image error:", err.message);
        return res.status(500).json({ success: false, message: "Failed to upload image" });
    }
};

// ─── CHANGE PASSWORD ───
exports.changePassword = async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) return res.status(400).json({ success: false, message: "Both passwords required" });
        if (String(new_password).length < 6) return res.status(400).json({ success: false, message: "Min 6 characters" });

        const [rows] = await db.query("SELECT password FROM users WHERE id=?", [req.user.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "User not found" });

        const ok = await bcrypt.compare(String(current_password), rows[0].password);
        if (!ok) return res.status(401).json({ success: false, message: "Current password incorrect" });

        const hash = await bcrypt.hash(String(new_password), 10);
        await db.query("UPDATE users SET password=? WHERE id=?", [hash, req.user.id]);
        return res.json({ success: true, message: "Password changed" });
    } catch (err) {
        console.error("ChangePassword error:", err.message);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};