'use strict';

const db = require('../config/db');

const safeParseJSON = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
};

const getConversations = async (req, res) => {
  try {
    const [conversations] = await db.query(
      `SELECT c.id, c.item_id, c.item_title, c.item_type,
              c.user_one_id, c.user_two_id,
              c.user_one_name, c.user_two_name,
              c.last_message, c.last_sender_id,
              c.typing_user_id, c.updated_at AS last_updated
       FROM conversations c
       WHERE c.user_one_id = ? OR c.user_two_id = ?
       ORDER BY c.updated_at DESC`,
      [req.user.id, req.user.id]
    );

    const prepared = conversations.map((conv) => {
      const otherUserId = conv.user_one_id === req.user.id ? conv.user_two_id : conv.user_one_id;
      const otherUserName = conv.user_one_id === req.user.id ? conv.user_two_name : conv.user_one_name;
      const typingUserName = conv.typing_user_id && conv.typing_user_id !== req.user.id
        ? (conv.typing_user_id === conv.user_one_id ? conv.user_one_name : conv.user_two_name)
        : null;

      return {
        id: conv.id,
        item_id: conv.item_id,
        item_title: conv.item_title,
        item_type: conv.item_type,
        other_user_id: otherUserId,
        other_user_name: otherUserName,
        last_message: conv.last_message,
        last_sender_id: conv.last_sender_id,
        typing_user_id: conv.typing_user_id,
        typing_user_name: typingUserName,
        last_updated: conv.last_updated,
      };
    });

    return res.json({ success: true, data: prepared });
  } catch (error) {
    console.error('[messageController] getConversations error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch conversations' });
  }
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const [conversations] = await db.query(
      `SELECT * FROM conversations
       WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
      [conversationId, req.user.id, req.user.id]
    );

    if (!conversations.length) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const [messages] = await db.query(
      `SELECT m.*,
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
      reply_to_message: msg.reply_to_message_id ? {
        sender_name: msg.reply_to_sender_name,
        content: msg.reply_to_content,
        image_url: msg.reply_to_image_url,
      } : null,
    }));

    return res.json({ success: true, data: normalized });
  } catch (error) {
    console.error('[messageController] getMessages error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch messages' });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { conversation_id, item_id, content } = req.body;
    let conversationId = conversation_id;
    let itemTitle = null;
    let itemType = null;
    let otherUserId = null;
    let otherUserName = null;

    const senderName = req.user.full_name || req.user.email;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    if (!conversationId && !item_id) {
      return res.status(400).json({ success: false, message: 'Conversation or item must be provided' });
    }

    let relatedItemId = null;

    if (conversationId) {
      const [existing] = await db.query(
        `SELECT * FROM conversations
         WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
        [conversationId, req.user.id, req.user.id]
      );

      if (!existing.length) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }

      const conv = existing[0];
      itemTitle = conv.item_title;
      itemType = conv.item_type;
      relatedItemId = conv.item_id;
      otherUserId = conv.user_one_id === req.user.id ? conv.user_two_id : conv.user_one_id;
      otherUserName = conv.user_one_id === req.user.id ? conv.user_two_name : conv.user_one_name;
    } else {
      const [items] = await db.query('SELECT id, title, type, user_id FROM items WHERE id = ?', [item_id]);
      if (!items.length) {
        return res.status(404).json({ success: false, message: 'Item not found' });
      }

      const item = items[0];
      itemTitle = item.title;
      itemType = item.type;
      relatedItemId = item.id;
      const otherUser = item.user_id === req.user.id ? null : item.user_id;

      if (!otherUser) {
        return res.status(400).json({ success: false, message: 'Cannot message your own item' });
      }

      const [users] = await db.query('SELECT id, full_name FROM users WHERE id = ?', [otherUser]);
      if (!users.length) {
        return res.status(404).json({ success: false, message: 'Target user not found' });
      }
      otherUserId = users[0].id;
      otherUserName = users[0].full_name || users[0].email;

      const [conversationExists] = await db.query(
        `SELECT * FROM conversations
         WHERE item_id = ? AND ((user_one_id = ? AND user_two_id = ?) OR (user_one_id = ? AND user_two_id = ?))`,
        [item.id, req.user.id, otherUserId, otherUserId, req.user.id]
      );

      if (conversationExists.length) {
        conversationId = conversationExists[0].id;
      } else {
        const userOneName = req.user.full_name || req.user.email;
        const userTwoName = otherUserName;
        const [insert] = await db.query(
          `INSERT INTO conversations
             (item_id, item_title, item_type, user_one_id, user_two_id, user_one_name, user_two_name, last_message, last_sender_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.id, item.title, item.type, req.user.id, otherUserId, userOneName, userTwoName, content || 'Photo', req.user.id]
        );
        conversationId = insert.insertId;
      }
    }

    const [messageInsert] = await db.query(
      `INSERT INTO messages
         (conversation_id, sender_id, sender_name, content, image_url)
       VALUES (?, ?, ?, ?, ?)`,
      [conversationId, req.user.id, senderName, content || null, imageUrl]
    );

    const messageId = messageInsert.insertId;

    await db.query(
      `UPDATE conversations
         SET last_message = ?, last_sender_id = ?, typing_user_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      [content || 'Photo', req.user.id, conversationId]
    );

    if (otherUserId) {
      try {
        await db.query(
          `INSERT INTO notifications
             (user_id, type, title, message, related_item_id)
           VALUES (?, 'new_message', 'New Message Received', ?, ?)`,
          [
            otherUserId,
            `${senderName} sent you a new message about "${itemTitle}".`,
            relatedItemId || null,
          ]
        );
      } catch (notifErr) {
        console.error('[messageController] Message notification insert error:', notifErr.message);
      }
    }

    const [messageRows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
    const createdMessage = messageRows[0];

    return res.json({ success: true, data: createdMessage });
  } catch (error) {
    console.error('[messageController] sendMessage error:', error);
    return res.status(500).json({ success: false, message: 'Unable to send message' });
  }
};

const updateTypingStatus = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { typing } = req.body;

    const [conversations] = await db.query(
      `SELECT * FROM conversations WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)`,
      [conversationId, req.user.id, req.user.id]
    );

    if (!conversations.length) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    await db.query(
      `UPDATE conversations SET typing_user_id = ? WHERE id = ?`,
      [typing ? req.user.id : null, conversationId]
    );

    return res.json({ success: true, data: { typing: Boolean(typing) } });
  } catch (error) {
    console.error('[messageController] updateTypingStatus error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update typing status' });
  }
};

const setReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reaction } = req.body;

    if (!reaction) {
      return res.status(400).json({ success: false, message: 'Reaction is required' });
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
    if (![message.user_one_id, message.user_two_id].includes(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to react to this message' });
    }

    const currentReactions = safeParseJSON(message.reactions);
    const nextReactions = {
      ...currentReactions,
      [req.user.id]: reaction,
    };

    await db.query(
      'UPDATE messages SET reactions = ? WHERE id = ?',
      [JSON.stringify(nextReactions), messageId]
    );

    const [updatedRows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);

    return res.json({ success: true, data: updatedRows[0] });
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
