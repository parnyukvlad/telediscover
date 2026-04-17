-- Add is_hidden column to onlydate_feed_photos (ADMIN-07)
-- Existing rows default to 0 (visible); no data migration needed.
ALTER TABLE onlydate_feed_photos ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
