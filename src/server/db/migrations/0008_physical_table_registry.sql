-- Additive registry: all resource IDs, QR tokens, codes and zone assignments stay intact.
ALTER TABLE venue_resources ADD COLUMN registry_version integer NOT NULL DEFAULT 1 CHECK(registry_version>0);
ALTER TABLE venue_resource_mappings
 ADD COLUMN relationship text NOT NULL DEFAULT 'pending' CHECK(relationship IN('pending','independent','linked')),
 ADD COLUMN linked_resource_id uuid,
 ADD CONSTRAINT physical_link_same_venue FOREIGN KEY(venue_id,linked_resource_id) REFERENCES venue_resources(venue_id,id),
 ADD CONSTRAINT physical_link_not_self CHECK(linked_resource_id IS DISTINCT FROM resource_id);
-- Pure metadata backfill must not invoke the old global future-occupancy guard.
DROP TRIGGER venue_mapping_guard ON venue_resource_mappings;
UPDATE venue_resource_mappings SET relationship=CASE WHEN verified_at IS NULL THEN 'pending' WHEN legacy_code IS NULL THEN 'independent' ELSE 'linked' END;
ALTER TABLE venue_resource_mappings ADD CONSTRAINT physical_relationship_consistency CHECK(
 (relationship='pending' AND verified_at IS NULL AND linked_resource_id IS NULL AND legacy_code IS NULL) OR
 (relationship='independent' AND linked_resource_id IS NULL AND legacy_code IS NULL) OR
 (relationship='linked' AND ((linked_resource_id IS NOT NULL AND legacy_code IS NULL) OR (linked_resource_id IS NULL AND legacy_code IS NOT NULL))));
CREATE UNIQUE INDEX physical_link_unique ON venue_resource_mappings(linked_resource_id) WHERE linked_resource_id IS NOT NULL;

CREATE FUNCTION hostess_physical_alias_codes(resource uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT ARRAY(SELECT DISTINCT code FROM (
  SELECT r.code FROM venue_resources r WHERE r.id=resource
  UNION ALL SELECT r.code FROM venue_resource_mappings m JOIN venue_resources r ON r.id=m.linked_resource_id
    WHERE m.resource_id=resource AND m.verified_at IS NOT NULL
  UNION ALL SELECT m.legacy_code FROM venue_resource_mappings m WHERE m.resource_id=resource AND m.verified_at IS NOT NULL
  UNION ALL SELECT r.code FROM venue_resource_mappings m JOIN venue_resources r ON r.id=m.resource_id
    WHERE m.linked_resource_id=resource AND m.verified_at IS NOT NULL
 ) aliases WHERE code IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION hostess_inventory_conflicts(a text[],b text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(a && b,false) OR EXISTS(
  SELECT 1 FROM venue_resource_mappings m JOIN venue_resources r ON r.id=m.resource_id
  LEFT JOIN venue_resources target ON target.id=m.linked_resource_id
  WHERE r.venue_code='xoxo' AND m.verified_at IS NOT NULL AND
   ((COALESCE(m.legacy_code,target.code)=ANY(a) AND r.code=ANY(b)) OR
    (COALESCE(m.legacy_code,target.code)=ANY(b) AND r.code=ANY(a))))
 OR EXISTS(
  SELECT 1 FROM unnest(a) x(code),unnest(b) y(code)
  WHERE (x.code=ANY(ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar'])
    AND NOT EXISTS(SELECT 1 FROM venue_resource_mappings m JOIN hostess_venues v ON v.id=m.venue_id WHERE v.slug='xoxo' AND m.legacy_code=x.code AND m.verified_at IS NOT NULL)
    AND EXISTS(SELECT 1 FROM venue_resources r WHERE r.venue_code='xoxo' AND r.code=y.code))
  OR (y.code=ANY(ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar'])
    AND NOT EXISTS(SELECT 1 FROM venue_resource_mappings m JOIN hostess_venues v ON v.id=m.venue_id WHERE v.slug='xoxo' AND m.legacy_code=y.code AND m.verified_at IS NOT NULL)
    AND EXISTS(SELECT 1 FROM venue_resources r WHERE r.venue_code='xoxo' AND r.code=x.code)))
$$;

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
 IF (NEW.verified_at IS NULL OR NEW.linked_resource_id IS NOT NULL)
    AND EXISTS(SELECT 1 FROM venue_resources WHERE id=NEW.resource_id AND is_reservable)
 THEN RAISE EXCEPTION 'disable QR reservations before clearing or linking mapping' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER venue_mapping_guard BEFORE INSERT OR UPDATE OR DELETE ON venue_resource_mappings
 FOR EACH ROW EXECUTE FUNCTION hostess_protect_mapping();

CREATE OR REPLACE FUNCTION hostess_require_qr_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(728411001);
 IF NEW.is_reservable AND EXISTS(SELECT 1 FROM table_qr_codes WHERE resource_id=NEW.id)
 AND (NEW.capacity IS NULL OR NOT EXISTS(SELECT 1 FROM venue_resource_mappings WHERE resource_id=NEW.id
      AND verified_at IS NOT NULL AND relationship<>'pending' AND linked_resource_id IS NULL))
 THEN RAISE EXCEPTION 'QR booking requires verified independent inventory and capacity' USING ERRCODE='23514'; END IF;
 IF NEW.is_reservable AND EXISTS(SELECT 1 FROM venue_resource_mappings m WHERE m.resource_id=NEW.id
    AND m.legacy_code IS NOT NULL AND NEW.capacity IS DISTINCT FROM CASE WHEN m.legacy_code IN('A1','A2','A3','Bar') THEN 6 ELSE 4 END)
 THEN RAISE EXCEPTION 'legacy alias capacity must match its physical booking resource' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- Bootstrap still creates only missing records, including their empty registry rows.
CREATE FUNCTION hostess_registry_bootstrap_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO venue_resource_mappings(resource_id,venue_id) VALUES(NEW.resource_id,NEW.venue_id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER qr_registry_mapping AFTER INSERT ON table_qr_codes FOR EACH ROW EXECUTE FUNCTION hostess_registry_bootstrap_mapping();

-- A confirmed VIP point can change its type without making bootstrap reject or
-- replace the existing inventory. Bootstrap only fills missing rows/credentials.
CREATE OR REPLACE FUNCTION hostess_bootstrap_qr() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid; z uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(728411006);
 SELECT id INTO v FROM hostess_venues WHERE slug='xoxo';
 INSERT INTO venue_zones(venue_code,code,name,zone_type,display_order)
   VALUES('xoxo','qr_unassigned','Расположение не назначено','shared_hall',99) ON CONFLICT(venue_code,code) DO NOTHING;
 SELECT id INTO z FROM venue_zones WHERE venue_code='xoxo' AND code='qr_unassigned';
 INSERT INTO venue_resources(venue_id,venue_code,zone_id,code,name,resource_type,is_reservable,status,metadata)
   SELECT v,'xoxo',z,lpad(n::text,2,'0'),'Стол '||lpad(n::text,2,'0'),'table',false,'active',
    '{"physical_position_verified":false,"source":"qr_pilot_17"}'::jsonb FROM generate_series(1,17) n
   ON CONFLICT(venue_code,code) DO NOTHING;
 IF (SELECT count(*) FROM venue_resources WHERE venue_id=v AND code BETWEEN '01' AND '17')<>17
 THEN RAISE EXCEPTION 'QR physical table codes conflict with existing resources'; END IF;
 INSERT INTO table_qr_codes(venue_id,resource_id,token)
   SELECT v,id,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') FROM venue_resources
   WHERE venue_id=v AND code BETWEEN '01' AND '17' ON CONFLICT(venue_id,resource_id) DO NOTHING;
 INSERT INTO venue_resource_mappings(resource_id,venue_id)
   SELECT resource_id,venue_id FROM table_qr_codes WHERE venue_id=v ON CONFLICT(resource_id) DO NOTHING;
END $$;

CREATE FUNCTION hostess_validate_physical_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM venue_resource_mappings m JOIN venue_resources r ON r.id=m.resource_id
   JOIN venue_resources t ON t.id=m.linked_resource_id
   WHERE m.verified_at IS NOT NULL AND (m.resource_id=NEW.resource_id OR m.linked_resource_id=NEW.resource_id)
     AND ((r.zone_id,r.resource_type,r.capacity) IS DISTINCT FROM (t.zone_id,t.resource_type,t.capacity) OR r.is_reservable))
 THEN RAISE EXCEPTION 'verified linked resources must share zone, type and capacity with only one booking resource' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER physical_link_consistent AFTER INSERT OR UPDATE ON venue_resource_mappings
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hostess_validate_physical_link();
CREATE FUNCTION hostess_validate_physical_resource() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM venue_resource_mappings m JOIN venue_resources r ON r.id=m.resource_id
   JOIN venue_resources t ON t.id=m.linked_resource_id
   WHERE m.verified_at IS NOT NULL AND (m.resource_id=NEW.id OR m.linked_resource_id=NEW.id)
     AND ((r.zone_id,r.resource_type,r.capacity) IS DISTINCT FROM (t.zone_id,t.resource_type,t.capacity) OR r.is_reservable))
 THEN RAISE EXCEPTION 'verified physical aliases cannot diverge from booking inventory' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER physical_resource_consistent AFTER UPDATE ON venue_resources
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hostess_validate_physical_resource();
CREATE FUNCTION hostess_protect_physical_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aliases text[];
BEGIN
 IF NEW.capacity IS DISTINCT FROM OLD.capacity AND (NEW.capacity IS NULL OR NEW.capacity<OLD.capacity) THEN
  PERFORM pg_advisory_xact_lock(728411001);
  aliases:=hostess_physical_alias_codes(NEW.id);
  IF EXISTS(SELECT 1 FROM command_center_reservations WHERE status NOT IN('cancelled','no_show')
    AND COALESCE(ends_at,starts_at+interval '2 hours')>now() AND guests>COALESCE(NEW.capacity,0)
    AND COALESCE(table_ids,ARRAY[table_id]) && aliases)
  OR EXISTS(SELECT 1 FROM hostess_holds WHERE consumed_at IS NULL AND expires_at>now()
    AND guests>COALESCE(NEW.capacity,0) AND table_ids && aliases)
  THEN RAISE EXCEPTION 'capacity is insufficient for existing physical reservations' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER physical_capacity_guard BEFORE UPDATE ON venue_resources FOR EACH ROW EXECUTE FUNCTION hostess_protect_physical_capacity();
