'use strict';

const db            = require('../config/db');
const fs            = require('fs');
const path          = require('path');
const emailService  = require('../utils/emailService');
const twilioService = require('../utils/twilioService');

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Fire-and-forget phone notifications.
 * NEVER throws — failure is logged and swallowed.
 */
const sendPhoneNotifications = async (phone, smsText, waText) => {
  if (!phone) return;
  twilioService.sendSMS(phone, smsText).catch(e =>
    console.error('[itemController] SMS error:', e.message)
  );
  twilioService.sendWhatsApp(phone, waText).catch(e =>
    console.error('[itemController] WhatsApp error:', e.message)
  );
};

/**
 * Fire-and-forget email notification.
 */
const sendEmailSafe = async (fn, ...args) => {
  try {
    await fn(...args);
  } catch (e) {
    console.error('[itemController] Email error:', e.message);
  }
};

/**
 * Delete an uploaded file from disk (silent on failure).
 * Used when replacing/removing images during update.
 */
const deleteUploadedFile = (relativePath) => {
  if (!relativePath) return;
  try {
    const filename = relativePath.replace(/^\/?uploads\//, '');
    const filepath = path.join(__dirname, '..', 'uploads', filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log(`[itemController] Deleted file: ${filepath}`);
    }
  } catch (e) {
    console.error('[itemController] File delete error:', e.message);
  }
};

/**
 * Truthy value coercion for form-data booleans like "1", "true", "yes"
 */
const isTruthy = (v) => {
  if (v === undefined || v === null || v === '') return false;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

// ═══════════════════════════════════════════════════════════════════
//  CREATE ITEM
//  POST /api/items  (protected, multipart)
// ═══════════════════════════════════════════════════════════════════
const createItem = async (req, res) => {
  try {
    const {
      category_id, category_manual, type, title, description,
      document_number, owner_name_on_doc,
      country, city, specific_location,
      latitude, longitude,
      date_lost_found, time_lost_found,
      is_reward_offered, reward_amount,
      contact_method,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────
    if (!type || !title) {
      return res.status(400).json({
        success: false,
        message: 'type and title are required',
      });
    }

    if (!['lost', 'found'].includes(String(type).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'type must be either "lost" or "found"',
      });
    }

    // Handle category — either category_id OR category_manual is required
    let finalCategoryId = null;

    if (category_id) {
      finalCategoryId = Number(category_id);
    } else if (category_manual) {
      // Look up or create a category based on manual input
      const manualName = String(category_manual).trim();
      const [existing] = await db.query(
        'SELECT id FROM categories WHERE LOWER(name_en) = LOWER(?) LIMIT 1',
        [manualName]
      );

      if (existing.length > 0) {
        finalCategoryId = existing[0].id;
      } else {
        // Try to find an "Other" category as fallback
        const [otherCat] = await db.query(
          "SELECT id FROM categories WHERE LOWER(name_en) LIKE '%other%' LIMIT 1"
        );
        finalCategoryId = otherCat.length > 0 ? otherCat[0].id : 1;
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Category is required',
      });
    }

    // ── Image uploads ─────────────────────────────────────────────
    let image_url   = null;
    let image_url_2 = null;
    let image_url_3 = null;

    if (req.files) {
      if (req.files['image']?.[0])
        image_url   = `/uploads/${req.files['image'][0].filename}`;
      if (req.files['image2']?.[0])
        image_url_2 = `/uploads/${req.files['image2'][0].filename}`;
      if (req.files['image3']?.[0])
        image_url_3 = `/uploads/${req.files['image3'][0].filename}`;
    }

    // ── Insert item ───────────────────────────────────────────────
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
        finalCategoryId,
        String(type).toLowerCase(),
        String(title).trim(),
        description       ? String(description).trim() : null,
        document_number   ? String(document_number).trim() : null,
        owner_name_on_doc ? String(owner_name_on_doc).trim() : null,
        country           ? String(country).trim() : null,
        city              ? String(city).trim() : null,
        specific_location ? String(specific_location).trim() : null,
        latitude          ? Number(latitude)  : null,
        longitude         ? Number(longitude) : null,
        date_lost_found   || null,
        time_lost_found   || null,
        image_url,
        image_url_2,
        image_url_3,
        isTruthy(is_reward_offered) ? 1 : 0,
        reward_amount     ? Number(reward_amount) : null,
        contact_method    || 'all',
      ]
    );

    const newItemId = result.insertId;

    // ── Get reporter details ──────────────────────────────────────
    const [[reporter]] = await db.query(
      'SELECT full_name, email, phone FROM users WHERE id = ?',
      [req.user.id]
    );

    // ── Submission notification (DB) ──────────────────────────────
    try {
      await db.query(
        `INSERT INTO notifications
           (user_id, type, title, message, related_item_id)
         VALUES (?, 'item_submitted', 'Item Report Submitted', ?, ?)`,
        [
          req.user.id,
          `Your ${type} item report "${title}" has been submitted. ` +
          `We'll notify you if we find any matches.`,
          newItemId,
        ]
      );
    } catch (notifErr) {
      console.error('[itemController] Notification insert error:', notifErr.message);
    }

    // ── Submission email (fire-and-forget) ────────────────────────
    if (reporter?.email && emailService?.sendItemSubmissionNotification) {
      sendEmailSafe(
        emailService.sendItemSubmissionNotification,
        reporter.email, reporter.full_name, title, type
      );
    }

    const canPhone = reporter?.phone &&
      (contact_method === 'all' || contact_method === 'phone');

    if (canPhone) {
      sendPhoneNotifications(
        reporter.phone,
        `Your ${type} item report "${title}" has been submitted successfully.`,
        `Your ${type} item report "${title}" has been submitted successfully.`
      );
    }

    // ── Auto-match logic ──────────────────────────────────────────
    let matchesCreated = 0;

    try {
      const oppositeType = type === 'lost' ? 'found' : 'lost';

      let matchQuery  = `
        SELECT * FROM items
        WHERE  type        = ?
          AND  status      = 'active'
          AND  category_id = ?
          AND  user_id    != ?
      `;
      const matchParams = [oppositeType, finalCategoryId, req.user.id];

      if (document_number) {
        matchQuery += ` AND (document_number = ? OR owner_name_on_doc LIKE ?)`;
        matchParams.push(
          String(document_number).trim(),
          `%${(owner_name_on_doc || '').trim()}%`
        );
      }
      if (country) {
        matchQuery += ` AND country = ?`;
        matchParams.push(String(country).trim());
      }

      const [potentialMatches] = await db.query(matchQuery, matchParams);

      for (const match of potentialMatches) {
        let score = 0;

        if (document_number &&
            match.document_number === String(document_number).trim())
          score += 50;

        if (owner_name_on_doc &&
            match.owner_name_on_doc?.toLowerCase()
              .includes(String(owner_name_on_doc).toLowerCase()))
          score += 30;

        if (city && match.city === String(city).trim())
          score += 10;

        if (finalCategoryId === Number(match.category_id))
          score += 10;

        if (score < 20) continue;

        const lostItemId  = type === 'lost'  ? newItemId : match.id;
        const foundItemId = type === 'found' ? newItemId : match.id;

        const [existing] = await db.query(
          'SELECT id FROM matches WHERE lost_item_id = ? AND found_item_id = ?',
          [lostItemId, foundItemId]
        );
        if (existing.length > 0) continue;

        await db.query(
          `INSERT INTO matches
             (lost_item_id, found_item_id, match_score, match_type)
           VALUES (?, ?, ?, 'auto')`,
          [lostItemId, foundItemId, score]
        );

        matchesCreated++;

        const [[matchUser]] = await db.query(
          'SELECT full_name, email, phone FROM users WHERE id = ?',
          [match.user_id]
        );

        try {
          await db.query(
            `INSERT INTO notifications
               (user_id, type, title, message, related_item_id)
             VALUES (?, 'match_found', 'Potential Match Found!', ?, ?)`,
            [
              match.user_id,
              `A potential match was found for your ${oppositeType} item: "${match.title}"`,
              match.id,
            ]
          );
        } catch (e) {
          console.error('[itemController] Match notification error:', e.message);
        }

        if (matchUser?.email && emailService?.sendMatchFoundNotification) {
          sendEmailSafe(
            emailService.sendMatchFoundNotification,
            matchUser.email, matchUser.full_name,
            match.title, oppositeType, 'match_found'
          );
        }
        sendPhoneNotifications(
          matchUser?.phone,
          `Potential match found for your ${oppositeType} item "${match.title}".`,
          `Potential match found for your ${oppositeType} item "${match.title}".`
        );

        try {
          await db.query(
            `INSERT INTO notifications
               (user_id, type, title, message, related_item_id)
             VALUES (?, 'match_found', 'Potential Match Found!', ?, ?)`,
            [
              req.user.id,
              `A potential match was found for your ${type} item: "${title}"`,
              newItemId,
            ]
          );
        } catch (e) {
          console.error('[itemController] Self-notification error:', e.message);
        }

        if (reporter?.email && emailService?.sendMatchFoundNotification) {
          sendEmailSafe(
            emailService.sendMatchFoundNotification,
            reporter.email, reporter.full_name,
            title, type, 'match_found'
          );
        }
        if (canPhone) {
          sendPhoneNotifications(
            reporter.phone,
            `We found a potential match for your ${type} item "${title}".`,
            `We found a potential match for your ${type} item "${title}".`
          );
        }
      }
    } catch (matchErr) {
      console.error('[itemController] Match logic error:', matchErr.message);
    }

    // ── Success ───────────────────────────────────────────────────
    return res.status(201).json({
      success: true,
      message: `Item reported as ${type} successfully!`,
      data:    { id: newItemId, matches_found: matchesCreated },
    });

  } catch (error) {
    console.error('[itemController] createItem error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while creating item',
      ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
    });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  GET ALL ITEMS
//  GET /api/items
// ═══════════════════════════════════════════════════════════════════
const getItems = async (req, res) => {
  try {
    const {
      type, category_id, country, city,
      status, search,
      page       = 1,
      limit      = 20,
      sort_by    = 'created_at',
      sort_order = 'DESC',
    } = req.query;

    const ALLOWED_SORTS = ['created_at', 'date_lost_found', 'title'];
    const sortField = ALLOWED_SORTS.includes(sort_by) ? sort_by : 'created_at';
    const sortDir   = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const conditions  = [];
    const params      = [];
    const countParams = [];

    const push = (clause, ...vals) => {
      conditions.push(clause);
      params.push(...vals);
      countParams.push(...vals);
    };

    if (type)        push('i.type = ?',        type);
    if (category_id) push('i.category_id = ?', Number(category_id));
    if (country)     push('i.country = ?',      country);
    if (city)        push('i.city LIKE ?',      `%${city}%`);
    if (status)      push('i.status = ?',       status);
    else             conditions.push("i.status = 'active'");

    if (search) {
      push(
        '(i.title LIKE ? OR i.description LIKE ? OR i.document_number LIKE ? OR i.owner_name_on_doc LIKE ?)',
        `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`
      );
    }

    const where    = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum  = Math.max(parseInt(page)  || 1,  1);
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset   = (pageNum - 1) * limitNum;

    const [items]  = await db.query(
      `SELECT i.*,
              c.name_en AS category_name, c.icon AS category_icon,
              u.full_name AS reporter_name, u.phone AS reporter_phone,
              u.user_type, u.organization_name
       FROM   items i
       JOIN   categories c ON i.category_id = c.id
       JOIN   users      u ON i.user_id     = u.id
       ${where}
       ORDER  BY i.${sortField} ${sortDir}
       LIMIT  ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [totals] = await db.query(
      `SELECT COUNT(*) AS total FROM items i ${where}`,
      countParams
    );

    return res.json({
      success: true,
      data: {
        items,
        pagination: {
          current_page: pageNum,
          total_pages:  Math.ceil(totals[0].total / limitNum),
          total_items:  totals[0].total,
          per_page:     limitNum,
        },
      },
    });
  } catch (error) {
    console.error('[itemController] getItems error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching items',
    });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  GET SINGLE ITEM
//  GET /api/items/:id
// ═══════════════════════════════════════════════════════════════════
const getItemById = async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId))
      return res.status(400).json({ success: false, message: 'Invalid item ID' });

    const [items] = await db.query(
      `SELECT i.*,
              c.name_en AS category_name,   c.name_rw AS category_name_rw,
              c.name_fr AS category_name_fr, c.name_sw AS category_name_sw,
              c.icon    AS category_icon,
              u.full_name    AS reporter_name,  u.phone AS reporter_phone,
              u.email        AS reporter_email, u.user_type,
              u.organization_name,              u.profile_image AS reporter_image
       FROM   items i
       JOIN   categories c ON i.category_id = c.id
       JOIN   users      u ON i.user_id     = u.id
       WHERE  i.id = ?`,
      [itemId]
    );

    if (!items.length)
      return res.status(404).json({ success: false, message: 'Item not found' });

    const [matches] = await db.query(
      `SELECT m.*,
              CASE WHEN m.lost_item_id = ?
                   THEN m.found_item_id
                   ELSE m.lost_item_id
              END AS matched_item_id
       FROM   matches m
       WHERE  m.lost_item_id = ? OR m.found_item_id = ?
       ORDER  BY m.match_score DESC`,
      [itemId, itemId, itemId]
    );

    return res.json({ success: true, data: { ...items[0], matches } });
  } catch (error) {
    console.error('[itemController] getItemById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  GET MY ITEMS
//  GET /api/items/my/items  (protected)
// ═══════════════════════════════════════════════════════════════════
const getMyItems = async (req, res) => {
  try {
    const { type, status } = req.query;

    const conditions = ['i.user_id = ?'];
    const params     = [req.user.id];

    if (type)   { conditions.push('i.type = ?');   params.push(type);   }
    if (status) { conditions.push('i.status = ?'); params.push(status); }

    const [items] = await db.query(
      `SELECT i.*, c.name_en AS category_name, c.icon AS category_icon
       FROM   items i
       JOIN   categories c ON i.category_id = c.id
       WHERE  ${conditions.join(' AND ')}
       ORDER  BY i.created_at DESC`,
      params
    );

    return res.json({ success: true, data: items });
  } catch (error) {
    console.error('[itemController] getMyItems error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  UPDATE ITEM — FULL CRUD with image management
//  PUT /api/items/:id  (protected, multipart)
// ═══════════════════════════════════════════════════════════════════
const updateItem = async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId))
      return res.status(400).json({ success: false, message: 'Invalid item ID' });

    // Ownership check
    const [items] = await db.query(
      'SELECT * FROM items WHERE id = ? AND user_id = ?',
      [itemId, req.user.id]
    );

    if (!items.length)
      return res.status(404).json({
        success: false,
        message: 'Item not found or not authorized',
      });

    const existing = items[0];

    const {
      type, category_id, category_manual,
      title, description,
      document_number, owner_name_on_doc,
      country, city, specific_location,
      latitude, longitude,
      date_lost_found, time_lost_found,
      status, is_reward_offered, reward_amount,
      contact_method,
      remove_image, remove_image2, remove_image3,
    } = req.body;

    // ── Resolve category ──────────────────────────────────────────
    let newCategoryId = existing.category_id;

    if (category_id) {
      newCategoryId = Number(category_id);
    } else if (category_manual) {
      const manualName = String(category_manual).trim();
      const [found] = await db.query(
        'SELECT id FROM categories WHERE LOWER(name_en) = LOWER(?) LIMIT 1',
        [manualName]
      );
      if (found.length > 0) {
        newCategoryId = found[0].id;
      }
    }

    // ── Handle images ─────────────────────────────────────────────
    let newImageUrl   = existing.image_url;
    let newImageUrl2  = existing.image_url_2;
    let newImageUrl3  = existing.image_url_3;

    // (1) Removals first
    if (isTruthy(remove_image)) {
      deleteUploadedFile(existing.image_url);
      newImageUrl = null;
    }
    if (isTruthy(remove_image2)) {
      deleteUploadedFile(existing.image_url_2);
      newImageUrl2 = null;
    }
    if (isTruthy(remove_image3)) {
      deleteUploadedFile(existing.image_url_3);
      newImageUrl3 = null;
    }

    // (2) New uploads override
    if (req.files) {
      if (req.files['image']?.[0]) {
        // Delete the old file if it exists and wasn't already flagged
        if (newImageUrl && !isTruthy(remove_image)) {
          deleteUploadedFile(newImageUrl);
        }
        newImageUrl = `/uploads/${req.files['image'][0].filename}`;
      }
      if (req.files['image2']?.[0]) {
        if (newImageUrl2 && !isTruthy(remove_image2)) {
          deleteUploadedFile(newImageUrl2);
        }
        newImageUrl2 = `/uploads/${req.files['image2'][0].filename}`;
      }
      if (req.files['image3']?.[0]) {
        if (newImageUrl3 && !isTruthy(remove_image3)) {
          deleteUploadedFile(newImageUrl3);
        }
        newImageUrl3 = `/uploads/${req.files['image3'][0].filename}`;
      }
    }

    // ── Update ────────────────────────────────────────────────────
    await db.query(
      `UPDATE items SET
         type              = ?,
         category_id       = ?,
         title             = ?,
         description       = ?,
         document_number   = ?,
         owner_name_on_doc = ?,
         country           = ?,
         city              = ?,
         specific_location = ?,
         latitude          = ?,
         longitude         = ?,
         date_lost_found   = ?,
         time_lost_found   = ?,
         image_url         = ?,
         image_url_2       = ?,
         image_url_3       = ?,
         status            = ?,
         is_reward_offered = ?,
         reward_amount     = ?,
         contact_method    = ?,
         updated_at        = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        type              ? String(type).toLowerCase() : existing.type,
        newCategoryId,
        title             !== undefined ? String(title).trim()       : existing.title,
        description       !== undefined ? (description ? String(description).trim() : null) : existing.description,
        document_number   !== undefined ? (document_number ? String(document_number).trim() : null) : existing.document_number,
        owner_name_on_doc !== undefined ? (owner_name_on_doc ? String(owner_name_on_doc).trim() : null) : existing.owner_name_on_doc,
        country           !== undefined ? (country ? String(country).trim() : null) : existing.country,
        city              !== undefined ? (city ? String(city).trim() : null) : existing.city,
        specific_location !== undefined ? (specific_location ? String(specific_location).trim() : null) : existing.specific_location,
        latitude          !== undefined && latitude !== ''  ? Number(latitude)  : existing.latitude,
        longitude         !== undefined && longitude !== '' ? Number(longitude) : existing.longitude,
        date_lost_found   !== undefined ? (date_lost_found || null) : existing.date_lost_found,
        time_lost_found   !== undefined ? (time_lost_found || null) : existing.time_lost_found,
        newImageUrl,
        newImageUrl2,
        newImageUrl3,
        status            ? String(status).toLowerCase() : existing.status,
        is_reward_offered !== undefined ? (isTruthy(is_reward_offered) ? 1 : 0) : existing.is_reward_offered,
        reward_amount     !== undefined && reward_amount !== '' ? Number(reward_amount) : existing.reward_amount,
        contact_method    || existing.contact_method,
        itemId,
      ]
    );

    // Fetch updated
    const [[updated]] = await db.query(
      `SELECT i.*, c.name_en AS category_name, c.icon AS category_icon
       FROM   items i
       JOIN   categories c ON i.category_id = c.id
       WHERE  i.id = ?`,
      [itemId]
    );

    console.log(`✅ [itemController] Item ${itemId} updated by user ${req.user.id}`);

    return res.json({
      success: true,
      message: 'Item updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('[itemController] updateItem error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating item',
      ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
    });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  DELETE ITEM (cascades notifications & matches)
//  DELETE /api/items/:id  (protected)
// ═══════════════════════════════════════════════════════════════════
const deleteItem = async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId))
      return res.status(400).json({ success: false, message: 'Invalid item ID' });

    // Ownership + get image paths before delete
    const [items] = await db.query(
      'SELECT image_url, image_url_2, image_url_3 FROM items WHERE id = ? AND user_id = ?',
      [itemId, req.user.id]
    );

    if (!items.length)
      return res.status(404).json({
        success: false,
        message: 'Item not found or not authorized',
      });

    const item = items[0];

    // Delete related matches
    try {
      await db.query(
        'DELETE FROM matches WHERE lost_item_id = ? OR found_item_id = ?',
        [itemId, itemId]
      );
    } catch (e) {
      console.error('[itemController] Match delete error:', e.message);
    }

    // Delete related notifications
    try {
      await db.query('DELETE FROM notifications WHERE related_item_id = ?', [itemId]);
    } catch (e) {
      console.error('[itemController] Notification delete error:', e.message);
    }

    // Delete the item
    const [result] = await db.query(
      'DELETE FROM items WHERE id = ? AND user_id = ?',
      [itemId, req.user.id]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({
        success: false,
        message: 'Item not found or not authorized',
      });

    // Delete files from disk
    deleteUploadedFile(item.image_url);
    deleteUploadedFile(item.image_url_2);
    deleteUploadedFile(item.image_url_3);

    console.log(`✅ [itemController] Item ${itemId} deleted by user ${req.user.id}`);

    return res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('[itemController] deleteItem error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while deleting item',
    });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  GET CATEGORIES
//  GET /api/items/categories/all
// ═══════════════════════════════════════════════════════════════════
const getCategories = async (req, res) => {
  try {
    const [categories] = await db.query(
      'SELECT * FROM categories ORDER BY name_en'
    );
    return res.json({ success: true, data: categories });
  } catch (error) {
    console.error('[itemController] getCategories error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  GET STATS (full — dashboard use)
//  GET /api/items/stats/overview
// ═══════════════════════════════════════════════════════════════════
const getStats = async (req, res) => {
  try {
    const [[{ total_lost }]]     = await db.query(
      `SELECT COUNT(*) AS total_lost FROM items WHERE type = 'lost'`
    );
    const [[{ total_found }]]    = await db.query(
      `SELECT COUNT(*) AS total_found FROM items WHERE type = 'found'`
    );
    const [[{ total_matched }]]  = await db.query(
      `SELECT COUNT(*) AS total_matched FROM matches WHERE status = 'confirmed'`
    );
    const [[{ total_returned }]] = await db.query(
      `SELECT COUNT(*) AS total_returned FROM items WHERE status = 'returned'`
    );
    const [[{ total_users }]]    = await db.query(
      `SELECT COUNT(*) AS total_users FROM users`
    );

    // Total recovered = returned + confirmed matches (whichever your business logic prefers)
    const total_recovered = (total_returned || 0) + (total_matched || 0);

    const [recentItems] = await db.query(
      `SELECT i.*, c.name_en AS category_name, c.icon AS category_icon,
              u.full_name AS reporter_name
       FROM   items i
       JOIN   categories c ON i.category_id = c.id
       JOIN   users      u ON i.user_id     = u.id
       WHERE  i.status = 'active'
       ORDER  BY i.created_at DESC
       LIMIT  10`
    );

    const [topCategories] = await db.query(
      `SELECT c.name_en, c.icon, COUNT(i.id) AS item_count
       FROM   categories c
       LEFT   JOIN items i ON c.id = i.category_id
       GROUP  BY c.id, c.name_en, c.icon
       ORDER  BY item_count DESC
       LIMIT  5`
    );

    return res.json({
      success: true,
      data: {
        total_lost,
        total_found,
        total_matched,
        total_returned,
        total_recovered,
        total_users,
        recent_items:   recentItems,
        top_categories: topCategories,
      },
    });
  } catch (error) {
    console.error('[itemController] getStats error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  PUBLIC STATS (lightweight — for login/register pages)
//  GET /api/items/stats/public
// ═══════════════════════════════════════════════════════════════════
const getPublicStats = async (req, res) => {
  try {
    const [[{ total_found }]]    = await db.query(
      `SELECT COUNT(*) AS total_found FROM items WHERE type = 'found'`
    );
    const [[{ total_returned }]] = await db.query(
      `SELECT COUNT(*) AS total_returned FROM items WHERE status = 'returned'`
    );
    const [[{ total_matched }]]  = await db.query(
      `SELECT COUNT(*) AS total_matched FROM matches WHERE status = 'confirmed'`
    );
    const [[{ total_users }]]    = await db.query(
      `SELECT COUNT(*) AS total_users FROM users`
    );
    const [[{ total_items }]]    = await db.query(
      `SELECT COUNT(*) AS total_items FROM items`
    );

    // Items recovered = returned status + confirmed matches
    const items_recovered = (total_returned || 0) + (total_matched || 0);

    // Success rate calculation
    const success_rate = total_items > 0
      ? Math.round((items_recovered / total_items) * 100)
      : 95;

    return res.json({
      success: true,
      data: {
        items_recovered,   // ← main counter for login/register
        total_found,
        total_returned,
        total_matched,
        total_users,
        total_items,
        success_rate,
      },
    });
  } catch (error) {
    console.error('[itemController] getPublicStats error:', error);
    // Graceful fallback so UI doesn't break
    return res.json({
      success: true,
      data: {
        items_recovered: 0,
        total_found:     0,
        total_returned:  0,
        total_matched:   0,
        total_users:     0,
        total_items:     0,
        success_rate:    95,
      },
    });
  }
};

// ═══════════════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════════════
module.exports = {
  createItem,
  getItems,
  getItemById,
  getMyItems,
  updateItem,
  deleteItem,
  getCategories,
  getStats,
  getPublicStats,
};