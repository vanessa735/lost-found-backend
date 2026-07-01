'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
require('dotenv').config();

const app    = express();
const db     = require('./config/db');
const server = http.createServer(app);

// ═══════════════════════════════════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════════════════════════════════
const { Server } = require('socket.io');

const ALLOWED_ORIGINS_LIST = [
    'http://localhost:3000', 'http://localhost:5000',
    'http://localhost:5001', 'http://localhost:5173',
    'http://localhost:4173', 'http://127.0.0.1:3000',
    'http://127.0.0.1:5001', 'http://127.0.0.1:5173',
    'https://finditbridge.vercel.app',
    'https://lostandfound-git-main-vanessa-iradukunda-s-projects.vercel.app',
    'https://lost-found-backend-32lt.onrender.com',
    ...(process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
        : []),
];

const isOriginAllowed = (origin) => {
    if (!origin) return true;
    if (ALLOWED_ORIGINS_LIST.includes(origin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin))  return true;
    if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin)) return true;
    return false;
};

const io = new Server(server, {
    cors: {
        origin: (origin, cb) => {
            if (!origin || isOriginAllowed(origin)) return cb(null, true);
            return cb(new Error(`Socket.IO CORS: ${origin}`));
        },
        methods:     ['GET', 'POST'],
        credentials: false,
    },
    transports:   ['polling', 'websocket'],
    upgradeTimeout: 10000,
    pingTimeout:    30000,
    pingInterval:   15000,
    allowEIO3:      true,
});

// ── Online presence ────────────────────────────────────────────────
const onlineUsers = new Map();

const broadcastOnline = () => {
    io.emit('users:online', Array.from(onlineUsers.values()));
};

io.on('connection', (socket) => {
    console.log(`[Socket.IO] Connected: ${socket.id}`);

    socket.on('user:online', ({ userId, userName }) => {
        if (!userId) return;
        onlineUsers.set(String(userId), {
            socketId:    socket.id,
            userId:      String(userId),
            userName:    userName || 'User',
            connectedAt: new Date().toISOString(),
        });
        socket.data.userId   = String(userId);
        socket.data.userName = userName || 'User';
        broadcastOnline();
    });

    socket.on('conversation:join',  ({ conversationId }) => { if (conversationId) socket.join(`conv:${conversationId}`); });
    socket.on('conversation:leave', ({ conversationId }) => { if (conversationId) socket.leave(`conv:${conversationId}`); });

    socket.on('typing:start', ({ conversationId, userId, userName }) => {
        socket.to(`conv:${conversationId}`).emit('typing:update', { conversationId, userId, userName, typing: true });
    });
    socket.on('typing:stop', ({ conversationId, userId }) => {
        socket.to(`conv:${conversationId}`).emit('typing:update', { conversationId, userId, typing: false });
    });

    socket.on('message:send', ({ conversationId, message }) => {
        socket.to(`conv:${conversationId}`).emit('message:new', { conversationId, message });
    });

    socket.on('message:reaction', ({ conversationId, messageId, reaction, userId }) => {
        socket.to(`conv:${conversationId}`).emit('message:reaction:update', { conversationId, messageId, reaction, userId });
    });

    socket.on('disconnect', () => {
        const uid = socket.data.userId;
        if (uid) { onlineUsers.delete(uid); broadcastOnline(); }
        console.log(`[Socket.IO] Disconnected: ${socket.id}`);
    });
});

app.set('io', io);
app.set('onlineUsers', onlineUsers);

// ═══════════════════════════════════════════════════════════════════
//  ANSI COLORS
// ═══════════════════════════════════════════════════════════════════
const C = {
    reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
    red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m',
    blue:'\x1b[34m', cyan:'\x1b[36m', white:'\x1b[37m', gray:'\x1b[90m',
    bRed:'\x1b[91m', bGreen:'\x1b[92m', bYellow:'\x1b[93m',
    bBlue:'\x1b[94m', bCyan:'\x1b[96m', bWhite:'\x1b[97m',
    bgGray:'\x1b[100m',
};
const clr  = (c, t) => `${c}${t}${C.reset}`;
const bold = (t)    => `${C.bold}${t}${C.reset}`;
const dim  = (t)    => `${C.dim}${t}${C.reset}`;

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const SERVER_START = Date.now();
const NODE_ENV     = process.env.NODE_ENV || 'development';
const PORT         = parseInt(process.env.PORT || '5001', 10);
const IS_PROD      = NODE_ENV === 'production';

// ═══════════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════════
const stats = {
    total:0, success:0, errors:0, totalMs:0,
    methods:  { GET:0, POST:0, PUT:0, DELETE:0, PATCH:0, OPTIONS:0 },
    statuses: {}, routes:{}, slowest:[], recent:[], errorLog:[],
};
const ROUTE_REGISTRY = [];

// ═══════════════════════════════════════════════════════════════════
//  CORS
// ═══════════════════════════════════════════════════════════════════
const corsOptions = {
    origin: (origin, cb) => {
        if (isOriginAllowed(origin)) return cb(null, true);
        return cb(new Error(`CORS: "${origin}" not allowed`));
    },
    credentials:          false,
    methods:              ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders:       ['Content-Type','Authorization','X-Requested-With','Accept'],
    exposedHeaders:       ['Content-Range','X-Content-Range'],
    optionsSuccessStatus: 200,
    maxAge:               86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use((req, res, next) => {
    const o = req.headers.origin;
    if (isOriginAllowed(o)) {
        res.setHeader('Access-Control-Allow-Origin',      o || '*');
        res.setHeader('Access-Control-Allow-Credentials', 'false');
        res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers',     'Content-Type,Authorization,X-Requested-With,Accept');
    }
    next();
});

// ═══════════════════════════════════════════════════════════════════
//  SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════
app.use((_req, res, next) => {
    res.setHeader('X-Powered-By',           'FindIt API');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options',        'DENY');
    res.setHeader('Referrer-Policy',        'strict-origin-when-cross-origin');
    next();
});

// ═══════════════════════════════════════════════════════════════════
//  BODY PARSERS
// ═══════════════════════════════════════════════════════════════════
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ═══════════════════════════════════════════════════════════════════
//  STATIC FILES
// ═══════════════════════════════════════════════════════════════════
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// ═══════════════════════════════════════════════════════════════════
//  REQUEST LOGGER
// ═══════════════════════════════════════════════════════════════════
app.use((req, res, next) => {
    const start    = Date.now();
    const routeKey = `${req.method} ${req.path}`;
    stats.total++;
    stats.methods[req.method] = (stats.methods[req.method] || 0) + 1;
    stats.routes[routeKey]    = (stats.routes[routeKey]    || 0) + 1;

    const origSend = res.send.bind(res);
    res.send = function (body) {
        const ms     = Date.now() - start;
        const status = res.statusCode;
        stats.totalMs          += ms;
        stats.statuses[status]  = (stats.statuses[status] || 0) + 1;
        if (status >= 400) {
            stats.errors++;
            stats.errorLog.unshift({ method: req.method, path: req.path, status, ms, time: new Date().toISOString() });
            if (stats.errorLog.length > 20) stats.errorLog.length = 20;
        } else {
            stats.success++;
        }
        stats.slowest.push({ method: req.method, path: req.path, ms, status });
        stats.slowest.sort((a, b) => b.ms - a.ms);
        if (stats.slowest.length > 5) stats.slowest.length = 5;
        stats.recent.unshift({ method: req.method, path: req.path, status, ms: `${ms}ms`, time: new Date().toISOString() });
        if (stats.recent.length > 50) stats.recent.length = 50;

        if (req.path !== '/api/health') {
            const mc = { GET:C.bBlue,POST:C.bGreen,PUT:C.bYellow,DELETE:C.bRed,PATCH:C.bCyan,OPTIONS:C.gray }[req.method]||C.white;
            const sc = status<300?C.bGreen:status<400?C.bCyan:status<500?C.bYellow:C.bRed;
            const mc2 = ms<100?C.bGreen:ms<500?C.bYellow:C.bRed;
            const icon = status<300?'✔':status<400?'↪':status<500?'✘':'💥';
            process.stdout.write(
                `  ${clr(C.gray,new Date().toTimeString().slice(0,8))} ` +
                `${clr(mc,req.method.padEnd(7))}${clr(C.bWhite,req.path.padEnd(48))}` +
                `${clr(sc,`${icon} ${status}`).padEnd(8)} ${clr(mc2,`${ms}ms`.padStart(7))}\n`
            );
        }
        return origSend(body);
    };
    next();
});

// ═══════════════════════════════════════════════════════════════════
//  ROUTE LOADER
// ═══════════════════════════════════════════════════════════════════
function mountRoutes() {
    const routes = [
        { prefix: '/api/auth',          file: './routes/authRoutes',         label: 'Auth'          },
        { prefix: '/api/items',         file: './routes/itemRoutes',         label: 'Items'         },
        { prefix: '/api/matches',       file: './routes/matchRoutes',        label: 'Matches'       },
        { prefix: '/api/notifications', file: './routes/notificationRoutes', label: 'Notifications' },
        { prefix: '/api/contact',       file: './routes/contactRoutes',      label: 'Contact'       },
        { prefix: '/api/subscribe',     file: './routes/subscribeRoutes',    label: 'Subscribe'     },
        { prefix: '/api/messages',      file: './routes/messageRoutes',      label: 'Messages'      },
    ];

    console.log(`\n  ${clr(C.bgGray+C.bWhite,'  ROUTE MOUNT REPORT  ')}\n  ${clr(C.gray,'─'.repeat(65))}`);

    routes.forEach(({ prefix, file, label }) => {
        try {
            const router = require(file);
            app.use(prefix, router);

            const endpoints = [];
            if (router.stack) {
                router.stack.forEach(layer => {
                    if (layer.route) {
                        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join('|');
                        const ep = `${prefix}${layer.route.path}`;
                        endpoints.push({ methods, path: ep });
                        ROUTE_REGISTRY.push({ methods, path: ep, label });
                    }
                });
            }
            console.log(
                `  ${clr(C.bGreen,'✔')} ${clr(C.bWhite,label.padEnd(16))} ` +
                `${clr(C.cyan,prefix.padEnd(28))} ${clr(C.gray,`${endpoints.length} endpoint(s)`)}`
            );
        } catch (err) {
            console.log(
                `  ${clr(C.bRed,'✘')} ${clr(C.bRed,label.padEnd(16))} ` +
                `${clr(C.red,`FAILED → ${err.message}`)}`
            );
        }
    });

    console.log(`  ${clr(C.gray,'─'.repeat(65))}\n  ${clr(C.bGreen,`✔ ${ROUTE_REGISTRY.length} total endpoints mounted`)}\n`);

    // ── Debug: print all registered routes ───────────────────────
    console.log('  Registered routes:');
    ROUTE_REGISTRY.forEach(r => {
        console.log(`    ${r.methods.padEnd(12)} ${r.path}`);
    });
    console.log('');
}

mountRoutes();

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
const fmtUptime = (ms) => {
    const s   = Math.floor(ms / 1000);
    const d   = Math.floor(s / 86400);
    const h   = Math.floor((s % 86400) / 3600);
    const m   = Math.floor((s % 3600)  / 60);
    const sec = s % 60;
    return [d&&`${d}d`, h&&`${h}h`, m&&`${m}m`, `${sec}s`].filter(Boolean).join(' ');
};

// ═══════════════════════════════════════════════════════════════════
//  SYSTEM ROUTES
// ═══════════════════════════════════════════════════════════════════
app.get('/', async (_req, res) => {
    let dbOk = false;
    try { await db.query('SELECT 1'); dbOk = true; } catch (_) {}
    const avg  = stats.total > 0 ? Math.round(stats.totalMs / stats.total) : 0;
    const rate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 100;
    return res.json({
        success:true, name:'FindIt API', version:'1.0.0', status:'online',
        message:'🔍 FindIt API is running',
        server:  { node:process.version, environment:NODE_ENV, port:PORT, uptime:fmtUptime(Date.now()-SERVER_START) },
        database:{ status:dbOk?'connected':'disconnected' },
        realtime:{ socket_io:'enabled', online_users:onlineUsers.size },
        performance:{ total_requests:stats.total, success:stats.success, errors:stats.errors, success_rate:`${rate}%`, avg_response:`${avg}ms` },
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/health', async (_req, res) => {
    let dbOk=false, dbMs=0;
    try { const t=Date.now(); await db.query('SELECT 1'); dbMs=Date.now()-t; dbOk=true; } catch (_) {}
    const avg  = stats.total>0 ? Math.round(stats.totalMs/stats.total) : 0;
    const rate = stats.total>0 ? Math.round((stats.success/stats.total)*100) : 100;
    return res.status(dbOk?200:503).json({
        success:dbOk, status:dbOk?'healthy':'degraded',
        message:dbOk?'🟢 FindIt API is running!':'🔴 Database connection failed',
        server:  { status:'online', uptime:fmtUptime(Date.now()-SERVER_START), environment:NODE_ENV, node:process.version, port:PORT },
        database:{ status:dbOk?'connected':'disconnected', latency:`${dbMs}ms` },
        realtime:{ socket_io:'enabled', online_users:onlineUsers.size, transports:'polling+websocket' },
        requests:{ total:stats.total, success:stats.success, errors:stats.errors, success_rate:`${rate}%`, avg_response:`${avg}ms` },
        routes:  ROUTE_REGISTRY.map(r => `${r.methods} ${r.path}`),
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/online-users', (_req, res) => {
    return res.json({ success:true, count:onlineUsers.size, data:Array.from(onlineUsers.values()) });
});

app.get('/api/test', (_req, res) => {
    return res.json({
        success:true, message:'FindIt API test — all systems go',
        routes:ROUTE_REGISTRY,
        methods:stats.methods, statuses:stats.statuses,
        timestamp: new Date().toISOString(),
    });
});

// ═══════════════════════════════════════════════════════════════════
//  404
// ═══════════════════════════════════════════════════════════════════
app.use((req, res) => {
    const o = req.headers.origin;
    if (isOriginAllowed(o)) {
        res.setHeader('Access-Control-Allow-Origin',      o||'*');
        res.setHeader('Access-Control-Allow-Credentials', 'false');
    }
    return res.status(404).json({
        success:false,
        message:`Route not found: ${req.method} ${req.path}`,
        hint:'GET /api/health · GET /api/test',
    });
});

// ═══════════════════════════════════════════════════════════════════
//  ERROR HANDLER
// ═══════════════════════════════════════════════════════════════════
app.use((err, req, res, _next) => {
    console.error(`[ERROR] ${err.stack||err.message}`);
    const o = req.headers.origin;
    if (isOriginAllowed(o)) {
        res.setHeader('Access-Control-Allow-Origin',      o||'*');
        res.setHeader('Access-Control-Allow-Credentials', 'false');
        res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers',     'Content-Type,Authorization,X-Requested-With,Accept');
    }
    return res.status(err.status||500).json({
        success:false,
        message: IS_PROD ? 'Internal server error' : (err.message||'Unknown error'),
    });
});

// ═══════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════
async function boot() {
    let dbOk=false, dbMs=0;
    try {
        const t = Date.now();
        await db.query('SELECT 1');
        dbMs = Date.now()-t;
        dbOk = true;
    } catch (err) {
        console.error(`[DB] Connection failed: ${err.message}`);
    }

    server.listen(PORT, () => {
        const BW  = 64;
        const line = '═'.repeat(BW);
        const row  = (txt='') => {
            const clean = txt.replace(/\x1b\[[0-9;]*m/g,'');
            const pad   = Math.max(0, BW-2-clean.length);
            return `║  ${txt}${' '.repeat(pad)}  ║`;
        };
        const colRow = (label, value) => {
            const lc = label.replace(/\x1b\[[0-9;]*m/g,'');
            const vc = value.replace(/\x1b\[[0-9;]*m/g,'');
            const sp = Math.max(1, BW-2-lc.length-2-vc.length);
            return clr(C.bBlue,'║')+`  ${clr(C.gray,label)}  ${value}`+' '.repeat(sp)+clr(C.bBlue,'║');
        };

        console.log('\n');
        console.log(clr(C.bBlue,`╔${line}╗`));
        console.log(clr(C.bBlue,row()));

        const title = '🔍  FindIt — Lost & Found Platform';
        const sub   = 'Express + MySQL + Socket.IO  ·  v1.0.0';
        const tp = Math.max(0,Math.floor((BW-2-title.length)/2));
        const sp = Math.max(0,Math.floor((BW-2-sub.length)/2));
        console.log(clr(C.bBlue,'║')+' '.repeat(tp)+bold(clr(C.bCyan,title))+' '.repeat(BW-2-tp-title.length)+clr(C.bBlue,'║'));
        console.log(clr(C.bBlue,'║')+' '.repeat(sp)+dim(clr(C.gray,sub))+' '.repeat(BW-2-sp-sub.length)+clr(C.bBlue,'║'));

        console.log(clr(C.bBlue,row()));
        console.log(clr(C.bBlue,`╠${line}╣`));
        console.log(clr(C.bBlue,row()));

        [
            ['📡 Port',      clr(C.bGreen, String(PORT))],
            ['🌐 URL',       clr(C.bCyan,  `http://localhost:${PORT}`)],
            ['💚 Health',    clr(C.bCyan,  `http://localhost:${PORT}/api/health`)],
            ['⚡ Socket.IO', clr(C.cyan,   'polling → websocket upgrade')],
            ['🔧 Env',       clr(C.bYellow, NODE_ENV)],
            ['🗄️  DB',       dbOk
                ? `${clr(C.bGreen,'✔ Connected')} ${clr(C.gray,`(${dbMs}ms)`)}`
                : clr(C.bRed,'✘ Disconnected')],
        ].forEach(([l,v]) => console.log(colRow(l,v)));

        console.log(clr(C.bBlue,row()));
        console.log(clr(C.bBlue,`╚${line}╝`));
        console.log(
            `\n  ${clr(C.bgGray+C.bWhite,'  REQUEST LOG  ')}\n` +
            `  ${clr(C.gray,'TIME    ')} ${clr(C.gray,'METHOD  ')} ` +
            `${clr(C.gray,'PATH'.padEnd(48))} ${clr(C.gray,'STATUS')} ${clr(C.gray,'    MS')}\n` +
            `  ${clr(C.gray,'─'.repeat(88))}\n`
        );
    });

    const shutdown = (sig) => {
        console.log(`\n[${sig}] Shutting down…`);
        server.close(() => { console.log('Server closed.\n'); process.exit(0); });
        setTimeout(() => process.exit(1), 8000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('uncaughtException',  (e) => console.error(`[UNCAUGHT] ${e.stack||e.message}`));
    process.on('unhandledRejection', (r) => console.error(`[UNHANDLED] ${String(r)}`));
}

boot();