'use strict';

// ═══════════════════════════════════════════════════════════════════
//  FindIt API Server
// ═══════════════════════════════════════════════════════════════════
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
//  ANSI COLORS
// ═══════════════════════════════════════════════════════════════════
const C = {
  reset:    '\x1b[0m',  bold:     '\x1b[1m',   dim:      '\x1b[2m',
  red:      '\x1b[31m', green:    '\x1b[32m',   yellow:   '\x1b[33m',
  blue:     '\x1b[34m', magenta:  '\x1b[35m',   cyan:     '\x1b[36m',
  white:    '\x1b[37m', gray:     '\x1b[90m',   bRed:     '\x1b[91m',
  bGreen:   '\x1b[92m', bYellow:  '\x1b[93m',   bBlue:    '\x1b[94m',
  bMagenta: '\x1b[95m', bCyan:    '\x1b[96m',   bWhite:   '\x1b[97m',
  bgBlack:  '\x1b[40m', bgRed:    '\x1b[41m',   bgGreen:  '\x1b[42m',
  bgYellow: '\x1b[43m', bgBlue:   '\x1b[44m',   bgGray:   '\x1b[100m',
};
const clr  = (color, text) => `${color}${text}${C.reset}`;
const bold = (text)        => `${C.bold}${text}${C.reset}`;
const dim  = (text)        => `${C.dim}${text}${C.reset}`;

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
  total: 0, success: 0, errors: 0, totalMs: 0,
  methods:  { GET: 0, POST: 0, PUT: 0, DELETE: 0, PATCH: 0, OPTIONS: 0 },
  statuses: {}, routes: {}, slowest: [], recent: [], errorLog: [],
};

// ═══════════════════════════════════════════════════════════════════
//  ROUTE REGISTRY
// ═══════════════════════════════════════════════════════════════════
const ROUTE_REGISTRY = [];

// ═══════════════════════════════════════════════════════════════════
//  CORS CONFIGURATION
//  Must be the very FIRST middleware — before everything else
// ═══════════════════════════════════════════════════════════════════

// Explicit allowed origins list
const EXPLICIT_ORIGINS = [
  // ── Local development ───────────────────────────────────────────
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5001',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5001',
  'http://127.0.0.1:5173',
  // ── Production ─────────────────────────────────────────────────
  'https://finditbridge.vercel.app',
  'https://lostandfound-git-main-vanessa-iradukunda-s-projects.vercel.app',
  'https://lost-found-backend-32lt.onrender.com',
  // ── Dynamic from Render env var (comma-separated) ───────────────
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : []),
];

/**
 * Returns true if the given origin should be allowed.
 * Handles null/undefined (Postman, curl, server-to-server).
 */
const isOriginAllowed = (origin) => {
  if (!origin)                                                      return true;
  if (EXPLICIT_ORIGINS.includes(origin))                            return true;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin))         return true;
  if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin))       return true;
  return false;
};

const corsOptions = {
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) {
      return cb(null, true);
    }
    console.warn(clr(C.bYellow, `  [CORS] Blocked origin: ${origin}`));
    return cb(new Error(`CORS policy: origin "${origin}" is not allowed`));
  },
  credentials:          true,
  methods:              ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:       ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders:       ['Content-Range', 'X-Content-Range'],
  optionsSuccessStatus: 200,
  maxAge:               86_400, // cache preflight 24 h
};

// ── 1. Apply cors() middleware ────────────────────────────────────
app.use(cors(corsOptions));

// ── 2. Handle ALL OPTIONS preflight requests immediately ──────────
app.options('*', cors(corsOptions));

// ── 3. Force CORS headers on EVERY response ───────────────────────
//    This is the nuclear option that guarantees headers are present
//    even when Express error handlers swallow them.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    // Echo the exact origin back (required when credentials:true)
    res.setHeader('Access-Control-Allow-Origin',      origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',     'Content-Type,Authorization,X-Requested-With,Accept');
    res.setHeader('Access-Control-Expose-Headers',    'Content-Range,X-Content-Range');
  }
  next();
});

// ═══════════════════════════════════════════════════════════════════
//  SECURITY HEADERS
//  NOTE: Do NOT set Cross-Origin-Opener-Policy here — it breaks
//        cross-origin XHR from Vercel to Render.
// ═══════════════════════════════════════════════════════════════════
app.use((_req, res, next) => {
  res.setHeader('X-Powered-By',           'FindIt API');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'DENY');
  res.setHeader('Referrer-Policy',        'strict-origin-when-cross-origin');
  // ⚠️ NO Cross-Origin-Opener-Policy — breaks cross-origin XHR
  next();
});

// ═══════════════════════════════════════════════════════════════════
//  BODY PARSERS
// ═══════════════════════════════════════════════════════════════════
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ═══════════════════════════════════════════════════════════════════
//  STATIC FILE SERVING
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
      stats.errorLog.unshift({
        method: req.method, path: req.path,
        status, ms, time: new Date().toISOString(),
        body: typeof body === 'string' ? body.slice(0, 200) : '',
      });
      if (stats.errorLog.length > 20) stats.errorLog.length = 20;
    } else {
      stats.success++;
    }

    stats.slowest.push({ method: req.method, path: req.path, ms, status });
    stats.slowest.sort((a, b) => b.ms - a.ms);
    if (stats.slowest.length > 5) stats.slowest.length = 5;

    stats.recent.unshift({
      method: req.method, path: req.path,
      status, ms: `${ms}ms`, time: new Date().toISOString(),
    });
    if (stats.recent.length > 50) stats.recent.length = 50;

    if (req.path !== '/api/health') {
      const methodColor = {
        GET: C.bBlue, POST: C.bGreen, PUT: C.bYellow,
        DELETE: C.bRed, PATCH: C.bMagenta, OPTIONS: C.gray,
      }[req.method] || C.white;

      const statusColor = status < 300 ? C.bGreen
        : status < 400 ? C.bCyan
        : status < 500 ? C.bYellow
        : C.bRed;
      const msColor     = ms < 100 ? C.bGreen : ms < 500 ? C.bYellow : C.bRed;
      const statusIcon  = status < 300 ? '✔' : status < 400 ? '↪' : status < 500 ? '✘' : '💥';

      process.stdout.write(
        `  ${clr(C.gray,    new Date().toTimeString().slice(0, 8))} ` +
        `${clr(methodColor, req.method.padEnd(7))}` +
        `${clr(C.bWhite,    req.path.padEnd(48))}` +
        `${clr(statusColor, `${statusIcon} ${status}`).padEnd(8)} ` +
        `${clr(msColor,     `${ms}ms`.padStart(7))}\n`
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
    { prefix: '/api/auth',          file: './routes/authRoutes',        label: 'Auth'          },
    { prefix: '/api/items',         file: './routes/itemRoutes',        label: 'Items'         },
    { prefix: '/api/matches',       file: './routes/matchRoutes',       label: 'Matches'       },
    { prefix: '/api/notifications', file: './routes/notificationRoutes',label: 'Notifications' },
    { prefix: '/api/contact',       file: './routes/contactRoutes',     label: 'Contact'       },
    { prefix: '/api/subscribe',     file: './routes/subscribeRoutes',   label: 'Subscribe'     },
  ];

  const PAD_LABEL  = 16;
  const PAD_PREFIX = 28;

  console.log(
    `\n  ${clr(C.bgGray + C.bWhite, '  ROUTE MOUNT REPORT  ')}\n` +
    `  ${clr(C.gray, '─'.repeat(65))}`
  );

  routes.forEach(({ prefix, file, label }) => {
    try {
      const router = require(file);
      app.use(prefix, router);

      const endpoints = [];
      if (router.stack) {
        router.stack.forEach(layer => {
          if (layer.route) {
            const methods = Object.keys(layer.route.methods)
              .map(m => m.toUpperCase()).join('|');
            const ep = `${prefix}${layer.route.path}`;
            endpoints.push({ methods, path: ep });
            ROUTE_REGISTRY.push({ methods, path: ep, label });
          }
        });
      }

      console.log(
        `  ${clr(C.bGreen, '✔')} ` +
        `${clr(C.bWhite,   label.padEnd(PAD_LABEL))} ` +
        `${clr(C.cyan,     prefix.padEnd(PAD_PREFIX))} ` +
        `${clr(C.gray,     `${endpoints.length} endpoint(s)`)}`
      );
    } catch (err) {
      console.log(
        `  ${clr(C.bRed, '✘')} ` +
        `${clr(C.bRed,   label.padEnd(PAD_LABEL))} ` +
        `${clr(C.red,    `FAILED → ${err.message}`)}`
      );
    }
  });

  console.log(
    `  ${clr(C.gray, '─'.repeat(65))}\n` +
    `  ${clr(C.bGreen, `✔ ${ROUTE_REGISTRY.length} total endpoints mounted`)}\n`
  );
}

mountRoutes();

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
const fmtUptime = (ms) => {
  const s   = Math.floor(ms / 1000);
  const d   = Math.floor(s / 86400);
  const h   = Math.floor((s % 86400) / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`]
    .filter(Boolean).join(' ');
};

// ═══════════════════════════════════════════════════════════════════
//  ROOT ROUTE
// ═══════════════════════════════════════════════════════════════════
app.get('/', async (_req, res) => {
  let dbOk = false;
  try { await db.query('SELECT 1'); dbOk = true; } catch (_) {}

  const avgMs       = stats.total > 0 ? Math.round(stats.totalMs / stats.total) : 0;
  const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 100;

  return res.json({
    success:  true,
    name:     'FindIt API',
    version:  '1.0.0',
    status:   'online',
    message:  '🔍 FindIt Lost & Found API Server is running',
    server:   { node: process.version, environment: NODE_ENV, port: PORT, uptime: fmtUptime(Date.now() - SERVER_START) },
    database: { status: dbOk ? 'connected' : 'disconnected' },
    performance: {
      total_requests: stats.total,
      success:        stats.success,
      errors:         stats.errors,
      success_rate:   `${successRate}%`,
      avg_response:   `${avgMs}ms`,
    },
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════
app.get('/api/health', async (_req, res) => {
  let dbOk = false, dbMs = 0;
  try {
    const t = Date.now();
    await db.query('SELECT 1');
    dbMs = Date.now() - t;
    dbOk = true;
  } catch (_) {}

  const avgMs       = stats.total > 0 ? Math.round(stats.totalMs / stats.total) : 0;
  const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 100;

  return res.status(dbOk ? 200 : 503).json({
    success:  dbOk,
    status:   dbOk ? 'healthy' : 'degraded',
    message:  dbOk ? '🟢 FindIt API is running!' : '🔴 Database connection failed',
    server:   { status: 'online', uptime: fmtUptime(Date.now() - SERVER_START), environment: NODE_ENV, node: process.version, port: PORT },
    database: { status: dbOk ? 'connected' : 'disconnected', latency: `${dbMs}ms` },
    requests: { total: stats.total, success: stats.success, errors: stats.errors, success_rate: `${successRate}%`, avg_response: `${avgMs}ms` },
    cors: {
      allowed_origins: EXPLICIT_ORIGINS,
      pattern_rules:   ['*.vercel.app', '*.onrender.com'],
    },
    slowest_requests: stats.slowest,
    timestamp:        new Date().toISOString(),
    version:          '1.0.0',
  });
});

// ═══════════════════════════════════════════════════════════════════
//  TEST / DEBUG ROUTE
// ═══════════════════════════════════════════════════════════════════
app.get('/api/test', (_req, res) => {
  return res.json({
    success: true,
    message: '🔍 FindIt API test endpoint — all systems go',
    routes:  ROUTE_REGISTRY,
    methods: stats.methods,
    statuses:stats.statuses,
    top_routes: Object.entries(stats.routes)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([route, hits]) => ({ route, hits })),
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════
//  404 HANDLER
// ═══════════════════════════════════════════════════════════════════
app.use((req, res) => {
  // Re-apply CORS on 404s so the browser can read the error
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin',      origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
    hint:    'GET /api/health for status · GET /api/test for route list',
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL ERROR HANDLER
// ═══════════════════════════════════════════════════════════════════
app.use((err, req, res, _next) => {
  console.error(clr(C.bRed, `\n  [ERROR] ${err.stack || err.message}\n`));

  // Always re-apply CORS headers on error responses —
  // without this the browser blocks the error and shows a misleading CORS error
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin',      origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',     'Content-Type,Authorization,X-Requested-With,Accept');
  }

  return res.status(err.status || 500).json({
    success: false,
    message: IS_PROD ? 'Internal server error' : (err.message || 'Unknown error'),
  });
});

// ═══════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════
async function boot() {
  let dbOk = false, dbMs = 0;
  try {
    const t = Date.now();
    await db.query('SELECT 1');
    dbMs = Date.now() - t;
    dbOk = true;
  } catch (err) {
    console.error(clr(C.bRed, `  [DB] Connection failed: ${err.message}`));
  }

  server.listen(PORT, () => {
    const BW  = 60;
    const top = `╔${'═'.repeat(BW)}╗`;
    const bot = `╚${'═'.repeat(BW)}╝`;
    const mid = `╠${'═'.repeat(BW)}╣`;
    const row = (txt = '') => {
      const clean = txt.replace(/\x1b\[[0-9;]*m/g, '');
      const pad   = Math.max(0, BW - 2 - clean.length);
      return `║  ${txt}${' '.repeat(pad)}  ║`;
    };

    console.log('\n');
    console.log(clr(C.bBlue, top));
    console.log(clr(C.bBlue, row()));

    const titleRaw = '🔍  FindIt  —  Lost & Found Platform';
    const subRaw   = 'API Server  ·  Express + MySQL';
    const tPad     = Math.max(0, Math.floor((BW - 2 - titleRaw.length) / 2));
    const sPad     = Math.max(0, Math.floor((BW - 2 - subRaw.length)   / 2));

    console.log(clr(C.bBlue, '║') + ' '.repeat(tPad) + bold(clr(C.bCyan, titleRaw)) + ' '.repeat(BW - 2 - tPad - titleRaw.length) + clr(C.bBlue, '║'));
    console.log(clr(C.bBlue, '║') + ' '.repeat(sPad) + dim(clr(C.gray,   subRaw))   + ' '.repeat(BW - 2 - sPad - subRaw.length)   + clr(C.bBlue, '║'));

    console.log(clr(C.bBlue, row()));
    console.log(clr(C.bBlue, mid));
    console.log(clr(C.bBlue, row()));

    const infoRows = [
      ['📡 Port',      clr(C.bGreen,  String(PORT))],
      ['🌐 URL',       clr(C.bCyan,   `http://localhost:${PORT}`)],
      ['💚 Health',    clr(C.bCyan,   `http://localhost:${PORT}/api/health`)],
      ['🔧 Env',       clr(C.bYellow, NODE_ENV)],
      ['🗄️  Database', dbOk
        ? `${clr(C.bGreen, '✔ Connected')} ${clr(C.gray, `(${dbMs}ms)`)}`
        : clr(C.bRed, '✘ Disconnected')],
      ['🕐 Started',   clr(C.gray, new Date(SERVER_START).toLocaleString())],
    ];

    infoRows.forEach(([label, value]) => {
      const lc = label.replace(/\x1b\[[0-9;]*m/g, '');
      const vc = value.replace(/\x1b\[[0-9;]*m/g, '');
      const sp = Math.max(1, BW - 2 - lc.length - 2 - vc.length);
      console.log(clr(C.bBlue, '║') + `  ${clr(C.gray, label)}  ${value}` + ' '.repeat(sp) + clr(C.bBlue, '║'));
    });

    console.log(clr(C.bBlue, row()));
    console.log(clr(C.bBlue, mid));
    console.log(clr(C.bBlue, row()));

    [
      { label: '🔐 Auth',          prefix: '/api/auth'          },
      { label: '📦 Items',         prefix: '/api/items'         },
      { label: '🔗 Matches',       prefix: '/api/matches'       },
      { label: '🔔 Notifications', prefix: '/api/notifications' },
      { label: '📬 Contact',       prefix: '/api/contact'       },
      { label: '📧 Subscribe',     prefix: '/api/subscribe'     },
    ].forEach(({ label, prefix }) => {
      const count  = ROUTE_REGISTRY.filter(r => r.path.startsWith(prefix)).length;
      const status = count > 0
        ? clr(C.bGreen, `✔  ${count} route${count !== 1 ? 's' : ''}`)
        : clr(C.bYellow, '⚠  0 routes');
      const lc = label.replace(/\x1b\[[0-9;]*m/g, '');
      const sc = status.replace(/\x1b\[[0-9;]*m/g, '');
      const sp = Math.max(1, BW - 2 - lc.length - 2 - sc.length);
      console.log(clr(C.bBlue, '║') + `  ${clr(C.white, label)}  ${status}` + ' '.repeat(sp) + clr(C.bBlue, '║'));
    });

    console.log(clr(C.bBlue, row()));

    const tl = `✔  ${ROUTE_REGISTRY.length} total API endpoints registered`;
    const ts = Math.max(1, BW - 2 - tl.length);
    console.log(clr(C.bBlue, '║') + `  ${clr(C.bGreen, tl)}` + ' '.repeat(ts) + clr(C.bBlue, '║'));

    console.log(clr(C.bBlue, row()));
    console.log(clr(C.bBlue, bot));

    console.log(
      `\n  ${clr(C.bgGray + C.bWhite, '  REQUEST LOG  ')}\n` +
      `  ${clr(C.gray, 'TIME    ')} ${clr(C.gray, 'METHOD  ')} ` +
      `${clr(C.gray, 'PATH'.padEnd(48))} ${clr(C.gray, 'STATUS')} ${clr(C.gray, '    MS')}\n` +
      `  ${clr(C.gray, '─'.repeat(88))}\n`
    );
  });

  // ── Graceful shutdown ─────────────────────────────────────────
  const shutdown = (sig) => {
    console.log(`\n  ${clr(C.bYellow, `[${sig}] Shutting down gracefully...`)}`);
    server.close(() => {
      console.log(clr(C.bGreen, '  ✔ Server closed cleanly.\n'));
      process.exit(0);
    });
    setTimeout(() => {
      console.error(clr(C.bRed, '  ✘ Forced exit after timeout.'));
      process.exit(1);
    }, 8_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException',  (err)    => console.error(clr(C.bRed, `\n  [UNCAUGHT]  ${err.stack  || err.message}`)));
  process.on('unhandledRejection', (reason) => console.error(clr(C.bRed, `\n  [UNHANDLED] ${String(reason)}`)));
}

boot();