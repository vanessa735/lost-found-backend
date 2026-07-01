const express = require('express');
const router = express.Router();

const {
  getConversations,
  getMessages,
  sendMessage,
  updateTypingStatus,
  setReaction,
} = require('../controllers/messageController');

const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/conversations', protect, getConversations);
router.get('/:conversationId', protect, getMessages);
router.post('/', protect, upload.single('image'), sendMessage);
router.put('/:conversationId/typing', protect, updateTypingStatus);
router.put('/:messageId/reaction', protect, setReaction);

module.exports = router;
