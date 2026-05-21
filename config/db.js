"use strict";

const mysql  = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

// ═══════════════════════════════════════════════════════════════════
//  ANSI helpers
// ═══════════════════════════════════════════════════════════════════
const clr = {
  green:  (t) => `\x1b[92m${t}\x1b[0m`,
  red:    (t) => `\x1b[91m${t}\x1b[0m`,
  yellow: (t) => `\x1b[93m${t}\x1b[0m`,
  cyan:   (t) => `\x1b[96m${t}\x1b[0m`,
  gray:   (t) => `\x1b[90m${t}\x1b[0m`,
  bold:   (t) => `\x1b[1m${t}\x1b[0m`,
};

// ═══════════════════════════════════════════════════════════════════
//  READ ENV
// ═══════════════════════════════════════════════════════════════════
const DB_HOST = process.env.DB_HOST     || "localhost";
const DB_PORT = parseInt(process.env.DB_PORT || "3306", 10);
const DB_USER = process.env.DB_USER     || "root";
const DB_PASS = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME     || "lost_and_found_db";

// ═══════════════════════════════════════════════════════════════════
//  SSL
//  Railway requires SSL with a self-signed cert.
//  rejectUnauthorized: false  accepts Railway's self-signed cert.
//  Set DB_SSL=false in .env ONLY for plain local MySQL.
// ═══════════════════════════════════════════════════════════════════
const sslConfig = process.env.DB_SSL === "false"
  ? false
  : { rejectUnauthorized: false };

// ═══════════════════════════════════════════════════════════════════
//  POOL
// ═══════════════════════════════════════════════════════════════════
const pool = mysql.createPool({
  host:     DB_HOST,
  port:     DB_PORT,
  user:     DB_USER,
  password: DB_PASS,
  database: DB_NAME,

  // ── SSL ──────────────────────────────────────────────────────────
  ssl: sslConfig,

  // ── Pool behaviour ───────────────────────────────────────────────
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,

  // ── Timeouts ─────────────────────────────────────────────────────
  connectTimeout: 10_000,

  // ── Keep-alive (Railway drops idle connections after ~30s) ───────
  enableKeepAlive:         true,
  keepAliveInitialDelay:   20_000,

  // ── UTC dates ─────────────────────────────────────────────────────
  timezone: "+00:00",
});

// ═══════════════════════════════════════════════════════════════════
//  BOOT PING
// ═══════════════════════════════════════════════════════════════════
const testConnection = async () => {
  const start = Date.now();
  try {
    const conn   = await pool.getConnection();
    const [rows] = await conn.query("SELECT 1 AS ping");
    const ms     = Date.now() - start;
    conn.release();

    if (rows[0]?.ping === 1) {
      console.log(
        `  ${clr.green("✔")} ${clr.bold("MySQL connected")}  ` +
        `${clr.cyan(`${DB_HOST}:${DB_PORT}`)} ` +
        `${clr.gray(`→ ${DB_NAME}`)} ` +
        `${clr.gray(`(${ms}ms)`)}`
      );
    }
  } catch (err) {
    console.error(`\n  ${clr.red("✘")} ${clr.bold("Railway MySQL connection failed")}`);
    console.error(`    ${clr.gray("Host    :")} ${clr.yellow(DB_HOST)}`);
    console.error(`    ${clr.gray("Port    :")} ${clr.yellow(String(DB_PORT))}`);
    console.error(`    ${clr.gray("User    :")} ${clr.yellow(DB_USER)}`);
    console.error(`    ${clr.gray("Database:")} ${clr.yellow(DB_NAME)}`);
    console.error(`    ${clr.gray("SSL     :")} ${clr.yellow(String(sslConfig))}`);
    console.error(`    ${clr.gray("Error   :")} ${clr.red(err.message)}`);
    console.error(
      `    ${clr.gray("Hint    :")} ` +
      `Check Railway dashboard → MySQL service is running & port ${DB_PORT} is exposed\n`
    );
    // Non-fatal — /api/health will report degraded state
  }
};

testConnection();

// ═══════════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════════
module.exports = pool;