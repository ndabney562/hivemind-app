// Phone-only mode (spec 2026-11-01-phone-only): when the Mac doesn't answer within 3 s, the app keeps working from
// the shell sw.js cached and the last state this page saw, and says so with a "Phone only" badge.
// Pure helpers first (tests run them in Node: everything above the page code).
const MAC_TIMEOUT_MS = 3000;

// true when the Mac answers ok within timeoutMs; a refusal, a network error or silence is false
function macCheck(fetchFn, timeoutMs = MAC_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Promise.resolve().then(fetchFn).then((r) => { clearTimeout(timer); resolve(!!(r && r.ok)); },
                                         () => { clearTimeout(timer); resolve(false); });
  });
}

// The answer comes back to the app through the Shortcut's x-success URL ("callback"), or stays in Shortcuts and is
// picked up later ("sync"). Callback until the spike on Noah's iPhone says otherwise (plan Task 1).
const RETURN_MODE = "callback";
const SHORTCUT_NAME = "HiveMind Phone";
// how to build it (public, so friends can read it too)
const SHORTCUT_RECIPE = "https://github.com/ndabney562/hivemind-app/blob/main/shortcut.md";
const PHONE_AIS = ["apple-local", "apple-cloud", "claude-app", "chatgpt-app"];
// first available wins (spec: kinds and preference lists)
const PREFERENCE = {
  quick: ["apple-local", "apple-cloud", "chatgpt-app", "claude-app"],
  thinking: ["apple-cloud", "claude-app", "chatgpt-app", "apple-local"],
  coding: ["claude-app", "chatgpt-app", "apple-cloud", "apple-local"],
  latest: ["chatgpt-app", "claude-app", "apple-cloud"],
};
const PROMPT_MAX = 6000, PROMPT_TURNS = 3;
const QUESTION_MAX = 20000;  // the Mac's phone_sync.QUESTION_MAX: a longer turn would be refused at every sync

function questionProblem(question) {
  return String(question || "").length > QUESTION_MAX ? "That's too long to ask on the phone (over 20,000 characters). Shorten it, or wait for the Mac." : null;
}

function kindOf(question) {
  const q = String(question || "").toLowerCase();
  if (/```|\b(code|coding|python|javascript|typescript|java|swift|sql|regex|html|css|bug|debug|error|exception|stack ?trace|function|compile|script|traceback)\b|[a-z]+error\b/.test(q)) return "coding";
  if (/\b(today|tonight|tomorrow|yesterday|now|latest|current|currently|news|weather|price|prices|score|scores|this (week|month|year)|right now|recent|recently)\b/.test(q)) return "latest";
  if (q.length > 280 || /\b(plan|help me|why|compare|should i|pros and cons|analy[sz]e|essay|strategy|think|reason|outline|study|studying)\b/.test(q)) return "thinking";
  return "quick";
}
function orderFor(kind, available) {
  return (PREFERENCE[kind] || PREFERENCE.quick).filter((id) => (available || []).includes(id));
}
function pickOrder(question, available, forced = null) {
  return forced && (available || []).includes(forced) ? [forced] : orderFor(kindOf(question), available);
}
// About you and the last turns ride along, trimmed oldest turn first, then facts; the question is never cut (RF4)
function buildPrompt(question, facts, turns, maxChars = PROMPT_MAX) {
  facts = (facts || []).slice();
  turns = (turns || []).slice(-PROMPT_TURNS);
  const make = () => {
    const parts = [];
    if (facts.length) parts.push("About me:\n" + facts.map((f) => "- " + f).join("\n"));
    if (turns.length) parts.push("Earlier in this chat:\n" + turns.map((t) => "Q: " + t.q + "\nA: " + t.a).join("\n\n"));
    parts.push((parts.length ? "Question:\n" : "") + question);
    return parts.join("\n\n");
  };
  let out = make();
  while (out.length > maxChars && turns.length) { turns.shift(); out = make(); }
  while (out.length > maxChars && facts.length) { facts.pop(); out = make(); }
  return out;
}
function shortcutUrl(prompt, order, returnUrl) {
  const base = String(returnUrl).split("#")[0];
  return "shortcuts://x-callback-url/run-shortcut?name=" + encodeURIComponent(SHORTCUT_NAME) + "&input=text&text=" +
    encodeURIComponent(JSON.stringify({ prompt, order })) + "&x-success=" + encodeURIComponent(base + "#cb=ok") +
    "&x-error=" + encodeURIComponent(base + "#cb=err") + "&x-cancel=" + encodeURIComponent(base + "#cb=cancel");
}
// null when the URL isn't a Shortcut return; an empty, cut-off or malformed result is a failed turn with the raw
// text, never a crash (RF1). x-callback adds result= to the URL's query, so both query and hash are read.
function parseResult(hash, search = "") {
  const h = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  for (const [k, v] of new URLSearchParams(String(search || "").replace(/^\?/, ""))) if (!h.has(k)) h.set(k, v);
  const cb = h.get("cb");
  if (cb !== "ok" && cb !== "err" && cb !== "cancel") return null;
  if (cb === "cancel") return { model: null, ok: false, answer: "", cut: false, cancel: true };
  if (cb === "err") return { model: null, ok: false, answer: h.get("errorMessage") || "", cut: false, cancel: false };
  const raw = h.get("result") || "";
  let r;
  try { r = JSON.parse(raw); } catch (e) { return { model: null, ok: false, answer: raw, cut: false, cancel: false }; }
  if (!r || typeof r !== "object") return { model: null, ok: false, answer: raw, cut: false, cancel: false };
  const id = String(r.model || "").replace(/^phone:/, "");
  const answer = typeof r.answer === "string" ? r.answer : "";
  return { model: PHONE_AIS.includes(id) ? "phone:" + id : null, ok: r.ok === true && !!answer.trim(), answer, cut: !!r.cut, cancel: false };
}

// phone turns wait here until the Mac confirms them: IndexedDB, or memory when this phone can't save (RF3)
const CACHE_DB = "hivemind-cache", CACHE_STORES = ["state", "phoneTurns", "setup"];
// One connection per page. A first-load open can hang with no event at all (a known Safari 14 bug), so a silent open is abandoned after DB_OPEN_MS and tried again; after DB_OPEN_TRIES the phone can't save.
const DB_OPEN_MS = 1000, DB_OPEN_TRIES = 3;
let cacheDbOpen = null;
function openOnce() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) return resolve(null);
      const open = indexedDB.open(CACHE_DB, 2);
      const timer = setTimeout(() => resolve(undefined), DB_OPEN_MS);
      const done = (v) => { clearTimeout(timer); resolve(v); };
      open.onupgradeneeded = () => { for (const n of CACHE_STORES) if (!open.result.objectStoreNames.contains(n)) open.result.createObjectStore(n); };
      open.onsuccess = () => done(open.result);
      open.onerror = () => done(null);
      open.onblocked = () => done(null);
    } catch (e) { resolve(null); }
  });
}
function cacheDb() {
  return cacheDbOpen || (cacheDbOpen = (async () => {
    for (let i = 0; i < DB_OPEN_TRIES; i++) {
      const db = await openOnce();
      if (db !== undefined) return db;
    }
    return null;
  })());
}
// fn(store) -> request or nothing; resolves the request's result, or null
async function cacheDo(storeName, mode, fn) {
  const db = await cacheDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(storeName, mode).objectStore(storeName));
      if (!req) return resolve(null);
      req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
const memTurns = new Map();
function noSave() { if (typeof HM !== "undefined") HM.canSave = false; }
async function queueTurn(turn) {
  if ((await cacheDo("phoneTurns", "readwrite", (st) => st.put(turn, turn.id))) === undefined) { noSave(); memTurns.set(turn.id, turn); }
}
async function pendingTurns() {
  const saved = await cacheDo("phoneTurns", "readonly", (st) => st.getAll());
  if (saved === undefined) noSave();
  return (saved || []).concat([...memTurns.values()]);
}
// ids the Mac is done with: stored, or refused for good (a refused turn would otherwise be resent at every sync)
function settledIds(res) {
  return ((res && res.synced) || []).concat(((res && res.rejected) || []).map((r) => r.id).filter(Boolean));
}
async function confirmSynced(ids) {
  for (const id of ids || []) {
    memTurns.delete(id);
    await cacheDo("phoneTurns", "readwrite", (st) => { st.delete(id); });
  }
}

if (typeof module !== "undefined") {
  module.exports = { MAC_TIMEOUT_MS, macCheck, RETURN_MODE, SHORTCUT_RECIPE, kindOf, orderFor, pickOrder, buildPrompt, shortcutUrl,
                     parseResult, questionProblem, settledIds, queueTurn, pendingTurns, confirmSynced };
}

(() => {
  // the last /api/state and /api/threads, for opening with the Mac off; a database of its own because sw.js opens
  // "hivemind" at version 1 and a version bump there would break its token lookup
  const save = (key, value) => cacheDo("state", "readwrite", (st) => { st.put(value, key); });
  HM.lastState = async () => (await cacheDo("state", "readonly", (st) => st.get("last"))) || null;
  HM.canSave = true;
  HM.on("state", (s) => { if (HM.mode !== "phone") save("last", s); });
  if (typeof window.api === "function") {
    const api = window.api;
    window.api = async (path, body) => {
      const r = await api(path, body);
      if (path === "/api/threads") save("threads", r);
      return r;
    };
  }

  HM.mode = "mac";
  const badge = document.createElement("div");
  badge.id = "mode-badge";
  badge.hidden = true;
  badge.setAttribute("role", "status");
  badge.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;font-size:13px;color:var(--muted)";
  const label = document.createElement("span");
  label.textContent = "Phone only";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn ghost";
  retry.style.cssText = "min-height:32px;padding:2px 10px";
  retry.textContent = "Try Mac again";
  retry.onclick = () => HM.checkMac().then((up) => { if (up && typeof load === "function") { load(); listThreads(); } });
  badge.append(label, retry);
  retry.hidden = !!HM.noMac;
  (document.getElementById("err") || document.body).before(badge);

  function setMode(mode) {
    badge.hidden = mode !== "phone";
    if (mode === HM.mode) return;
    HM.mode = mode;
    HM.emit("mode", mode);
  }
  async function showCached() {
    const s = await HM.lastState();
    if (s && typeof render === "function") { try { render(s); } catch (e) { console.error("phone render", e); } }
    const threads = await cacheDo("state", "readonly", (st) => st.get("threads"));
    const box = document.getElementById("threads");
    if (!box || !Array.isArray(threads)) return;
    box.replaceChildren();
    for (const t of threads) {
      const row = document.createElement("div");
      row.className = "thread-btn";
      row.textContent = t.title || t.id;
      box.append(row);
    }
  }
  HM.checkMac = async () => {
    const up = HM.noMac ? false  // the friend copy: no Mac to ask
      : await macCheck(() => fetch("/api/state", { headers: { "X-HiveMind-Token": typeof token === "string" ? token : "" } }));
    setMode(up ? "mac" : "phone");
    if (!up) { if (typeof showErr === "function") showErr(null); if (!HM.noMac) showCached(); showSaved(); }
    return up;
  };
  // index.html refreshes every 20 s: with no Mac its error ("pair this phone", "Load failed") would come back each time
  if (typeof window.load === "function") {
    const macLoad = window.load;
    window.load = async () => {
      if (HM.noMac) return;
      if (HM.mode === "phone") { if (await HM.checkMac()) return macLoad(); return; }  // the Mac may be back
      await macLoad();
      if (document.getElementById("err")?.textContent) HM.checkMac();
    };
  }

  // --- answering on the phone (plan Task 4) ---
  const $id = (id) => document.getElementById(id);
  const mk = (tag, attrs, text) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (text) e.textContent = text; return e; };
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} return null; };
  const unstore = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
  const PENDING = "hivemind.phonePending", RECENT = "hivemind.phoneRecent";
  HM.on("newchat", () => unstore(RECENT));  // a new chat starts without the last phone turns as context
  const shown = new Set();
  const settingsBtn = () => mk("button", { type: "button", className: "btn ghost", onclick: () => document.querySelector('.nav-btn[data-view="settings"]')?.click() }, "Your AIs");
  HM.forcedAI = null;  // the composer's Apple / Claude / ChatGPT pick (setup.js, Task 5)

  function notice(text, ...extra) {
    const box = mk("div", { className: "phone-notice", role: "status" });
    box.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0;font-size:14px;color:var(--muted)";
    box.append(mk("span", {}, text), ...extra);
    ($id("result") || document.body).append(box);
    return box;
  }
  function showTurn(turn) {
    const convo = $id("convo") || $id("result");
    if (!convo || shown.has(turn.id)) return;
    shown.add(turn.id);
    if ($id("welcome")) $id("welcome").hidden = true;
    const user = mk("div", { className: "msg-user" });
    user.append(mk("div", { className: "bubble" }, turn.question));
    const who = mk("div", { className: "who" });
    who.append(mk("b", {}, turn.model ? turn.model.replace(/^phone:/, "") : "HiveMind"),
               mk("span", { className: "tag " + (turn.ok ? "warn" : "fail") }, turn.ok ? "phone only, not checked" : "phone only, failed"));
    const body = mk("div", {});
    if (typeof md === "function" && turn.answer) body.append(md(turn.answer)); else body.textContent = turn.answer || "No answer came back.";
    if (turn.cut) body.append(mk("div", { className: "note" }, "This answer was cut short on the way back."));
    const ai = typeof aiMessage === "function" ? aiMessage(!turn.ok, who, body, "", "") : mk("div", { className: "msg-ai" });
    if (typeof aiMessage !== "function") ai.append(who, body);
    convo.append(user, ai);
    if (typeof scrollDown === "function") scrollDown();
    HM.emit("message", { el: ai, role: "assistant", task_id: null, text: turn.answer || "", turn });
  }

  // turns kept on this phone (the friend copy's history; Noah's until the Mac takes them), shown once per page
  let savedShown = false;
  async function showSaved() {
    if (savedShown) return;
    savedShown = true;
    for (const t of (await pendingTurns()).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) showTurn(t);
  }

  async function phoneSend() {
    const box = $id("task"), q = box.value.trim();
    if (!q) return;
    const tooLong = questionProblem(q);
    if (tooLong) { notice(tooLong); return; }
    const available = HM.available ? await HM.available() : [];
    const order = pickOrder(q, available, HM.forcedAI);
    if (!order.length) { notice("No AI set up on this phone yet.", settingsBtn()); return; }
    const kind = kindOf(q);
    const s = await HM.lastState();
    const facts = ((s && s.profile && s.profile.facts) || []).map((f) => f.text).filter(Boolean);
    const recent = (store(RECENT) || []).filter((t) => t.thread === (typeof threadId === "string" ? threadId : null));
    const prompt = buildPrompt(q, facts, recent);
    const id = "p_" + Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
    store(PENDING, { id, question: q, kind, order, thread_id: typeof threadId === "string" ? threadId : null, ts: new Date().toISOString() });
    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    location.href = shortcutUrl(prompt, order, location.href.split("#")[0].split("?")[0]);
    if (RETURN_MODE === "sync") notice("Answered in Shortcuts. HiveMind picks it up at the next sync.");
  }

  // the Shortcut sends the person back here with #cb=ok&result=… or #cb=err&errorMessage=…
  async function onReturn() {
    const r = parseResult(location.hash, location.search);
    if (!r) return;
    history.replaceState(null, "", location.pathname);
    const p = store(PENDING);
    unstore(PENDING);
    if (!p) return;
    if (r.cancel) { restore(p); return; }
    if (!r.ok && !r.model && /couldn.?t find|not found|no shortcut|doesn.?t exist/i.test(r.answer)) {
      restore(p);
      notice("The HiveMind Phone Shortcut isn't on this phone yet.",
             mk("a", { className: "btn ghost", href: HM.shortcutLink || SHORTCUT_RECIPE, target: "_blank", rel: "noopener" }, "Install HiveMind Phone"));
      return;
    }
    const turn = { id: p.id, question: p.question, answer: r.answer, model: r.model || "phone:" + p.order[0], kind: p.kind,
                   ok: r.ok, thread_id: p.thread_id, ts: p.ts, cut: r.cut };
    await queueTurn(turn);  // the friend copy keeps it here for good: its history lives on the phone
    showTurn(turn);
    HM.emit("phoneTurn", turn);
    if (HM.canSave === false) notice("This phone can't save chats, so this one is gone when the app closes.");
    if (turn.ok) store(RECENT, (store(RECENT) || []).concat({ thread: p.thread_id, q: p.question, a: r.answer }).slice(-PROMPT_TURNS));
  }
  window.addEventListener("hashchange", onReturn);
  // the question goes back in the box when nothing comes back: cancelled in Shortcuts, Shortcut missing (Shortcuts
  // shows its own alert), or the person just switched back
  function restore(p) {
    const box = $id("task");
    if (box && !box.value.trim()) { box.value = p.question; box.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    setTimeout(() => {
      const p = store(PENDING);
      if (!p || parseResult(location.hash, location.search)) return;
      unstore(PENDING);
      restore(p);
    }, 1500);
  });

  // the Mac is back: hand it the phone turns; the queue empties only for ids the Mac confirmed (RF2)
  let syncing = false;
  async function syncTurns() {
    if (syncing) return;
    syncing = true;
    try {
      const turns = (await pendingTurns()).map(({ cut, ...t }) => t);
      if (!turns.length) return;
      for (let i = 0; i < turns.length;) {
        const batch = [];
        let size = 0;
        while (i < turns.length && (!batch.length || size + JSON.stringify(turns[i]).length < 1.5e6)) { size += JSON.stringify(turns[i]).length; batch.push(turns[i++]); }
        const res = await window.api("/api/phone/sync", { turns: batch });
        await confirmSynced(settledIds(res));
        for (const bad of res.rejected || []) {
          const t = batch.find((x) => x.id === bad.id);
          if (t) notice("The Mac couldn't keep a phone answer (" + bad.error + "): \u201c" + t.question.slice(0, 80) + "\u201d");
        }
        for (const t of batch) {
          if (t.ok || !(res.synced || []).includes(t.id)) continue;
          notice("Not answered on the phone: “" + t.question.slice(0, 80) + "”",
                 mk("button", { type: "button", className: "btn ghost", onclick: (e) => { e.currentTarget.parentNode.remove(); HM.fillComposer(t.question); $id("run").click(); } }, "Run on Mac"));
        }
      }
      if (typeof listThreads === "function") listThreads();
    } catch (e) { console.error("phone sync", e); } finally { syncing = false; }
  }
  HM.on("mode", (m) => { if (m === "mac") syncTurns(); });

  // each send tries the Mac first (spec): Enter in the composer clicks #run, so this covers both
  const run = $id("run"), macRun = run && run.onclick;
  let checking = false;
  if (run) run.onclick = async (e) => {
    if (checking) return;
    checking = true;
    try { if (await HM.checkMac()) return macRun && macRun.call(run, e); } finally { checking = false; }
    phoneSend();
  };

  onReturn().then(() => HM.checkMac()).then((up) => { if (up) syncTurns(); });
})();
