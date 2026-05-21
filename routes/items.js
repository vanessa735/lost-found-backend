'use strict';

const express        = require('express');
const router         = express.Router();
const itemsCtrl      = require('../controllers/itemsController');
const { protect }    = require('../middleware/auth');
const upload         = require('../middleware/upload');

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  ORDER MATTERS — named routes MUST come before /:id
//     Otherwise Express treats "stats" and "categories" as IDs
// ─────────────────────────────────────────────────────────────────────────────

// ── Public: named routes first ────────────────────────────────────────────────
router.get('/stats/overview',  itemsCtrl.getStats);        // ✅ fixed 404
router.get('/categories/all',  itemsCtrl.getCategories);

// ── Protected: user-scoped ────────────────────────────────────────────────────
router.get('/my/items',        protect, itemsCtrl.getMyItems);

// ── Public: collection + single ───────────────────────────────────────────────
router.get('/',                itemsCtrl.getItems);
router.get('/:id',             itemsCtrl.getItemById);     // ← last GET, catches :id

// ── Protected: mutations ──────────────────────────────────────────────────────
router.post(
  '/',
  protect,
  upload.fields([
    { name: 'image',  maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 },
  ]),
  itemsCtrl.createItem
);
router.put('/:id',    protect, itemsCtrl.updateItem);
router.delete('/:id', protect, itemsCtrl.deleteItem);

module.exports = router;