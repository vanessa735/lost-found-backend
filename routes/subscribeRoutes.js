"use strict";

const express  = require("express");
const router   = express.Router();
const crypto   = require("crypto");
const db       = require("../config/db");
const nodemailer = require("nodemailer");

// ── Mailer setup ──────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// ── Helper: send verification email ──────────────────────────────
const sendVerificationEmail = async (email, token) => {
    const verifyURL =
        `${process.env.VITE_BACKEND_URL || "http://localhost:5001"}` +
        `/api/subscribe/verify?token=${token}&email=${encodeURIComponent(email)}`;

    await transporter.sendMail({
        from:    `"FindIt" <${process.env.EMAIL_USER}>`,
        to:      email,
        subject: "✅ Confirm your FindIt subscription",
        html: `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9fafb;border-radius:12px;">
                <h2 style="color:#1d4ed8;margin-bottom:8px;">FindIt Newsletter</h2>
                <p style="color:#374151;font-size:15px;line-height:1.6;">
                    Thanks for subscribing! Click the button below to confirm your email address.
                    This link is valid for <strong>24 hours</strong>.
                </p>
                <a href="${verifyURL}"
                   style="display:inline-block;margin-top:20px;padding:12px 28px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
                    Confirm Subscription
                </a>
                <p style="color:#9ca3af;font-size:12px;margin-top:28px;">
                    If you did not subscribe, ignore this email.
                </p>
            </div>
        `,
    });
};

// ══════════════════════════════════════════════════════════════════
//  POST /api/subscribe
//  Body: { email }
// ══════════════════════════════════════════════════════════════════
router.post("/", async (req, res) => {
    const { email } = req.body;

    // ── Validate ──────────────────────────────────────────────────
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid email address.",
        });
    }

    try {
        // ── Check if already subscribed ───────────────────────────
        const [existing] = await db.query(
            "SELECT id, verified FROM subscribers WHERE email = ?",
            [email]
        );

        if (existing.length > 0) {
            // Already verified → nothing to do
            if (existing[0].verified) {
                return res.status(200).json({
                    success:  true,
                    already:  true,
                    message:  "You are already subscribed and verified! 🎉",
                });
            }

            // Exists but not verified → resend verification
            const token = crypto.randomBytes(32).toString("hex");
            await db.query(
                "UPDATE subscribers SET token = ? WHERE email = ?",
                [token, email]
            );
            await sendVerificationEmail(email, token);

            return res.status(200).json({
                success: true,
                message: "Verification email resent. Please check your inbox.",
            });
        }

        // ── New subscriber ────────────────────────────────────────
        const token = crypto.randomBytes(32).toString("hex");

        await db.query(
            `INSERT INTO subscribers (email, verified, token, subscribed_at)
             VALUES (?, FALSE, ?, NOW())`,
            [email, token]
        );

        await sendVerificationEmail(email, token);

        return res.status(201).json({
            success: true,
            message: "Almost there! Check your inbox to confirm your subscription.",
        });

    } catch (err) {
        console.error("[subscribe] error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again.",
        });
    }
});

// ══════════════════════════════════════════════════════════════════
//  GET /api/subscribe/verify?token=xxx&email=xxx
//  Called from verification email link
// ══════════════════════════════════════════════════════════════════
router.get("/verify", async (req, res) => {
    const { token, email } = req.query;

    if (!token || !email) {
        return res.status(400).send(htmlPage(
            "❌ Invalid Link",
            "This verification link is missing required information.",
            "#ef4444"
        ));
    }

    try {
        const [rows] = await db.query(
            "SELECT id, verified FROM subscribers WHERE email = ? AND token = ?",
            [email, token]
        );

        if (rows.length === 0) {
            return res.status(404).send(htmlPage(
                "❌ Link Expired or Invalid",
                "This verification link is invalid or has already been used.",
                "#ef4444"
            ));
        }

        if (rows[0].verified) {
            return res.send(htmlPage(
                "✅ Already Verified",
                "Your email is already confirmed. You are all set!",
                "#10b981"
            ));
        }

        // ── Mark as verified ──────────────────────────────────────
        await db.query(
            `UPDATE subscribers
             SET verified = TRUE, token = NULL, verified_at = NOW()
             WHERE email = ?`,
            [email]
        );

        return res.send(htmlPage(
            "✅ Subscription Confirmed!",
            `<strong>${email}</strong> has been verified.<br/>
             You will now receive updates from FindIt. Welcome aboard! 🎉`,
            "#2563eb"
        ));

    } catch (err) {
        console.error("[verify] error:", err.message);
        return res.status(500).send(htmlPage(
            "❌ Server Error",
            "Something went wrong. Please try again later.",
            "#ef4444"
        ));
    }
});

// ══════════════════════════════════════════════════════════════════
//  GET /api/subscribe/check?email=xxx
//  Frontend can call this to check status without submitting
// ══════════════════════════════════════════════════════════════════
router.get("/check", async (req, res) => {
    const { email } = req.query;

    if (!email) {
        return res.status(400).json({ success: false, message: "Email required." });
    }

    try {
        const [rows] = await db.query(
            "SELECT verified FROM subscribers WHERE email = ?",
            [email]
        );

        if (rows.length === 0) {
            return res.json({ success: true, status: "not_subscribed" });
        }

        return res.json({
            success:  true,
            status:   rows[0].verified ? "verified" : "pending",
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

// ── HTML helper for verify page ───────────────────────────────────
const htmlPage = (title, body, color = "#2563eb") => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${title} — FindIt</title>
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:system-ui,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
        .card{background:#fff;border-radius:16px;padding:48px 40px;max-width:440px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
        .icon{font-size:3rem;margin-bottom:16px}
        h1{font-size:1.5rem;color:${color};margin-bottom:12px}
        p{color:#6b7280;font-size:0.95rem;line-height:1.6}
        a{display:inline-block;margin-top:24px;padding:10px 24px;background:${color};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem}
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">${color === "#ef4444" ? "❌" : "✅"}</div>
        <h1>${title}</h1>
        <p>${body}</p>
        <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}">
            Go to FindIt
        </a>
    </div>
</body>
</html>
`;

module.exports = router;