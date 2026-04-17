CREATE TABLE IF NOT EXISTS onlydate_persona_config (
  persona_id  TEXT    PRIMARY KEY,
  sort_order  INTEGER NOT NULL DEFAULT 9999999,
  is_promoted INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
