-- Correct two false 23514 checks introduced in 0004.
-- Valid normalized VIP resources WITH proper links were being rejected as legacy records.
-- No data changes: replaces only the existing trigger function; all triggers remain installed.
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
    ELSIF NOT EXISTS (SELECT 1 FROM venue_resources WHERE venue_code='xoxo' AND code=ANY(assigned_ids))
      AND EXISTS (SELECT 1 FROM command_center_reservation_resources WHERE reservation_id=entity_id) THEN
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
    ELSIF NOT EXISTS (SELECT 1 FROM venue_resources WHERE venue_code='xoxo' AND code=ANY(assigned_ids))
      AND EXISTS (SELECT 1 FROM hostess_hold_resources WHERE hold_id=entity_id) THEN
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
