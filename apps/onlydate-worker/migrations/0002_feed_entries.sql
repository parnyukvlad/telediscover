-- Manual feed entries created from the admin panel
-- These are separate from the main personas table
CREATE TABLE IF NOT EXISTS onlydate_feed_entries (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  handle       TEXT NOT NULL UNIQUE,
  cover_url    TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  feed_visible INTEGER DEFAULT NULL,
  created_at   INTEGER NOT NULL
);
