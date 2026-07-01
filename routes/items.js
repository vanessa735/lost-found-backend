'use strict';

const express     = require('express');
const router      = express.Router();
const itemsCtrl   = require('../controllers/itemsController');
const { protect } = require('../middleware/auth');
const upload      = require('../middleware/upload');

// ═══════════════════════════════════════════════════════════════════
// ⚠️  ORDER MATTERS — named routes MUST come before /:id
// ═══════════════════════════════════════════════════════════════════

// ── Public: named GET routes first ───────────────────────────────
router.get('/stats/public',    itemsCtrl.getPublicStats);   // ← NEW: for login/register
router.get('/stats/overview',  itemsCtrl.getStats);
router.get('/categories/all',  itemsCtrl.getCategories);

// ── Protected: user-scoped ────────────────────────────────────────
router.get('/my/items',        protect, itemsCtrl.getMyItems);

// ── Public: collection + single ───────────────────────────────────
router.get('/',                itemsCtrl.getItems);
router.get('/:id',             itemsCtrl.getItemById);

// ── Protected: mutations (with file uploads) ──────────────────────
const uploadFields = upload.fields([
  { name: 'image',  maxCount: 1 },
  { name: 'image2', maxCount: 1 },
  { name: 'image3', maxCount: 1 },
]);

router.post(   '/',      protect, uploadFields, itemsCtrl.createItem);
router.put(    '/:id',   protect, uploadFields, itemsCtrl.updateItem);  // ← now supports images
router.delete( '/:id',   protect,               itemsCtrl.deleteItem);

module.exports = router;