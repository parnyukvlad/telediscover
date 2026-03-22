-- Feed visibility controls
-- feed_visible: NULL = follow global mode, 1 = force show, 0 = force hide
ALTER TABLE personas ADD COLUMN feed_visible INTEGER DEFAULT NULL;

-- Global app settings (key-value)
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default: show all personas in the feed
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('feed_mode', 'all');
