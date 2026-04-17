-- Analytics event log
-- Populated by Phase 2: POST /api/onlydate/track
-- Pruned by Phase 2: scheduled cron (90-day TTL)

CREATE TABLE IF NOT EXISTS onlydate_events (
  id             TEXT    PRIMARY KEY,
  event_type     TEXT    NOT NULL,
  user_id        TEXT    NOT NULL,
  persona_handle TEXT,
  start_param    TEXT,
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  created_at     INTEGER NOT NULL
);

-- Per-user event queries (TRACK-02, TRACK-03)
CREATE INDEX IF NOT EXISTS idx_events_user_type
  ON onlydate_events(user_id, event_type);

-- 90-day TTL cron pruning (TRACK-08)
CREATE INDEX IF NOT EXISTS idx_events_created
  ON onlydate_events(created_at);

-- Funnel aggregation queries (TRACK-01, TRACK-04)
CREATE INDEX IF NOT EXISTS idx_events_type
  ON onlydate_events(event_type);
