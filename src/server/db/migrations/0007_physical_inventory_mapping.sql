-- Explicit physical inventory mapping. No real-world assignments are inferred.
CREATE TABLE venue_resource_mappings (
 resource_id uuid PRIMARY KEY,
 venue_id uuid NOT NULL,
 legacy_code text CHECK(legacy_code IN ('A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar')),
 verified_at timestamptz,
 verified_by text,
 note text NOT NULL DEFAULT '',
 UNIQUE(venue_id,legacy_code),
 FOREIGN KEY(venue_id,resource_id) REFERENCES venue_resources(venue_id,id),
 CHECK((verified_at IS NULL AND verified_by IS NULL AND legacy_code IS NULL) OR
       (verified_at IS NOT NULL AND verified_by IS NOT NULL AND length(verified_by)>0 AND length(note)>=3))
);
INSERT INTO venue_resource_mappings(resource_id,venue_id)
 SELECT resource_id,venue_id FROM table_qr_codes;

-- Unknown legacy positions retain conservative blocking. Confirmed aliases share occupancy.
CREATE FUNCTION hostess_inventory_conflicts(a text[],b text[]) RETURNS boolean
 LANGUAGE sql STABLE AS $$
 SELECT COALESCE(a && b,false) OR EXISTS(
  SELECT 1 FROM venue_resource_mappings m JOIN venue_resources r ON r.id=m.resource_id
  WHERE r.venue_code='xoxo' AND m.verified_at IS NOT NULL AND
   ((m.legacy_code=ANY(a) AND r.code=ANY(b)) OR (m.legacy_code=ANY(b) AND r.code=ANY(a))))
 OR EXISTS(
  SELECT 1 FROM unnest(a) x(code),unnest(b) y(code)
  WHERE (x.code=ANY(ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar'])
    AND NOT EXISTS(SELECT 1 FROM venue_resource_mappings m JOIN hostess_venues v ON v.id=m.venue_id WHERE v.slug='xoxo' AND m.legacy_code=x.code AND m.verified_at IS NOT NULL)
    AND EXISTS(SELECT 1 FROM venue_resources r WHERE r.venue_code='xoxo' AND r.code=y.code))
  OR (y.code=ANY(ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar'])
    AND NOT EXISTS(SELECT 1 FROM venue_resource_mappings m JOIN hostess_venues v ON v.id=m.venue_id WHERE v.slug='xoxo' AND m.legacy_code=y.code AND m.verified_at IS NOT NULL)
    AND EXISTS(SELECT 1 FROM venue_resources r WHERE r.venue_code='xoxo' AND r.code=x.code)))
$$;

CREATE FUNCTION hostess_protect_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(728411001);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'clear mapping through an audited update' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.resource_id,NEW.venue_id) IS DISTINCT FROM (OLD.resource_id,OLD.venue_id)
 THEN RAISE EXCEPTION 'mapping resource is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM table_qr_codes q WHERE q.resource_id=NEW.resource_id AND q.venue_id=NEW.venue_id)
 THEN RAISE EXCEPTION 'mapping requires same venue QR resource' USING ERRCODE='23514'; END IF;
 -- Reconfiguration is deliberately unavailable while future occupancy exists.
 IF EXISTS(SELECT 1 FROM command_center_reservations WHERE status NOT IN('cancelled','no_show') AND COALESCE(ends_at,starts_at+interval '2 hours')>now())
 OR EXISTS(SELECT 1 FROM hostess_holds WHERE consumed_at IS NULL AND expires_at>now())
 THEN RAISE EXCEPTION 'mapping changes require an empty future booking schedule' USING ERRCODE='23P01'; END IF;
 IF NEW.verified_at IS NULL AND EXISTS(SELECT 1 FROM venue_resources WHERE id=NEW.resource_id AND is_reservable)
 THEN RAISE EXCEPTION 'disable reservations before clearing mapping' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER venue_mapping_guard BEFORE INSERT OR UPDATE OR DELETE ON venue_resource_mappings
 FOR EACH ROW EXECUTE FUNCTION hostess_protect_mapping();
CREATE FUNCTION hostess_require_qr_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(728411001);
 IF NEW.is_reservable AND EXISTS(SELECT 1 FROM table_qr_codes WHERE resource_id=NEW.id)
 AND (NEW.capacity IS NULL OR NOT EXISTS(SELECT 1 FROM venue_resource_mappings WHERE resource_id=NEW.id AND verified_at IS NOT NULL))
 THEN RAISE EXCEPTION 'QR booking requires verified physical mapping and capacity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER qr_booking_mapping_guard BEFORE UPDATE ON venue_resources
 FOR EACH ROW EXECUTE FUNCTION hostess_require_qr_mapping();

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
    IF capacity IS NULL THEN RAISE EXCEPTION 'invalid or unavailable resource' USING ERRCODE = '23514'; END IF;
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
