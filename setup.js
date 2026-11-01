// Your AIs and suggestions for phone-only mode (spec 2026-11-01-phone-only): which AIs this phone has (Apple
// Intelligence, the Claude app, the ChatGPT app), tips when a missing one would help, and About you kept on the
// phone when there is no Mac at all (the friend copy). Pure helpers first (tests run them in Node).
const SETUP_AIS = ["apple-local", "apple-cloud", "claude-app", "chatgpt-app"];
const AI_NAMES = { "apple-local": "Apple Intelligence", "apple-cloud": "Apple Intelligence (cloud)", "claude-app": "Claude", "chatgpt-app": "ChatGPT" };
const SUGGESTION_TEXT = {
  "apple-off": "Turn on Apple Intelligence (Settings › Apple Intelligence & Siri) so quick questions answer right on this phone.",
  "code-app": "Coding questions go best to the Claude or ChatGPT app. Install one, sign in, then tick it under Your AIs.",
  "web-app": "For news and today's facts, the ChatGPT app can look things up. Install it, sign in, then tick it under Your AIs.",
};
const FAIL_RUN = 3;

// the "setup" store of phone.js's "hivemind-cache" database, or memory when this phone can't save
const setupMem = {};
// phone.js's cacheDb (one connection per page, with its retry for a hung open); Node tests have no IndexedDB
function setupDb() {
  return typeof cacheDb === "function" ? cacheDb() : Promise.resolve(null);
}
async function setupGet(key, fallback) {
  const db = await setupDb();
  if (!db) return key in setupMem ? setupMem[key] : fallback;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("setup").objectStore("setup").get(key);
      req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
      req.onerror = () => resolve(fallback);
    } catch (e) { resolve(fallback); }
  });
}
async function setupPut(key, value) {
  const db = await setupDb();
  if (!db) { setupMem[key] = value; return; }
  await new Promise((resolve) => {
    try {
      const tx = db.transaction("setup", "readwrite");
      tx.objectStore("setup").put(value, key);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch (e) { resolve(); }
  });
}

async function available() {
  const ais = await setupGet("ais", []);
  return Array.isArray(ais) ? ais.filter((id) => SETUP_AIS.includes(id)) : [];
}
function setAvailable(ais) { return setupPut("ais", (ais || []).filter((id) => SETUP_AIS.includes(id))); }

// recentTurns: [{kind, model, ok}] oldest first; dismissed: ids never shown again
function suggestionsFor(available, recentTurns, dismissed) {
  const has = (id) => (available || []).includes(id), turns = recentTurns || [], out = [];
  if (!has("apple-local") && !has("apple-cloud")) out.push("apple-off");
  if (turns.some((t) => t.kind === "coding") && !has("claude-app") && !has("chatgpt-app")) out.push("code-app");
  if (turns.some((t) => t.kind === "latest") && !has("chatgpt-app")) out.push("web-app");
  for (const id of SETUP_AIS) {
    const mine = turns.filter((t) => t.model === "phone:" + id).slice(-FAIL_RUN);
    if (mine.length === FAIL_RUN && mine.every((t) => t.ok === false)) out.push("failing:phone:" + id);
  }
  return out.filter((id) => !(dismissed || []).includes(id)).map((id) => ({
    id, text: SUGGESTION_TEXT[id] || (AI_NAMES[id.replace("failing:phone:", "")] + " failed " + FAIL_RUN +
      " times in a row. Check you're signed in to it, or untick it under Your AIs.") }));
}

// About you with no Mac: the shape of the Mac's /api/profile ({facts, suggested, welcomed}), kept on this phone
const WELCOME_FIELDS = [["name", "Name is %s"], ["does", "Does: %s"], ["goals", "Goals: %s"]];
const STYLES = { short: "Prefers short answers", detailed: "Prefers detailed answers" };
const localProfile = {
  async load() {
    const p = await setupGet("profile", null);
    return { facts: (p && p.facts) || [], suggested: [], welcomed: !!(p && p.welcomed) };
  },
  async save(p) { await setupPut("profile", { facts: p.facts, welcomed: p.welcomed }); return this.load(); },
  item(text) {
    const id = "f_" + Math.random().toString(16).slice(2, 10);
    return { id, text: String(text).split(/\s+/).filter(Boolean).join(" ").slice(0, 200), source: "you", ts: new Date().toISOString() };
  },
  async add(text) {
    const p = await this.load(), f = this.item(text);
    p.facts.push(f);
    await this.save(p);
    return f;
  },
  async remove(id) { const p = await this.load(); p.facts = p.facts.filter((f) => f.id !== id); return this.save(p); },
  async welcome(answers) {
    const a = answers || {}, p = await this.load(), known = new Set(p.facts.map((f) => f.text.toLowerCase()));
    const texts = WELCOME_FIELDS.filter(([k]) => String(a[k] || "").trim())
      .map(([k, fmt]) => fmt.replace("%s", String(a[k]).split(/\s+/).filter(Boolean).join(" ")));
    if (STYLES[a.style]) texts.push(STYLES[a.style]);
    for (const t of texts) if (!known.has(t.toLowerCase())) p.facts.push(this.item(t));
    p.welcomed = true;
    return this.save(p);
  },
  // the Mac's /api/profile actions: GET with no body, add, welcome, delete/undo (keep/dismiss have nothing to act on)
  async api(body) {
    const b = body || {};
    if (b.action === "add" && String(b.text || "").trim()) await this.add(b.text);
    else if (b.action === "welcome") await this.welcome(b);
    else if (b.action === "delete" || b.action === "undo") await this.remove(b.id);
    return this.load();
  },
};

if (typeof module !== "undefined") module.exports = { available, setAvailable, suggestionsFor, localProfile };

(() => {
  const mk = (tag, attrs, text) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (text) e.textContent = text; return e; };
  HM.available = available;
  // the friend copy has no Mac: About you lives on the phone (Task 7 sets HM.noMac before this script runs)
  if (HM.noMac && typeof window.api === "function") {
    const api = window.api;
    window.api = (path, body) => path === "/api/profile" ? localProfile.api(body) : api(path, body);
    // profile.js asked the (missing) Mac before this ran: hand it the phone's About you, which opens the start page
    localProfile.load().then((p) => HM.emit("state", { profile: p, scope: "phone" }));
  }

  // Settings › Your AIs
  const card = mk("div", { className: "card", id: "your-ais" });
  card.style.marginBottom = "16px";
  const boxes = [["apple", "Apple Intelligence is on", ["apple-local", "apple-cloud"]], ["claude", "Claude app (signed in)", ["claude-app"]],
                 ["chatgpt", "ChatGPT app (signed in)", ["chatgpt-app"]]].map(([key, label, ids]) => {
    const input = mk("input", { type: "checkbox", id: "ai-" + key });
    const row = mk("label", { htmlFor: "ai-" + key });
    row.style.cssText = "display:flex;align-items:center;gap:8px;min-height:44px";
    row.append(input, label);
    return { input, ids, row };
  });
  const save = async () => { await setAvailable(boxes.flatMap((b) => b.input.checked ? b.ids : [])); fillPick(); showSuggestion(); };
  for (const b of boxes) b.input.onchange = save;
  card.append(mk("h3", {}, "Your AIs"),
    mk("p", { className: "meta" }, "When the Mac is off, HiveMind asks these apps on this phone, through the HiveMind Phone Shortcut, under your own sign-ins."),
    ...boxes.map((b) => b.row));
  const settings = document.querySelector("#view-settings .page-inner");
  const lead = settings && settings.querySelector("h2 ~ .lead");
  if (lead) lead.after(card); else if (settings) settings.append(card);
  available().then((ais) => { for (const b of boxes) b.input.checked = b.ids.some((id) => ais.includes(id)); });

  // the composer's pick: Auto or one of this phone's AIs, phone mode only
  const pick = mk("select", { className: "pick", id: "phone-ai", hidden: true });
  pick.setAttribute("aria-label", "Which AI answers on the phone");
  pick.onchange = () => { HM.forcedAI = pick.value || null; };
  document.getElementById("opts")?.prepend(pick);
  async function fillPick() {
    const ais = await available(), keep = pick.value;
    pick.replaceChildren(mk("option", { value: "" }, "Auto"), ...ais.map((id) => mk("option", { value: id }, AI_NAMES[id])));
    pick.value = ais.includes(keep) ? keep : "";
    HM.forcedAI = pick.value || null;
    pick.hidden = HM.mode !== "phone" || !ais.length;
  }

  // one suggestion at a time on the chat page; "Not now" dismisses it for good
  const tip = mk("div", { className: "card", id: "phone-tip", role: "status", hidden: true });
  tip.style.cssText = "margin:8px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center";
  document.getElementById("result")?.before(tip);
  async function showSuggestion() {
    if (HM.mode !== "phone") { tip.hidden = true; return; }
    const [ais, turns, dismissed] = await Promise.all([available(), setupGet("turns", []), setupGet("dismissed", [])]);
    const s = suggestionsFor(ais, turns, dismissed)[0];
    tip.hidden = !s;
    if (!s) return;
    const no = mk("button", { type: "button", className: "btn ghost" }, "Not now");
    no.onclick = async () => { await setupPut("dismissed", dismissed.concat(s.id)); showSuggestion(); };
    tip.replaceChildren(mk("span", {}, s.text), no);
  }
  HM.on("mode", () => { fillPick(); showSuggestion(); });
  HM.on("phoneTurn", async (t) => {
    const turns = await setupGet("turns", []);
    await setupPut("turns", turns.concat({ kind: t.kind, model: t.model, ok: t.ok }).slice(-20));
    showSuggestion();
  });
  fillPick();
})();
