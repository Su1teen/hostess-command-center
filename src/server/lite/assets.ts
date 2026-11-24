/**
 * Static assets of the lite Command Center (/lite).
 *
 * Target: the worst browsers still found on venue tablets — Android 4.x stock
 * browser / WebView (WebKit 534–537, Chrome 30–33), Huawei/EMUI browsers without
 * Google services, TV-box style engines.
 *
 * CSS rules: no custom properties, no flexbox gap, no grid, no oklch/color-mix,
 * no @layer/@property, no calc(); layout is floats, inline-blocks and tables;
 * every rounded/box-sized rule carries the -webkit- prefix.
 *
 * JS rules: ECMAScript 3 only (var, function, for-loops), XMLHttpRequest,
 * getElementById/getElementsByTagName. tests/lite.unit.test.ts parses this file's
 * script with ecmaVersion 3 and scans the CSS for unsupported features.
 */

export const LITE_CSS = `
html,body{margin:0;padding:0}
*{-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box}
body{background:#f3f4f6;color:#111827;font-family:Roboto,"Droid Sans","Helvetica Neue",Arial,sans-serif;font-size:16px;line-height:1.4;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:rgba(0,0,0,0.1)}
a{color:#111827}
h1{font-size:26px;line-height:1.2;margin:6px 0 4px}
h2{font-size:19px;line-height:1.25;margin:0 0 6px}
h3{font-size:16px;margin:14px 0 6px}
p{margin:4px 0}
.cf:after,.top:after,.row:after,.bar:after{content:"";display:block;clear:both;height:0}
.top{background:#111827;color:#ffffff;padding:8px 12px}
.brand{float:left;font-size:22px;font-weight:bold;letter-spacing:2px;line-height:48px}
.brand span{font-size:12px;font-weight:normal;letter-spacing:0;color:#9ca3af;margin-left:8px}
.who{float:right;text-align:right;font-size:13px;color:#d1d5db;line-height:16px;padding-top:2px}
.who form{display:inline}
.who .btn{min-height:40px;padding:8px 12px;margin:0 0 0 8px;background:#1f2937;border-color:#374151;color:#ffffff;font-size:14px}
.nav{background:#ffffff;border-bottom:1px solid #e5e7eb;padding:6px 8px;white-space:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch}
.nav a{display:inline-block;padding:13px 16px;margin:2px 2px;-webkit-border-radius:12px;border-radius:12px;text-decoration:none;color:#374151;font-weight:bold;font-size:16px}
.nav a.on{background:#111827;color:#ffffff}
.nav a.add{background:#fef3c7;color:#78350f}
.badge{display:inline-block;min-width:24px;padding:1px 7px;-webkit-border-radius:12px;border-radius:12px;background:#f59e0b;color:#111827;font-size:13px;line-height:20px;text-align:center;margin-left:4px}
.wrap{max-width:1180px;margin:0 auto;padding:12px}
.muted{color:#6b7280;font-size:14px}
.small{font-size:13px}
.bold{font-weight:bold}
.right{text-align:right}
.bar{margin:6px 0 10px}
.bar .l{float:left}
.bar .r{float:right}
.conn{display:inline-block;padding:4px 10px;-webkit-border-radius:12px;border-radius:12px;font-size:13px;background:#e5e7eb;color:#374151}
.conn.ok{background:#d1fae5;color:#065f46}
.conn.bad{background:#fee2e2;color:#991b1b}
.flash{padding:12px 14px;-webkit-border-radius:12px;border-radius:12px;margin:0 0 12px;font-size:15px}
.flash.ok{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
.flash.err{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.card{background:#ffffff;border:1px solid #e5e7eb;-webkit-border-radius:16px;border-radius:16px;padding:14px;margin:0 0 12px}
.card.new{border:2px solid #f59e0b;background:#fffbeb}
.card.warn{border-color:#fcd34d;background:#fffbeb}
.card.late{border:2px solid #dc2626}
.card.exch{border:2px solid #7c3aed;background:#f5f3ff}
.tagx{display:inline-block;padding:2px 9px;-webkit-border-radius:10px;border-radius:10px;font-size:12px;font-weight:bold;background:#6d28d9;color:#ffffff;margin:0 6px 4px 0}
.xform{float:right;margin:-4px -4px 0 8px}
.xbtn{min-width:46px;height:46px;padding:0 8px;font-size:24px;line-height:44px;text-align:center;background:#ffffff;color:#6b7280;border:1px solid #d1d5db;-webkit-border-radius:23px;border-radius:23px;cursor:pointer;font-family:Arial,sans-serif}
.card a.title{text-decoration:none;display:block}
.row{margin:0 -6px}
.col{float:left;width:50%;padding:0 6px}
.col3{float:left;width:33.33%;padding:0 6px}
.pill{display:inline-block;padding:3px 10px;-webkit-border-radius:12px;border-radius:12px;font-size:13px;background:#f3f4f6;color:#374151;margin:2px 4px 2px 0}
.pill.new{background:#fef3c7;color:#78350f}
.pill.accepted{background:#dbeafe;color:#1e3a8a}
.pill.preparing{background:#ede9fe;color:#4c1d95}
.pill.delivered{background:#d1fae5;color:#065f46}
.pill.closed{background:#e5e7eb;color:#374151}
.pill.cancelled{background:#fee2e2;color:#991b1b}
.sum{margin-top:8px;font-weight:bold;font-size:17px}
.sum .r{float:right}
.lines{margin:6px 0 0;padding:0;list-style:none}
.lines li{padding:7px 0;border-bottom:1px solid #f3f4f6}
.lines li:last-child{border-bottom:0}
.lines .r{float:right;font-weight:bold}
.total{background:#111827;color:#ffffff;-webkit-border-radius:12px;border-radius:12px;padding:12px 14px;font-size:18px;font-weight:bold;margin:10px 0}
.total .r{float:right}
.btn{display:inline-block;min-height:50px;padding:13px 18px;margin:4px 6px 4px 0;border:1px solid #d1d5db;-webkit-border-radius:12px;border-radius:12px;background:#ffffff;color:#111827;font-family:inherit;font-size:16px;font-weight:bold;line-height:22px;text-align:center;text-decoration:none;vertical-align:middle;cursor:pointer;-webkit-appearance:none}
.btn.dark{background:#111827;border-color:#111827;color:#ffffff}
.btn.ok{background:#047857;border-color:#047857;color:#ffffff}
.btn.red{color:#b91c1c;border-color:#fca5a5;background:#ffffff}
.btn.block{display:block;width:100%;margin:6px 0}
.btn.sm{min-height:40px;padding:8px 12px;font-size:14px}
form.inline{display:inline}
label{display:block;font-size:14px;color:#374151;margin:10px 0 4px}
input,select,textarea{font-family:inherit}
.field{display:block;width:100%;min-height:50px;padding:11px 12px;border:1px solid #d1d5db;-webkit-border-radius:12px;border-radius:12px;background:#ffffff;color:#111827;font-size:17px;-webkit-appearance:none}
textarea.field{min-height:80px}
.qty{width:84px;min-height:46px;padding:8px;border:1px solid #d1d5db;-webkit-border-radius:10px;border-radius:10px;font-size:18px;text-align:center}
.tiles{width:100%;border-collapse:separate;border-spacing:8px;margin:0 -8px}
.tiles td{background:#ffffff;border:1px solid #e5e7eb;-webkit-border-radius:16px;border-radius:16px;padding:0;width:33%;vertical-align:top}
.tiles td.on{border:2px solid #111827}
.tiles a{display:block;padding:12px 14px;text-decoration:none}
.tiles strong{display:block;font-size:30px;line-height:36px}
.zone{margin:0 0 16px}
.tbl{display:inline-block;vertical-align:top;width:158px;min-height:96px;margin:0 8px 8px 0;padding:10px 12px;border:1px solid #e5e7eb;border-left-width:8px;-webkit-border-radius:14px;border-radius:14px;background:#ffffff;text-decoration:none;color:#111827}
.tbl b{display:block;font-size:18px}
.tbl i{display:block;font-style:normal;font-size:13px;color:#4b5563;margin-top:3px}
.st-free,.legend .st-free{border-left-color:#10b981}
.st-reserved,.legend .st-reserved{border-left-color:#3b82f6;background:#eff6ff}
.st-seated,.legend .st-seated{border-left-color:#f59e0b;background:#fffbeb}
.st-qr_activity,.legend .st-qr_activity{border-left-color:#8b5cf6;background:#f5f3ff}
.st-overdue,.legend .st-overdue{border-left-color:#dc2626;background:#fef2f2}
.st-blocked,.legend .st-blocked{border-left-color:#9ca3af;background:#f3f4f6;color:#6b7280}
.st-unconfigured,.legend .st-unconfigured{border-left-color:#d1d5db}
.legend span{display:inline-block;margin:0 10px 6px 0;font-size:13px;padding:2px 8px;border:1px solid #e5e7eb;border-left-width:8px;-webkit-border-radius:6px;border-radius:6px}
.menu-cat{margin:16px 0 6px;padding-top:6px;font-size:18px}
.menu-row{padding:8px 0;border-bottom:1px solid #f3f4f6}
.menu-row .r{float:right}
.menu-row .name{display:block;padding-right:100px;padding-top:10px}
.jump a{display:inline-block;margin:0 6px 6px 0;padding:8px 12px;background:#f3f4f6;-webkit-border-radius:10px;border-radius:10px;text-decoration:none;font-size:14px}
.history{margin:6px 0 0;padding:0 0 0 12px;border-left:2px solid #e5e7eb;list-style:none}
.history li{margin:0 0 8px;font-size:13px;color:#4b5563}
.bubble{max-width:82%;margin:0 0 8px;padding:9px 12px;-webkit-border-radius:16px;border-radius:16px;font-size:15px;line-height:1.35;word-wrap:break-word;background:#ffffff;border:1px solid #e5e7eb;float:left}
.bubble.agent{float:right;background:#111827;border-color:#111827;color:#ffffff}
.bubble .when{display:block;margin-top:4px;font-size:11px;color:#9ca3af}
.login{max-width:420px;margin:30px auto;padding:0 14px}
.login .card{padding:22px}
.foot{padding:20px 12px 40px;text-align:center;font-size:13px;color:#9ca3af}
.foot a{color:#6b7280}
.alarm{position:fixed;top:0;left:0;right:0;z-index:1000;padding:12px 14px;background:#dc2626;color:#ffffff;font-size:22px;line-height:1.25;border-bottom:4px solid #7f1d1d}
.alarm.flash{background:#facc15;color:#111827;border-bottom-color:#a16207}
.alarm.exch{background:#6d28d9;border-bottom-color:#3b0764}
.alarm.exch.flash{background:#c4b5fd;color:#2e1065;border-bottom-color:#7c3aed}
.alarm a{color:inherit;text-decoration:none;display:block;padding-right:130px}
.alarm .btn{float:right;margin:0 0 0 10px;font-size:20px;padding:12px 18px;background:#ffffff;color:#111827;border-color:#ffffff}
.alarm .tap{display:block;font-size:15px;margin-top:4px;text-decoration:underline}
.hide{display:none}
@media (max-width:760px){.col,.col3{float:none;width:auto}.tbl{width:46%}.who .id{display:none}}
`;

/**
 * ECMAScript 3 progressive enhancement: loud new-order alarm on every staff page,
 * live refresh, double-submit guard.
 */
export const LITE_JS = `(function () {
  var doc = document;
  function bindForms(root) {
    var forms = root.getElementsByTagName("form");
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].getAttribute("data-bound")) continue;
      forms[i].setAttribute("data-bound", "1");
      forms[i].onsubmit = guard;
    }
  }
  function guard() {
    var question = this.getAttribute("data-confirm");
    if (question && !window.confirm(question)) return false;
    if (this.getAttribute("data-sent")) return false;
    this.setAttribute("data-sent", "1");
    var buttons = this.getElementsByTagName("button");
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].type === "submit" || !buttons[i].getAttribute("type")) {
        buttons[i].className = buttons[i].className + " sending";
        buttons[i].innerHTML = "\\u041e\\u0442\\u043f\\u0440\\u0430\\u0432\\u043b\\u044f\\u0435\\u043c\\u2026";
      }
    }
    return true;
  }
  bindForms(doc);

  var memory = {};
  function getItem(key) {
    try { if (window.localStorage) return window.localStorage.getItem(key); } catch (e) {}
    return memory.hasOwnProperty(key) ? memory[key] : null;
  }
  function setItem(key, value) {
    memory[key] = value;
    try { if (window.localStorage) window.localStorage.setItem(key, value); } catch (e) {}
  }
  function listen(node, name, fn) {
    if (node.addEventListener) node.addEventListener(name, fn, false);
    else if (node.attachEvent) node.attachEvent("on" + name, fn);
  }
  function later(fn, ms) { return window.setTimeout(fn, ms); }

  /* ---------- sound ---------- */
  var bell = doc.getElementById("bell");
  var beepEl = doc.getElementById("beep");
  var chime = doc.getElementById("chime");
  var button = doc.getElementById("sound");
  var soundOn = getItem("hostess-lite-sound") !== "0";
  var unlocked = false;
  var blockedNow = false;
  function label() {
    if (button) button.innerHTML = soundOn ? "\\u0417\\u0432\\u0443\\u043a: \\u0432\\u043a\\u043b" : "\\u0417\\u0432\\u0443\\u043a: \\u0432\\u044b\\u043a\\u043b";
  }
  function setBlocked(value) {
    blockedNow = value;
    var tap = doc.getElementById("alarm-tap");
    if (tap) tap.className = value ? "tap" : "tap hide";
  }
  function play(el) {
    if (!soundOn || !el || !el.play) return;
    try { el.muted = false; } catch (e) {}
    try { el.volume = 1; } catch (e) {}
    try { el.currentTime = 0; } catch (e) {}
    try {
      var result = el.play();
      if (result && result.then) {
        result.then(function () { unlocked = true; setBlocked(false); }, function () { setBlocked(true); });
      } else {
        unlocked = true;
      }
    } catch (e) { setBlocked(true); }
  }
  /* Old Android only lets a page play audio after a tap: prime both players on the first tap. */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    var players = [bell, beepEl, chime];
    for (var i = 0; i < players.length; i++) {
      var el = players[i];
      if (!el || !el.play) continue;
      try {
        el.muted = true;
        var result = el.play();
        if (result && result.then) result.then(null, function () {});
      } catch (e) {}
    }
    later(function () {
      if (ringing) return;
      for (var j = 0; j < players.length; j++) {
        var p = players[j];
        if (!p || !p.pause) continue;
        try { p.pause(); p.currentTime = 0; p.muted = false; } catch (e) {}
      }
    }, 80);
  }
  if (button) {
    button.className = button.className.replace(" hide", "");
    label();
    button.onclick = function () {
      soundOn = !soundOn;
      setItem("hostess-lite-sound", soundOn ? "1" : "0");
      if (soundOn) play(bell);
      label();
      return false;
    };
  }

  /* ---------- new-order alarm ---------- */
  var alarm = doc.getElementById("alarm");
  var alarmText = doc.getElementById("alarm-text");
  var alarmOk = doc.getElementById("alarm-ok");
  var baseTitle = doc.title;
  var pending = [];
  var shown = ",";
  var active = false;
  var ringing = false;
  var repeatTimer = null;
  var blinkTimer = null;
  var flash = false;
  var exch = false;
  var alertFailures = 0;
  function acknowledged() { return "," + (getItem("hostess-lite-acked") || "") + ","; }
  function ringSeries() {
    var count = 0;
    ringing = true;
    function strike() {
      if (!active) { ringing = false; return; }
      play(exch && chime ? chime : bell);
      count++;
      if (count < 3) later(strike, 1800);
      else later(function () { ringing = false; }, 1800);
    }
    strike();
    try { if (window.navigator.vibrate) window.navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) {}
  }
  function blink() {
    flash = !flash;
    alarm.className = (exch ? "alarm exch" : "alarm") + (flash ? " flash" : "");
    doc.title = flash ? (exch ? "*** \\u0411\\u0418\\u0420\\u0416\\u0410 ***" : "*** \\u041d\\u041e\\u0412\\u042b\\u0419 \\u0417\\u0410\\u041a\\u0410\\u0417 ***") : baseTitle;
  }
  function start() {
    active = true;
    alarm.className = exch ? "alarm exch" : "alarm";
    blinkTimer = window.setInterval(blink, 600);
    ringSeries();
    repeatTimer = window.setInterval(function () { if (active && !ringing) ringSeries(); }, 15000);
  }
  function stop() {
    active = false;
    if (blinkTimer) window.clearInterval(blinkTimer);
    if (repeatTimer) window.clearInterval(repeatTimer);
    blinkTimer = repeatTimer = null;
    alarm.className = "alarm hide";
    doc.title = baseTitle;
    shown = ",";
  }
  function update(list) {
    pending = list;
    var known = acknowledged();
    var fresh = [];
    for (var i = 0; i < list.length; i++) {
      if (known.indexOf("," + list[i].id + ",") < 0) fresh.push(list[i]);
    }
    if (!fresh.length) { if (active) stop(); return; }
    var labels = [];
    var added = false;
    exch = false;
    var next = ",";
    for (var k = 0; k < fresh.length; k++) {
      labels.push(fresh[k].label);
      if (fresh[k].kind === "x") exch = true;
      next += fresh[k].id + ",";
      if (shown.indexOf("," + fresh[k].id + ",") < 0) added = true;
    }
    shown = next;
    var title = doc.getElementById("alarm-title");
    if (title) title.innerHTML = exch ? "\\u0417\\u0410\\u041a\\u0410\\u0417 \\u0421 \\u0411\\u0418\\u0420\\u0416\\u0418" : "\\u041d\\u041e\\u0412\\u042b\\u0419 \\u0417\\u0410\\u041a\\u0410\\u0417";
    alarm.className = exch ? "alarm exch" : "alarm";
    alarmText.innerHTML = "";
    alarmText.appendChild(doc.createTextNode(labels.join(" \\u00b7 ")));
    if (!active) start();
    else if (added && !ringing) ringSeries();
  }
  function parse(text) {
    var out = [];
    var lines = String(text || "").split("\\n");
    for (var i = 0; i < lines.length; i++) {
      var cols = lines[i].split("\\t");
      if (cols.length >= 2 && cols[0]) out.push({ id: cols[0], label: cols[1], kind: cols[2] || "" });
    }
    return out;
  }
  function poll() {
    var request;
    try { request = new XMLHttpRequest(); } catch (e) { return; }
    request.open("GET", "/lite/alerts?_=" + new Date().getTime(), true);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      if (request.status === 200) {
        alertFailures = 0;
        update(parse(request.responseText));
      } else if (request.status === 401) {
        window.location.href = "/lite/login";
        return;
      } else {
        alertFailures++;
      }
      later(poll, alertFailures > 3 ? 20000 : 5000);
    };
    try { request.send(null); } catch (e) { alertFailures++; later(poll, 20000); }
  }
  if (alarm && alarmText) {
    if (alarmOk) {
      alarmOk.onclick = function () {
        var ids = [];
        for (var i = 0; i < pending.length; i++) ids.push(pending[i].id);
        setItem("hostess-lite-acked", ids.join(","));
        stop();
        return false;
      };
    }
    var onTap = function () {
      if (active && blockedNow && !ringing) ringSeries();
      else unlock();
    };
    listen(doc, "touchstart", onTap);
    listen(doc, "click", onTap);
    poll();
  }

  /* ---------- live region refresh ---------- */
  var live = doc.getElementById("live");
  if (!live) return;
  var source = live.getAttribute("data-src");
  var seen = live.getAttribute("data-new") || "";
  var failures = 0;
  var busy = false;
  function typing() {
    var active = doc.activeElement;
    if (!active || !active.tagName) return false;
    var tag = active.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }
  /* Orders ring through the alarm above; the live region only chimes for WhatsApp hand-offs. */
  function freshChat(previous, next) {
    if (!next) return false;
    var known = "," + previous + ",";
    var ids = next.split(",");
    for (var i = 0; i < ids.length; i++) {
      if (ids[i].indexOf("wa:") === 0 && known.indexOf("," + ids[i] + ",") < 0) return true;
    }
    return false;
  }
  function status(ok) {
    var node = doc.getElementById("conn");
    if (!node) return;
    node.className = ok ? "conn ok" : "conn bad";
    node.innerHTML = ok ? "\\u041d\\u0430 \\u0441\\u0432\\u044f\\u0437\\u0438" : "\\u041d\\u0435\\u0442 \\u0441\\u0432\\u044f\\u0437\\u0438 \\u2014 \\u043f\\u043e\\u0432\\u0442\\u043e\\u0440\\u044f\\u0435\\u043c";
  }
  function schedule() {
    later(tick, failures > 3 ? 20000 : 6000);
  }
  function tick() {
    if (busy || typing()) { schedule(); return; }
    var request;
    try { request = new XMLHttpRequest(); } catch (e) { window.location.reload(); return; }
    busy = true;
    request.open("GET", source + (source.indexOf("?") < 0 ? "?" : "&") + "partial=1&_=" + new Date().getTime(), true);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      busy = false;
      if (request.status === 200) {
        var fresh = request.getResponseHeader("X-Lite-New") || "";
        if (freshChat(seen, fresh)) play(beepEl);
        seen = fresh;
        if (!typing()) {
          live.innerHTML = request.responseText;
          bindForms(live);
        }
        failures = 0;
        status(true);
      } else if (request.status === 401) {
        window.location.href = "/lite/login";
        return;
      } else {
        failures++;
        status(false);
      }
      schedule();
    };
    try { request.send(null); } catch (e) { busy = false; failures++; status(false); schedule(); }
  }
  schedule();
})();
`;

/** 8-bit mono PCM WAV from samples in [-1, 1] — the one audio format every old Android plays. */
function wav(rate: number, samples: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const n = samples.length,
    buffer = new Uint8Array(44 + n),
    view = new DataView(buffer.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) buffer[offset + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + n, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, n, true);
  for (let i = 0; i < n; i++)
    buffer[44 + i] = Math.max(0, Math.min(255, Math.round(128 + 127 * samples[i])));
  return buffer;
}

let cachedBeep: Uint8Array<ArrayBuffer> | null = null;
let cachedBell: Uint8Array<ArrayBuffer> | null = null;

/** Soft 0.25 s, 880 Hz chime — WhatsApp hand-offs. */
export function beepWav(): Uint8Array<ArrayBuffer> {
  if (cachedBeep) return cachedBeep;
  const rate = 8000,
    samples = new Float64Array(rate / 4);
  for (let i = 0; i < samples.length; i++) {
    const fade = Math.min(1, (samples.length - i) / 400, i / 80);
    samples[i] = (90 / 127) * fade * Math.sin((2 * Math.PI * 880 * i) / rate);
  }
  return (cachedBeep = wav(rate, samples));
}

/**
 * Loud «дзынь-дзынь» service bell for new orders: two strikes of an inharmonic bell
 * around 1.2–6 kHz (where small tablet speakers are loudest), normalised to full
 * scale and soft-clipped so it cuts through a noisy hall. 1.6 s, 22 050 Hz.
 */
export function bellWav(): Uint8Array<ArrayBuffer> {
  if (cachedBell) return cachedBell;
  const rate = 22050,
    samples = new Float64Array(Math.round(rate * 1.6)),
    base = 1175;
  // [frequency ratio, amplitude, decay per second] — classic bell partials.
  const partials = [
    [1, 1, 2.6],
    [2, 0.6, 4],
    [2.76, 0.5, 5.5],
    [4.07, 0.3, 7],
    [5.4, 0.22, 9],
  ];
  const strikes = [
    [0, 1],
    [0.3, 0.85],
  ];
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    let value = 0;
    for (const [at, gain] of strikes) {
      const dt = t - at;
      if (dt < 0) continue;
      const attack = Math.min(1, dt / 0.002);
      for (const [ratio, amp, decay] of partials)
        value +=
          gain * attack * amp * Math.exp(-dt * decay) * Math.sin(2 * Math.PI * base * ratio * dt);
    }
    samples[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  const drive = 2.4,
    norm = Math.tanh(drive);
  for (let i = 0; i < samples.length; i++) {
    const tail = Math.min(1, (samples.length - i) / (rate * 0.05));
    samples[i] = (Math.tanh((drive * samples[i]) / peak) / norm) * tail;
  }
  return (cachedBell = wav(rate, samples));
}

let cachedChime: Uint8Array<ArrayBuffer> | null = null;
/**
 * Exchange-order chime: three rising marimba-like notes (G5–B5–E6), deliberately unlike the
 * double «дзынь-дзынь» bell used for ordinary orders, so staff tell them apart without looking.
 */
export function chimeWav(): Uint8Array<ArrayBuffer> {
  if (cachedChime) return cachedChime;
  const rate = 22050,
    samples = new Float64Array(Math.round(rate * 1.5)),
    notes = [
      [0, 784],
      [0.28, 988],
      [0.56, 1319],
    ];
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    let value = 0;
    for (const [at, freq] of notes) {
      const dt = t - at;
      if (dt < 0) continue;
      const attack = Math.min(1, dt / 0.003);
      value +=
        attack *
        Math.exp(-dt * 3.2) *
        (Math.sin(2 * Math.PI * freq * dt) +
          0.5 * Math.sin(2 * Math.PI * freq * 2 * dt) +
          0.25 * Math.sin(2 * Math.PI * freq * 3 * dt));
    }
    samples[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  const drive = 2.2,
    norm = Math.tanh(drive);
  for (let i = 0; i < samples.length; i++) {
    const tail = Math.min(1, (samples.length - i) / (rate * 0.05));
    samples[i] = (Math.tanh((drive * samples[i]) / peak) / norm) * tail;
  }
  return (cachedChime = wav(rate, samples));
}
