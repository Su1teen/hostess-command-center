-- Owner-authorized operational pilot: attestation is metadata, unknown capacity is NULL.
-- IDs, QR credentials, zones, layouts and historic financial records are untouched.
ALTER TABLE dine_in_quotes ADD COLUMN order_source text NOT NULL DEFAULT 'qr'
 CHECK(order_source IN('qr','table_code','staff','web_app'));

CREATE OR REPLACE FUNCTION hostess_require_qr_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(728411001);
 IF NEW.is_reservable AND EXISTS(SELECT 1 FROM venue_resource_mappings
   WHERE resource_id=NEW.id AND linked_resource_id IS NOT NULL)
 THEN RAISE EXCEPTION 'linked physical alias must use its canonical booking resource' USING ERRCODE='23514'; END IF;
 IF NEW.is_reservable AND EXISTS(SELECT 1 FROM venue_resource_mappings m WHERE m.resource_id=NEW.id
    AND m.legacy_code IS NOT NULL AND NEW.capacity IS DISTINCT FROM CASE WHEN m.legacy_code IN('A1','A2','A3','Bar') THEN 6 ELSE 4 END)
 THEN RAISE EXCEPTION 'legacy alias capacity must match its physical booking resource' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION hostess_protect_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected text[]; old_alias text[] := '{}';
BEGIN
 PERFORM pg_advisory_xact_lock(728411001);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'clear mapping through an audited update' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.resource_id,NEW.venue_id) IS DISTINCT FROM (OLD.resource_id,OLD.venue_id)
 THEN RAISE EXCEPTION 'mapping resource is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM table_qr_codes q WHERE q.resource_id=NEW.resource_id AND q.venue_id=NEW.venue_id)
 THEN RAISE EXCEPTION 'mapping requires same venue QR resource' USING ERRCODE='23514'; END IF;
 -- ON CONFLICT runs BEFORE INSERT before its UPDATE trigger. The UPDATE branch
 -- validates the actual semantic change against OLD; do not reject note-only upserts.
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM venue_resource_mappings WHERE resource_id=NEW.resource_id) THEN RETURN NEW; END IF;
 IF NEW.linked_resource_id IS NOT NULL AND EXISTS(SELECT 1 FROM table_qr_codes WHERE resource_id=NEW.linked_resource_id)
 THEN RAISE EXCEPTION 'link to a canonical booking resource, not another QR point' USING ERRCODE='23514'; END IF;
 -- Editing a note or re-confirming the same place does not change occupancy.
 IF TG_OP='INSERT' OR (NEW.legacy_code,NEW.linked_resource_id,NEW.verified_at IS NULL,NEW.relationship)
    IS DISTINCT FROM (OLD.legacy_code,OLD.linked_resource_id,OLD.verified_at IS NULL,OLD.relationship) THEN
  IF TG_OP='UPDATE' THEN old_alias:=hostess_physical_alias_codes(OLD.resource_id); END IF;
  SELECT array_remove(old_alias || ARRAY[r.code,NEW.legacy_code,target.code],NULL) INTO affected
    FROM venue_resources r LEFT JOIN venue_resources target ON target.id=NEW.linked_resource_id WHERE r.id=NEW.resource_id;
  IF EXISTS(SELECT 1 FROM command_center_reservations WHERE status NOT IN('cancelled','no_show')
     AND COALESCE(ends_at,starts_at+interval '2 hours')>now()
     AND COALESCE(table_ids,CASE WHEN table_id IS NULL THEN '{}'::text[] ELSE ARRAY[table_id] END) && affected)
   OR EXISTS(SELECT 1 FROM hostess_holds WHERE consumed_at IS NULL AND expires_at>now() AND table_ids && affected)
   OR EXISTS(SELECT 1 FROM dining_sessions s JOIN venue_resources r ON r.id=s.resource_id WHERE s.closed_at IS NULL AND r.code=ANY(affected))
  THEN RAISE EXCEPTION 'affected physical place has future reservations or holds' USING ERRCODE='23P01'; END IF;
 END IF;
 IF (NEW.linked_resource_id IS NOT NULL)
    AND EXISTS(SELECT 1 FROM venue_resources WHERE id=NEW.resource_id AND is_reservable)
 THEN RAISE EXCEPTION 'disable QR reservations before clearing or linking mapping' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION hostess_protect_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[];
  conflict boolean;
  capacity integer;
  legacy_only boolean;
  valid_combo boolean;
  legacy_codes constant text[] := ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar'];
BEGIN
  -- One lock protects API holds, website bookings, and the legacy staff writer.
  PERFORM pg_advisory_xact_lock(728411001);

  IF TG_TABLE_NAME = 'command_center_reservations' THEN
    IF TG_OP = 'UPDATE' AND NEW.table_id IS DISTINCT FROM OLD.table_id
       AND NEW.table_ids IS NOT DISTINCT FROM OLD.table_ids THEN
      NEW.table_ids := CASE WHEN NEW.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.table_id] END;
    END IF;
    ids := COALESCE(NEW.table_ids,
      CASE WHEN NEW.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.table_id] END);
    NEW.table_ids := ids;
    IF NEW.status IN ('cancelled','no_show') THEN RETURN NEW; END IF;
  ELSE
    ids := NEW.table_ids;
    IF NEW.consumed_at IS NOT NULL OR NEW.expires_at <= now() THEN RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'command_center_reservations' AND NEW.ends_at IS NULL THEN
    NEW.ends_at := NEW.starts_at + interval '2 hours';
  END IF;
  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'invalid interval' USING ERRCODE = '23514';
  END IF;
  -- Empty table_ids are allowed only for the normalized resource API; those rows
  -- are checked by the deferred resource-link constraint below.
  IF ids IS NULL OR cardinality(ids) = 0 THEN RETURN NEW; END IF;
  IF cardinality(ids) <> (SELECT count(DISTINCT id) FROM unnest(ids) AS t(id)) THEN
    RAISE EXCEPTION 'duplicate table' USING ERRCODE = '23514';
  END IF;

  SELECT bool_and(id = ANY(legacy_codes)) INTO legacy_only FROM unnest(ids) AS t(id);
  IF legacy_only THEN
    IF cardinality(ids) > 1 THEN
      SELECT bool_and(id ~ '^[AB][1-4]$') INTO valid_combo FROM unnest(ids) AS t(id);
      IF NOT COALESCE(valid_combo, false) THEN
        RAISE EXCEPTION 'invalid table combination' USING ERRCODE = '23514';
      END IF;
      SELECT count(DISTINCT left(id,1)) = 1
        AND max(substring(id from 2)::integer) - min(substring(id from 2)::integer) + 1 = count(*)
        INTO valid_combo FROM unnest(ids) AS t(id);
      IF NOT COALESCE(valid_combo, false) THEN
        RAISE EXCEPTION 'invalid table combination' USING ERRCODE = '23514';
      END IF;
    END IF;
    SELECT sum(CASE WHEN id IN ('A1','A2','A3','Bar') THEN 6 ELSE 4 END)
      INTO capacity FROM unnest(ids) AS t(id);
  ELSE
    IF cardinality(ids) <> 1 THEN
      RAISE EXCEPTION 'resource combinations are not configured' USING ERRCODE = '23514';
    END IF;
    SELECT r.capacity INTO capacity FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
      WHERE r.venue_code='xoxo' AND r.code=ids[1] AND z.is_active
        AND r.is_reservable AND r.status='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid or unavailable resource' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.guests > capacity THEN RAISE EXCEPTION 'invalid capacity' USING ERRCODE = '23514'; END IF;

  SELECT EXISTS (SELECT 1 FROM command_center_reservations r
    WHERE (TG_TABLE_NAME <> 'command_center_reservations' OR r.id <> NEW.id)
      AND r.status NOT IN ('cancelled','no_show')
      AND hostess_inventory_conflicts(COALESCE(r.table_ids, CASE WHEN r.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[r.table_id] END),ids)
      AND r.starts_at < NEW.ends_at
      AND COALESCE(r.ends_at,r.starts_at + interval '2 hours') > NEW.starts_at)
    INTO conflict;
  IF conflict THEN RAISE EXCEPTION 'table unavailable' USING ERRCODE = '23P01'; END IF;

  IF TG_TABLE_NAME = 'command_center_reservations' THEN
    SELECT EXISTS (SELECT 1 FROM hostess_holds h
      WHERE h.consumed_at IS NULL AND h.expires_at > now()
        AND h.id IS DISTINCT FROM NEW.hold_id AND hostess_inventory_conflicts(h.table_ids,ids)
        AND h.starts_at < NEW.ends_at AND h.ends_at > NEW.starts_at) INTO conflict;
  ELSE
    SELECT EXISTS (SELECT 1 FROM hostess_holds h
      WHERE h.id <> NEW.id AND h.consumed_at IS NULL AND h.expires_at > now()
        AND hostess_inventory_conflicts(h.table_ids,ids) AND h.starts_at < NEW.ends_at AND h.ends_at > NEW.starts_at)
      INTO conflict;
  END IF;
  IF conflict THEN RAISE EXCEPTION 'table held' USING ERRCODE = '23P01'; END IF;

  RETURN NEW;
END $$;

-- Public/staff allocation uses existing QR physical resources or a verified canonical
-- target. Legacy VIP writers retain their IDs; unknown aliases conservatively share
-- conflicts with unlinked VIP points only while real occupancy overlaps.
ALTER FUNCTION hostess_inventory_conflicts(text[],text[]) RENAME TO hostess_inventory_conflicts_v3;
CREATE FUNCTION hostess_inventory_conflicts(a text[],b text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT hostess_inventory_conflicts_v3(a,b) OR EXISTS(
   SELECT 1 FROM venue_resources legacy JOIN venue_zones lz ON lz.id=legacy.zone_id
   JOIN venue_resources physical ON physical.venue_code=legacy.venue_code
   JOIN venue_zones pz ON pz.id=physical.zone_id AND pz.zone_type='vip'
   JOIN table_qr_codes q ON q.resource_id=physical.id
   LEFT JOIN venue_resource_mappings pm ON pm.resource_id=physical.id
   WHERE legacy.code IN('VIP1','VIP2','VIP3') AND lz.zone_type='vip'
     AND COALESCE(pm.relationship,'pending')='pending'
     AND NOT EXISTS(SELECT 1 FROM venue_resource_mappings known WHERE known.linked_resource_id=legacy.id AND known.verified_at IS NOT NULL)
     AND ((legacy.code=ANY(a) AND physical.code=ANY(b)) OR (legacy.code=ANY(b) AND physical.code=ANY(a))))
$$;

-- Activates actual existing operational points without inventing capacity or mapping.
UPDATE venue_resources r SET is_reservable=true,registry_version=registry_version+1
 WHERE r.status='active' AND EXISTS(SELECT 1 FROM table_qr_codes q WHERE q.resource_id=r.id)
 AND NOT r.is_reservable AND NOT EXISTS(SELECT 1 FROM venue_resource_mappings m
   WHERE m.resource_id=r.id AND m.linked_resource_id IS NOT NULL);
