"use strict";
const jwt = require("jsonwebtoken");
const db  = require("../config/db");

const protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "No token provided" });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");

        const [rows] = await db.query(
            `SELECT id,full_name,email,phone,country,city,preferred_language,
                    user_type,organization_name,is_verified,profile_image
             FROM users WHERE id=?`, [decoded.id]
        );

        if (!rows.length) {
            return res.status(401).json({ success: false, message: "User not found" });
        }

        req.user = rows[0];
        return next();
    } catch (err) {
        console.error("Auth error:", err.message);
        return res.status(401).json({ success: false, message: "Not authorized" });
    }
};

const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");
            const [rows] = await db.query("SELECT id,full_name,email,user_type FROM users WHERE id=?", [decoded.id]);
            if (rows.length) req.user = rows[0];
        }
    } catch (_) {}
    return next();
};

module.exports = { protect, optionalAuth };