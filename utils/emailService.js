const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Send email
const sendEmail = async (to, subject, html, text = '') => {
    try {
        const mailOptions = {
            from: `"Lost & Found App" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
            text
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Email send error:', error);
        return { success: false, error: error.message };
    }
};

// Send item submission confirmation
const sendItemSubmissionNotification = async (userEmail, userName, itemTitle, itemType) => {
    const subject = `Item Report Submitted - ${itemTitle}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Item Report Submitted Successfully</h2>
            <p>Dear ${userName},</p>
            <p>Your ${itemType} item report for "<strong>${itemTitle}</strong>" has been submitted successfully.</p>
            <p>We'll notify you immediately if we find any matches or if someone reports finding your item.</p>
            <p>Thank you for using our Lost & Found service!</p>
            <br>
            <p>Best regards,<br>Lost & Found Team</p>
        </div>
    `;

    return await sendEmail(userEmail, subject, html);
};

// Send match found notification
const sendMatchFoundNotification = async (userEmail, userName, itemTitle, itemType, matchType) => {
    const subject = `Potential Match Found - ${itemTitle}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #28a745;">Potential Match Found!</h2>
            <p>Dear ${userName},</p>
            <p>Great news! We've found a potential match for your ${itemType} item "<strong>${itemTitle}</strong>".</p>
            <p>Please check your dashboard to view the details and contact the other party.</p>
            <p>Don't forget to verify the item details before meeting anyone.</p>
            <br>
            <p>Best regards,<br>Lost & Found Team</p>
        </div>
    `;

    return await sendEmail(userEmail, subject, html);
};

// Send item recovered notification
const sendItemRecoveredNotification = async (userEmail, userName, itemTitle) => {
    const subject = `Item Recovered - ${itemTitle}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #28a745;">Item Recovered!</h2>
            <p>Dear ${userName},</p>
            <p>Congratulations! Your lost item "<strong>${itemTitle}</strong>" has been recovered.</p>
            <p>Please check your dashboard for more details and arrange to pick up your item.</p>
            <br>
            <p>Best regards,<br>Lost & Found Team</p>
        </div>
    `;

    return await sendEmail(userEmail, subject, html);
};

module.exports = {
    sendEmail,
    sendItemSubmissionNotification,
    sendMatchFoundNotification,
    sendItemRecoveredNotification
};