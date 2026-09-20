ALTER TABLE command_center_reservations
  ADD COLUMN IF NOT EXISTS table_id text,
  ADD COLUMN IF NOT EXISTS table_label text;

UPDATE command_center_reservations
SET ends_at = starts_at + interval '2 hours'
WHERE ends_at IS NULL;

CREATE INDEX IF NOT EXISTS command_center_reservations_table_range_idx
  ON command_center_reservations (table_id, starts_at, ends_at)
  WHERE status NOT IN ('cancelled', 'no_show');
