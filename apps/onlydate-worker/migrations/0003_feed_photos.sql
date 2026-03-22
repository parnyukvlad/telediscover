-- Gallery photos for onlydate_feed_entries (uploaded directly to R2)
CREATE TABLE IF NOT EXISTS onlydate_feed_photos (
  id            TEXT PRIMARY KEY,
  feed_entry_id TEXT NOT NULL,
  file_key      TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feed_photos_entry ON onlydate_feed_photos(feed_entry_id, sort_order);
