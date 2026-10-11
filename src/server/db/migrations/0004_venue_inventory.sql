-- XoXo venue inventory. Existing A/B/C codes stay in the legacy reservation columns
-- until their physical locations are verified. Only the three confirmed VIP rooms
-- are created as reservable resources; all geometry remains NULL until surveyed.
CREATE TABLE IF NOT EXISTS venue_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code text NOT NULL DEFAULT 'xoxo',
  code text NOT NULL,
  name text NOT NULL,
  zone_type text NOT NULL CHECK (zone_type IN ('main_hall','secondary_hall','vip','shared_hall','bar')),
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (venue_code, code)
);

CREATE TABLE IF NOT EXISTS venue_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code text NOT NULL DEFAULT 'xoxo',
  zone_id uuid NOT NULL REFERENCES venue_zones(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('table','private_room','bar_seating')),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  is_reservable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('active','inactive','maintenance','unverified')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_code, code)
);
CREATE INDEX IF NOT EXISTS venue_resources_zone_idx ON venue_resources(zone_id, is_reservable, status);

CREATE TABLE IF NOT EXISTS venue_layout (
  resource_id uuid PRIMARY KEY REFERENCES venue_resources(id) ON DELETE CASCADE,
  layout_version integer NOT NULL DEFAULT 1,
  x numeric,
  y numeric,
  width numeric,
  height numeric,
  shape text,
  rotation numeric,
  display_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (width IS NULL OR width > 0),
  CHECK (height IS NULL OR height > 0)
);

INSERT INTO venue_zones (venue_code, code, name, zone_type, description, display_order)
VALUES
  ('xoxo','ps','ПС / общий зал','shared_hall','3 стола; физическое соответствие старым ID не подтверждено.',10),
  ('xoxo','first_hall','Первый зал','main_hall','8 столов; состав ресурсов и вместимость отдельных столов требуют проверки.',20),
  ('xoxo','second_hall','Второй зал','secondary_hall','3 стола; состав ресурсов и вместимость отдельных столов требуют проверки.',30),
  ('xoxo','vip','VIP-комнаты','vip','Подтверждены названия и максимальная вместимость комнат.',40),
  ('xoxo','bar','Бар','bar','Отдельная посадочная зона; места и вместимость требуют проверки.',50)
ON CONFLICT (venue_code, code) DO NOTHING;

INSERT INTO venue_resources (venue_code, zone_id, code, name, resource_type, capacity,
  is_reservable, status, metadata)
SELECT 'xoxo', z.id, v.code, v.name, 'private_room', v.capacity, true, 'active',
  jsonb_build_object('capacity_verified', true, 'minimum_guests', null,
    'physical_position_verified', false, 'source', 'user-confirmed venue inventory')
FROM venue_zones z
CROSS JOIN (VALUES
  ('VIP1','VIP 1 — средняя',6),
  ('VIP2','VIP 2 — большая',9),
  ('VIP3','VIP 3 — маленькая',4)
) AS v(code,name,capacity)
WHERE z.venue_code='xoxo' AND z.code='vip'
ON CONFLICT (venue_code, code) DO NOTHING;

INSERT INTO venue_layout (resource_id, layout_version, x, y, width, height, shape, rotation, display_properties)
SELECT id, 1, NULL, NULL, NULL, NULL, NULL, NULL,
  jsonb_build_object('positionVerified', false)
FROM venue_resources WHERE venue_code='xoxo' AND code IN ('VIP1','VIP2','VIP3')
ON CONFLICT (resource_id) DO NOTHING;

-- These relations give new bookings real foreign keys while table_id/table_ids stay
-- available to legacy staff screens, audit records, and integrations.
CREATE TABLE IF NOT EXISTS command_center_reservation_resources (
  reservation_id uuid PRIMARY KEY REFERENCES command_center_reservations(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES venue_resources(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS command_center_reservation_resources_resource_idx
  ON command_center_reservation_resources(resource_id, reservation_id);

CREATE TABLE IF NOT EXISTS hostess_hold_resources (
  hold_id uuid PRIMARY KEY REFERENCES hostess_holds(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES venue_resources(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hostess_hold_resources_resource_idx
  ON hostess_hold_resources(resource_id, hold_id);

CREATE TABLE IF NOT EXISTS hostess_hold_idempotency (
  guest_id uuid NOT NULL REFERENCES hostess_guests(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  hold_id uuid NOT NULL REFERENCES hostess_holds(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guest_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS hostess_hold_idempotency_hold_idx ON hostess_hold_idempotency(hold_id);

CREATE OR REPLACE FUNCTION hostess_protect_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[];
  conflict boolean;
  capacity integer;
  legacy_only boolean;
  is_inventory_resource boolean;
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
      AND COALESCE(r.table_ids, CASE WHEN r.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[r.table_id] END) && ids
      AND r.starts_at < NEW.ends_at
      AND COALESCE(r.ends_at,r.starts_at + interval '2 hours') > NEW.starts_at)
    INTO conflict;
  IF conflict THEN RAISE EXCEPTION 'table unavailable' USING ERRCODE = '23P01'; END IF;

  IF TG_TABLE_NAME = 'command_center_reservations' THEN
    SELECT EXISTS (SELECT 1 FROM hostess_holds h
      WHERE h.consumed_at IS NULL AND h.expires_at > now()
        AND h.id IS DISTINCT FROM NEW.hold_id AND h.table_ids && ids
        AND h.starts_at < NEW.ends_at AND h.ends_at > NEW.starts_at) INTO conflict;
  ELSE
    SELECT EXISTS (SELECT 1 FROM hostess_holds h
      WHERE h.id <> NEW.id AND h.consumed_at IS NULL AND h.expires_at > now()
        AND h.table_ids && ids AND h.starts_at < NEW.ends_at AND h.ends_at > NEW.starts_at)
      INTO conflict;
  END IF;
  IF conflict THEN RAISE EXCEPTION 'table held' USING ERRCODE = '23P01'; END IF;

  -- Old A/B/C IDs have no verified physical mapping. Until staff maps them,
  -- conservatively prevent simultaneous legacy and new-resource bookings.
  SELECT EXISTS (SELECT 1 FROM venue_resources r WHERE r.venue_code='xoxo' AND r.code=ANY(ids))
    INTO is_inventory_resource;
  IF is_inventory_resource THEN
    SELECT EXISTS (
      SELECT 1 FROM command_center_reservations r
      WHERE r.status NOT IN ('cancelled','no_show')
        AND (TG_TABLE_NAME <> 'command_center_reservations' OR r.id <> NEW.id)
        AND COALESCE(r.table_ids, CASE WHEN r.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[r.table_id] END) && legacy_codes
        AND r.starts_at < NEW.ends_at AND COALESCE(r.ends_at,r.starts_at+interval '2 hours') > NEW.starts_at
      UNION ALL
      SELECT 1 FROM hostess_holds h WHERE h.consumed_at IS NULL AND h.expires_at>now()
        AND h.table_ids && legacy_codes AND h.starts_at<NEW.ends_at AND h.ends_at>NEW.starts_at
    ) INTO conflict;
  ELSIF legacy_only THEN
    SELECT EXISTS (
      SELECT 1 FROM command_center_reservations r
      WHERE r.status NOT IN ('cancelled','no_show')
        AND (TG_TABLE_NAME <> 'command_center_reservations' OR r.id <> NEW.id)
        AND EXISTS (SELECT 1 FROM venue_resources v WHERE v.venue_code='xoxo'
          AND v.is_reservable AND v.status='active'
          AND v.code = ANY(COALESCE(r.table_ids, CASE WHEN r.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[r.table_id] END)))
        AND r.starts_at<NEW.ends_at AND COALESCE(r.ends_at,r.starts_at+interval '2 hours')>NEW.starts_at
      UNION ALL
      SELECT 1 FROM hostess_holds h
      WHERE h.consumed_at IS NULL AND h.expires_at>now()
        AND EXISTS (SELECT 1 FROM venue_resources v WHERE v.venue_code='xoxo'
          AND v.is_reservable AND v.status='active' AND v.code=ANY(h.table_ids))
        AND h.starts_at<NEW.ends_at AND h.ends_at>NEW.starts_at
    ) INTO conflict;
  END IF;
  IF conflict THEN RAISE EXCEPTION 'legacy resource mapping requires verification' USING ERRCODE = '23P01'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hostess_reservation_occupancy ON command_center_reservations;
DROP TRIGGER IF EXISTS hostess_hold_occupancy ON hostess_holds;
CREATE TRIGGER hostess_reservation_occupancy BEFORE INSERT OR UPDATE ON command_center_reservations
  FOR EACH ROW EXECUTE FUNCTION hostess_protect_occupancy();
CREATE TRIGGER hostess_hold_occupancy BEFORE INSERT OR UPDATE ON hostess_holds
  FOR EACH ROW EXECUTE FUNCTION hostess_protect_occupancy();

CREATE OR REPLACE FUNCTION hostess_validate_resource_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  resource_code text;
  assigned_ids text[];
  is_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(728411001);
  SELECT r.code, r.is_reservable AND r.status='active' AND z.is_active INTO resource_code, is_active
    FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
    WHERE r.id=NEW.resource_id AND r.venue_code='xoxo';
  IF resource_code IS NULL OR NOT is_active THEN
    RAISE EXCEPTION 'resource is not reservable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME='command_center_reservation_resources' THEN
    SELECT table_ids INTO assigned_ids FROM command_center_reservations WHERE id=NEW.reservation_id;
  ELSE
    SELECT table_ids INTO assigned_ids FROM hostess_holds WHERE id=NEW.hold_id;
  END IF;
  IF cardinality(assigned_ids) <> 1 OR assigned_ids[1] <> resource_code THEN
    RAISE EXCEPTION 'resource link does not match legacy compatibility ID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hostess_reservation_resource_link_check ON command_center_reservation_resources;
DROP TRIGGER IF EXISTS hostess_hold_resource_link_check ON hostess_hold_resources;
CREATE TRIGGER hostess_reservation_resource_link_check BEFORE INSERT OR UPDATE
  ON command_center_reservation_resources FOR EACH ROW EXECUTE FUNCTION hostess_validate_resource_link();
CREATE TRIGGER hostess_hold_resource_link_check BEFORE INSERT OR UPDATE
  ON hostess_hold_resources FOR EACH ROW EXECUTE FUNCTION hostess_validate_resource_link();

CREATE OR REPLACE FUNCTION hostess_require_resource_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entity_id uuid;
  assigned_ids text[];
  current_status text;
  is_consumed boolean;
BEGIN
  IF TG_TABLE_NAME='command_center_reservations' THEN
    entity_id := NEW.id;
    assigned_ids := COALESCE(NEW.table_ids, CASE WHEN NEW.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.table_id] END);
    current_status := NEW.status;
    IF current_status IN ('cancelled','no_show') THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM venue_resources WHERE venue_code='xoxo' AND code=ANY(assigned_ids))
       AND NOT EXISTS (
         SELECT 1 FROM command_center_reservation_resources rr JOIN venue_resources vr ON vr.id=rr.resource_id
         WHERE rr.reservation_id=entity_id AND cardinality(assigned_ids)=1 AND vr.code=assigned_ids[1]
       ) THEN RAISE EXCEPTION 'active resource reservation requires normalized resource link' USING ERRCODE = '23514';
    ELSIF EXISTS (SELECT 1 FROM command_center_reservation_resources WHERE reservation_id=entity_id) THEN
      RAISE EXCEPTION 'legacy reservation cannot keep an inventory resource link' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME='hostess_holds' THEN
    entity_id := NEW.id;
    assigned_ids := NEW.table_ids;
    IF NEW.consumed_at IS NOT NULL OR NEW.expires_at<=now() THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM venue_resources WHERE venue_code='xoxo' AND code=ANY(assigned_ids))
       AND NOT EXISTS (
         SELECT 1 FROM hostess_hold_resources hr JOIN venue_resources vr ON vr.id=hr.resource_id
         WHERE hr.hold_id=entity_id AND cardinality(assigned_ids)=1 AND vr.code=assigned_ids[1]
       ) THEN RAISE EXCEPTION 'active resource hold requires normalized resource link' USING ERRCODE = '23514';
    ELSIF EXISTS (SELECT 1 FROM hostess_hold_resources WHERE hold_id=entity_id) THEN
      RAISE EXCEPTION 'legacy hold cannot keep an inventory resource link' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME='command_center_reservation_resources' THEN
    entity_id := CASE WHEN TG_OP='DELETE' THEN OLD.reservation_id ELSE NEW.reservation_id END;
    SELECT table_ids,status INTO assigned_ids,current_status FROM command_center_reservations WHERE id=entity_id;
    IF NOT FOUND OR current_status IN ('cancelled','no_show') THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM venue_resources WHERE venue_code='xoxo' AND code=ANY(assigned_ids)) THEN
      IF cardinality(assigned_ids)<>1 OR NOT EXISTS (
        SELECT 1 FROM command_center_reservation_resources rr JOIN venue_resources vr ON vr.id=rr.resource_id
        WHERE rr.reservation_id=entity_id AND vr.code=assigned_ids[1]
      ) THEN RAISE EXCEPTION 'active reservation resource must match compatibility ID' USING ERRCODE = '23514'; END IF;
    ELSIF EXISTS (SELECT 1 FROM command_center_reservation_resources WHERE reservation_id=entity_id) THEN
      RAISE EXCEPTION 'legacy reservation cannot keep an inventory resource link' USING ERRCODE = '23514';
    END IF;
  ELSE
    entity_id := CASE WHEN TG_OP='DELETE' THEN OLD.hold_id ELSE NEW.hold_id END;
    SELECT table_ids,consumed_at IS NOT NULL OR expires_at<=now()
      INTO assigned_ids,is_consumed FROM hostess_holds WHERE id=entity_id;
    IF NOT FOUND OR is_consumed THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM venue_resources WHERE venue_code='xoxo' AND code=ANY(assigned_ids)) THEN
      IF cardinality(assigned_ids)<>1 OR NOT EXISTS (
        SELECT 1 FROM hostess_hold_resources hr JOIN venue_resources vr ON vr.id=hr.resource_id
        WHERE hr.hold_id=entity_id AND vr.code=assigned_ids[1]
      ) THEN RAISE EXCEPTION 'active hold resource must match compatibility ID' USING ERRCODE = '23514'; END IF;
    ELSIF EXISTS (SELECT 1 FROM hostess_hold_resources WHERE hold_id=entity_id) THEN
      RAISE EXCEPTION 'legacy hold cannot keep an inventory resource link' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS hostess_reservation_resource_required ON command_center_reservations;
DROP TRIGGER IF EXISTS hostess_hold_resource_required ON hostess_holds;
CREATE CONSTRAINT TRIGGER hostess_reservation_resource_required
  AFTER INSERT OR UPDATE ON command_center_reservations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hostess_require_resource_link();
CREATE CONSTRAINT TRIGGER hostess_hold_resource_required
  AFTER INSERT OR UPDATE ON hostess_holds DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hostess_require_resource_link();
CREATE CONSTRAINT TRIGGER hostess_reservation_resource_link_required
  AFTER INSERT OR UPDATE OR DELETE ON command_center_reservation_resources DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hostess_require_resource_link();
CREATE CONSTRAINT TRIGGER hostess_hold_resource_link_required
  AFTER INSERT OR UPDATE OR DELETE ON hostess_hold_resources DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hostess_require_resource_link();
