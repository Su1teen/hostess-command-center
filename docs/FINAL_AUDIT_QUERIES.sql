-- Run with existing production credentials. SELECT only; no test records or migration replay.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT name, applied_at FROM command_center_migrations ORDER BY name;
SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
 AND tablename=ANY(ARRAY['hostess_venues','table_qr_codes','dining_sessions','dine_in_quotes',
 'dine_in_orders','dine_in_order_items','dine_in_order_events','loyalty_programs',
 'loyalty_wallets','loyalty_lots','loyalty_transactions','integration_outbox']) ORDER BY tablename;
SELECT v.slug,p.cashback_bps,p.lifetime_days,p.redeem_limit_bps
 FROM loyalty_programs p JOIN hostess_venues v ON v.id=p.venue_id;
SELECT v.slug,count(*) AS total,count(DISTINCT q.resource_id) AS resources,
 count(DISTINCT q.token) AS tokens,count(*) FILTER(WHERE q.enabled) AS enabled,
 count(*) FILTER(WHERE r.is_reservable) AS reservable,
 count(*) FILTER(WHERE z.code='qr_unassigned') AS unassigned,
 count(*) FILTER(WHERE r.venue_id<>q.venue_id OR r.venue_code<>v.slug OR z.venue_code<>v.slug) AS wrong_venue
 FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id
 JOIN hostess_venues v ON v.id=q.venue_id JOIN venue_zones z ON z.id=r.zone_id GROUP BY v.slug;
SELECT z.code AS zone,r.code,r.resource_type,r.capacity,r.is_reservable,r.status
 FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id ORDER BY z.code,r.code;
SELECT count(*) AS total,
 count(*) FILTER(WHERE created_at<'2026-10-16T17:34:54Z') AS pre_dining,
 count(*) FILTER(WHERE status NOT IN('cancelled','no_show')) AS active FROM command_center_reservations;
SELECT status,terminal,count(*) AS count,min(created_at) AS oldest,max(attempts) AS max_attempts
 FROM integration_outbox GROUP BY status,terminal;
SELECT count(*) AS total,count(*) FILTER(WHERE closed_at IS NULL) AS open FROM dining_sessions;
SELECT
 (SELECT count(*) FROM table_qr_codes q LEFT JOIN venue_resources r ON r.id=q.resource_id AND r.venue_id=q.venue_id WHERE r.id IS NULL) AS qr_orphans,
 (SELECT count(*) FROM dine_in_orders o LEFT JOIN dining_sessions s ON s.id=o.dining_session_id AND s.venue_id=o.venue_id WHERE s.id IS NULL) AS session_orphans,
 (SELECT count(*) FROM loyalty_lots l LEFT JOIN loyalty_wallets w ON w.id=l.wallet_id AND w.venue_id=l.venue_id WHERE w.id IS NULL) AS wallet_orphans,
 (SELECT count(*) FROM integration_outbox b LEFT JOIN dine_in_order_items i ON i.id=b.order_item_id AND i.order_id=b.order_id AND i.venue_id=b.venue_id WHERE i.id IS NULL) AS outbox_orphans;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema()
 AND tablename=ANY(ARRAY['table_qr_codes','dining_sessions','dine_in_orders','loyalty_lots','loyalty_transactions','integration_outbox']) ORDER BY tablename,indexname;
SELECT c.conrelid::regclass::text AS table_name,c.conname,c.contype,c.convalidated
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname=current_schema() AND t.relname=ANY(ARRAY['table_qr_codes','dining_sessions','dine_in_quotes',
 'dine_in_orders','dine_in_order_items','dine_in_order_events','loyalty_wallets','loyalty_lots','loyalty_transactions','integration_outbox']) ORDER BY 1,2;
ROLLBACK;

-- After normal deployment of 0007, inspect unresolved mapping without activating booking:
-- SELECT count(*) AS total,count(*) FILTER(WHERE verified_at IS NULL) AS unverified FROM venue_resource_mappings;
