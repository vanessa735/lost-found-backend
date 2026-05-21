const express = require("express");
const router  = express.Router();

// ── Controller ────────────────────────────────────────────────────────────────
const itemController = require("../controllers/itemController");

// ── Middleware ────────────────────────────────────────────────────────────────
const { protect, optionalAuth } = require("../middleware/auth");
const upload = require("../middleware/upload");

// ── Destructure & validate exports at startup ─────────────────────────────────
const {
    createItem,
    getItems,
    getItemById,
    getMyItems,
    updateItem,
    deleteItem,
    getCategories,
    getStats
} = itemController;

// Fail fast with a descriptive message if any handler is missing
const requiredHandlers = {
    createItem, getItems, getItemById, getMyItems,
    updateItem, deleteItem, getCategories, getStats
};

Object.entries(requiredHandlers).forEach(([name, fn]) => {
    if (typeof fn !== "function") {
        throw new Error(
            `[itemRoutes] "${name}" is not a function. ` +
            `Check exports in controllers/itemController.js`
        );
    }
});

const requiredMiddleware = { protect, optionalAuth };
Object.entries(requiredMiddleware).forEach(([name, fn]) => {
    if (typeof fn !== "function") {
        throw new Error(
            `[itemRoutes] middleware "${name}" is not a function. ` +
            `Check exports in middleware/auth.js`
        );
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// STATIC ROUTES  (must be declared BEFORE  /:id  to avoid route conflicts)
// ─────────────────────────────────────────────────────────────────────────────

// GET  /api/items/categories/all
router.get("/categories/all", getCategories);

// GET  /api/items/stats/overview
router.get("/stats/overview", getStats);

// GET  /api/items/my/items   (auth required)
router.get("/my/items", protect, getMyItems);

// ─────────────────────────────────────────────────────────────────────────────
// ROOT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET  /api/items
router.get("/", optionalAuth, getItems);

// POST /api/items   (auth + file upload)
router.post(
    "/",
    protect,
    upload.fields([
        { name: "image",  maxCount: 1 },
        { name: "image2", maxCount: 1 },
        { name: "image3", maxCount: 1 }
    ]),
    createItem
);

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC :id ROUTES  (always LAST)
// ─────────────────────────────────────────────────────────────────────────────

// GET    /api/items/:id
router.get("/:id", optionalAuth, getItemById);

// PUT    /api/items/:id   (auth required)
router.put("/:id", protect, updateItem);

// DELETE /api/items/:id   (auth required)
router.delete("/:id", protect, deleteItem);

module.exports = router;