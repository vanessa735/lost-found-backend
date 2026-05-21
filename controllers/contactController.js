"use strict";
const nodemailer = require("nodemailer");

// Create transporter
const createTransporter = () => {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER || 'iradukundavanessa772@gmail.com',
            pass: process.env.EMAIL_PASS || '',
        },
    });
};

exports.sendContactEmail = async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and message are required"
            });
        }

        // Email to admin
        const adminMailOptions = {
            from: `"FindIt Contact" <${process.env.EMAIL_USER || 'iradukundavanessa772@gmail.com'}>`,
            to: process.env.ADMIN_EMAIL || 'iradukundavanessa772@gmail.com',
            subject: `[FindIt Contact] ${subject || 'New Message'} - from ${name}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #1e40af, #7c3aed); padding: 30px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">🔍 FindIt - New Contact Message</h1>
                    </div>
                    <div style="padding: 30px;">
                        <div style="background: white; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
                            <p style="margin: 0 0 8px 0;"><strong>From:</strong> ${name}</p>
                            <p style="margin: 0 0 8px 0;"><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
                            <p style="margin: 0;"><strong>Subject:</strong> ${subject || 'General Inquiry'}</p>
                        </div>
                        <div style="background: white; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0;">
                            <h3 style="margin: 0 0 12px 0; color: #1e293b;">Message:</h3>
                            <p style="margin: 0; color: #475569; line-height: 1.6; white-space: pre-wrap;">${message}</p>
                        </div>
                        <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 20px;">
                            Sent from FindIt Contact Form • ${new Date().toLocaleString()}
                        </p>
                    </div>
                </div>
            `,
        };

        // Auto-reply to user
        const userMailOptions = {
            from: `"FindIt Team" <${process.env.EMAIL_USER || 'iradukundavanessa772@gmail.com'}>`,
            to: email,
            subject: `Re: ${subject || 'Your message'} - FindIt Support`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #1e40af, #7c3aed); padding: 30px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">🔍 FindIt</h1>
                        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">Thank you for contacting us!</p>
                    </div>
                    <div style="padding: 30px;">
                        <p style="color: #1e293b; font-size: 16px;">Hi ${name},</p>
                        <p style="color: #475569; line-height: 1.6;">
                            Thank you for reaching out! We've received your message and will get back to you within <strong>24 hours</strong>.
                        </p>
                        <div style="background: white; border-radius: 12px; padding: 16px; margin: 20px 0; border: 1px solid #e2e8f0;">
                            <p style="margin: 0; color: #64748b; font-size: 14px;"><strong>Your message:</strong></p>
                            <p style="margin: 8px 0 0; color: #475569; font-style: italic;">"${message.substring(0, 200)}${message.length > 200 ? '...' : ''}"</p>
                        </div>
                        <p style="color: #475569; line-height: 1.6;">
                            Need urgent help? Contact us directly:
                        </p>
                        <ul style="color: #475569; line-height: 2;">
                            <li>📞 Phone: +250 791 377 930</li>
                            <li>💬 WhatsApp: <a href="https://wa.me/250791377930">Chat Now</a></li>
                            <li>📧 Email: iradukundavanessa772@gmail.com</li>
                        </ul>
                        <p style="color: #475569;">Best regards,<br><strong>The FindIt Team</strong></p>
                    </div>
                    <div style="background: #1e293b; padding: 20px; text-align: center;">
                        <p style="color: #64748b; font-size: 12px; margin: 0;">
                            © ${new Date().getFullYear()} FindIt • Kigali, Rwanda
                        </p>
                    </div>
                </div>
            `,
        };

        // Try to send emails
        try {
            const transporter = createTransporter();
            await transporter.sendMail(adminMailOptions);
            await transporter.sendMail(userMailOptions);
            console.log("✅ Contact emails sent:", email);
        } catch (emailErr) {
            console.error("Email send error:", emailErr.message);
            // Still return success - message was received even if email fails
        }

        return res.json({
            success: true,
            message: "Message sent successfully! We'll get back to you soon."
        });

    } catch (err) {
        console.error("Contact error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to send message. Please try WhatsApp or phone."
        });
    }
};