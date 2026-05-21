"use strict";
const mysql  = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

const pool = mysql.createPool({
    host:               process.env.DB_HOST     || "localhost",
    user:               process.env.DB_USER     || "root",
    password:           process.env.DB_PASSWORD || "",
    database:           process.env.DB_NAME     || "lost_and_found_db",
    port:               process.env.DB_PORT     || 3306,
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    timezone:           "+00:00",
});

const testConnection = async () => {
    try {
        const conn = await pool.getConnection();
        console.log("✅ MySQL Database connected successfully");
        conn.release();
    } catch (err) {
        console.error("❌ Database connection failed:", err.message);
    }
};

testConnection();

module.exports = pool;