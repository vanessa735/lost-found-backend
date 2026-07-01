'use strict';

const db = require('../config/db');

const safeParseJSON = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
};

// ─────────────────────────────────────────────────────────────────
//  GET /api/messages/conversations
// ─────────────────────────────────────────────────────────────────
const getConversations = async (req, res) => {
  try {
    // Guard: req.user must exist (protect middleware)
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    const userId = Number(req.user.id);

    const [conversations] = await db.query(
      `SELECT
         c.id,
         c.item_id,
         c.item_title,
         c.item_type,
         c.user_one_id,
         c.user_two_id,
         c.user_one_name,
         c.user_two_name,
         c.last_message,
         c.last_sender_id,
         c.typing_user_id,
         c.updated_at AS last_updated,
         (
           SELECT COUNT(*)
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.sender_id != ?
             AND (m.read_at IS NULL OR m.read_at = '')
         ) AS unread_count
       FROM conversations c
       WHERE c.user_one_id = ? OR c.user_two_id = ?
       ORDER BY c.updated_at DESC`,
      [userId, userId, userId]
    );

    const prepared = conversations.map((conv) => {
      const isUserOne    = Number(conv.user_one_id) === userId;
      const otherUserId  = isUserOne ? conv.user_two_id  : conv.user_one_id;
      const otherUserName= isUserOne ? conv.user_two_name: conv.user_one_name;

      let typingUserName = null;
      if (conv.typing_user_id && Number(conv.typing_user_id) !== userId) {
        typingUserName = Number(conv.typing_user_id) === Number(conv.user_one_id)
          ? conv.user_one_name
          : conv.user_two_name;
      }

      return {
        id:               conv.id,
        item_id:          conv.item_id,
        item_title:       conv.item_title,
        item_type:        conv.item_type,
        other_user_id:    otherUserId,
        other_user_name:  otherUserName,
        last_message:     conv.last_message,
        last_sender_id:   conv.last_sender_id,
        typing_user_id:   conv.typing_user_id,
        typing_user_name: typingUserName,
        last_updated:     conv.last_updated,
        unread_count:     Number(conv.unread_count ?? 0),
      };
    });

    return res.json({ success: true, data: prepared });

  } catch (error) {
    console.error('[messageController] getConversations error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch conversations',
      // expose in dev only
      ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
    });
  }
};

// ─────────────────────────────────────────────────────────────────
//  GET /api/messages/:conversationId
// ─────────────────────────────────────────────────────────────────
const getMessages = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    const { conversationId } = req.params;
    const userId = Number(req.user.id);

    if (!conversationId || isNaN(Number(conversationId))) {
      return res.status(400).json({ success: false, message: 'Invalid conversationId' });
    }

    const [conversations] = await db.query(
      `SELECT * FROM conversations
       WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
      [conversationId, userId, userId]
    );

    if (!conversations.length) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const [messages] = await db.query(
      `SELECT
         m.*,
         r.sender_name AS reply_to_sender_name,
         r.content     AS reply_to_content,
         r.image_url   AS reply_to_image_url
       FROM messages m
       LEFT JOIN messages r ON m.reply_to_message_id = r.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    const normalized = messages.map((msg) => ({
      ...msg,
      reactions: safeParseJSON(msg.reactions),
      reply_to_message: msg.reply_to_message_id
        ? {
            sender_name: msg.reply_to_sender_name,
            content:     msg.reply_to_content,
            image_url:   msg.reply_to_image_url,
          }
        : null,
    }));

    // Mark messages as read (fire-and-forget — don't block response)
    db.query(
      `UPDATE messages
       SET read_at = NOW()
       WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`,
      [conversationId, userId]
    ).catch((e) => console.warn('[messageController] read_at update failed:', e.message));

    return res.json({ success: true, data: normalized });

  } catch (error) {
    console.error('[messageController] getMessages error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch messages',
      ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
    });
  }
};

// ─────────────────────────────────────────────────────────────────
//  POST /api/messages
// ─────────────────────────────────────────────────────────────────
const sendMessage = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    const userId     = Number(req.user.id);
    const senderName = req.user.full_name || req.user.name || req.user.email || 'User';
    const imageUrl   = req.file ? `/uploads/${req.file.filename}` : null;

    // ── Parse body ─────────────────────────────────────────────
    // Support both snake_case and camelCase keys from the frontend
    const conversationId_raw =
      req.body.conversation_id ?? req.body.conversationId ?? null;
    const itemId_raw =
      req.body.item_id ?? req.body.itemId ?? null;
    const content =
      (req.body.content ?? req.body.message ?? '').toString().trim() || null;
    const replyToMessageId =
      req.body.reply_to_message_id ?? req.body.replyToMessageId ?? null;

    const conversationId = conversationId_raw ? Number(conversationId_raw) : null;
    const itemId         = itemId_raw         ? Number(itemId_raw)         : null;

    // Must have at least content or an image
    if (!content && !imageUrl) {
      return res.status(400).json({
        success: false,
        message: 'Message content or image is required',
      });
    }

    // Must be able to identify the conversation
    if (!conversationId && !itemId) {
      return res.status(400).json({
        success: false,
        message: 'conversation_id or item_id is required',
      });
    }

    let finalConversationId = conversationId;
    let itemTitle    = null;
    let itemType     = null;
    let relatedItemId= null;
    let otherUserId  = null;
    let otherUserName= null;

    // ── Resolve conversation ───────────────────────────────────
    if (finalConversationId) {
      const [existing] = await db.query(
        `SELECT * FROM conversations
         WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
        [finalConversationId, userId, userId]
      );

      if (!existing.length) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }

      const conv     = existing[0];
      itemTitle      = conv.item_title;
      itemType       = conv.item_type;
      relatedItemId  = conv.item_id;
      const isUserOne= Number(conv.user_one_id) === userId;
      otherUserId    = isUserOne ? conv.user_two_id  : conv.user_one_id;
      otherUserName  = isUserOne ? conv.user_two_name: conv.user_one_name;

    } else {
      // Starting a new conversation via item
      const [items] = await db.query(
        'SELECT id, title, type, user_id FROM items WHERE id = ?',
        [itemId]
      );
      if (!items.length) {
        return res.status(404).json({ success: false, message: 'Item not found' });
      }

      const item    = items[0];
      itemTitle     = item.title;
      itemType      = item.type;
      relatedItemId = item.id;

      if (Number(item.user_id) === userId) {
        return res.status(400).json({
          success: false,
          message: 'Cannot message your own item',
        });
      }

      const [users] = await db.query(
        'SELECT id, full_name, email FROM users WHERE id = ?',
        [item.user_id]
      );
      if (!users.length) {
        return res.status(404).json({ success: false, message: 'Item owner not found' });
      }
      otherUserId   = users[0].id;
      otherUserName = users[0].full_name || users[0].email;

      // Find or create conversation
      const [convExists] = await db.query(
        `SELECT * FROM conversations
         WHERE item_id = ?
           AND (
             (user_one_id = ? AND user_two_id = ?)
             OR
             (user_one_id = ? AND user_two_id = ?)
           )`,
        [item.id, userId, otherUserId, otherUserId, userId]
      );

      if (convExists.length) {
        finalConversationId = convExists[0].id;
      } else {
        const [insert] = await db.query(
          `INSERT INTO conversations
             (item_id, item_title, item_type,
              user_one_id, user_two_id,
              user_one_name, user_two_name,
              last_message, last_sender_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.title,
            item.type,
            userId,
            otherUserId,
            senderName,
            otherUserName,
            content || 'Photo',
            userId,
          ]
        );
        finalConversationId = insert.insertId;
      }
    }

    // ── Insert message ─────────────────────────────────────────
    const [messageInsert] = await db.query(
      `INSERT INTO messages
         (conversation_id, sender_id, sender_name,
          content, image_url, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        finalConversationId,
        userId,
        senderName,
        content,
        imageUrl,
        replyToMessageId || null,
      ]
    );

    const messageId = messageInsert.insertId;

    // ── Update conversation summary ────────────────────────────
    await db.query(
      `UPDATE conversations
       SET last_message   = ?,
           last_sender_id = ?,
           typing_user_id = NULL,
           updated_at     = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [content || 'Photo', userId, finalConversationId]
    );

    // ── Notification (fire-and-forget) ─────────────────────────
    if (otherUserId) {
      db.query(
        `INSERT INTO notifications
           (user_id, type, title, message, related_item_id)
         VALUES (?, 'new_message', 'New Message Received', ?, ?)`,
        [
          otherUserId,
          `${senderName} sent you a message about "${itemTitle}".`,
          relatedItemId || null,
        ]
      ).catch((e) =>
        console.error('[messageController] notification insert error:', e.message)
      );
    }

    // ── Emit via Socket.IO (if wired) ─────────────────────────
    const io = req.app.get('io');
    if (io) {
      const [msgRows] = await db.query(
        'SELECT * FROM messages WHERE id = ?',
        [messageId]
      );
      const newMsg = { ...msgRows[0], reactions: safeParseJSON(msgRows[0]?.reactions) };
      io.to(`conv:${finalConversationId}`).emit('message:new', {
        conversationId: finalConversationId,
        message:        newMsg,
      });
    }

    // ── Return created message ─────────────────────────────────
    const [messageRows] = await db.query(
      'SELECT * FROM messages WHERE id = ?',
      [messageId]
    );
    const createdMessage = {
      ...messageRows[0],
      reactions: safeParseJSON(messageRows[0]?.reactions),
    };

    return res.status(201).json({
      success:         true,
      data:            createdMessage,
      conversation_id: finalConversationId,
    });

  } catch (error) {
    console.error('[messageController] sendMessage error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to send message',
      ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
    });
  }
};

// ─────────────────────────────────────────────────────────────────
//  PUT /api/messages/:conversationId/typing
// ─────────────────────────────────────────────────────────────────
const updateTypingStatus = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    const { conversationId } = req.params;
    const userId = Number(req.user.id);
    const typing = Boolean(req.body.typing);

    const [conversations] = await db.query(
      `SELECT * FROM conversations
       WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
      [conversationId, userId, userId]
    );

    if (!conversations.length) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    await db.query(
      `UPDATE conversations SET typing_user_id = ? WHERE id = ?`,
      [typing ? userId : null, conversationId]
    );

    // Also broadcast via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conversationId}`).emit('typing:update', {
        conversationId: Number(conversationId),
        userId,
        typing,
      });
    }

    return res.json({ success: true, data: { typing } });

  } catch (error) {
    console.error('[messageController] updateTypingStatus error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update typing status' });
  }
};

// ─────────────────────────────────────────────────────────────────
//  PUT /api/messages/:messageId/reaction
// ─────────────────────────────────────────────────────────────────
const setReaction = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    const { messageId } = req.params;
    const userId   = Number(req.user.id);
    const reaction = (req.body.reaction ?? '').toString().trim();

    if (!reaction) {
      return res.status(400).json({ success: false, message: 'Reaction emoji is required' });
    }

    const [messageRows] = await db.query(
      `SELECT m.*, c.user_one_id, c.user_two_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ?`,
      [messageId]
    );

    if (!messageRows.length) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const message = messageRows[0];
    const authorized =
      Number(message.user_one_id) === userId ||
      Number(message.user_two_id) === userId;

    if (!authorized) {
      return res.status(403).json({ success: false, message: 'Not authorised to react' });
    }

    const currentReactions = safeParseJSON(message.reactions);
    const nextReactions    = { ...currentReactions, [userId]: reaction };

    await db.query(
      'UPDATE messages SET reactions = ? WHERE id = ?',
      [JSON.stringify(nextReactions), messageId]
    );

    const [updatedRows] = await db.query(
      'SELECT * FROM messages WHERE id = ?',
      [messageId]
    );
    const updated = { ...updatedRows[0], reactions: safeParseJSON(updatedRows[0]?.reactions) };

    // Broadcast reaction update
    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${message.conversation_id}`).emit('message:reaction:update', {
        conversationId: message.conversation_id,
        messageId:      Number(messageId),
        reactions:      updated.reactions,
        userId,
      });
    }

    return res.json({ success: true, data: updated });

  } catch (error) {
    console.error('[messageController] setReaction error:', error);
    return res.status(500).json({ success: false, message: 'Unable to set reaction' });
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  updateTypingStatus,
  setReaction,
};