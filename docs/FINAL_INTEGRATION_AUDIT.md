# Hostess Command Center — final integration audit

Дата: 17 октября 2026, UTC+05:00. Итог: **production не принят полностью**. Backend и изолированные финансовые/регрессионные проверки подтверждены; публичный Cloudflare BFF блокирует открытие стола ошибкой конфигурации. Зеленый CI не отменяет этот блокер.

## Проверенные версии

- Исходный main Command Center: `8fdac23fcfeb45b78f724f01ddb4e84a343fa2ee`, совпадает с внедрением QR dining. Перед началом изменений удаленный main был проверен через GitHub.
- Коммит исправлений: `74813190062b65fb3e1bf57977d34cd070bc155c`.
- Hostess: настоящий код main `90cf28a0fcdde5a79cd17d9fe6287f2205aa475e`; исправление единственного неправильного домена в документации отправлено отдельным коммитом `6144a23baa822bdb8d72a3f06ae7178125ebd4d3`. API/BFF-код между этими коммитами одинаков.
- XOXO: настоящий main `e9bbe282fad44eeb441cd4d39051e41f861dc04d`. Его routes/service, Prisma migrations и PostgreSQL suites проверялись из отдельной копии. Изменения XOXO не потребовались.
- Исходный Railway deployment Command Center: `b368023e-8859-4af2-9851-f4af1562663b`, SUCCESS; лог `[migrate] applied 0006_dine_in.sql` подтвержден отдельно.

## Матрица приемки

PASS означает наблюдаемое подтверждение в указанной среде. FIXED — найденный дефект исправлен и проверен. BLOCKED — требуется внешнее действие. NOT VERIFIED — проверка сознательно не выполнялась или доказательств недостаточно. FAIL — наблюдаемый отрицательный результат.

| Область | Статус | Подтверждение и граница |
|---|---|---|
| Фактический main и QR merge | PASS | HEAD и origin/main исходно совпадали с 8fdac23 |
| Production migration ledger и 12 dining-таблиц | PASS | READ ONLY SQL: исходные 0001–0006 и все 12 объектов; после deploy также 0007 и 17 mapping-строк |
| Production loyalty | PASS | cashback_bps=300, lifetime_days=14, redeem_limit_bps=10000 |
| Production QR 01–17 | PASS | 17 записей, 17 resource IDs, 17 уникальных токенов, enabled=17, wrong_venue=0 |
| Физический инвентарь | FIXED | Добавлены явные проверяемые mapping, manager UI и общая SQL-проверка занятости |
| Реальное распределение столов по залам | BLOCKED | Все 17 пока в qr_unassigned, capacity=NULL, is_reservable=false; требуется осмотр владельца |
| VIP и legacy reservations | PASS | VIP1/2/3 отдельные ресурсы 6/9/4; upgrade fixture и 31 booking regression сохраняют старую модель |
| Историческая сохранность production-броней | NOT VERIFIED | Текущая таблица пуста; отсутствие прежней потери данных по одному снимку доказать нельзя |
| Staff CRM при DINE_IN_ENABLED=no | FIXED | Создание/редактирование работают; viewer, отсутствие сессии и чужой Origin по-прежнему отвергаются |
| Startup/pre-deploy | FIXED | Отсутствующий DATABASE_URL теперь дает exit 1; pending prerequisite блокирует следующие миграции |
| Автоматический startup outbox | FIXED | Nitro plugin; browser E2E перезапускает процесс и подтверждает delivery без входящего HTTP |
| Domain для QR, magic links и fallback | FIXED | https://hostes.online в исходниках, примерах и тестах; Railway значение сохранено без ротации |
| QR SVG/PNG/ZIP/print/PDF | PASS | Mobile E2E: все 17 панелей, реальные скачивания, PDF; стабильный bootstrap, disable/enable, rotation в тестовой БД |
| Публичные deep links / refresh | PASS | Все 17 адресов отдают HTML 200; mobile refresh 200, нет pageerror |
| Публичное открытие стола | FAIL | Реальная страница: «Не удалось открыть стол»; BFF возвращает 503 SERVICE_UNAVAILABLE «Сервис пока не настроен» |
| Cloudflare runtime bindings | BLOCKED | BOOKING_API_ORIGIN или HOSTESS_BFF_KEY недоступны runtime; точные binding values не подтверждены |
| Snapshot XOXO | PASS | Production GET: 200, status=ok, опубликованный round, 27 продуктов |
| Checkout/TTL/round/idempotency/concurrency | PASS | Реальная локальная PostgreSQL; 35 dining tests, включая настоящий consumer/BFF/schema receiver |
| Cashback/expiry/FIFO/debt/compensation | PASS | Тот же PostgreSQL suite; 4770−1000=3770, cashback=113; конкурентное списание, отмены, истечение и debt |
| Lifecycle/payment/session closure | PASS | Последовательные статусы, закрытие после всех заказов, новая сессия следующего визита; cancel не может одновременно отметить оплату |
| WhatsApp identity/claims/merge/history | PASS | Booking и dining suites, реальные DB transactions; phone/JID proof, provisional/staff merge, lot/ledger/history retention |
| Ретроначисление anonymous order | PASS | Политика retroactiveCashback:false сохранена; одного введенного телефона недостаточно |
| Outbox retry/ACK/429/5xx/lease/backlog | PASS | Stable IDs, decimal-string payload, strict ACK, terminal/retry, expired lease, restart E2E; настоящий XOXO suite отдельно |
| Production outbox | PASS | 0 записей, backlog=0, terminal=0; отправитель выключен, receiver diagnostics enabled=false |
| Live покупка/кошелек/оплата персоналом | NOT VERIFIED | Production бизнес-записи не создавались; public BFF дополнительно блокирует сценарий |
| Browser E2E с настоящими live WhatsApp аккаунтами | NOT VERIFIED | Identity и merging проверены изолированно; пользовательские production-сессии не использовались |

## Production PostgreSQL: обезличенный снимок

Проверки выполнены в `BEGIN READ ONLY` с statement_timeout=15s через существующую PostgreSQL. Пароли, телефоны, QR-токены и гостевые данные не выводились. SQL для повторения: [FINAL_AUDIT_QUERIES.sql](FINAL_AUDIT_QUERIES.sql).

- Ledger: 0001, 0002, 0003, 0004, 0005, 0006. Время применения 0006: `2026-10-16T17:34:53.765Z`; соответствующий deployment log — `17:34:54.760Z`.
- Все 12 новых таблиц присутствуют. Для выбранных финансовых/QR таблиц проверены 26 индексов и 167 ограничений PostgreSQL 18; unvalidated=0. Включены partial unique index открытой dining_session, FIFO index, уникальность idempotency, token и order-item/event.
- QR: ровно 17, коды 01–17, уникальные resource IDs и credentials; tenant mismatch=0. Все enabled, все unassigned, booking выключен.
- VIP: отдельные private_room, VIP1=6, VIP2=9, VIP3=4, active/reservable; не объявлялись частью QR 01–17.
- command_center_reservations=0, dining_sessions=0, integration_outbox=0. Это состояние снимка, а не доказательство отсутствия исторической потери.
- Проверенные orphan counts QR/resource, order/session, lot/wallet, outbox/item/order/venue: все 0. Composite FKs и immutable financial-history triggers изучены в миграции.
- Command Center и XOXO используют одинаковый DATABASE_URL (сравнение в памяти), существующая общая БД сохранена. Принудительного повторения 0006, reset, production test schema и второй production БД не было.
- Сохранен агрегированный отпечаток credentials для сверки до/после deploy; отдельные токены в отчет не включены.

## Реальные настройки Railway

Настройки прочитаны через CLI с выводом только разрешенных значений и логических результатов сравнений. OAuth connector возвращал только имена и сам по себе не использовался как доказательство значений.

| Настройка | Наблюдение |
|---|---|
| DINE_IN_ENABLED | yes |
| DINE_IN_PILOT_ASSUMED_PAID | yes |
| DINE_IN_OUTBOX_ENABLED | no, сохранено |
| DINE_IN_OUTBOX_INTERVAL_MS | 5000 |
| HOSTESS_PUBLIC_ORIGIN до исправления | https://hostess.sultansovetov2003.workers.dev |
| HOSTESS_PUBLIC_ORIGIN после исправления | https://hostes.online; применено успешным deployment a2902369, повторно прочитано после deploy |
| COMMAND_CENTER_ORIGIN | https://hostess-command-center-production.up.railway.app; совпадает с доменом сервиса |
| EXCHANGE_API_ORIGIN | https://hostess-xoxo-production.up.railway.app |
| HOSTESS_BFF_KEY / WHATSAPP_SERVICE_KEY / COMMAND_CENTER_SERVICE_KEY | присутствуют, длина не менее 32; значения не раскрывались |
| COMMAND_CENTER_SERVICE_KEY между CC/XOXO | совпадает |
| QR_ORDER_EVENTS_ENABLED в XOXO | отсутствует; реальный diagnostics enabled=false |
| Railway pre-deploy | npm run db:migrate; repo Su1teen/hostess-command-center@main |

## Исправления и совместимость

1. CRM writes отделены от QR feature gate; существующие staff session, role и точное сравнение Origin оставлены.
2. Миграция `0007_physical_inventory_mapping.sql` добавляет 17 неподтвержденных mapping-строк без назначений. Уникальный legacy alias, tenant FK, verifier/reason и защитные triggers. Подтверждение отдельного стола допускает legacy_code=NULL. Изменения запрещены при будущих бронях/активных holds; clearing запрещен, пока ресурс reservable.
3. Legacy и normalized selection/availability/DB triggers используют один predicate занятости. Проверенная пара A1↔QR делит одну занятость. Для неизвестных legacy остается консервативная блокировка; без осмотра никакие реальные соответствия не выдуманы. Existing table_id/table_ids и normalized links сохранены.
4. QR booking требует проверенной mapping и вместимости; manager form не включает booking автоматически. QR order на уже зарезервированный ресурс проверен отдельно: заказ не создает/переносит бронь.
5. Outbox перенесен с первого fetch на process startup через Nitro plugin. Delivery flags не включались. Missing DATABASE_URL больше не приводит к успешному пропуску миграций.
6. Домен исправлен на hostes.online; QR bootstrap и credentials не менялись. Guest links используют тот же HOSTESS_PUBLIC_ORIGIN и хранят token во fragment.
7. Combined cancellation/payment service call больше не отмечает отмененный заказ оплаченным. Retroactive cashback:false сохранен.

Существующие API payload/units не менялись. Дополнены только staff mapping endpoint и поля QR-панели; это описано в DINE_IN_API_CONTRACT.md. Фиктивные consumer fixtures не были единственным доказательством: optional sibling test импортировал настоящие `dine-in-api.ts`, `guest-proxy.ts` и `order-events.service.ts`.

## Выполненные проверки

| Проверка | Результат |
|---|---|
| TypeScript `tsc --noEmit` / npm run typecheck | PASS |
| ESLint / npm run lint | PASS, 0 errors; 9 существующих Fast Refresh warnings |
| Vite production build / npm run build | PASS, client + SSR + Nitro |
| `bun test tests/dine-in.unit.test.ts` | 29 PASS |
| `tests/booking.integration.test.ts` на локальной PostgreSQL | 31 PASS после применения 0001–0007 |
| `tests/dine-in.integration.test.ts` на локальной PostgreSQL | 35 PASS под Node/Vitest, с реальными sibling imports; Linux CI: 34 PASS, 1 explicit sibling skip |
| `scripts/test-integration.mjs`: clean/replay migrations | PASS, 0001–0007, 17 неизменных QR credentials |
| Startup negative checks | PASS: missing DATABASE_URL и pending gated 0003 дают exit 1; 0004–0007 не пропускаются вперед |
| `node scripts/test-ui.mjs` | PASS: mobile queue/state/reload/search, guest CRUD, mapping form, 17 SVG/PNG/ZIP/PDF, bootstrap/disable/enable/rotation, worker restart без HTTP |
| Настоящий XOXO `vitest run tests/order-events.contract.test.ts tests/order-events.postgres.test.ts` | 31 PASS: 15 HTTP/schema + 16 PostgreSQL |
| Production public browser | HTML/deep-link routing PASS; открытие QR FAIL из-за BFF 503 configuration |
| `git diff --check` | PASS |

Локальная тестовая PostgreSQL работала только на 127.0.0.1:55439, пользователь hostess_test. Command Center использовал случайные schemas, XOXO — отдельную локальную qr_integration_test со своим актуальным generated Prisma client. Это не дополнительная production БД.

Windows Bun 1.3.13 воспроизводимо зависал в idempotency test и pool teardown; канонический полный `npm run test:integration` на этой машине поэтому не объявлен успешным. Те же 35 test bodies выполнены под Node 24.19.0/Vitest 2.1.4 с alias bun:test→vitest. Unit и booking выполнялись также непосредственно Bun. Канонический runner полностью прошел отдельно в Linux CI, включая browser E2E. Cross-repository test включается через HOSTESS_REPOSITORY и XOXO_REPOSITORY; без соседних копий он явно skipped.

## Оставшиеся действия владельца и безопасное включение

1. **Cloudflare:** проверить Worker, обслуживающий именно https://hostes.online. Обеспечить runtime доступ к BOOKING_API_ORIGIN=https://hostess-command-center-production.up.railway.app и существующему HOSTESS_BFF_KEY; не создавать новый несовпадающий key. Проверить, что bindings доходят до Nitro/SSR. Повторить GET /api/guest/v1/dine-in/tables/:token и mobile refresh: требуется валидная карточка стола, не только HTML 200. Отдельный прямой диагностический backend-запрос с production-ключом был отклонен automatic approval review; вместо него применены public BFF probes и чтение журналов.
2. **Railway:** нормальный deploy main и применение pending 0007 уже подтверждены; дальнейшие выкладки должны сохранять все 17 credentials. 0006 не запускать принудительно. Отправитель outbox оставить выключенным до шага 4.
3. **Физический инвентарь:** владелец подтверждает зал/вместимость/legacy соответствия в `/tables/qr`. Не считать QR 01–17 вторым набором физических столов. Для подтвержденных ресурсов booking включать отдельно после обзора вместимости; VIP не перенумеровывать. Ограничение mapping-редактирования при будущих бронях требует согласованного окна, а не обхода SQL guard.
4. **XOXO rollout:** оставить DINE_IN_OUTBOX_ENABLED=no. У receiver подтвердить текущие migrations, service-key equality, реальные HTTP ACK и durable deduplication; включить QR_ORDER_EVENTS_ENABLED=true. После read-only diagnostics enabled=true разрешить отправитель DINE_IN_OUTBOX_ENABLED=yes. Наблюдать pending/failed/terminal; перед manual retry устранить причину. Не менять eventId/orderItemId при повторах.
5. После устранения BFF blocker согласовать обозначенную production-тестовую покупку с владельцем: anonymous/verified guest, 4770−1000/113, ручная оплата, WhatsApp, staff queue, outbox ACK. До этого live финансовая приемка — NOT VERIFIED. В этом аудите production заказов, бонусных начислений и платежных отметок не создавалось.

## Delivery evidence

В main отправлены коммит исправлений 7481319 и отчет c2aeab1. Полный проверенный SHA deployment: `c2aeab1b2943fc0ff755631b846d60f4fdae6510`.

- [GitHub Actions 38979720280](https://github.com/Su1teen/hostess-command-center/actions/runs/38979720280): SUCCESS. Все шаги typecheck/lint/build/unit/integration/browser завершились успешно. Unit=29; booking=31; dining=34 PASS + 1 explicit cross-repository skip; настоящий cross-repository тест отдельно прошел локально в числе 35.
- Railway deployment `a2902369-abf6-492a-95af-d6f407ee84b7`: SUCCESS, опубликован `2026-10-16T23:09:06Z` (17 октября 04:09 UTC+05). Start log подтверждает прослушивание 8080; pre-deploy log содержит `[migrate] applied 0007_physical_inventory_mapping.sql`.
- Повторный READ ONLY снимок `2026-10-16T23:09:28.755Z`: ledger заканчивается 0007; время ledger 0006 осталось прежним. Mapping=17, все 17 unverified. QR=17, enabled=17, reservable=0, unassigned=17, tenant mismatch=0. Агрегированный отпечаток resource IDs + credentials **точно совпадает** с контрольным снимком до deploy: QR-токены не перевыпускались.
- Повторно прочитано HOSTESS_PUBLIC_ORIGIN=https://hostes.online; DINE_IN_ENABLED=yes, pilot=yes, outbox=no, interval=5000; shared DB и равенство CC/XOXO ключей сохранены. Outbox остается пустым, orphan counts=0.
- Публичный BFF blocker Cloudflare этим Railway deployment не устраняется: он расположен в соседнем frontend runtime. Полная live приемка остается BLOCKED/NOT VERIFIED согласно матрице.

Финальная добавка этого раздела изменяет только документацию. Файл не встраивает собственный будущий commit hash; проверенный SHA кода и deployment приведен выше.
