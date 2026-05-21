const db = require('../config/db');
const emailService = require('../utils/emailService');
const twilioService = require('../utils/twilioService');

// @desc    Get matches for user
// @route   GET /api/matches
const getMyMatches = async (req, res) => {
    try {
        const [matches] = await db.query(
            `SELECT m.*, 
                    li.title as lost_title, li.document_number as lost_doc_number, 
                    li.image_url as lost_image, li.user_id as lost_user_id,
                    fi.title as found_title, fi.document_number as found_doc_number,
                    fi.image_url as found_image, fi.user_id as found_user_id,
                    lu.full_name as lost_reporter, lu.phone as lost_phone,
                    fu.full_name as found_reporter, fu.phone as found_phone
             FROM matches m
             JOIN items li ON m.lost_item_id = li.id
             JOIN items fi ON m.found_item_id = fi.id
             JOIN users lu ON li.user_id = lu.id
             JOIN users fu ON fi.user_id = fu.id
             WHERE li.user_id = ? OR fi.user_id = ?
             ORDER BY m.match_score DESC, m.created_at DESC`,
            [req.user.id, req.user.id]
        );

        res.json({
            success: true,
            data: matches
        });
    } catch (error) {
        console.error('Get matches error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Confirm match
// @route   PUT /api/matches/:id/confirm
const confirmMatch = async (req, res) => {
    try {
        const [matches] = await db.query(
            `SELECT m.*, li.user_id as lost_user_id, fi.user_id as found_user_id
             FROM matches m
             JOIN items li ON m.lost_item_id = li.id
             JOIN items fi ON m.found_item_id = fi.id
             WHERE m.id = ?`,
            [req.params.id]
        );

        if (matches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        const match = matches[0];
        const isLoser = req.user.id === match.lost_user_id;
        const isFinder = req.user.id === match.found_user_id;

        if (!isLoser && !isFinder) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        // Update confirmation
        if (isLoser) {
            await db.query(
                'UPDATE matches SET confirmed_by_loser = TRUE WHERE id = ?',
                [req.params.id]
            );
        }

        if (isFinder) {
            await db.query(
                'UPDATE matches SET confirmed_by_finder = TRUE WHERE id = ?',
                [req.params.id]
            );
        }

        // Check if both confirmed
        const [updatedMatch] = await db.query(
            'SELECT * FROM matches WHERE id = ?',
            [req.params.id]
        );

        if (updatedMatch[0].confirmed_by_loser && updatedMatch[0].confirmed_by_finder) {
            await db.query(
                "UPDATE matches SET status = 'confirmed' WHERE id = ?",
                [req.params.id]
            );

            // Update item statuses
            await db.query(
                "UPDATE items SET status = 'matched' WHERE id IN (?, ?)",
                [match.lost_item_id, match.found_item_id]
            );

            // Notify both users
            const otherUserId = isLoser ? match.found_user_id : match.lost_user_id;
            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_match_id)
                 VALUES (?, 'match_confirmed', 'Match Confirmed!', 'Both parties have confirmed the match. You can now arrange the return.', ?)`,
                [otherUserId, isLoser ? match.found_item_id : match.lost_item_id]
            );

            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_item_id)
                 VALUES (?, 'match_confirmed', 'Match Confirmed!', 'Both parties have confirmed the match. You can now arrange the return.', ?)`,
                [req.user.id, isLoser ? match.lost_item_id : match.found_item_id]
            );

            // Send email and phone notifications when match is confirmed
            try {
                const [users] = await db.query(
                    `SELECT id, full_name, email, phone
                     FROM users WHERE id IN (?, ?)`,
                    [match.lost_user_id, match.found_user_id]
                );

                for (const user of users) {
                    if (user.email) {
                        await emailService.sendMatchFoundNotification(
                            user.email,
                            user.full_name,
                            isLoser ? match.lost_title : match.found_title,
                            'match',
                            'match_confirmed'
                        );
                    }

                    if (user.phone) {
                        await twilioService.sendSMS(
                            user.phone,
                            'Your match has been confirmed. Please contact the other party to arrange return.'
                        );
                        await twilioService.sendWhatsApp(
                            user.phone,
                            'Your match has been confirmed. Please contact the other party to arrange return.'
                        );
                    }
                }
            } catch (err) {
                console.error('Match confirmation notification error:', err);
            }
        }

        res.json({
            success: true,
            message: 'Match confirmation updated'
        });
    } catch (error) {
        console.error('Confirm match error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Reject match
// @route   PUT /api/matches/:id/reject
const rejectMatch = async (req, res) => {
    try {
        await db.query(
            "UPDATE matches SET status = 'rejected' WHERE id = ?",
            [req.params.id]
        );

        res.json({
            success: true,
            message: 'Match rejected'
        });
    } catch (error) {
        console.error('Reject match error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Mark item as returned
// @route   PUT /api/matches/:id/returned
const markReturned = async (req, res) => {
    try {
        const [matches] = await db.query(
            `SELECT m.*, 
                    li.title as lost_title, li.user_id as lost_user_id,
                    fi.title as found_title, fi.user_id as found_user_id,
                    lu.full_name as lost_reporter_name, lu.email as lost_reporter_email, lu.phone as lost_reporter_phone,
                    fu.full_name as found_reporter_name, fu.email as found_reporter_email, fu.phone as found_reporter_phone
             FROM matches m
             JOIN items li ON m.lost_item_id = li.id
             JOIN items fi ON m.found_item_id = fi.id
             JOIN users lu ON li.user_id = lu.id
             JOIN users fu ON fi.user_id = fu.id
             WHERE m.id = ?`,
            [req.params.id]
        );

        if (matches.length === 0) {
            return res.status(404).json({ success: false, message: 'Match not found' });
        }

        const match = matches[0];

        await db.query(
            "UPDATE matches SET status = 'completed' WHERE id = ?",
            [req.params.id]
        );

        await db.query(
            "UPDATE items SET status = 'returned' WHERE id IN (?, ?)",
            [match.lost_item_id, match.found_item_id]
        );

        // Send notifications to both users
        await db.query(
            `INSERT INTO notifications (user_id, type, title, message, related_match_id)
             VALUES (?, 'item_returned', 'Item Successfully Returned!', ?, ?)`,
            [match.lost_user_id, `Your lost item "${match.lost_title}" has been successfully returned!`, match.lost_item_id]
        );

        await db.query(
            `INSERT INTO notifications (user_id, type, title, message, related_item_id)
             VALUES (?, 'item_returned', 'Item Successfully Returned!', ?, ?)`,
            [match.found_user_id, `The item "${match.found_title}" you found has been successfully returned to its owner!`, match.found_item_id]
        );

        // Send email notifications
        if (match.lost_reporter_email) {
            await emailService.sendItemRecoveredNotification(
                match.lost_reporter_email,
                match.lost_reporter_name,
                match.lost_title
            );
        }

        if (match.found_reporter_email) {
            await emailService.sendItemRecoveredNotification(
                match.found_reporter_email,
                match.found_reporter_name,
                match.found_title
            );
        }

        // Send SMS/WhatsApp notifications to both users if phone provided
        try {
            if (match.lost_reporter_phone) {
                await twilioService.sendSMS(
                    match.lost_reporter_phone,
                    `Your lost item "${match.lost_title}" has been returned to its owner.`
                );
                await twilioService.sendWhatsApp(
                    match.lost_reporter_phone,
                    `Your lost item "${match.lost_title}" has been returned to its owner.`
                );
            }

            if (match.found_reporter_phone) {
                await twilioService.sendSMS(
                    match.found_reporter_phone,
                    `The item "${match.found_title}" you found has been returned to its owner.`
                );
                await twilioService.sendWhatsApp(
                    match.found_reporter_phone,
                    `The item "${match.found_title}" you found has been returned to its owner.`
                );
            }
        } catch (err) {
            console.error('Return phone notification error:', err);
        }

        res.json({
            success: true,
            message: 'Item marked as returned successfully!'
        });
    } catch (error) {
        console.error('Mark returned error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

module.exports = { getMyMatches, confirmMatch, rejectMatch, markReturned };
