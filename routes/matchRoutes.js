const express = require('express');
const router = express.Router();

// Example routes (adjust to your project)
router.get('/', (req, res) => {
    res.json({ message: "Matches route working" });
});

router.post('/', (req, res) => {
    res.json({ message: "Create match" });
});

// ✅ IMPORTANT FIX
module.exports = router;