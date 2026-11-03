-- XOXO floor aligned with the iiko hall schema (snapshot 2026-11-03, src/lib/iiko/xoxo-floor.json).
-- Resource codes 01–17 stay the same, so reservation history, sessions and orders keep their tables.
-- 01–08 Основной зал «Стол 01–08», 09–11 Второй зал «Стол 01–03», 15–17 «PS 01–03», 12–14 «VIP 01–03».
-- A VIP plate is the same room as the booking resource VIP1–VIP3: the QR point is linked to it, so the
-- room has one capacity and one occupancy. Every QR credential is re-issued for the new printed plates.

UPDATE venue_zones SET name=z.name, description=z.description, display_order=z.display_order, is_active=true
FROM (VALUES
  ('first_hall','Основной зал','8 столов: Стол 01–08 (iiko «Зал (Барная)»).',10),
  ('second_hall','Второй зал','3 стола: Стол 01–03 (iiko «Общий зал»).',20),
  ('ps','PlayStation','3 места с PlayStation: PS 01–03 (iiko «PS (Общий зал)»).',30),
  ('vip','VIP-комнаты','3 отдельные комнаты: VIP 01–03 (iiko «ВИП»).',40)
) AS z(code,name,description,display_order)
WHERE venue_zones.venue_code='xoxo' AND venue_zones.code=z.code;

UPDATE venue_resources r SET name=v.name, updated_at=now(), registry_version=r.registry_version+1,
  metadata=r.metadata || jsonb_build_object('source','iiko_schema_2026-11-03','qr_point',v.qr)
FROM (VALUES ('VIP1','VIP 01','12'),('VIP2','VIP 02','13'),('VIP3','VIP 03','14')) AS v(code,name,qr)
WHERE r.venue_code='xoxo' AND r.code=v.code;

CREATE TEMP TABLE iiko_floor(code text, zone text, name text, kind text, capacity int,
  iiko_section text, iiko_number int, x int, y int, w int, h int, room text) ON COMMIT DROP;
-- Coordinates are the iiko schema scaled into the 1000×700 command center plan.
INSERT INTO iiko_floor VALUES
  ('01','first_hall','Стол 01','table',6,'Зал (Барная)',1,110,385,120,80,NULL),
  ('02','first_hall','Стол 02','table',6,'Зал (Барная)',2,292,90,120,80,NULL),
  ('03','first_hall','Стол 03','table',6,'Зал (Барная)',3,487,90,120,80,NULL),
  ('04','first_hall','Стол 04','table',6,'Зал (Барная)',4,110,533,120,80,NULL),
  ('05','first_hall','Стол 05','table',6,'Зал (Барная)',5,331,533,120,80,NULL),
  ('06','first_hall','Стол 06','table',6,'Зал (Барная)',6,500,533,120,80,NULL),
  ('07','first_hall','Стол 07','table',6,'Зал (Барная)',7,487,238,120,80,NULL),
  ('08','first_hall','Стол 08','table',6,'Зал (Барная)',8,123,90,120,80,NULL),
  ('09','second_hall','Стол 01','table',6,'Общий зал',1,300,270,140,100,NULL),
  ('10','second_hall','Стол 02','table',6,'Общий зал',2,550,445,140,100,NULL),
  ('11','second_hall','Стол 03','table',6,'Общий зал',3,550,120,140,100,NULL),
  ('12','vip','VIP 01','private_room',6,'ВИП',1,380,95,240,90,'VIP1'),
  ('13','vip','VIP 02','private_room',9,'ВИП',2,380,295,240,90,'VIP2'),
  ('14','vip','VIP 03','private_room',4,'ВИП',3,380,495,240,90,'VIP3'),
  ('15','ps','PS 01','table',6,'PS (Общий зал)',1,200,140,160,100,NULL),
  ('16','ps','PS 02','table',6,'PS (Общий зал)',2,200,472,160,100,NULL),
  ('17','ps','PS 03','table',6,'PS (Общий зал)',3,560,472,160,100,NULL);

UPDATE venue_resources r SET zone_id=z.id, name=f.name, resource_type=f.kind, capacity=f.capacity,
  is_reservable=f.room IS NULL, status='active', updated_at=now(), registry_version=r.registry_version+1,
  metadata=r.metadata || jsonb_build_object('source','iiko_schema_2026-11-03','iiko_section',f.iiko_section,
    'iiko_number',f.iiko_number,'physical_position_verified',true)
FROM iiko_floor f JOIN venue_zones z ON z.venue_code='xoxo' AND z.code=f.zone
WHERE r.venue_code='xoxo' AND r.code=f.code;

DO $$
BEGIN
  IF (SELECT count(*) FROM venue_resources r JOIN iiko_floor f ON f.code=r.code WHERE r.venue_code='xoxo')<>17
  THEN RAISE EXCEPTION 'expected the 17 XOXO QR tables 01–17'; END IF;
END $$;

INSERT INTO venue_layout(resource_id,layout_version,x,y,width,height,shape,rotation)
SELECT r.id,1,f.x,f.y,f.w,f.h,'rectangle',0
FROM iiko_floor f JOIN venue_resources r ON r.venue_code='xoxo' AND r.code=f.code
ON CONFLICT(resource_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y,width=EXCLUDED.width,height=EXCLUDED.height,
  shape='rectangle',rotation=0,layout_version=venue_layout.layout_version+1;

-- Confirm each plate: VIP plates link to their room, the rest are independent places. A place with an
-- open visit or upcoming booking keeps its mapping (the guard refuses); staff confirm it in «Столы и QR».
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT r.id, room.id AS room_id FROM venue_resources r JOIN iiko_floor f ON f.code=r.code
    LEFT JOIN venue_resources room ON room.venue_code='xoxo' AND room.code=f.room WHERE r.venue_code='xoxo' LOOP
    BEGIN
      UPDATE venue_resource_mappings SET relationship=CASE WHEN t.room_id IS NULL THEN 'independent' ELSE 'linked' END,
        linked_resource_id=t.room_id, legacy_code=NULL,
        verified_at=COALESCE(verified_at,now()), verified_by='script:iiko-floor', note='Схема зала iiko, 2026-11-03'
      WHERE resource_id=t.id;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'mapping for % left unchanged: %', t.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- New credentials for the new plates: previously printed QR codes stop working.
UPDATE table_qr_codes q SET token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
  generation=q.generation+1, rotated_at=now(), enabled=true
FROM venue_resources r WHERE r.id=q.resource_id AND r.venue_code='xoxo' AND r.code IN (SELECT code FROM iiko_floor);
INSERT INTO hostess_audit(actor,action,entity_id,details)
SELECT 'script:iiko-floor','qr_rotated',r.id,'{"reason":"iiko floor alignment, new printed plates"}'::jsonb
FROM venue_resources r WHERE r.venue_code='xoxo' AND r.code IN (SELECT code FROM iiko_floor);
