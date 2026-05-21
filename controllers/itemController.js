const db = require('../config/db');
const emailService = require('../utils/emailService');
const twilioService = require('../utils/twilioService');

// @desc    Create/Report lost or found item
// @route   POST /api/items
const createItem = async (req, res) => {
    try {
        const {
            category_id, type, title, description,
            document_number, owner_name_on_doc,
            country, city, specific_location,
            latitude, longitude,
            date_lost_found, time_lost_found,
            is_reward_offered, reward_amount,
            contact_method
        } = req.body;

        // Validate required fields
        if (!category_id || !type || !title) {
            return res.status(400).json({
                success: false,
                message: 'category_id, type, and title are required'
            });
        }

        if (!['lost', 'found'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'type must be either "lost" or "found"'
            });
        }

        // Handle image uploads
        let image_url = null, image_url_2 = null, image_url_3 = null;

        if (req.files) {
            if (req.files['image']?.[0])  image_url   = `/uploads/${req.files['image'][0].filename}`;
            if (req.files['image2']?.[0]) image_url_2 = `/uploads/${req.files['image2'][0].filename}`;
            if (req.files['image3']?.[0]) image_url_3 = `/uploads/${req.files['image3'][0].filename}`;
        }

        const [result] = await db.query(
            `INSERT INTO items 
             (user_id, category_id, type, title, description,
              document_number, owner_name_on_doc,
              country, city, specific_location,
              latitude, longitude,
              date_lost_found, time_lost_found,
              image_url, image_url_2, image_url_3,
              is_reward_offered, reward_amount, contact_method)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                category_id,
                type,
                title,
                description         || null,
                document_number     || null,
                owner_name_on_doc   || null,
                country             || null,
                city                || null,
                specific_location   || null,
                latitude            || null,
                longitude           || null,
                date_lost_found     || null,
                time_lost_found     || null,
                image_url,
                image_url_2,
                image_url_3,
                is_reward_offered   ? 1 : 0,
                reward_amount       || null,
                contact_method      || 'all'
            ]
        );

        const newItemId = result.insertId;

        // Get user details for notifications
        const [userDetails] = await db.query(
            `SELECT full_name, email, phone
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        const user = userDetails[0];

        // Create submission confirmation notification
        await db.query(
            `INSERT INTO notifications (user_id, type, title, message, related_item_id)
             VALUES (?, 'item_submitted', 'Item Report Submitted', ?, ?)`,
            [
                req.user.id,
                `Your ${type} item report "${title}" has been submitted successfully. We'll notify you if we find any matches.`,
                newItemId
            ]
        );

        // Send email notification
        if (user.email) {
            await emailService.sendItemSubmissionNotification(
                user.email,
                user.full_name,
                title,
                type
            );
        }

        // Send SMS/WhatsApp if phone contact is allowed
        try {
            const canSendPhone = user.phone && (contact_method === 'all' || contact_method === 'phone');
            if (canSendPhone) {
                await twilioService.sendSMS(
                    user.phone,
                    `Your ${type} item report "${title}" has been submitted successfully.`
                );
                await twilioService.sendWhatsApp(
                    user.phone,
                    `Your ${type} item report "${title}" has been submitted successfully.`
                );
            }
        } catch (err) {
            console.error('Phone notification error:', err);
        }

        // ── Auto-match logic ──────────────────────────────────────────
        const oppositeType = type === 'lost' ? 'found' : 'lost';

        let matchQuery = `
            SELECT * FROM items
            WHERE type = ?
              AND status = 'active'
              AND category_id = ?
              AND user_id != ?
        `;
        let matchParams = [oppositeType, category_id, req.user.id];

        if (document_number) {
            matchQuery += ` AND (document_number = ? OR owner_name_on_doc LIKE ?)`;
            matchParams.push(document_number, `%${owner_name_on_doc || ''}%`);
        }

        if (country) {
            matchQuery += ` AND country = ?`;
            matchParams.push(country);
        }

        const [potentialMatches] = await db.query(matchQuery, matchParams);

        let matchesCreated = 0;

        for (const match of potentialMatches) {
            let matchScore = 0;

            if (document_number && match.document_number === document_number)          matchScore += 50;
            if (owner_name_on_doc && match.owner_name_on_doc &&
                match.owner_name_on_doc.toLowerCase().includes(owner_name_on_doc.toLowerCase()))
                                                                                        matchScore += 30;
            if (city && match.city === city)                                            matchScore += 10;
            if (Number(category_id) === Number(match.category_id))                     matchScore += 10;

            if (matchScore >= 20) {
                const lostItemId  = type === 'lost'  ? newItemId : match.id;
                const foundItemId = type === 'found' ? newItemId : match.id;

                // Avoid duplicate match entries
                const [existingMatch] = await db.query(
                    `SELECT id FROM matches WHERE lost_item_id = ? AND found_item_id = ?`,
                    [lostItemId, foundItemId]
                );

                if (existingMatch.length === 0) {
                    await db.query(
                        `INSERT INTO matches (lost_item_id, found_item_id, match_score, match_type)
                         VALUES (?, ?, ?, 'auto')`,
                        [lostItemId, foundItemId, matchScore]
                    );

                    // Get user details for notifications
                    const [matchUserDetails] = await db.query(
                        `SELECT full_name, email, phone
                         FROM users WHERE id = ?`,
                        [match.user_id]
                    );
                    const matchUser = matchUserDetails[0];

                    // Notify matched item owner
                    await db.query(
                        `INSERT INTO notifications (user_id, type, title, message, related_item_id)
                         VALUES (?, 'match_found', 'Potential Match Found!', ?, ?)`,
                        [
                            match.user_id,
                            `A potential match was found for your ${oppositeType} item: "${match.title}"`,
                            match.id
                        ]
                    );

                    // Send email to matched item owner
                    if (matchUser.email) {
                        await emailService.sendMatchFoundNotification(
                            matchUser.email,
                            matchUser.full_name,
                            match.title,
                            oppositeType,
                            'match_found'
                        );
                    }

                    // Send phone notifications to matched owner
                    try {
                        if (matchUser.phone) {
                            await twilioService.sendSMS(
                                matchUser.phone,
                                `Potential match found for your ${oppositeType} item "${match.title}".`
                            );
                            await twilioService.sendWhatsApp(
                                matchUser.phone,
                                `Potential match found for your ${oppositeType} item "${match.title}".`
                            );
                        }
                    } catch (err) {
                        console.error('Match phone notification error:', err);
                    }

                    // Notify current user
                    await db.query(
                        `INSERT INTO notifications (user_id, type, title, message, related_item_id)
                         VALUES (?, 'match_found', 'Potential Match Found!', ?, ?)`,
                        [
                            req.user.id,
                            `A potential match was found for your ${type} item: "${title}"`,
                            newItemId
                        ]
                    );

                    // Send email to current user
                    if (user.email) {
                        await emailService.sendMatchFoundNotification(
                            user.email,
                            user.full_name,
                            title,
                            type,
                            'match_found'
                        );
                    }

                    // Send phone notifications to current user
                    try {
                        if (user.phone) {
                            await twilioService.sendSMS(
                                user.phone,
                                `We found a potential match for your ${type} item "${title}".`
                            );
                            await twilioService.sendWhatsApp(
                                user.phone,
                                `We found a potential match for your ${type} item "${title}".`
                            );
                        }
                    } catch (err) {
                        console.error('Current user phone notification error:', err);
                    }

                    matchesCreated++;
                }
            }
        }

        return res.status(201).json({
            success: true,
            message: `Item reported as ${type} successfully!`,
            data: {
                id: newItemId,
                matches_found: matchesCreated
            }
        });

    } catch (error) {
        console.error('Create item error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while creating item'
        });
    }
};

// @desc    Get all items with filters
// @route   GET /api/items
const getItems = async (req, res) => {
    try {
        const {
            type, category_id, country, city,
            status, search,
            page      = 1,
            limit     = 20,
            sort_by   = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        // Whitelist sort options to prevent SQL injection
        const ALLOWED_SORTS = ['created_at', 'date_lost_found', 'title'];
        const sortField = ALLOWED_SORTS.includes(sort_by) ? sort_by : 'created_at';
        const sortDir   = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const conditions = [];
        const params      = [];
        const countParams = [];

        if (type) {
            conditions.push(`i.type = ?`);
            params.push(type); countParams.push(type);
        }
        if (category_id) {
            conditions.push(`i.category_id = ?`);
            params.push(category_id); countParams.push(category_id);
        }
        if (country) {
            conditions.push(`i.country = ?`);
            params.push(country); countParams.push(country);
        }
        if (city) {
            conditions.push(`i.city LIKE ?`);
            params.push(`%${city}%`); countParams.push(`%${city}%`);
        }
        if (status) {
            conditions.push(`i.status = ?`);
            params.push(status); countParams.push(status);
        } else {
            conditions.push(`i.status = 'active'`);
        }
        if (search) {
            conditions.push(`(i.title LIKE ? OR i.description LIKE ? OR i.document_number LIKE ? OR i.owner_name_on_doc LIKE ?)`);
            const s = `%${search}%`;
            params.push(s, s, s, s);
            countParams.push(s, s, s, s);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const dataQuery = `
            SELECT i.*,
                   c.name_en AS category_name, c.icon AS category_icon,
                   u.full_name AS reporter_name, u.phone AS reporter_phone,
                   u.user_type, u.organization_name
            FROM items i
            JOIN categories c ON i.category_id = c.id
            JOIN users u ON i.user_id = u.id
            ${whereClause}
            ORDER BY i.${sortField} ${sortDir}
            LIMIT ? OFFSET ?
        `;

        const countQuery = `
            SELECT COUNT(*) AS total
            FROM items i
            ${whereClause}
        `;

        const pageNum  = Math.max(parseInt(page)  || 1, 1);
        const limitNum = Math.min(parseInt(limit) || 20, 100);
        const offset   = (pageNum - 1) * limitNum;

        params.push(limitNum, offset);

        const [items]  = await db.query(dataQuery,  params);
        const [totals] = await db.query(countQuery, countParams);

        const total = totals[0].total;

        return res.json({
            success: true,
            data: {
                items,
                pagination: {
                    current_page: pageNum,
                    total_pages:  Math.ceil(total / limitNum),
                    total_items:  total,
                    per_page:     limitNum
                }
            }
        });

    } catch (error) {
        console.error('Get items error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while fetching items'
        });
    }
};

// @desc    Get single item by ID
// @route   GET /api/items/:id
const getItemById = async (req, res) => {
    try {
        const itemId = parseInt(req.params.id);

        if (isNaN(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid item ID' });
        }

        const [items] = await db.query(
            `SELECT i.*,
                    c.name_en AS category_name,   c.name_rw AS category_name_rw,
                    c.name_fr AS category_name_fr, c.name_sw AS category_name_sw,
                    c.icon AS category_icon,
                    u.full_name AS reporter_name,  u.phone AS reporter_phone,
                    u.email AS reporter_email,     u.user_type,
                    u.organization_name,           u.profile_image AS reporter_image
             FROM items i
             JOIN categories c ON i.category_id = c.id
             JOIN users u ON i.user_id = u.id
             WHERE i.id = ?`,
            [itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }

        const [matches] = await db.query(
            `SELECT m.*,
                    CASE WHEN m.lost_item_id = ? THEN m.found_item_id
                         ELSE m.lost_item_id END AS matched_item_id
             FROM matches m
             WHERE m.lost_item_id = ? OR m.found_item_id = ?
             ORDER BY m.match_score DESC`,
            [itemId, itemId, itemId]
        );

        return res.json({
            success: true,
            data: { ...items[0], matches }
        });

    } catch (error) {
        console.error('Get item error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Get current user's items
// @route   GET /api/items/my/items
const getMyItems = async (req, res) => {
    try {
        const { type, status } = req.query;

        const conditions = ['i.user_id = ?'];
        const params     = [req.user.id];

        if (type)   { conditions.push('i.type = ?');   params.push(type);   }
        if (status) { conditions.push('i.status = ?'); params.push(status); }

        const query = `
            SELECT i.*, c.name_en AS category_name, c.icon AS category_icon
            FROM items i
            JOIN categories c ON i.category_id = c.id
            WHERE ${conditions.join(' AND ')}
            ORDER BY i.created_at DESC
        `;

        const [items] = await db.query(query, params);

        return res.json({ success: true, data: items });

    } catch (error) {
        console.error('Get my items error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Update item
// @route   PUT /api/items/:id
const updateItem = async (req, res) => {
    try {
        const itemId = parseInt(req.params.id);

        if (isNaN(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid item ID' });
        }

        // Verify ownership
        const [items] = await db.query(
            'SELECT * FROM items WHERE id = ? AND user_id = ?',
            [itemId, req.user.id]
        );

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Item not found or you are not authorized'
            });
        }

        const existing = items[0];

        const {
            title, description, document_number, owner_name_on_doc,
            country, city, specific_location, status,
            is_reward_offered, reward_amount
        } = req.body;

        await db.query(
            `UPDATE items SET
                title             = ?,
                description       = ?,
                document_number   = ?,
                owner_name_on_doc = ?,
                country           = ?,
                city              = ?,
                specific_location = ?,
                status            = ?,
                is_reward_offered = ?,
                reward_amount     = ?,
                updated_at        = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                title             ?? existing.title,
                description       ?? existing.description,
                document_number   ?? existing.document_number,
                owner_name_on_doc ?? existing.owner_name_on_doc,
                country           ?? existing.country,
                city              ?? existing.city,
                specific_location ?? existing.specific_location,
                status            ?? existing.status,
                is_reward_offered !== undefined ? (is_reward_offered ? 1 : 0) : existing.is_reward_offered,
                reward_amount     ?? existing.reward_amount,
                itemId
            ]
        );

        return res.json({ success: true, message: 'Item updated successfully' });

    } catch (error) {
        console.error('Update item error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Delete item
// @route   DELETE /api/items/:id
const deleteItem = async (req, res) => {
    try {
        const itemId = parseInt(req.params.id);

        if (isNaN(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid item ID' });
        }

        const [result] = await db.query(
            'DELETE FROM items WHERE id = ? AND user_id = ?',
            [itemId, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Item not found or you are not authorized'
            });
        }

        return res.json({ success: true, message: 'Item deleted successfully' });

    } catch (error) {
        console.error('Delete item error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Get all categories
// @route   GET /api/items/categories/all
const getCategories = async (req, res) => {
    try {
        const [categories] = await db.query(
            'SELECT * FROM categories ORDER BY name_en'
        );
        return res.json({ success: true, data: categories });

    } catch (error) {
        console.error('Get categories error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Get platform statistics
// @route   GET /api/items/stats/overview
const getStats = async (req, res) => {
    try {
        const [[{ total_lost }]]     = await db.query(`SELECT COUNT(*) AS total_lost    FROM items  WHERE type   = 'lost'`);
        const [[{ total_found }]]    = await db.query(`SELECT COUNT(*) AS total_found   FROM items  WHERE type   = 'found'`);
        const [[{ total_matched }]]  = await db.query(`SELECT COUNT(*) AS total_matched FROM matches WHERE status = 'confirmed'`);
        const [[{ total_returned }]] = await db.query(`SELECT COUNT(*) AS total_returned FROM items WHERE status  = 'returned'`);
        const [[{ total_users }]]    = await db.query(`SELECT COUNT(*) AS total_users   FROM users`);

        const [recentItems] = await db.query(
            `SELECT i.*, c.name_en AS category_name, c.icon AS category_icon,
                    u.full_name AS reporter_name
             FROM items i
             JOIN categories c ON i.category_id = c.id
             JOIN users u ON i.user_id = u.id
             WHERE i.status = 'active'
             ORDER BY i.created_at DESC
             LIMIT 10`
        );

        const [topCategories] = await db.query(
            `SELECT c.name_en, c.icon, COUNT(i.id) AS item_count
             FROM categories c
             LEFT JOIN items i ON c.id = i.category_id
             GROUP BY c.id, c.name_en, c.icon
             ORDER BY item_count DESC
             LIMIT 5`
        );

        return res.json({
            success: true,
            data: {
                total_lost,
                total_found,
                total_matched,
                total_returned,
                total_users,
                recent_items:   recentItems,
                top_categories: topCategories
            }
        });

    } catch (error) {
        console.error('Get stats error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    createItem,
    getItems,
    getItemById,
    getMyItems,
    updateItem,
    deleteItem,
    getCategories,
    getStats
};