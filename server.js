"use strict";
const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");
require("dotenv").config();

const app = express();
const db  = require("./config/db");


// ═══════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════
app.use(cors({
    origin: [
        "http://localhost:3000",
        "http://localhost:5000",
        "http://localhost:5001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5001"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve uploads
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

// ═══════════════════════════════════════════
// REQUEST TRACKER
// ═══════════════════════════════════════════
const serverStartTime = Date.now();
const stats = {
    total: 0, success: 0, errors: 0,
    methods: { GET: 0, POST: 0, PUT: 0, DELETE: 0 },
    routes: {},
    recent: []
};

app.use((req, res, next) => {
    const start = Date.now();
    stats.total++;
    stats.methods[req.method] = (stats.methods[req.method] || 0) + 1;

    const key = `${req.method} ${req.path}`;
    stats.routes[key] = (stats.routes[key] || 0) + 1;

    const origSend = res.send;
    res.send = function (data) {
        const ms = Date.now() - start;
        if (res.statusCode >= 400) stats.errors++;
        else stats.success++;

        stats.recent.unshift({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: `${ms}ms`,
            time: new Date().toISOString()
        });
        if (stats.recent.length > 50) stats.recent.length = 50;

        return origSend.call(this, data);
    };
    next();
});

// ═══════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════
const authRoutes         = require("./routes/authRoutes");
const itemRoutes         = require("./routes/itemRoutes");
const matchRoutes        = require("./routes/matchRoutes");
const contactRoutes = require("./routes/contactRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

console.log("✅ authRoutes loaded:        ", typeof authRoutes);
console.log("✅ itemRoutes loaded:        ", typeof itemRoutes);
console.log("✅ matchRoutes loaded:       ", typeof matchRoutes);
console.log("✅ notificationRoutes loaded:", typeof notificationRoutes);

app.use("/api/auth",          authRoutes);
app.use("/api/items",         itemRoutes);
app.use("/api/matches",       matchRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/contact", contactRoutes);

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function fmtUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(" ");
}

// Safe DB query helper
async function safeQuery(sql, params = []) {
    try {
        const [rows] = await db.query(sql, params);
        return rows;
    } catch (err) {
        console.error("DB Query error:", err.message);
        return null;
    }
}

// ═══════════════════════════════════════════
// HOMEPAGE DASHBOARD
// ═══════════════════════════════════════════
app.get("/", async (_req, res) => {
    const uptime = fmtUptime(Date.now() - serverStartTime);

    // Fetch stats safely
    const usersR      = await safeQuery("SELECT COUNT(*) as c FROM users");
    const itemsR      = await safeQuery("SELECT COUNT(*) as c FROM items");
    const lostR       = await safeQuery("SELECT COUNT(*) as c FROM items WHERE type='lost'");
    const foundR      = await safeQuery("SELECT COUNT(*) as c FROM items WHERE type='found'");
    const activeR     = await safeQuery("SELECT COUNT(*) as c FROM items WHERE status='active'");
    const returnedR   = await safeQuery("SELECT COUNT(*) as c FROM items WHERE status='returned'");
    const matchesR    = await safeQuery("SELECT COUNT(*) as c FROM matches");
    const confirmedR  = await safeQuery("SELECT COUNT(*) as c FROM matches WHERE status='confirmed'");
    const notifR      = await safeQuery("SELECT COUNT(*) as c FROM notifications");
    const catR        = await safeQuery("SELECT COUNT(*) as c FROM categories");
    const recentUsers = await safeQuery("SELECT id,full_name,email,user_type,created_at FROM users ORDER BY created_at DESC LIMIT 5") || [];
    const recentItems = await safeQuery(`
        SELECT i.id,i.title,i.type,i.status,i.city,i.created_at,
               u.full_name as reporter, c.name_en as category
        FROM items i
        LEFT JOIN users u ON i.user_id=u.id
        LEFT JOIN categories c ON i.category_id=c.id
        ORDER BY i.created_at DESC LIMIT 5
    `) || [];
    const topCats = await safeQuery(`
        SELECT c.name_en,c.icon,COUNT(i.id) as total
        FROM categories c LEFT JOIN items i ON c.id=i.category_id
        GROUP BY c.id ORDER BY total DESC LIMIT 6
    `) || [];

    const dbOk = usersR !== null;
    const d = {
        users:     usersR?.[0]?.c     || 0,
        items:     itemsR?.[0]?.c     || 0,
        lost:      lostR?.[0]?.c      || 0,
        found:     foundR?.[0]?.c     || 0,
        active:    activeR?.[0]?.c    || 0,
        returned:  returnedR?.[0]?.c  || 0,
        matches:   matchesR?.[0]?.c   || 0,
        confirmed: confirmedR?.[0]?.c || 0,
        notifs:    notifR?.[0]?.c     || 0,
        cats:      catR?.[0]?.c       || 0,
    };

    const topRoutes = Object.entries(stats.routes).sort((a,b) => b[1]-a[1]).slice(0,10);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>FindIt API Dashboard</title>
<meta http-equiv="refresh" content="30"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(135deg,#0f172a,#1e293b,#0f172a);color:#e2e8f0;min-height:100vh;padding:20px}
.c{max-width:1400px;margin:0 auto}
.hdr{text-align:center;padding:40px 20px;background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:20px;margin-bottom:30px;position:relative;overflow:hidden}
.hdr::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.1) 0%,transparent 50%);animation:p 4s ease-in-out infinite}
@keyframes p{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.1);opacity:.8}}
.hdr h1{font-size:2.5em;font-weight:800;position:relative;z-index:1}
.hdr .sub{font-size:1.1em;opacity:.9;margin-top:8px;position:relative;z-index:1}
.hdr .ver{display:inline-block;background:rgba(255,255,255,.2);padding:4px 16px;border-radius:50px;font-size:.85em;margin-top:12px;position:relative;z-index:1}
.sb{display:flex;gap:15px;margin-bottom:30px;flex-wrap:wrap}
.si{flex:1;min-width:180px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:20px;display:flex;align-items:center;gap:15px}
.sd{width:14px;height:14px;border-radius:50%;animation:blink 2s infinite}
.sd.g{background:#22c55e;box-shadow:0 0 10px #22c55e}.sd.r{background:#ef4444;box-shadow:0 0 10px #ef4444}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
.si h3{font-size:.85em;color:#94a3b8;font-weight:500}.si p{font-size:1.15em;font-weight:700;color:#f1f5f9}
.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:15px;margin-bottom:30px}
.sc{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;text-align:center;transition:all .3s}
.sc:hover{transform:translateY(-4px);border-color:#3b82f6;box-shadow:0 8px 30px rgba(59,130,246,.2)}
.sc .i{font-size:2em;margin-bottom:10px;display:block}
.sc .n{font-size:2.2em;font-weight:800}
.sc .l{font-size:.85em;color:#94a3b8;margin-top:4px}
.bl{background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.rd{background:linear-gradient(135deg,#f87171,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.gr{background:linear-gradient(135deg,#4ade80,#2dd4bf);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.pr{background:linear-gradient(135deg,#a78bfa,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.yl{background:linear-gradient(135deg,#fbbf24,#f97316);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.sec{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;margin-bottom:20px}
.sec h2{font-size:1.3em;margin-bottom:20px;display:flex;align-items:center;gap:10px;color:#f1f5f9}
.tc{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:768px){.tc{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:.8em;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #334155}
td{padding:10px 12px;font-size:.9em;border-bottom:1px solid rgba(51,65,85,.5);color:#cbd5e1}
tr:hover td{background:rgba(59,130,246,.05)}
.b{display:inline-block;padding:3px 10px;border-radius:50px;font-size:.75em;font-weight:600}
.b-lost{background:#7f1d1d;color:#fca5a5}.b-found{background:#14532d;color:#86efac}
.b-active{background:#1e3a5f;color:#93c5fd}.b-returned{background:#365314;color:#bef264}
.b-get{background:#1e3a5f;color:#93c5fd}.b-post{background:#14532d;color:#86efac}
.b-put{background:#713f12;color:#fde047}.b-delete{background:#7f1d1d;color:#fca5a5}
.b-2{background:#14532d;color:#86efac}.b-4{background:#713f12;color:#fde047}.b-5{background:#7f1d1d;color:#fca5a5}
.rl{list-style:none;padding:0}
.rl li{padding:8px 12px;border-bottom:1px solid #334155;font-family:'Cascadia Code','Fira Code',monospace;font-size:.85em;display:flex;align-items:center;gap:10px}
.rl li:hover{background:rgba(59,130,246,.05)}
.rm{display:inline-block;width:55px;text-align:center;padding:2px 8px;border-radius:4px;font-size:.8em;font-weight:700}
.rm.get{background:#1e3a5f;color:#93c5fd}.rm.post{background:#14532d;color:#86efac}
.rm.put{background:#713f12;color:#fde047}.rm.del{background:#7f1d1d;color:#fca5a5}
.cg{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.ci{background:#0f172a;border:1px solid #334155;border-radius:12px;padding:15px;text-align:center;transition:all .3s}
.ci:hover{border-color:#3b82f6;transform:translateY(-2px)}
.ci .ck{font-size:1.8em;margin-bottom:5px}.ci .cn{font-size:.8em;color:#94a3b8}.ci .cc{font-size:1.2em;font-weight:700;color:#60a5fa}
.ft{text-align:center;padding:20px;color:#475569;font-size:.85em}
.ft a{color:#60a5fa;text-decoration:none}
.rn{text-align:center;color:#475569;font-size:.8em;margin-bottom:20px}
</style>
</head>
<body>
<div class="c">
<div class="hdr">
<h1>🔍 FindIt API Server</h1>
<p class="sub">Lost & Found Application Backend</p>
<span class="ver">v1.0.0 • Node.js ${process.version}</span>
</div>
<p class="rn">🔄 Auto-refreshes every 30s • ${new Date().toLocaleString()}</p>
<div class="sb">
<div class="si"><div class="sd g"></div><div><h3>Server</h3><p>🟢 Online</p></div></div>
<div class="si"><div class="sd ${dbOk?"g":"r"}"></div><div><h3>Database</h3><p>${dbOk?"🟢 Connected":"🔴 Error"}</p></div></div>
<div class="si"><div><h3>Uptime</h3><p>⏱️ ${uptime}</p></div></div>
<div class="si"><div><h3>Environment</h3><p>🔧 ${process.env.NODE_ENV||"development"}</p></div></div>
<div class="si"><div><h3>Port</h3><p>📡 ${process.env.PORT||5000}</p></div></div>
</div>
<div class="sg">
<div class="sc"><span class="i">👥</span><div class="n bl">${d.users}</div><div class="l">Users</div></div>
<div class="sc"><span class="i">🔍</span><div class="n rd">${d.lost}</div><div class="l">Lost</div></div>
<div class="sc"><span class="i">📦</span><div class="n gr">${d.found}</div><div class="l">Found</div></div>
<div class="sc"><span class="i">🔗</span><div class="n pr">${d.matches}</div><div class="l">Matches</div></div>
<div class="sc"><span class="i">✅</span><div class="n yl">${d.confirmed}</div><div class="l">Confirmed</div></div>
<div class="sc"><span class="i">🎉</span><div class="n gr">${d.returned}</div><div class="l">Returned</div></div>
<div class="sc"><span class="i">📂</span><div class="n bl">${d.cats}</div><div class="l">Categories</div></div>
<div class="sc"><span class="i">🔔</span><div class="n bl">${d.notifs}</div><div class="l">Notifications</div></div>
</div>
<div class="tc">
<div class="sec"><h2>👥 Recent Users</h2>${recentUsers.length?`<table><tr><th>Name</th><th>Email</th><th>Type</th><th>Joined</th></tr>${recentUsers.map(u=>`<tr><td><b>${u.full_name}</b></td><td>${u.email}</td><td><span class="b b-active">${u.user_type}</span></td><td>${new Date(u.created_at).toLocaleDateString()}</td></tr>`).join("")}</table>`:"<p style='color:#64748b'>No users yet</p>"}</div>
<div class="sec"><h2>📋 Recent Items</h2>${recentItems.length?`<table><tr><th>Title</th><th>Type</th><th>Status</th><th>By</th></tr>${recentItems.map(i=>`<tr><td><b>${i.title}</b></td><td><span class="b b-${i.type}">${i.type}</span></td><td><span class="b b-${i.status}">${i.status}</span></td><td>${i.reporter||"N/A"}</td></tr>`).join("")}</table>`:"<p style='color:#64748b'>No items yet</p>"}</div>
</div>
<div class="sec"><h2>📂 Categories</h2><div class="cg">${topCats.map(c=>`<div class="ci"><div class="ck">${c.icon||"📦"}</div><div class="cn">${c.name_en}</div><div class="cc">${c.total} items</div></div>`).join("")}</div></div>
<div class="tc">
<div class="sec"><h2>📊 Requests</h2>
<div class="sg" style="grid-template-columns:repeat(2,1fr)">
<div class="sc"><div class="n bl">${stats.total}</div><div class="l">Total</div></div>
<div class="sc"><div class="n gr">${stats.success}</div><div class="l">Success</div></div>
<div class="sc"><div class="n rd">${stats.errors}</div><div class="l">Errors</div></div>
<div class="sc"><div class="n bl">${stats.total?Math.round(stats.success/stats.total*100):0}%</div><div class="l">Rate</div></div>
</div>
${topRoutes.length?`<h3 style="margin:20px 0 10px;color:#94a3b8;font-size:.9em">Top Routes</h3><table><tr><th>Route</th><th>Hits</th></tr>${topRoutes.map(([r,c])=>`<tr><td style="font-family:monospace;font-size:.8em">${r}</td><td>${c}</td></tr>`).join("")}</table>`:""}
</div>
<div class="sec"><h2>🛣️ API Endpoints</h2>
<ul class="rl">
<li><span class="rm post">POST</span>/api/auth/register</li>
<li><span class="rm post">POST</span>/api/auth/login</li>
<li><span class="rm get">GET</span>/api/auth/me</li>
<li><span class="rm put">PUT</span>/api/auth/profile</li>
<li><span class="rm put">PUT</span>/api/auth/change-password</li>
<li style="border-top:2px solid #334155;margin-top:8px;padding-top:12px"><span class="rm get">GET</span>/api/items</li>
<li><span class="rm get">GET</span>/api/items/categories/all</li>
<li><span class="rm get">GET</span>/api/items/stats/overview</li>
<li><span class="rm get">GET</span>/api/items/my/items</li>
<li><span class="rm get">GET</span>/api/items/:id</li>
<li><span class="rm post">POST</span>/api/items</li>
<li><span class="rm put">PUT</span>/api/items/:id</li>
<li><span class="rm del">DEL</span>/api/items/:id</li>
<li style="border-top:2px solid #334155;margin-top:8px;padding-top:12px"><span class="rm get">GET</span>/api/matches</li>
<li><span class="rm put">PUT</span>/api/matches/:id/confirm</li>
<li><span class="rm put">PUT</span>/api/matches/:id/reject</li>
<li><span class="rm put">PUT</span>/api/matches/:id/returned</li>
<li style="border-top:2px solid #334155;margin-top:8px;padding-top:12px"><span class="rm get">GET</span>/api/notifications</li>
<li><span class="rm put">PUT</span>/api/notifications/read-all</li>
<li><span class="rm put">PUT</span>/api/notifications/:id/read</li>
</ul>
</div>
</div>
${stats.recent.length?`<div class="sec"><h2>🕐 Recent Requests</h2><table><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Speed</th></tr>${stats.recent.slice(0,20).map(r=>`<tr><td style="font-size:.8em">${new Date(r.time).toLocaleTimeString()}</td><td><span class="b b-${r.method.toLowerCase()}">${r.method}</span></td><td style="font-family:monospace;font-size:.8em">${r.path}</td><td><span class="b b-${String(r.status)[0]}">${r.status}</span></td><td>${r.ms}</td></tr>`).join("")}</table></div>`:""}
<div class="ft"><p>🔍 FindIt API • Node.js + Express + MySQL</p><p style="margin-top:5px"><a href="/api/health">Health</a> • <a href="/api/items/stats/overview">Stats</a> • <a href="/api/items/categories/all">Categories</a></p></div>
</div>
</body></html>`;

    res.setHeader("Content-Type", "text/html");
    return res.send(html);
});

// ═══════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════
app.get("/api/health", async (_req, res) => {
    let dbOk = false;
    try { await db.query("SELECT 1"); dbOk = true; } catch(_){}

    return res.json({
        success: true,
        message: "🟢 FindIt API is running!",
        server: "online",
        database: dbOk ? "connected" : "disconnected",
        uptime: fmtUptime(Date.now() - serverStartTime),
        timestamp: new Date().toISOString()
    });
});

// ═══════════════════════════════════════════
// 404 + ERROR HANDLERS
// ═══════════════════════════════════════════
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found"
    });
});

app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    next();
});

app.use((err, _req, res, _next) => {
    console.error("Server error:", err.message);
    res.status(err.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === "production"
            ? "Server error"
            : err.message || "Server error"
    });
});

// ═══════════════════════════════════════════
// START
// ═══════════════════════════════════════════
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║   🔍 FindIt - Lost & Found API Server           ║
║                                                  ║
║   📡 Port:      ${String(PORT).padEnd(37)}║
║   🌐 Home:      http://localhost:${String(PORT).padEnd(20)}║
║   💚 Health:    http://localhost:${PORT}/api/health  ║
║   🔧 Env:       ${(process.env.NODE_ENV||"development").padEnd(33)}║
║                                                  ║
╚══════════════════════════════════════════════════╝
    `);
});