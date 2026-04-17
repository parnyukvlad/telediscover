-- Add ordering and promotion support to manual feed entries
-- sort_order: admin drag-drop position; is_promoted: float-to-top flag

ALTER TABLE onlydate_feed_entries ADD COLUMN sort_order  INTEGER;
ALTER TABLE onlydate_feed_entries ADD COLUMN is_promoted INTEGER NOT NULL DEFAULT 0;

-- Populate sort_order for existing rows sequentially by created_at
-- so drag-drop admin starts with a sensible default order (1, 2, 3…)
UPDATE onlydate_feed_entries
SET    sort_order = (
  SELECT COUNT(*)
  FROM   onlydate_feed_entries older
  WHERE  older.created_at <= onlydate_feed_entries.created_at
    AND  older.id          != onlydate_feed_entries.id
) + 1;

CREATE INDEX IF NOT EXISTS idx_feed_entries_sort
  ON onlydate_feed_entries(is_promoted DESC, sort_order ASC);
