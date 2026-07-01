-- Migration: add related_match_id column to notifications table

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS related_match_id INT DEFAULT NULL;
