-- Migration: add notification and privacy preference columns to users
-- Run this file against your existing database to add the new columns.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notifications_email TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notifications_sms TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notifications_whatsapp TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS privacy_public TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS privacy_show_phone TINYINT(1) NOT NULL DEFAULT 0;

-- Ensure no NULLs remain (safety)
UPDATE users SET notifications_email = 1 WHERE notifications_email IS NULL;
UPDATE users SET notifications_sms = 0 WHERE notifications_sms IS NULL;
UPDATE users SET notifications_whatsapp = 0 WHERE notifications_whatsapp IS NULL;
UPDATE users SET privacy_public = 1 WHERE privacy_public IS NULL;
UPDATE users SET privacy_show_phone = 0 WHERE privacy_show_phone IS NULL;

-- End of migration
