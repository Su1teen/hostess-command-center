// Generates the Dayan v9 n8n workflows from one source of truth.
// Usage: node n8n/dayan-v9/build.mjs [--env=test|prod] [--booking-id=ID --handoff-id=ID]
// Writes main.json, booking.json, handoff.json next to this file.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const dir = new URL(".", import.meta.url);
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const env = arg("env", "prod");

// ---- Settings. Production values; test mode only changes where staff notices go. ----
const credentials = {
  commandCenter: {
    httpHeaderAuth: {
      id: arg("cc-cred-id", "16iV4WrEbTKjS0v7"),
      name: arg("cc-cred-name", "Hostess booking service"),
    },
  },
  waha: { httpHeaderAuth: { id: "efDgfDjzCTMvRmmM", name: "XoXo auth" } },
  telegram: { telegramApi: { id: "IstucbElD9VeIe4H", name: "XOXO" } },
  openai: { openAiApi: { id: "pG1trLtfC2Ljombv", name: "Pater" } },
};
const settings = {
  // true: the staff-group booking notice goes to Telegram instead of the WhatsApp group.
  testMode: env === "test",
  ccBaseUrl: arg("cc-url", "https://hostess-command-center-production.up.railway.app"),
  wahaBaseUrl: "https://waha-clean-production-a261.up.railway.app",
  wahaSession: "XoXo",
  staffGroupId: "120363403598925979@g.us",
  telegramChatId: "872587503",
  venueAddress: "Астана, ул. Санжара Асфендиярова, 8",
  venueMap: "https://2gis.kz/astana/firm/70000001089631692",
};
const webhookPath = arg("path", env === "test" ? "xoxo-waha-v9-test" : "xoxo-waha");
const prefix = env === "test" ? "Даян v9 [TEST]" : "Даян v9";

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: randomUUID(),
  name,
  type,
  typeVersion,
  position,
  parameters,
  ...extra,
});
const ccHttp = (name, position, method, path, jsonBody, extra = {}) =>
  node(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    position,
    {
      method,
      url: `={{ $('Настройки').first().json.ccBaseUrl }}${path}`,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      ...(jsonBody ? { sendBody: true, specifyBody: "json", jsonBody } : {}),
      options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true } } },
    },
    {
      credentials: credentials.commandCenter,
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1500,
      onError: "continueRegularOutput",
      ...extra,
    },
  );
const telegram = (
  name,
  position,
  text,
  chatId = "={{ $('Настройки').first().json.telegramChatId }}",
) =>
  node(
    name,
    "n8n-nodes-base.telegram",
    1.2,
    position,
    {
      chatId,
      text,
      additionalFields: { appendAttribution: false, disable_web_page_preview: true },
    },
    {
      credentials: credentials.telegram,
      onError: "continueRegularOutput",
      webhookId: randomUUID(),
    },
  );
const ifNode = (name, position, expression) =>
  node(name, "n8n-nodes-base.if", 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
      combinator: "and",
      conditions: [
        {
          id: randomUUID(),
          leftValue: expression,
          rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
    },
    options: {},
  });
const link = (connections, from, to, output = 0) => {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node: to, type: "main", index: 0 });
};
const workflow = (name, nodes, connections) => ({
  name,
  nodes,
  connections,
  settings: {
    executionOrder: "v1",
    timezone: "Asia/Almaty",
    callerPolicy: "workflowsFromSameOwner",
    saveDataSuccessExecution: "all",
    saveManualExecutions: true,
  },
});
const settingsNode = (position) =>
  node("Настройки", "n8n-nodes-base.set", 3.4, position, {
    mode: "raw",
    jsonOutput: JSON.stringify(settings, null, 2),
    includeOtherFields: false,
    options: {},
  });

// Sub-workflows receive the caller's settings so that one switch controls everything.
const settingsFromInput = (position) =>
  node("Настройки", "n8n-nodes-base.set", 3.4, position, {
    mode: "raw",
    jsonOutput: "={{ JSON.stringify($('Старт').first().json.settings) }}",
    includeOtherFields: false,
    options: {},
  });
const trigger = (fields) =>
  node("Старт", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 300], {
    workflowInputs: { values: fields.map(([name, type]) => ({ name, type })) },
  });

// ========================= Sub-workflow: booking =========================
function bookingWorkflow() {
  const c = {};
  const nodes = [
    trigger([
      ["settings", "object"],
      ["chatKey", "string"],
      ["chatId", "string"],
      ["jid", "string"],
      ["messageId", "string"],
      ["dryRun", "boolean"],
      ["name", "string"],
      ["date", "string"],
      ["time", "string"],
      ["guests", "number"],
      ["zone", "string"],
      ["notes", "string"],
      ["contactPhone", "string"],
      ["guestWords", "string"],
    ]),
    settingsFromInput([220, 300]),
    node("Проверка данных", "n8n-nodes-base.code", 2, [440, 500], {
      jsCode: `const s = $('Старт').first().json;
// The model must not book under the WhatsApp profile name or an invented name.
const words = String(s.guestWords || '').toLowerCase();
const name = String(s.name || '').trim().toLowerCase();
const stem = name.length > 4 ? name.slice(0, name.length - 1) : name;
const problem = !name || name === 'гость' ? 'Гость не назвал имя — спроси имя для брони.'
  : !words.includes(stem) ? 'Гость в переписке не называл имя «' + s.name + '» — спроси, на какое имя оформить бронь.'
  : !s.date || !s.time || !(Number(s.guests) > 0) ? 'Не хватает даты, времени или числа гостей — уточни у гостя, не придумывай.' : '';
return [{ json: { valid: !problem, problem } }];`,
    }),
    ifNode("Данных хватает?", [660, 500], "={{ $json.valid === true }}"),
    node("Нужны данные от гостя", "n8n-nodes-base.code", 2, [880, 600], {
      jsCode: `return [{ json: { ok: false, needsGuestInput: true, problem: $('Проверка данных').first().json.problem } }];`,
    }),
    ccHttp(
      "Command Center: бронь",
      [440, 300],
      "POST",
      "/api/agent/v1/bookings",
      `={{ JSON.stringify((() => { const s = $('Старт').first().json; const clean = v => (v === undefined || v === null || String(v).trim() === '' || String(v) === 'null') ? null : String(v).trim();
  return { chatKey: s.chatKey, idempotencyKey: s.chatKey + ':' + s.messageId + ':' + [s.date, s.time, s.guests].join('/'),
    jid: clean(s.jid), contactPhone: clean(s.contactPhone)?.replace(/[^+\\d]/g, '').replace(/^8(\\d{10})$/, '+7$1').replace(/^7(\\d{10})$/, '+7$1') || null,
    name: clean(s.name) || 'Гость', date: clean(s.date), time: clean(s.time)?.padStart(5, '0'), guests: Number(s.guests),
    zone: clean(s.zone), notes: clean(s.notes) }; })()) }}`,
    ),
    node("Итог брони", "n8n-nodes-base.code", 2, [660, 300], {
      jsCode: `const s = $('Старт').first().json;
const cfg = $('Настройки').first().json;
const r = $input.first().json || {};
const status = Number(r.statusCode || 0);
const b = r.body && typeof r.body === 'object' ? r.body : {};
const err = b.error || {};
const dmy = d => String(d || '').split('-').reverse().join('.');
const plural = n => n % 10 === 1 && n % 100 !== 11 ? 'гость' : [2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100) ? 'гостя' : 'гостей';
const who = 'Имя: ' + (b.name || s.name) + '\\nТелефон: ' + (b.phone || s.contactPhone || s.jid || s.chatId) + (b.phoneVerified === false ? ' (со слов гостя)' : '');
const when = 'Дата: ' + dmy(b.date || s.date) + ' в ' + (b.time || s.time) + '\\nГостей: ' + (b.guests || s.guests);
const out = { ok: true, status: 'accepted', groupText: '', telegramText: '', pause: false, pauseReason: '' };
if (status === 201 && b.status === 'confirmed') {
  out.status = 'confirmed';
  out.groupText = (b.replacedPrevious ? '🔄 Бронь изменена гостем (WhatsApp · Даян)\\n' : '✅ Новая бронь (WhatsApp · Даян)\\n') + who + '\\n' + when + '\\nЗона: ' + (b.zoneName || '—') + '\\nМесто: ' + (b.tableName || '—') + (b.notes ? '\\nКомментарий: ' + b.notes : '') + (b.requestedZone && !b.zoneMatched ? '\\n⚠️ Гость хотел: ' + b.requestedZone : '');
  out.booking = { name: b.name, when: b.when, guests: b.guests, zone: b.zoneName };
} else if (status === 201 && b.status === 'requested') {
  out.telegramText = '🕓 Даян: стол не назначился автоматически — заявка в Command Center (Смена → Заявки на бронирование). Назначьте место.\\n' + who + '\\n' + when + (b.requestedZone ? '\\nПожелание: ' + b.requestedZone : '') + '\\nЧат: ' + s.chatId;
  out.booking = { name: b.name, date: b.date, time: b.time, guests: b.guests };
} else if (status === 422 && ['CLOSED', 'INVALID_DATE', 'PHONE_REQUIRED', 'INVALID_INPUT'].includes(err.code)) {
  return [{ json: { ok: false, needsGuestInput: true, problem: err.code === 'CLOSED' ? 'Бронь возможна только на время с 17:00 до 04:00.' : err.code === 'PHONE_REQUIRED' ? 'Нужен номер телефона гостя.' : err.code === 'INVALID_DATE' ? 'Дата уже прошла или слишком далеко — нужна ближайшая будущая дата.' : 'Проверь имя, дату (ГГГГ-ММ-ДД), время (ЧЧ:ММ) и число гостей.' } }];
} else {
  out.pause = true;
  out.pauseReason = 'Бронь не записалась в Command Center';
  out.telegramText = '🚨 Даян: бронь НЕ записалась в Command Center — внесите вручную. ИИ в этом чате остановлен.\\n' + who + '\\n' + when + (s.zone ? '\\nЗона: ' + s.zone : '') + (s.notes ? '\\nКомментарий: ' + s.notes : '') + '\\nЧат: ' + s.chatId + '\\nОтвет сервера: ' + (status || 'нет ответа') + ' ' + String(err.code || r.error?.message || '').slice(0, 120);
  out.booking = { name: s.name, date: s.date, time: s.time, guests: s.guests };
}
if (cfg.testMode && out.groupText) out.telegramText = [out.telegramText, '🧪 ТЕСТ — в общий чат ушло бы:\\n' + out.groupText].filter(Boolean).join('\\n\\n');
out.sendGroup = Boolean(out.groupText) && !cfg.testMode && !s.dryRun;
return [{ json: out }];`,
    }),
    ifNode("В общий чат?", [880, 300], "={{ $json.sendGroup === true }}"),
    node(
      "WhatsApp: общий чат",
      "n8n-nodes-base.httpRequest",
      4.2,
      [1100, 200],
      {
        method: "POST",
        url: "={{ $('Настройки').first().json.wahaBaseUrl }}/api/sendText",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ session: $('Настройки').first().json.wahaSession, chatId: $('Настройки').first().json.staffGroupId, text: $('Итог брони').first().json.groupText, linkPreview: false }) }}",
        options: {
          timeout: 20000,
          response: { response: { fullResponse: true, neverError: true } },
        },
      },
      {
        credentials: credentials.waha,
        retryOnFail: true,
        maxTries: 2,
        waitBetweenTries: 2000,
        onError: "continueRegularOutput",
      },
    ),
    node("Проверка уведомлений", "n8n-nodes-base.code", 2, [1320, 300], {
      jsCode: `const out = { ...$('Итог брони').first().json };
let group = null; try { group = $('WhatsApp: общий чат').first().json; } catch {}
if (out.sendGroup && !(group && group.statusCode >= 200 && group.statusCode < 300))
  out.telegramText = [out.telegramText, '⚠️ Бронь записана, но WhatsApp не принял сообщение в общий чат:\\n' + out.groupText].filter(Boolean).join('\\n\\n');
return [{ json: out }];`,
    }),
    ifNode("Нужно остановить ИИ?", [1540, 300], "={{ $json.pause === true }}"),
    ccHttp(
      "Command Center: остановить ИИ",
      [1760, 200],
      "POST",
      "/api/agent/v1/handoff",
      "={{ JSON.stringify({ chatKey: $('Старт').first().json.chatKey, reason: $('Проверка уведомлений').first().json.pauseReason }) }}",
    ),
    ifNode(
      "Есть сообщение в Telegram?",
      [1980, 300],
      "={{ Boolean($('Проверка уведомлений').first().json.telegramText) }}",
    ),
    telegram(
      "Telegram: администраторам",
      [2200, 200],
      "={{ $('Проверка уведомлений').first().json.telegramText }}",
    ),
    node("Ответ агенту", "n8n-nodes-base.code", 2, [2420, 300], {
      jsCode: `const r = $('Проверка уведомлений').first().json;
if (r.needsGuestInput) return [{ json: { ok: false, needsGuestInput: true, problem: r.problem } }];
return [{ json: { ok: true, status: r.status, booking: r.booking, instruction: 'Бронь стоит. Одним коротким сообщением подтверди гостю: имя, когда (называй время ровно так: «' + (r.booking && r.booking.when) + '»), сколько гостей' + (r.status === 'confirmed' ? ', зона' : '') + ', адрес и ссылка 2ГИС. Условия по деньгам — только если они есть в афише на эту дату.' } }];`,
    }),
  ];
  link(c, "Старт", "Настройки");
  link(c, "Настройки", "Проверка данных");
  link(c, "Проверка данных", "Данных хватает?");
  link(c, "Данных хватает?", "Command Center: бронь", 0);
  link(c, "Данных хватает?", "Нужны данные от гостя", 1);
  link(c, "Command Center: бронь", "Итог брони");
  link(c, "Итог брони", "В общий чат?");
  link(c, "В общий чат?", "WhatsApp: общий чат", 0);
  link(c, "В общий чат?", "Проверка уведомлений", 1);
  link(c, "WhatsApp: общий чат", "Проверка уведомлений");
  link(c, "Проверка уведомлений", "Нужно остановить ИИ?");
  link(c, "Нужно остановить ИИ?", "Command Center: остановить ИИ", 0);
  link(c, "Нужно остановить ИИ?", "Есть сообщение в Telegram?", 1);
  link(c, "Command Center: остановить ИИ", "Есть сообщение в Telegram?");
  link(c, "Есть сообщение в Telegram?", "Telegram: администраторам", 0);
  link(c, "Есть сообщение в Telegram?", "Ответ агенту", 1);
  link(c, "Telegram: администраторам", "Ответ агенту");
  return workflow(`${prefix} · 2 · Бронь в Command Center`, nodes, c);
}

// ========================= Sub-workflow: handoff =========================
function handoffWorkflow() {
  const c = {};
  const nodes = [
    trigger([
      ["settings", "object"],
      ["chatKey", "string"],
      ["chatId", "string"],
      ["phone", "string"],
      ["guestName", "string"],
      ["reason", "string"],
      ["summary", "string"],
      ["pause", "boolean"],
    ]),
    settingsFromInput([220, 300]),
    ifNode("Остановить ИИ?", [440, 300], "={{ $('Старт').first().json.pause !== false }}"),
    ccHttp(
      "Command Center: остановить ИИ",
      [660, 200],
      "POST",
      "/api/agent/v1/handoff",
      "={{ JSON.stringify({ chatKey: $('Старт').first().json.chatKey, reason: String($('Старт').first().json.reason || 'нужен сотрудник').slice(0, 500) }) }}",
    ),
    telegram(
      "Telegram: нужен сотрудник",
      [880, 300],
      "={{ (() => { const s = $('Старт').first().json; const paused = s.pause !== false; const digits = String(s.phone || s.chatId || '').replace(/\\D/g, ''); return (paused ? '🙋 Даян передал чат сотруднику — ИИ в нём остановлен.\\nПричина: ' : '❓ Гость спросил то, чего Даян не знает. ИИ в чате продолжает отвечать.\\nВопрос: ') + (s.reason || '—') + '\\nСуть: ' + (s.summary || '—') + '\\nГость: ' + (s.guestName || '—') + ' · ' + (s.phone || s.chatId) + (digits.length === 11 ? '\\nНаписать: https://wa.me/' + digits : '') + (paused ? '\\nВернуть ИИ: Command Center → Даян → чат → «Вернуть ИИ».' : ''); })() }}",
    ),
    node("Ответ агенту", "n8n-nodes-base.code", 2, [1100, 300], {
      jsCode: `const paused = $('Старт').first().json.pause !== false;
return [{ json: { ok: true, instruction: paused
  ? 'Чат передан администратору. Одной фразой скажи гостю, что администратор скоро ему напишет. Больше ничего не обещай.'
  : 'Вопрос передан администратору. Скажи гостю одной фразой, что уточнишь это у администратора. Ты продолжаешь отвечать в чате.' } }];`,
    }),
  ];
  link(c, "Старт", "Настройки");
  link(c, "Настройки", "Остановить ИИ?");
  link(c, "Остановить ИИ?", "Command Center: остановить ИИ", 0);
  link(c, "Остановить ИИ?", "Telegram: нужен сотрудник", 1);
  link(c, "Command Center: остановить ИИ", "Telegram: нужен сотрудник");
  link(c, "Telegram: нужен сотрудник", "Ответ агенту");
  return workflow(`${prefix} · 3 · Передать сотруднику`, nodes, c);
}

// ========================= Sub-workflow: invoice request =========================
function invoiceWorkflow() {
  const c = {};
  const nodes = [
    trigger([
      ["settings", "object"],
      ["chatKey", "string"],
      ["chatId", "string"],
      ["phone", "string"],
      ["guestName", "string"],
      ["details", "string"],
    ]),
    settingsFromInput([220, 300]),
    node("Сообщение", "n8n-nodes-base.code", 2, [440, 300], {
      jsCode: `const s = $('Старт').first().json;
const cfg = $('Настройки').first().json;
const digits = String(s.phone || s.chatId || '').replace(/\\D/g, '');
const text = '💳 Гость просит счёт на депозит\\nИмя: ' + (s.guestName || '—') + '\\nТелефон: ' + (s.phone || s.chatId) + '\\nЧто: ' + (s.details || '—') + '\\nВыставите счёт и отправьте гостю в WhatsApp' + (digits.length === 11 ? ': https://wa.me/' + digits : '.');
return [{ json: { text, sendGroup: !cfg.testMode, telegramText: cfg.testMode ? '🧪 ТЕСТ — в общий чат ушло бы:\\n' + text : text } }];`,
    }),
    ifNode("В общий чат?", [660, 300], "={{ $json.sendGroup === true }}"),
    node(
      "WhatsApp: общий чат",
      "n8n-nodes-base.httpRequest",
      4.2,
      [880, 200],
      {
        method: "POST",
        url: "={{ $('Настройки').first().json.wahaBaseUrl }}/api/sendText",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ session: $('Настройки').first().json.wahaSession, chatId: $('Настройки').first().json.staffGroupId, text: $('Сообщение').first().json.text, linkPreview: false }) }}",
        options: {
          timeout: 20000,
          response: { response: { fullResponse: true, neverError: true } },
        },
      },
      {
        credentials: credentials.waha,
        retryOnFail: true,
        maxTries: 2,
        waitBetweenTries: 2000,
        onError: "continueRegularOutput",
      },
    ),
    telegram(
      "Telegram: администраторам",
      [1100, 300],
      "={{ $('Сообщение').first().json.telegramText }}",
    ),
    node("Ответ агенту", "n8n-nodes-base.code", 2, [1320, 300], {
      jsCode: `return [{ json: { ok: true, instruction: 'Запрос счёта передан администраторам, счёт пришлют гостю в этот чат. Скажи одной фразой, что бронь закреплена и счёт скоро придёт сюда.' } }];`,
    }),
  ];
  link(c, "Старт", "Настройки");
  link(c, "Настройки", "Сообщение");
  link(c, "Сообщение", "В общий чат?");
  link(c, "В общий чат?", "WhatsApp: общий чат", 0);
  link(c, "В общий чат?", "Telegram: администраторам", 1);
  link(c, "WhatsApp: общий чат", "Telegram: администраторам");
  link(c, "Telegram: администраторам", "Ответ агенту");
  return workflow(`${prefix} · 4 · Счёт на депозит`, nodes, c);
}

// ========================= Main: WhatsApp inbound =========================
function mainWorkflow(bookingId, handoffId, invoiceId) {
  const prompt = readFileSync(new URL("./prompt.md", dir), "utf8");
  const c = {};
  const toolInputs = (fields) => ({
    mappingMode: "defineBelow",
    value: Object.fromEntries(fields.map(([name, , value]) => [name, value])),
    matchingColumns: [],
    schema: fields.map(([name, type]) => ({
      id: name,
      displayName: name,
      required: false,
      defaultMatch: false,
      display: true,
      canBeUsedToMatch: true,
      type,
      removed: false,
    })),
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  });
  const ctx = "$('Контекст').first().json";
  const nodes = [
    node(
      "WAHA: входящее",
      "n8n-nodes-base.webhook",
      2,
      [0, 300],
      { httpMethod: "POST", path: webhookPath, options: {} },
      { webhookId: randomUUID() },
    ),
    settingsNode([220, 300]),
    node("Разбор сообщения", "n8n-nodes-base.code", 2, [440, 300], {
      jsCode: `const raw = $('WAHA: входящее').first().json;
const e = raw.body && typeof raw.body === 'object' ? raw.body : raw;
const p = e.payload || {};
const cfg = $('Настройки').first().json;
const session = String(e.session || p.session || '').trim();
const event = String(e.event || '');
const chatId = String(p.from || p.chatId || '').trim();
const id = typeof p.id === 'string' ? p.id : String(p.id?._serialized || p.id?.id || '');
const text = typeof (p.body ?? p.text) === 'string' ? String(p.body ?? p.text).trim() : '';
// Only real incoming personal text messages for our WAHA session.
if (session.toLowerCase() !== String(cfg.wahaSession).toLowerCase() || !['message', 'message.any'].includes(event) || p.fromMe !== false) return [];
if (!/^\\d+@(c\\.us|s\\.whatsapp\\.net|lid)$/i.test(chatId) || /^0+@/.test(chatId)) return [];
if (!id || !text || p.hasMedia === true || p.isStatus === true || p.isGroupMsg === true) return [];
if (!['chat', 'text', ''].includes(String(p.type || p._data?.type || 'chat').toLowerCase())) return [];
if (/^(?:iVBORw0KGgo|\\/9j\\/|R0lGOD|UklGR)[A-Za-z0-9+/=]{100,}/.test(text) || /^[A-Za-z0-9+/]{450,}={0,2}$/.test(text)) return [];
const pn = chatId.replace('@s.whatsapp.net', '@c.us');
const alt = String(p._data?.Info?.SenderAlt || p._data?.key?.senderPn || '').replace(/[:@].*$/, '');
return [{ json: {
  chatId, messageId: id, text: text.slice(0, 3500),
  pushName: String(p.notifyName || p._data?.notifyName || p._data?.Info?.PushName || '').slice(0, 80),
  jid: /^7\\d{10}@c\\.us$/.test(pn) ? pn : /^7\\d{10}$/.test(alt) ? alt + '@c.us' : '',
  needsLid: chatId.endsWith('@lid'),
  dryRun: e._test === true,
} }];`,
    }),
    ifNode("Нужен номер по LID?", [660, 300], "={{ $json.needsLid === true && !$json.jid }}"),
    node(
      "WAHA: номер по LID",
      "n8n-nodes-base.httpRequest",
      4.2,
      [880, 200],
      {
        url: "={{ $('Настройки').first().json.wahaBaseUrl }}/api/{{ encodeURIComponent($('Настройки').first().json.wahaSession) }}/lids/{{ encodeURIComponent($json.chatId.split('@')[0]) }}",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        options: { timeout: 15000 },
      },
      { credentials: credentials.waha, onError: "continueRegularOutput", alwaysOutputData: true },
    ),
    node("Гость", "n8n-nodes-base.code", 2, [1100, 300], {
      jsCode: `const m = $('Разбор сообщения').first().json;
let lid = {}; try { lid = $('WAHA: номер по LID').first().json || {}; } catch {}
const pn = String(lid.pn || lid.phoneJid || lid.jid || '').replace('@s.whatsapp.net', '@c.us');
const jid = m.jid || (/^7\\d{10}@c\\.us$/.test(pn) ? pn : '');
return [{ json: { ...m, jid, phone: jid ? '+' + jid.split('@')[0] : null } }];`,
    }),
    ccHttp(
      "Command Center: входящее",
      [1320, 300],
      "POST",
      "/api/agent/v1/inbound",
      "={{ JSON.stringify({ session: $('Настройки').first().json.wahaSession, chatId: $json.chatId, messageId: $json.messageId, text: $json.text, phone: $json.phone, pushName: $json.pushName || null }) }}",
    ),
    node("Контекст", "n8n-nodes-base.code", 2, [1540, 300], {
      jsCode: `const g = $('Гость').first().json;
const r = $input.first().json || {};
const b = r.body && typeof r.body === 'object' ? r.body : {};
if (Number(r.statusCode) !== 200 || typeof b.accepted !== 'boolean')
  return [{ json: { route: 'backend_down', chatId: g.chatId, text: g.text, phone: g.phone, status: r.statusCode || null, error: String(b.error?.code || r.error?.message || '').slice(0, 200) } }];
if (!b.accepted) return [];
if (b.paused) return [{ json: { route: 'paused', chatId: g.chatId, text: g.text, phone: g.phone, reason: b.pausedReason, name: b.guest?.whatsappName } }];
const k = b.knowledge || {};
const zones = (k.zones || []).map(z => z.name).join(', ') || 'Первый зал, Второй зал, ПС / общий зал, VIP-комнаты';
const PROMPT = ${JSON.stringify(prompt)};
const lines = [];
lines.push('# Данные на этот момент');
lines.push('Сегодня: ' + k.today + ', ' + k.weekday + '. Сейчас в Астане: ' + String(k.nowLocal || '').slice(11) + '.');
lines.push('Гость: имя в WhatsApp — ' + (b.guest?.whatsappName || 'неизвестно') + '. Телефон подтверждён: ' + (b.guest?.verifiedPhone ? 'да (' + b.guest.verifiedPhone + ')' : 'нет') + '.');
const up = b.guest?.upcomingReservations || [];
lines.push('Ближайшие брони гостя: ' + (up.length ? up.map(u => u.startsAt + ', ' + u.guests + ' гост., ' + (u.table || 'место назначат')).join('; ') : 'нет') + '.');
lines.push('', 'События (ближайшие 14 дней):');
lines.push(...((k.events || []).length ? k.events.map(e => '- ' + (e.night ? 'в ночь с ' + e.bookingDate + ' на ' + e.date + ' (' + e.weekday + '), ' + e.time + ' [для брони: date=' + e.bookingDate + ']' : e.date + ' (' + e.weekday + ')' + (e.time ? ' ' + e.time : '')) + ' — ' + e.title + (e.details ? '. ' + e.details.replace(/\\s+/g, ' ') : '')) : ['- в календаре пока ничего не отмечено']));
lines.push('', 'Акции:');
lines.push(...((k.promotions || []).length ? k.promotions.map(p => '- ' + p.title + ' (' + p.schedule + (p.appliesToday ? '; действует сегодня' : '') + ')' + (p.details ? ': ' + p.details.replace(/\\s+/g, ' ') : '')) : ['- нет активных акций']));
const history = (b.history || []).filter(h => h.role !== 'system').slice(-20).map(h => (h.role === 'guest' ? 'Гость: ' : 'Даян: ') + String(h.text).replace(/\\s+/g, ' ').slice(0, 600));
lines.push('', '# История диалога (старые сверху)', ...(history.length ? history : ['(это первое сообщение гостя)']));
return [{ json: {
  route: 'agent',
  chatKey: b.chatKey, chatId: g.chatId, jid: g.jid || '', phone: g.phone, messageId: g.messageId, dryRun: g.dryRun,
  guestName: b.guest?.whatsappName || '',
  guestWords: [...(b.history || []).filter(h => h.role === 'guest').map(h => h.text), g.text].join('\\n').slice(-6000),
  systemMessage: PROMPT.replace('{{ZONES}}', zones) + '\\n\\n' + lines.join('\\n'),
  userMessage: g.text,
} }];`,
    }),
    node("Куда дальше", "n8n-nodes-base.switch", 3.2, [1760, 300], {
      rules: {
        values: ["agent", "paused", "backend_down"].map((route) => ({
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
            combinator: "and",
            conditions: [
              {
                id: randomUUID(),
                leftValue: "={{ $json.route }}",
                rightValue: route,
                operator: { type: "string", operation: "equals" },
              },
            ],
          },
          renameOutput: true,
          outputKey: route,
        })),
      },
      options: {},
    }),
    node(
      "Даян",
      "@n8n/n8n-nodes-langchain.agent",
      2.2,
      [2000, 100],
      {
        promptType: "define",
        text: "={{ $json.userMessage }}",
        options: {
          systemMessage: "={{ $json.systemMessage }}",
          maxIterations: 6,
          returnIntermediateSteps: true,
        },
      },
      { onError: "continueErrorOutput", retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 },
    ),
    node(
      "OpenAI",
      "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      1.2,
      [1880, 360],
      {
        model: { __rl: true, value: "gpt-4.1", mode: "list", cachedResultName: "gpt-4.1" },
        options: { temperature: 0.5, maxTokens: 600 },
      },
      { credentials: credentials.openai },
    ),
    node(
      "check_availability",
      "n8n-nodes-base.httpRequestTool",
      4.2,
      [2040, 380],
      {
        toolDescription:
          "Проверить свободные места на дату/время. Используй, когда гость спрашивает, есть ли места. date — дата вечера ГГГГ-ММ-ДД, time — ЧЧ:ММ, guests — число гостей, zone — зона по желанию гостя или пусто. Ответ: available (есть ли места в нужной зоне), anyZoneAvailable, zones[{name, free}].",
        method: "POST",
        url: `={{ $('Настройки').first().json.ccBaseUrl }}/api/agent/v1/availability`,
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={\n  \"date\": \"{{ $fromAI('date', 'Дата вечера ГГГГ-ММ-ДД', 'string') }}\",\n  \"time\": \"{{ $fromAI('time', 'Время ЧЧ:ММ', 'string') }}\",\n  \"guests\": {{ $fromAI('guests', 'Количество гостей', 'number') }},\n  \"zone\": \"{{ $fromAI('zone', 'Зона по желанию гостя или пустая строка', 'string') }}\"\n}",
        options: { timeout: 15000 },
      },
      { credentials: credentials.commandCenter },
    ),
    node(
      "menu_search",
      "n8n-nodes-base.httpRequestTool",
      4.2,
      [2200, 380],
      {
        toolDescription:
          "Найти блюда и напитки в актуальном меню XoXo с ценами в тенге. query — 1–3 ключевых слова (например «пиво», «бургер», «кальян», «виски»); пустой query — только список категорий. Если ничего не нашлось — попробуй синоним или категорию. Гостю называй ТОЛЬКО позиции из items; если items пуст — так и скажи и предложи найденное ранее.",
        url: `={{ $('Настройки').first().json.ccBaseUrl }}/api/agent/v1/menu`,
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendQuery: true,
        specifyQuery: "keypair",
        queryParameters: {
          parameters: [
            {
              name: "q",
              value: "={{ $fromAI('query', 'Ключевые слова поиска по меню', 'string') }}",
            },
          ],
        },
        options: { timeout: 15000 },
      },
      { credentials: credentials.commandCenter },
    ),
    node("create_booking", "@n8n/n8n-nodes-langchain.toolWorkflow", 2.2, [2360, 380], {
      description:
        "Поставить бронь в Command Center. Вызывай, только когда гость сам назвал имя, дату, время и число гостей и хочет забронировать. Никогда не придумывай и не подставляй эти данные. Сам подбирает стол, записывает бронь и уведомляет персонал. Ответ: status confirmed/accepted — бронь стоит; needsGuestInput — нужно поправить данные (см. problem).",
      workflowId: { __rl: true, value: bookingId, mode: "id" },
      workflowInputs: toolInputs([
        ["settings", "object", "={{ $('Настройки').first().json }}"],
        ["chatKey", "string", `={{ ${ctx}.chatKey }}`],
        ["chatId", "string", `={{ ${ctx}.chatId }}`],
        ["jid", "string", `={{ ${ctx}.jid }}`],
        ["messageId", "string", `={{ ${ctx}.messageId }}`],
        ["dryRun", "boolean", `={{ ${ctx}.dryRun === true }}`],
        ["name", "string", "={{ $fromAI('name', 'Имя гостя для брони', 'string') }}"],
        ["date", "string", "={{ $fromAI('date', 'Дата вечера брони ГГГГ-ММ-ДД', 'string') }}"],
        ["time", "string", "={{ $fromAI('time', 'Время брони ЧЧ:ММ (24 часа)', 'string') }}"],
        ["guests", "number", "={{ $fromAI('guests', 'Количество гостей', 'number') }}"],
        [
          "zone",
          "string",
          "={{ $fromAI('zone', 'Зона, если гость её просил (VIP, PlayStation, у экрана, второй зал…), иначе пустая строка', 'string') }}",
        ],
        [
          "notes",
          "string",
          "={{ $fromAI('notes', 'Пожелания гостя (повод, матч, детское кресло…) или пустая строка', 'string') }}",
        ],
        ["guestWords", "string", `={{ ${ctx}.guestWords }}`],
        [
          "contactPhone",
          "string",
          "={{ $fromAI('contactPhone', 'Телефон гостя, только если телефон НЕ подтверждён и гость его написал; иначе пустая строка', 'string') }}",
        ],
      ]),
    }),
    node("handoff_to_staff", "@n8n/n8n-nodes-langchain.toolWorkflow", 2.2, [2520, 380], {
      description:
        "Передать вопрос администратору. pause=true — остановить себя в этом чате (жалоба, возврат денег, отмена брони, банкет от 20 человек, просьба позвать менеджера). pause=false — ты продолжаешь отвечать (разовый вопрос, на который ты не знаешь ответа: парковка, доставка, дресс-код и т.п.).",
      workflowId: { __rl: true, value: handoffId, mode: "id" },
      workflowInputs: toolInputs([
        ["settings", "object", "={{ $('Настройки').first().json }}"],
        ["chatKey", "string", `={{ ${ctx}.chatKey }}`],
        ["chatId", "string", `={{ ${ctx}.chatId }}`],
        ["phone", "string", `={{ ${ctx}.phone || '' }}`],
        ["guestName", "string", `={{ ${ctx}.guestName }}`],
        ["reason", "string", "={{ $fromAI('reason', 'Причина передачи в 2–5 словах', 'string') }}"],
        [
          "summary",
          "string",
          "={{ $fromAI('summary', 'Суть запроса гостя одним предложением с деталями', 'string') }}",
        ],
        [
          "pause",
          "boolean",
          "={{ $fromAI('pause', 'true — остановить ИИ в этом чате; false — продолжать отвечать', 'boolean') }}",
        ],
      ]),
    }),
    node("request_invoice", "@n8n/n8n-nodes-langchain.toolWorkflow", 2.2, [2680, 380], {
      description:
        "Запросить счёт на депозит. Вызывай ТОЛЬКО если у события на дату брони указан депозит и гость просит счёт или ссылку на оплату. Бронь при этом ставится как обычно (create_booking). Сообщение уходит в общий чат и в Telegram, счёт гостю пришлют вручную.",
      workflowId: { __rl: true, value: invoiceId, mode: "id" },
      workflowInputs: toolInputs([
        ["settings", "object", "={{ $('Настройки').first().json }}"],
        ["chatKey", "string", `={{ ${ctx}.chatKey }}`],
        ["chatId", "string", `={{ ${ctx}.chatId }}`],
        ["phone", "string", `={{ ${ctx}.phone || '' }}`],
        ["guestName", "string", "={{ $fromAI('guestName', 'Имя гостя', 'string') }}"],
        [
          "details",
          "string",
          "={{ $fromAI('details', 'Событие, дата и время, число гостей и сумма депозита как в афише, например: Эль-Класико, 1 ноября 01:00, 6 гостей, депозит 5000 ₸ с человека', 'string') }}",
        ],
      ]),
    }),
    node("Ответ гостю", "n8n-nodes-base.code", 2, [2400, 100], {
      jsCode: `const c = $('Контекст').first().json;
const raw = String($input.first().json.output ?? $input.first().json.text ?? '').trim();
const silent = /^\s*NO_REPLY\s*$/.test(raw);
const plain = silent ? '' : raw.replace(/\\*\\*(.+?)\\*\\*/g, '$1').replace(/^#+\\s*/gm, '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 1500);
const text = silent ? '' : plain.replace(/\\s*(Чем (ещё |еще )?(могу|можем) (вам )?помочь\\?|Если (у вас )?(будут|появятся) (ещё |еще )?вопросы[^.!?]*[.!?]?|Обращайтесь[.!]?)\\s*$/i, '').trim() || plain;
// A booking/handoff tool that crashed never reached staff: alert them and hand the chat over.
const failed = ($input.first().json.intermediateSteps || []).filter(s => ['create_booking', 'handoff_to_staff', 'request_invoice'].includes(s.action?.tool)
  && /^There was an error|"error"/.test(typeof s.observation === 'string' ? s.observation.slice(0, 300) : JSON.stringify(s.observation || '').slice(0, 300)));
const used = new Set(($input.first().json.intermediateSteps || []).map(s => s.action?.tool));
// The agent must never promise an invoice it did not request.
const promisedInvoice = /счёт|счет|invoice/i.test(text) && !used.has('request_invoice');
// A booking confirmation without create_booking is a hallucination: retry the agent once, then alert staff.
const claimsBooking = /(записал[аи]?(?![а-я])|забронирован\S*|бронь (поставлена|оформлена|подтверждена|стоит)|брондалды|брондап қойдым)/i.test(text);
let retried = false; try { $('Даян (повтор)').first(); retried = true; } catch (e) {}
const retry = claimsBooking && !used.has('create_booking') && !retried;
const unconfirmed = claimsBooking && !used.has('create_booking') && retried;
const toolFailure = unconfirmed ? 'гостю подтверждена бронь, но create_booking не вызван' : promisedInvoice ? 'request_invoice не вызван, а гостю обещан счёт на депозит' : failed.length ? failed.map(s => s.action.tool + ' ' + JSON.stringify(s.action.toolInput || {}).slice(0, 400) + ' → ' + String(s.observation).slice(0, 200)).join('\\n') : '';
return [{ json: { chatKey: c.chatKey, chatId: c.chatId, phone: c.phone, dryRun: c.dryRun, text, toolFailure: retry ? '' : toolFailure, retry } }];`,
    }),
    ifNode("Повторить попытку?", [2520, 100], "={{ $json.retry === true }}"),
    node(
      "Даян (повтор)",
      "@n8n/n8n-nodes-langchain.agent",
      2.2,
      [2520, 320],
      {
        promptType: "define",
        text: `={{ ${ctx}.userMessage }}`,
        options: {
          systemMessage: `={{ ${ctx}.systemMessage + '\\n\\nВАЖНО: в прошлой попытке ты подтвердил гостю бронь, не вызвав create_booking, поэтому она не записана. Если данные для брони есть в диалоге — сначала вызови create_booking, и только потом пиши гостю подтверждение. Если данных не хватает — не подтверждай, спроси недостающее.' }}`,
          maxIterations: 6,
          returnIntermediateSteps: true,
        },
      },
      { onError: "continueErrorOutput", retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 },
    ),
    ifNode("Инструмент сломался?", [2620, -100], "={{ Boolean($json.toolFailure) }}"),
    ccHttp(
      "Command Center: остановить ИИ (инструмент)",
      [2840, -200],
      "POST",
      "/api/agent/v1/handoff",
      "={{ JSON.stringify({ chatKey: $json.chatKey, reason: 'Сбой инструмента — проверьте бронь вручную' }) }}",
    ),
    telegram(
      "Telegram: сбой инструмента",
      [3060, -200],
      "={{ '🚨 Даян: действие не выполнилось — внесите вручную. ИИ в этом чате остановлен.\\nГость: ' + ($('Ответ гостю').last().json.phone || $('Ответ гостю').last().json.chatId) + '\\n' + $('Ответ гостю').last().json.toolFailure + '\\nГостю ответили: ' + $('Ответ гостю').last().json.text }}",
    ),
    ifNode("Есть ответ?", [2620, 100], "={{ Boolean($json.text) }}"),
    ccHttp(
      "Command Center: ответ в историю",
      [2840, 0],
      "POST",
      "/api/agent/v1/reply",
      "={{ JSON.stringify({ chatKey: $json.chatKey, text: $json.text }) }}",
    ),
    ifNode(
      "Отправлять в WhatsApp?",
      [3060, 0],
      "={{ $('Ответ гостю').last().json.dryRun !== true }}",
    ),
    node(
      "WhatsApp: гостю",
      "n8n-nodes-base.httpRequest",
      4.2,
      [3280, -100],
      {
        method: "POST",
        url: "={{ $('Настройки').first().json.wahaBaseUrl }}/api/sendText",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ session: $('Настройки').first().json.wahaSession, chatId: $('Ответ гостю').last().json.chatId, text: $('Ответ гостю').last().json.text, linkPreview: false }) }}",
        options: {
          timeout: 20000,
          response: { response: { fullResponse: true, neverError: true } },
        },
      },
      {
        credentials: credentials.waha,
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 2000,
        onError: "continueRegularOutput",
      },
    ),
    ifNode(
      "WhatsApp не принял?",
      [3500, -100],
      "={{ !($json.statusCode >= 200 && $json.statusCode < 300) }}",
    ),
    telegram(
      "Telegram: ответ не ушёл",
      [3720, -200],
      "={{ '⚠️ Даян: WhatsApp не принял ответ гостю ' + $('Ответ гостю').last().json.chatId + ' (код ' + ($json.statusCode || 'нет') + '). Ответьте вручную:\\n' + $('Ответ гостю').last().json.text }}",
    ),
    ccHttp(
      "Command Center: остановить ИИ (сбой)",
      [2400, 300],
      "POST",
      "/api/agent/v1/handoff",
      `={{ JSON.stringify({ chatKey: ${ctx}.chatKey, reason: 'Сбой ИИ: ' + String($json.error?.message || $json.error || '').slice(0, 200) }) }}`,
    ),
    telegram(
      "Telegram: сбой ИИ",
      [2620, 300],
      `={{ '🚨 Даян не смог ответить — ИИ в этом чате остановлен, ответьте гостю сами.\\nГость: ' + (${ctx}.phone || ${ctx}.chatId) + '\\nСообщение: ' + ${ctx}.userMessage + '\\nОшибка: ' + String($json.body?.pausedReason || '').slice(0, 300) }}`,
    ),
    telegram(
      "Telegram: гость пишет сотруднику",
      [2000, 520],
      "={{ '💬 Гость пишет в чат, где ИИ остановлен (' + ($json.reason || 'передан сотруднику') + '):\\n' + ($json.name ? $json.name + ' · ' : '') + ($json.phone || $json.chatId) + '\\n«' + $json.text + '»' }}",
    ),
    telegram(
      "Telegram: Command Center недоступен",
      [2000, 720],
      "={{ '🚨 Даян: Command Center не ответил (' + ($json.status || 'нет ответа') + ' ' + $json.error + '). Сообщение гостя не обработано, ответьте вручную:\\n' + ($json.phone || $json.chatId) + '\\n«' + $json.text + '»' }}",
    ),
  ];
  link(c, "WAHA: входящее", "Настройки");
  link(c, "Настройки", "Разбор сообщения");
  link(c, "Разбор сообщения", "Нужен номер по LID?");
  link(c, "Нужен номер по LID?", "WAHA: номер по LID", 0);
  link(c, "Нужен номер по LID?", "Гость", 1);
  link(c, "WAHA: номер по LID", "Гость");
  link(c, "Гость", "Command Center: входящее");
  link(c, "Command Center: входящее", "Контекст");
  link(c, "Контекст", "Куда дальше");
  link(c, "Куда дальше", "Даян", 0);
  link(c, "Куда дальше", "Telegram: гость пишет сотруднику", 1);
  link(c, "Куда дальше", "Telegram: Command Center недоступен", 2);
  link(c, "Даян", "Ответ гостю", 0);
  link(c, "Даян", "Command Center: остановить ИИ (сбой)", 1);
  link(c, "Command Center: остановить ИИ (сбой)", "Telegram: сбой ИИ");
  link(c, "Ответ гостю", "Повторить попытку?");
  link(c, "Повторить попытку?", "Даян (повтор)", 0);
  link(c, "Повторить попытку?", "Есть ответ?", 1);
  link(c, "Повторить попытку?", "Инструмент сломался?", 1);
  link(c, "Даян (повтор)", "Ответ гостю", 0);
  link(c, "Даян (повтор)", "Command Center: остановить ИИ (сбой)", 1);
  link(c, "Инструмент сломался?", "Command Center: остановить ИИ (инструмент)", 0);
  link(c, "Command Center: остановить ИИ (инструмент)", "Telegram: сбой инструмента");
  link(c, "Есть ответ?", "Command Center: ответ в историю", 0);
  link(c, "Command Center: ответ в историю", "Отправлять в WhatsApp?");
  link(c, "Отправлять в WhatsApp?", "WhatsApp: гостю", 0);
  link(c, "WhatsApp: гостю", "WhatsApp не принял?");
  link(c, "WhatsApp не принял?", "Telegram: ответ не ушёл", 0);
  for (const [tool, type] of [
    ["OpenAI", "ai_languageModel"],
    ["check_availability", "ai_tool"],
    ["menu_search", "ai_tool"],
    ["create_booking", "ai_tool"],
    ["handoff_to_staff", "ai_tool"],
    ["request_invoice", "ai_tool"],
  ])
    c[tool] = {
      [type]: [
        [
          { node: "Даян", type, index: 0 },
          ...(type === "ai_languageModel" || tool !== "OpenAI"
            ? [{ node: "Даян (повтор)", type, index: 0 }]
            : []),
        ],
      ],
    };
  return workflow(`${prefix} · 1 · WhatsApp → ИИ-администратор`, nodes, c);
}

const out = (file, data) => {
  // Fail the build on any Code node that would not compile inside n8n.
  for (const n of data.nodes)
    if (n.parameters.jsCode)
      try {
        new Function("$", "$input", n.parameters.jsCode);
      } catch (error) {
        throw new Error(`${data.name} → ${n.name}: ${error.message}`);
      }
  writeFileSync(new URL(file, dir), JSON.stringify(data, null, 2) + "\n");
};
const suffix = env === "test" ? ".test" : "";
out(`booking${suffix}.json`, bookingWorkflow());
out(`handoff${suffix}.json`, handoffWorkflow());
out(`invoice${suffix}.json`, invoiceWorkflow());
out(
  `main${suffix}.json`,
  mainWorkflow(
    arg("booking-id", "BOOKING_WORKFLOW_ID"),
    arg("handoff-id", "HANDOFF_WORKFLOW_ID"),
    arg("invoice-id", "INVOICE_WORKFLOW_ID"),
  ),
);
console.log(`built ${env}: main${suffix}.json booking handoff invoice`);
