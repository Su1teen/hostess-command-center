-- Provenance is attached to the existing regular catalogue; no second product ledger.
ALTER TABLE venue_menu_items
 ADD COLUMN source_key text,
 ADD COLUMN source_url text,
 ADD COLUMN source_fingerprint text,
 ADD COLUMN source_details jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX venue_menu_source_key ON venue_menu_items(venue_id,source_key) WHERE source_key IS NOT NULL;
