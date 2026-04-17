// ─── Feed visibility filter ───────────────────────────────────────────────────
// feed_visible: NULL = follow mode, 1 = force show, 0 = force hide
// alias = table alias used in query (e.g. 'p' or 'fe')
export function feedFilter(alias: string, mode: 'all' | 'selected'): string {
  return mode === 'selected'
    ? `${alias}.feed_visible = 1`
    : `(${alias}.feed_visible IS NULL OR ${alias}.feed_visible = 1)`;
}

// ─── SQL fragments (visibility-aware) ────────────────────────────────────────
// cover_photo: prefers admin-set cover, falls back to oldest visible photo
// NOTE: D1 SQLite does NOT allow outer-query aliases (p.id) in subquery ORDER BY.
// Workaround: COALESCE two subqueries — explicit cover (p.id in WHERE is fine),
// then fallback oldest photo (no outer alias in ORDER BY).
export const COVER_PHOTO = `COALESCE(
  (
    SELECT mf.file_url
    FROM   media_library ml
    JOIN   media_files   mf  ON mf.media_id = ml.id
    JOIN   onlydate_photo_config opc ON opc.media_id = ml.id
    WHERE  ml.persona_id = p.id
      AND  ml.category = 'casual'
      AND  (ml.price_stars IS NULL OR ml.price_stars = 0)
      AND  ml.type = 'photo'
      AND  opc.is_cover_for_persona = p.id
      AND  (opc.is_hidden IS NULL OR opc.is_hidden = 0)
    LIMIT 1
  ),
  (
    SELECT mf.file_url
    FROM   media_library ml
    JOIN   media_files   mf  ON mf.media_id = ml.id
    LEFT JOIN onlydate_photo_config opc ON opc.media_id = ml.id
    WHERE  ml.persona_id = p.id
      AND  ml.category = 'casual'
      AND  (ml.price_stars IS NULL OR ml.price_stars = 0)
      AND  ml.type = 'photo'
      AND  (opc.is_hidden IS NULL OR opc.is_hidden = 0)
    ORDER BY ml.created_at ASC, mf.file_order ASC
    LIMIT 1
  )
)`;

// has at least one visible free photo
export const HAS_FREE_PHOTO = `(
  SELECT COUNT(*)
  FROM   media_library ml2
  JOIN   media_files   mf2  ON mf2.media_id = ml2.id
  LEFT JOIN onlydate_photo_config opc2 ON opc2.media_id = ml2.id
  WHERE  ml2.persona_id = p.id
    AND  ml2.category = 'casual'
    AND  (ml2.price_stars IS NULL OR ml2.price_stars = 0)
    AND  ml2.type = 'photo'
    AND  (opc2.is_hidden IS NULL OR opc2.is_hidden = 0)
) > 0`;
