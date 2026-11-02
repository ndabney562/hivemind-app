// The Mac opens the page with its per-launch token (#t=). A paired iPhone opens it with its phone key (#k=), which
// is also kept in this browser so the plain address works later. The key stays in the link on purpose: a
// Home Screen icon has its own storage and needs it.
const hashArgs = new URLSearchParams(location.hash.slice(1));
let token = hashArgs.get("t") || hashArgs.get("k") || "";
// Keys saved before the rename to HiveMind (2026-10-31) were stored as "hub.*": moved over once, then removed.
try { for (const k of ["key", "pending"]) { const old = localStorage.getItem("hub." + k);
  if (old !== null) { if (localStorage.getItem("hivemind." + k) === null) localStorage.setItem("hivemind." + k, old);
                      localStorage.removeItem("hub." + k); } } } catch (e) {}
if (hashArgs.get("k")) { try { localStorage.setItem("hivemind.key", hashArgs.get("k")); } catch (e) {} }
if (!token) { try { token = localStorage.getItem("hivemind.key") || ""; } catch (e) {} }
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n[k] = v; else n.setAttribute(k, v);
  }
  for (const k of kids) n.append(k instanceof Node ? k : document.createTextNode(k ?? ""));
  return n;
};
const icon = (name) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "i"); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#i-" + name); s.append(u); return s; };
async function api(path, body) {
  const r = await fetch(path, { method: body ? "POST" : "GET",
    headers: { "X-HiveMind-Token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || ("HTTP " + r.status));
  return data;
}
function showErr(e) { $("err").textContent = e ? String(e.message || e) : ""; }
const isTouch = matchMedia("(hover: none)").matches;
// A notification when an answer is ready (hivemindcore/push.py). iOS offers it only in the Home Screen app.
const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let swReg = null;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; pushUI(); }).catch(() => {});
function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)); }
async function pushOn() {
  try {
    if (await Notification.requestPermission() === "granted") {
      const { key } = await api("/api/push/key");
      const reg = swReg || await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
      await api("/api/push/subscribe", { endpoint: sub.endpoint });
    }
  } catch (e) { showErr(e); }
  pushUI();
}
async function pushOff() {
  try {
    const sub = swReg && await swReg.pushManager.getSubscription();
    if (sub) { await api("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
  } catch (e) { showErr(e); }
  pushUI();
}
async function pushState() {
  if (!canPush) return navigator.standalone ? "readd" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  try { return swReg && await swReg.pushManager.getSubscription() ? "on" : "off"; } catch (e) { return "off"; }
}
async function pushUI() {
  const box = $("push"); if (!box) return;
  const st = await pushState();
  box.replaceChildren(
    st === "on" ? el("div", { class: "row-actions" }, el("span", { class: "meta" }, "On for this device."),
                     el("button", { class: "btn", onclick: pushOff }, "Turn off"))
    : st === "off" ? el("div", { class: "row-actions" }, el("button", { class: "btn primary", onclick: pushOn }, "Turn on notifications"))
    : el("p", { class: "meta" }, st === "denied" ? "Notifications are blocked. Turn them on in the iPhone's Settings › Notifications › HiveMind."
      : st === "readd" ? "To turn this on, remove HiveMind from your Home Screen and add it again from Safari (Share › Add to Home Screen)."
      : isTouch ? "Open HiveMind from your Home Screen to turn this on." : "This browser can't show HiveMind notifications."));
}
let ratings = {};  // task_id -> good|bad, from /api/state; threads don't store ratings
// Answers are model text: escape everything, then allow a small markdown subset. Links: http(s) only.
function md(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)<]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [], parts = String(text || "").split(/^```[^\n]*\n?/m);
  parts.forEach((part, i) => {
    if (i % 2) { out.push("<pre><code>" + esc(part.replace(/\n$/, "")) + "</code></pre>"); return; }
    let list = null, para = [];
    const flushP = () => { if (para.length) out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; };
    const flushL = () => { if (list) out.push("<" + list.tag + ">" + list.items.map((x) => "<li>" + inline(x) + "</li>").join("") + "</" + list.tag + ">"); list = null; };
    for (const line of part.split("\n")) {
      let m;
      if (!line.trim()) { flushP(); flushL(); }
      else if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); out.push("<h" + (m[1].length < 3 ? 3 : 4) + ">" + inline(m[2]) + "</h" + (m[1].length < 3 ? 3 : 4) + ">"); }
      else if ((m = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)/))) {
        flushP(); const tag = /\d/.test(m[1]) ? "ol" : "ul";
        if (!list || list.tag !== tag) { flushL(); list = { tag, items: [] }; }
        list.items.push(m[2]);
      }
      else if ((m = line.match(/^>\s?(.*)/))) { flushP(); flushL(); out.push("<blockquote>" + inline(m[1]) + "</blockquote>"); }
      else if (list && /^\s{2,}\S/.test(line)) list.items[list.items.length - 1] += " " + line.trim();
      else { flushL(); para.push(line); }
    }
    flushP(); flushL();
  });
  const box = el("div", { class: "md" }); box.innerHTML = out.join(""); return box;
}
function rateButtons(taskId, current, compact) {
  const box = el("span", { class: compact ? "rate" : "rate ai-rate" });
  const label = (r) => r === "good" ? "Good" : "Bad";
  // Mark the tap here: load() redraws the recent table, not the conversation (live 2026-10-31: 3 taps, no ✓)
  const mark = (pick) => { for (const b of box.children) { const on = b.dataset.r === pick;
    b.setAttribute("aria-pressed", String(on)); b.title = on ? "You rated this " + label(b.dataset.r).toLowerCase() : "Rate " + label(b.dataset.r).toLowerCase(); } };
  for (const r of ["good", "bad"]) {
    box.append(el("button", { class: "btn ghost " + r, "data-r": r, "aria-pressed": String(current === r), "aria-label": label(r),
      onclick: async () => { try { await api("/api/rate", { task_id: taskId, rating: r }); ratings[taskId] = r; mark(r); load(); } catch (e) { showErr(e); } } },
      icon(r === "good" ? "up-thumb" : "down-thumb"), compact ? label(r) : ""));
  }
  mark(current);
  return box;
}
// Pages
const VIEWS = { chat: "Chat", stats: "Usage & results", you: "About you", settings: "Settings" };
let view = "chat";
function showView(v) {
  view = VIEWS[v] ? v : "chat";
  for (const k of Object.keys(VIEWS)) $("view-" + k).hidden = k !== view;
  for (const b of document.querySelectorAll(".nav-btn")) {
    if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  setTitle();
  document.body.classList.remove("side-open");
  HM.emit("view:" + view, $("view-" + view));
}
let threadTitle = "";
// Pages carry their own heading, so the top bar names only the conversation
function setTitle() { $("title").textContent = view === "chat" ? (threadTitle || "New chat") : "";
  $("delchat").hidden = !threadId || view !== "chat"; }
for (const b of document.querySelectorAll(".nav-btn")) b.onclick = () => showView(b.dataset.view);
$("mini-quota").onclick = () => showView("stats");
$("mini-quota").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showView("stats"); } };
$("menu").onclick = () => document.body.classList.add("side-open");
$("scrim").onclick = () => document.body.classList.remove("side-open");
function meterRow(name, v) {
  const pct = v == null ? null : Math.round(v * 100);
  const fill = el("div", { class: "fill" + (pct == null ? "" : pct < 10 ? " out" : pct < 30 ? " low" : "") });
  fill.style.width = (pct ?? 0) + "%";
  return [el("span", {}, name), el("span", {}, pct == null ? "unknown" : pct + "%"), el("div", { class: "track" }, fill)];
}
function render(s) {
  ratings = {};
  for (const t of s.recent) if (t.rating) ratings[t.task_id] = t.rating;
  const q = $("quota"); q.replaceChildren(); q.classList.remove("empty");
  const mq = $("mini-quota"); mq.replaceChildren();
  for (const [name, v] of Object.entries(s.quota)) {
    const [a, b, track] = meterRow(name, v);
    q.append(el("div", { class: "meter", "data-key": name }, el("div", { class: "row" }, a, b), track));
    mq.append(el("div", { class: "mq" }, ...meterRow(name.replace(/ \((\w+), free\)/, " ($1)").replace(/^antigravity:/, "agy "), v)));
  }
  const rec = $("recent"); rec.replaceChildren();
  if (!s.recent.length) rec.append(el("tr", {}, el("td", { colspan: "6", class: "empty" }, "No tasks yet.")));
  for (const t of s.recent) {
    rec.append(el("tr", { "data-id": t.task_id, tabindex: "0", title: "Show answer and attempts",
      onclick: (e) => { if (!e.target.closest("button")) showTask(t.task_id); },
      onkeydown: (e) => { if (e.key === "Enter" && !e.target.closest("button")) showTask(t.task_id); } },
      el("td", { style: "white-space:nowrap;color:var(--muted)" }, ago(t.ts)), el("td", { class: "task-cell", title: t.task || "" }, t.task || ""),
      el("td", {}, t.category || ""), el("td", {}, t.model || ""),
      el("td", {}, el("span", { class: "pill " + (t.pass === null ? "warn" : t.pass ? "pass" : "fail") },
        t.pass === null ? "not checked" : t.pass ? "passed" : "failed")),
      el("td", {}, rateButtons(t.task_id, t.rating, true))));
  }
  if (s.history) { quotaChart(s.history); savingsChart(s.history); }
  if (s.profile) renderProfile(s.profile);
  const phoneMode = s.scope === "phone";  // a phone can't pick a folder, approve proposals or pair phones
  $("cwd").hidden = phoneMode;
  $("drophint").hidden = phoneMode;
  $("phone-panel").hidden = phoneMode;
  $("data-card").hidden = phoneMode;  // a phone can remove one chat, not everything
  if (!phoneMode) renderPhone(s.phone, s.projects || []);
  renderProjectPicker(phoneMode ? s.projects || [] : []);
  const imp = s.improving || {};
  const proposed = imp.Proposed || [];
  badge("set-badge", phoneMode ? 0 : proposed.length);
  const prop = $("proposed"); prop.replaceChildren(); prop.classList.toggle("empty", !proposed.length);
  if (!proposed.length) prop.append("Nothing waiting.");
  for (const item of proposed) {
    const pid = (item.match(/^P-\d+/) || [""])[0];
    const link = (item.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/) || [null])[0];
    const actions = phoneMode ? el("div", { class: "meta" }, "Approve or reject this on your Mac.")
      : el("div", { class: "row-actions" },
        el("button", { class: "btn good", onclick: () => decide(pid, "start") }, "Approve"),
        el("button", { class: "btn bad", onclick: () => decide(pid, "reject") }, "Reject"));
    if (link) actions.append(el("a", { href: link, target: "_blank", rel: "noopener" }, "Open repo"));
    prop.append(el("div", { class: "item" }, item, actions));
  }
  const now = $("now"); now.replaceChildren(); now.classList.remove("empty");
  for (const i of imp.Now || []) now.append(el("div", { class: "item" }, i));
  if (!(imp.Now || []).length) { now.classList.add("empty"); now.append("Nothing in Now."); }
  const sc = $("score"); sc.replaceChildren();
  if (!s.scoreboard.length) sc.append(el("tr", {}, el("td", { colspan: "9", class: "empty" }, "No results yet.")));
  for (const r of s.scoreboard) {
    sc.append(el("tr", {}, el("td", {}, r.category), el("td", {}, r.model), el("td", { class: "num" }, String(r.n)),
      el("td", { class: "num" }, r.pass_pct + "%"), el("td", { class: "num" }, r.esc_pct + "%"),
      el("td", { class: "num" }, r.avg_latency == null ? "" : String(r.avg_latency)),
      el("td", { class: "num" }, String(r.up)), el("td", { class: "num" }, String(r.down)), el("td", { style: "color:var(--muted)" }, r.prior)));
  }
  HM.emit("state", s);
}
function badge(id, n) { const b = $(id); b.hidden = !n; b.textContent = n ? String(n) : ""; }
function ago(ts) {
  if (!ts) return "";
  const d = new Date(ts), s = (Date.now() - d) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
async function showTask(id) {
  const body = $("detail-body");
  body.replaceChildren(el("div", { class: "meta" }, "Loading…"));
  $("detail-title").textContent = "Task " + id;
  $("detail").showModal();
  try {
    const d = await api("/api/task?id=" + encodeURIComponent(id));
    $("detail-title").textContent = d.task || id;
    const models = d.attempts.map((a) => a.model);
    body.replaceChildren(
      el("div", { class: "meta" }, [(d.ts || "").slice(0, 16).replace("T", " "), d.category, d.ok ? "passed" : "failed",
        models.length > 1 ? "escalated: " + models.join(" → ") : models[0]].filter(Boolean).join(" · ")),
      d.route_line ? el("div", { class: "meta" }, d.route_line) : "",
      el("div", { class: "answer-box" }, d.text == null ? "No saved answer: this task ran before HiveMind started saving answers." : md(d.text)),
      el("h4", {}, "Attempts"),
      ...d.attempts.map((a) => {
        const v = a.verify || {}, pass = !!v.pass, unchecked = v.type === "judge" && v.pass === null;  // P-25
        return el("div", { class: "attempt " + (unchecked ? "" : pass ? "pass" : "fail") },
          el("div", {}, "#" + (a.attempt ?? "?") + " " + a.model + (a.tier != null ? " (tier " + a.tier + ")" : "") + " · " +
            (unchecked ? "not checked" : pass ? "passed" : "failed") + (a.latency_s != null ? " · " + a.latency_s + " s" : "")),
          a.error_kind ? el("div", { class: "meta" }, "Error: " + a.error_kind) : "",
          v.reason ? el("div", { class: "meta" }, "Check (" + (v.type || "?") + "): " + v.reason) : "",
          a.escalated_from ? el("div", { class: "meta" }, "Escalated from " + a.escalated_from + ": " + (a.reason || "")) : "");
      }),
      el("div", { class: "row-actions" }, rateButtons(d.task_id, d.rating, true)));
  } catch (e) { body.replaceChildren(el("div", { class: "meta" }, String(e.message || e))); }
}
$("detail-close").onclick = () => $("detail").close();
$("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });
// Charts: plain SVG. One y-axis each; color follows the quota group (fixed slot order), never its rank.
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.append(k instanceof Node ? k : document.createTextNode(k ?? ""));
  return n;
};
const GROUP_ORDER = ["claude", "codex", "antigravity:gemini", "antigravity:3p", "antigravity:argon"];
const slot = (g) => { const i = GROUP_ORDER.indexOf(g); return "var(--s" + ((i < 0 ? 4 : i) + 1) + ")"; };
const fmtTime = (ms, bucket) => { const d = new Date(ms);
  return bucket === "day" ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
function tipAt(box, tip, x, y, lines) {
  tip.replaceChildren(...lines.map(([v, label, color]) => el("div", {},
    color ? el("span", { class: "key", style: "background:" + color }) : "", el("b", {}, v), " " + label)));
  tip.hidden = false;
  const bw = box.clientWidth, tw = tip.offsetWidth;
  tip.style.left = Math.max(0, Math.min(bw - tw, x + 12)) + "px"; tip.style.top = Math.max(0, y - 10) + "px";
}
function legend(items) {
  return el("div", { class: "legend" }, ...items.map(([label, color]) =>
    el("span", {}, el("span", { class: "key", style: "background:" + color }), label)));
}
function table(head, rows) {
  return el("details", { class: "tbl" }, el("summary", {}, "Show as table"),
    el("div", { class: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...head.map((h) => el("th", {}, h)))),
      el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((c, i) => el("td", i ? { class: "num" } : {}, String(c)))))))));
}
function quotaChart(h) {
  const box = $("quota-chart"); box.replaceChildren(); box.classList.remove("empty");
  const groups = Object.keys(h.quota).sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  if (!groups.length) { box.classList.add("empty"); box.append("No quota readings yet."); return; }
  const series = groups.map((g) => ({ g, pts: h.quota[g].map(([ts, v]) => [Date.parse(ts), v]) }));
  const all = series.flatMap((s) => s.pts.map((p) => p[0]));
  const t0 = Math.min(...all), t1 = Math.max(...all, t0 + 1);
  const W = 860, H = 220, L = 34, R = groups.length <= 4 ? 120 : 12, T = 8, B = 24;
  const x = (t) => L + (t - t0) / (t1 - t0) * (W - L - R), y = (v) => T + (100 - v) / 100 * (H - T - B);
  const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
    "aria-label": "Quota percent left over time for " + groups.join(", ") });
  const grid = svgEl("g", { class: "grid axis" });
  for (const v of [0, 50, 100]) grid.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }),
    svgEl("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, v + "%"));
  for (const [t, a] of [[t0, "start"], [t1, "end"]]) grid.append(svgEl("text", { x: x(t), y: H - 6, "text-anchor": a }, fmtTime(t, "hour")));
  svg.append(grid);
  for (const s of series) {
    const c = slot(s.g);
    // step line: a reading holds until the next one
    let d = "";
    s.pts.forEach(([t, v], i) => { d += (i ? "H" + x(t).toFixed(1) + "V" : "M" + x(t).toFixed(1) + " ") + y(v).toFixed(1); });
    svg.append(svgEl("path", { d, fill: "none", stroke: c, "stroke-width": 2, "stroke-linejoin": "round" }));
    const [lt, lv] = s.pts[s.pts.length - 1];
    svg.append(svgEl("circle", { cx: x(lt), cy: y(lv), r: 4, fill: c, stroke: "var(--panel)", "stroke-width": 2 }));
    if (groups.length <= 4) svg.append(svgEl("text", { class: "dlabel", x: W - R + 8, y: y(lv) + 4 }, s.g + " " + lv + "%"));
  }
  const hair = svgEl("line", { class: "hair", y1: T, y2: H - B, visibility: "hidden" });
  svg.append(hair);
  const tip = el("div", { class: "tip", hidden: "" });
  const at = (s, t) => { let v = null; for (const p of s.pts) { if (p[0] <= t) v = p[1]; else break; } return v; };
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * W / r.width;
    const t = t0 + Math.max(0, Math.min(1, (sx - L) / (W - L - R))) * (t1 - t0);
    hair.setAttribute("x1", x(t)); hair.setAttribute("x2", x(t)); hair.setAttribute("visibility", "visible");
    tipAt(box, tip, e.clientX - box.getBoundingClientRect().left, e.clientY - box.getBoundingClientRect().top,
      [[fmtTime(t, "hour"), "", null], ...series.map((s) => { const v = at(s, t); return [v == null ? "—" : v + "%", s.g, slot(s.g)]; })]);
  });
  svg.addEventListener("pointerleave", () => { hair.setAttribute("visibility", "hidden"); tip.hidden = true; });
  box.append(groups.length > 1 ? legend(groups.map((g) => [g, slot(g)])) : el("div", { class: "meta" }, groups[0]), svg, tip,
    table(["Group", "Readings", "First", "Latest"], series.map((s) => [s.g, s.pts.length, s.pts[0][1] + "%", s.pts[s.pts.length - 1][1] + "%"])));
}
function savingsChart(h) {
  const box = $("savings-chart"); box.replaceChildren(); box.classList.remove("empty");
  const data = h.savings;
  if (!data.length) { box.classList.add("empty"); box.append("No finished tasks yet."); return; }
  const LOW = "var(--s1)", HIGH = "var(--s2)";
  const W = 520, H = 160, L = 30, R = 8, T = 8, B = 24, max = Math.max(...data.map((b) => b.low + b.high), 1);
  const y = (v) => (H - T - B) * v / max, base = H - B, step = (W - L - R) / data.length, bw = Math.min(40, step * 0.7);
  const ms = (b) => Date.parse(b.t.length === 10 ? b.t + "T00:00" : b.t + ":00");
  const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
    "aria-label": "Finished tasks per " + h.bucket + ", tier 0 to 1 versus tier 2 and up" });
  const grid = svgEl("g", { class: "grid axis" });
  for (const v of [0, max]) grid.append(svgEl("line", { x1: L, x2: W - R, y1: base - y(v), y2: base - y(v) }),
    svgEl("text", { x: L - 6, y: base - y(v) + 4, "text-anchor": "end" }, String(v)));
  svg.append(grid);
  const tip = el("div", { class: "tip", hidden: "" });
  // a segment with its top corners rounded 4px (data end), square at the baseline side
  const seg = (x0, top, hgt, round) => {
    const r = round ? Math.min(4, hgt, bw / 2) : 0;
    return "M" + x0 + " " + (top + hgt) + "V" + (top + r) + (r ? "Q" + x0 + " " + top + " " + (x0 + r) + " " + top : "") +
      "H" + (x0 + bw - r) + (r ? "Q" + (x0 + bw) + " " + top + " " + (x0 + bw) + " " + (top + r) : "") + "V" + (top + hgt) + "Z";
  };
  data.forEach((b, i) => {
    const x0 = L + i * step + (step - bw) / 2, hl = y(b.low), hh = y(b.high), gap = b.low && b.high ? 2 : 0;
    const g = svgEl("g", { tabindex: "0", "aria-label": fmtTime(ms(b), h.bucket) + ": " + b.low + " on tier 0–1, " + b.high + " on tier 2+" });
    g.append(svgEl("rect", { x: L + i * step, y: T, width: step, height: H - T - B, fill: "transparent" }));  // hit target
    if (b.low) g.append(svgEl("path", { d: seg(x0, base - hl, hl, !b.high), fill: LOW }));
    if (b.high) g.append(svgEl("path", { d: seg(x0, base - hl - gap - hh, hh, true), fill: HIGH }));
    const show = (cx, cy) => tipAt(box, tip, cx, cy, [[fmtTime(ms(b), h.bucket), "", null],
      [String(b.low), "tier 0–1", LOW], [String(b.high), "tier 2+", HIGH]]);
    g.addEventListener("pointermove", (e) => { const r = box.getBoundingClientRect(); show(e.clientX - r.left, e.clientY - r.top); });
    g.addEventListener("focus", () => show(box.clientWidth * (i + 0.5) / data.length, 40));
    g.addEventListener("pointerleave", () => { tip.hidden = true; }); g.addEventListener("blur", () => { tip.hidden = true; });
    svg.append(g);
  });
  const ends = [[0, "start"], [data.length - 1, "end"]].filter(([i], k) => k === 0 || i > 0);
  for (const [i, a] of ends) svg.append(svgEl("text", { class: "dlabel", x: L + i * step + (a === "start" ? 0 : step), y: H - 6, "text-anchor": a },
    fmtTime(ms(data[i]), h.bucket)));
  const low = data.reduce((n, b) => n + b.low, 0), all = data.reduce((n, b) => n + b.low + b.high, 0);
  box.append(el("div", { class: "hero" }, Math.round((h.low_share ?? 0) * 100) + "%"),
    el("div", { class: "meta", style: "margin:0 0 8px" }, low + " of " + all + " tasks ran on tier 0–1 (local or cheapest), last 14 days"),
    legend([["tier 0–1", LOW], ["tier 2+", HIGH]]), svg, tip,
    table([h.bucket === "day" ? "Day" : "Hour", "Tier 0–1", "Tier 2+"], data.map((b) => [fmtTime(ms(b), h.bucket), b.low, b.high])));
}
async function decide(pid, action) {
  if (action === "start" && !confirm("Approve " + pid + "? HiveMind moves it to Now and creates the branch improve/" + pid + ". Nothing is installed.")) return;
  try { await api("/api/improve", { pid, action }); load(); } catch (e) { showErr(e); }
}
// Phone only: ask about a project listed on the Mac. HiveMind reads it and never changes it.
function renderProjectPicker(list) {
  const sel = $("proj"), keep = sel.value || (() => { try { return localStorage.getItem("hivemind.proj") || ""; } catch (e) { return ""; } })();
  sel.hidden = !list.length;
  sel.replaceChildren(el("option", { value: "" }, "No project"),
    ...list.map((p) => el("option", { value: p.name }, p.name + " (read-only)")));
  sel.value = list.some((p) => p.name === keep) ? keep : "";
  optsLabel();
}
$("proj").onchange = () => { try { localStorage.setItem("hivemind.proj", $("proj").value); } catch (e) {} optsLabel(); };
$("cat").onchange = () => optsLabel();
// Phone: type, folder and project sit behind one button that says what is picked
function optsLabel() {
  const picks = [!$("proj").hidden && $("proj").value, $("cat").value, !$("cwd").hidden && $("cwd").value.trim()].filter(Boolean);
  $("optslabel").textContent = picks.length ? picks.join(" · ") : "Options";
}
$("cwd").addEventListener("input", optsLabel);
$("optsbtn").onclick = () => { const on = composer.classList.toggle("show-opts"); $("optsbtn").setAttribute("aria-expanded", String(on)); };
function renderPhone(p, projects) {
  const box = $("phone");
  if (box.dataset.pairing) return;  // keep a QR on screen until it is closed
  box.replaceChildren();
  if (!p || !p.host) {
    box.append(el("p", { class: "meta", style: "margin-top:0" }, "Not set up. Install Tailscale on this Mac and your iPhone, sign in on both, " +
      "then run `hivemind phone setup` in Terminal."));
    return;
  }
  box.append(el("p", { class: "meta", style: "margin-top:0" }, "Reachable only from your own devices at https://" + p.host),
    el("div", { class: "row-actions" }, el("button", { class: "btn primary", onclick: pairPhone }, "Pair iPhone")));
  for (const d of p.devices || []) {
    const seen = d.last_seen ? new Date(d.last_seen * 1000).toLocaleString() : "never";
    box.append(el("div", { class: "item fact" }, el("span", {}, d.name + " · last used " + seen),
      el("button", { class: "btn bad", "aria-label": "Remove " + d.name,
        onclick: async () => { await api("/api/phone/unpair", { id: d.id }).catch(showErr); load(); } }, "Remove")));
  }
  box.append(el("h3", { style: "margin:18px 0 4px" }, "Projects your phone can read"),
    el("p", { class: "meta", style: "margin-top:0" }, "Read-only: HiveMind answers questions about them from the phone and never changes files or runs commands there."));
  for (const pr of projects) {
    box.append(el("div", { class: "item fact" }, el("span", {}, pr.name + " · " + pr.path),
      el("button", { class: "btn bad", "aria-label": "Remove project " + pr.name,
        onclick: async () => { await api("/api/phone/projects", { action: "remove", name: pr.name }).catch(showErr); load(); } }, "Remove")));
  }
  const path = el("input", { class: "field", placeholder: "Folder, e.g. ~/moshi-and-pals", "aria-label": "Project folder" });
  box.append(el("div", { class: "inline-form" }, path, el("button", { class: "btn", onclick: async () => {
    try { await api("/api/phone/projects", { action: "add", path: path.value.trim() }); load(); } catch (e) { showErr(e); }
  } }, "Add")));
}
async function pairPhone() {
  try {
    const r = await api("/api/phone/pair", { name: "iPhone" });
    const box = $("phone"); box.dataset.pairing = "1"; box.replaceChildren();
    const done = el("button", { class: "btn", onclick: () => { delete box.dataset.pairing; load(); } }, "Done");
    box.append(el("p", { style: "margin-top:0" }, "Point your iPhone camera at this code and tap the link."),
      r.qr ? el("img", { src: r.qr, alt: "Pairing QR code", width: "220", height: "220",
                         style: "background:#fff;padding:12px;border-radius:8px;image-rendering:pixelated" }) : "",
      el("p", { class: "meta" }, "Then in Safari: Share › Add to Home Screen. The link is the key, so don't share it:"),
      el("code", { class: "key-url" }, r.url), el("div", { class: "row-actions" }, done));
  } catch (e) { showErr(e); }
}
async function load() {
  try { render(await api("/api/state")); showErr(null); }
  catch (e) { showErr(token ? e : new Error("Open this page from the link that `hivemind ui` prints, or pair this phone from the Mac dashboard's iPhone panel.")); }
}
let uploadDir = null, uploaded = [];
function showFiles() {
  const box = $("files"); box.replaceChildren();
  for (const n of uploaded) box.append(el("span", { class: "chip" }, icon("clip"), n));
  if (uploaded.length) box.append(el("button", { class: "btn ghost", style: "padding:2px 8px;font-size:13px",
    onclick: () => { uploadDir = null; uploaded = []; showFiles(); } }, "Clear files"));
  canSend();
}
async function upload(fileList) {
  for (const f of fileList) {
    const headers = { "X-HiveMind-Token": token, "X-File-Name": encodeURIComponent(f.name) };
    if (uploadDir) headers["X-Upload-Dir"] = uploadDir;
    try {
      const r = await fetch("/api/upload", { method: "POST", headers, body: f });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ("upload failed: HTTP " + r.status));
      uploadDir = data.dir; uploaded.push(data.name);
      if (!$("task").value.trim()) $("task").value = "Summarize " + uploaded.map((n) => '"' + n + '"').join(" and ");
    } catch (e) { showErr(e); }
  }
  showFiles(); grow();
}
const composer = $("composer"), chatView = $("view-chat");
chatView.addEventListener("dragover", (e) => { e.preventDefault(); composer.classList.add("drop"); });
chatView.addEventListener("dragleave", (e) => { if (!chatView.contains(e.relatedTarget)) composer.classList.remove("drop"); });
chatView.addEventListener("drop", (e) => { e.preventDefault(); composer.classList.remove("drop"); upload(e.dataTransfer.files); });
$("picker").onchange = (e) => { upload(e.target.files); e.target.value = ""; };
let searchTimer = null;
async function runSearch() {
  const q = $("q").value.trim(), box = $("hits");
  $("threads").hidden = !!q;
  box.replaceChildren();
  if (!q) return;
  let hits = [];
  try { hits = await api("/api/search?q=" + encodeURIComponent(q)); } catch (e) { showErr(e); return; }
  if (q !== $("q").value.trim()) return;  // a newer search is on its way
  if (!hits.length) { box.append(el("div", { class: "empty", style: "padding:8px" }, "Nothing matches.")); return; }
  box.append(el("div", { class: "group-label" }, hits.length + (hits.length === 1 ? " result" : " results")));
  for (const h of hits) {
    const open = h.kind === "thread" ? () => { showView("chat"); openThread(h.id); } : () => showTask(h.id);
    box.append(el("button", { class: "hit", onclick: open },
      el("div", { class: "t" }, (h.kind === "thread" ? "💬 " : "") + (h.title || h.id)),
      el("div", { class: "meta" }, ago(h.ts) + (h.kind === "thread" ? " · " + h.turns + (h.turns === 1 ? " message" : " messages") : "") + " · " + h.snippet)));
  }
}
$("q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
async function profileAct(body) {
  try { renderProfile(await api("/api/profile", body)); showErr(null); } catch (e) { showErr(e); }
}
function renderProfile(p) {
  badge("you-badge", p.suggested.length);
  $("suggested-card").hidden = !p.suggested.length;
  const sug = $("suggested"); sug.replaceChildren();
  for (const f of p.suggested) {
    sug.append(el("div", { class: "item" }, f.text, el("div", { class: "row-actions" },
      el("button", { class: "btn good", onclick: () => profileAct({ action: "keep", id: f.id }) }, "Keep"),
      el("button", { class: "btn", onclick: () => profileAct({ action: "dismiss", id: f.id }) }, "Dismiss"))));
  }
  const kept = $("facts"); kept.replaceChildren();
  if (!p.facts.length) kept.append(el("div", { class: "empty" }, "Nothing kept yet."));
  for (const f of p.facts) {
    kept.append(el("div", { class: "item fact" }, el("span", {}, f.text),
      el("button", { class: "btn ghost", "aria-label": "Forget: " + f.text, title: "Forget",
        onclick: () => profileAct({ action: "delete", id: f.id }) }, "×")));
  }
}
$("addfact").onclick = () => { const t = $("newfact").value.trim(); if (t) { $("newfact").value = ""; profileAct({ action: "add", text: t }); } };
$("newfact").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addfact").click(); });
function stepLine(e) {
  if (e.step === "route") return el("li", {}, "Route: " + e.line);
  if (e.step === "try") return el("li", {}, "Asking " + e.model + " (tier " + e.tier + ")…");
  if (e.step === "check") return el("li", {}, "Checking " + e.model + "'s answer…");
  if (e.step === "failed") return el("li", { class: "bad" }, "✗ " + e.model + ": " + e.reason);
  if (e.step === "handoff") return el("li", {}, "Needs " + e.reason + ": open it in an app below");
  return el("li", {}, e.step);
}
// Conversations: a follow-up sends the earlier turns along. threadId null = the next Run starts a new one.
let threadId = null, threadList = [];
function setThread(id, title) {
  threadId = id; threadTitle = id ? title || "" : "";
  $("task").placeholder = id ? "Ask a follow-up, e.g. make it shorter" : "Ask anything, or drop a file here";
  setTitle(); markActive();
  if (!id) HM.emit("newchat");
}
const shortModel = (m) => (m || "").replace(/^[^:]+:/, "").replace(/:free$/, "").replace(/^upstage\//, "");
function scrollDown() { const m = $("messages"); m.scrollTop = m.scrollHeight; }
// The avatar is the logo of the AI that answered; HiveMind's own logo only while no model is picked yet.
// Antigravity runs other companies' models, so the model name decides (antigravity:claude-* is Claude).
const AI_LOGOS = { claude: ["Claude", "ai-claude.png"], openai: ["ChatGPT", "ai-openai.png", "pad"],
                   gemini: ["Gemini", "ai-gemini.svg", "pad"], ollama: ["Ollama", "ai-ollama.png", "pad"],
                   nous: ["Hermes (Nous)", "ai-nous.png"] };
function aiFamily(m) {
  const [prov, name = ""] = (m || "").split(/:(.*)/);
  if (prov === "antigravity") return /^claude/.test(name) ? "claude" : /^(gpt|o\d)/.test(name) ? "openai" : "gemini";
  return { claude: "claude", codex: "openai", hermes: "nous", ollama: "ollama" }[prov] || null;
}
function setAiDot(dot, model, failed) {
  const logo = AI_LOGOS[aiFamily(model)];
  dot.className = "ai-dot" + (failed ? " fail" : logo ? " has-logo" : "");
  dot.title = logo ? logo[0] : "HiveMind";
  dot.replaceChildren(failed ? "!" : logo ? el("img", { src: "icons/" + logo[1], alt: "", class: logo[2] || "" }) : "");
}
function aiMessage(failed, who, body, actions, model) {
  const dot = el("div", { "aria-hidden": "true" });
  setAiDot(dot, model, failed);
  return el("div", { class: "msg-ai" }, dot, el("div", { class: "ai-body" }, who, body, actions || ""));
}
function showThread(t) {
  const box = $("convo"); box.replaceChildren();
  const turns = (t && t.turns) || [];
  $("welcome").hidden = !!turns.length || !!$("result").childNodes.length;
  for (const turn of turns) {
    const models = turn.models || [], last = models[models.length - 1];
    const brand = AI_LOGOS[aiFamily(last)];
    const who = el("div", { class: "who" }, el("b", {}, brand ? brand[0] : "HiveMind"),
      last ? el("span", { title: last }, shortModel(last)) : "",
      models.length > 1 ? el("span", { class: "tag warn", title: "Tried in order: " + models.join(" → ") }, "escalated ×" + (models.length - 1)) : "",
      turn.ok === false ? el("span", { class: "tag fail" }, "not verified") : "");
    const actions = el("div", { class: "ai-actions" },
      models.length ? rateButtons(turn.task_id, ratings[turn.task_id] || null) : "",
      el("button", { class: "btn ghost", title: "Copy answer", "aria-label": "Copy answer", onclick: (e) => {
        try { navigator.clipboard.writeText(turn.answer || ""); e.currentTarget.lastChild.textContent = "Copied"; } catch (err) {} } },
        icon("copy"), el("span", {}, isTouch ? "" : "Copy")),
      turn.task_id && models.length ? el("button", { class: "btn ghost", title: "How HiveMind got this answer", onclick: () => showTask(turn.task_id) },
        icon("info"), el("span", {}, isTouch ? "" : "Details")) : "",
      appButtons(turn.message));
    const ai = aiMessage(turn.ok === false, who, el("div", {}, turn.note ? el("div", { class: "note" }, turn.note) : "", md(turn.answer || "")), actions, last);
    box.append(el("div", { class: "msg-user" }, el("div", { class: "bubble" }, turn.message)), ai);
    HM.emit("message", { el: ai, role: "assistant", task_id: turn.task_id, text: turn.answer || "", turn });
  }
  scrollDown();
}
// Same links as hivemindcore/apps.py. Opening one is your click; HiveMind never sends by script (their terms forbid it).
// ChatGPT's link sends on open, Claude's only types the prompt, Gemini has none: paste (it's copied).
const APPS = { claude: ["Claude", "https://claude.ai/new?q=", "https://claude.ai/new"],
               chatgpt: ["ChatGPT", "https://chatgpt.com/?q=", "https://chatgpt.com/"],
               gemini: ["Gemini", null, "https://gemini.google.com/app"] };
function appLink(app, prompt) {
  const [, pre, home] = APPS[app];
  return pre && prompt.length <= 4000 ? pre + encodeURIComponent(prompt) : home;
}
function appButtons(prompt) {
  const menu = el("details", { class: "menu" });
  menu.append(el("summary", { class: "btn ghost", title: "Ask this in another app" }, icon("out"), el("span", {}, isTouch ? "" : "Open in…")),
    el("div", { class: "menu-list" }, el("div", { class: "meta" }, "Your prompt is copied too"),
      ...Object.keys(APPS).map((a) => el("button", {
        title: a === "chatgpt" ? "Opens ChatGPT and sends this prompt right away" : a === "gemini"
          ? "Opens Gemini; paste the prompt (already copied)" : "Opens Claude with this prompt typed in; you press send",
        onclick: () => {
          try { navigator.clipboard.writeText(prompt).catch(() => {}); } catch (e) {}
          window.open(appLink(a, prompt), "_blank", "noopener"); menu.open = false;
        } }, APPS[a][0]))));
  return menu;
}
document.addEventListener("click", (e) => { for (const m of document.querySelectorAll("details.menu[open]")) if (!m.contains(e.target)) m.open = false; });
async function openThread(id) {
  try { const t = await api("/api/thread?id=" + encodeURIComponent(id)); setThread(t.id, t.title); showThread(t); }
  catch (e) { setThread(null); showThread(null); }
  document.body.classList.remove("side-open");
}
function markActive() { for (const b of document.querySelectorAll(".thread-btn")) b.classList.toggle("active", b.dataset.id === threadId); }
async function listThreads() {
  try { threadList = await api("/api/threads"); } catch (e) { return; }
  const box = $("threads"); box.replaceChildren();
  if (!threadList.length) { box.append(el("div", { class: "empty", style: "padding:12px 8px;font-size:13px" }, "Your conversations will show up here.")); return; }
  const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
  let group = null;
  for (const t of threadList) {
    const d = t.updated ? new Date(t.updated).toDateString() : "";
    const g = d === today ? "Today" : d === yest ? "Yesterday" : "Earlier";
    if (g !== group) { box.append(el("div", { class: "group-label" }, g)); group = g; }
    box.append(el("div", { class: "thread-row" },
      el("button", { class: "thread-btn", "data-id": t.id, title: (t.title || t.id) + " · " + t.turns + (t.turns === 1 ? " message" : " messages"),
        onclick: () => { showView("chat"); openThread(t.id); } }, t.title || t.id),
      el("button", { class: "thread-del", "aria-label": "Remove chat: " + (t.title || t.id), title: "Remove chat",
        onclick: () => removeChat(t.id, t.title) }, icon("trash"))));
  }
  markActive();
}
$("topnew").onclick = () => $("newconvo").click();
async function removeChat(id, title) {
  if (!confirm("Remove \u201c" + (title || "this chat") + "\u201d? Its messages and answers are gone for good.")) return;
  try {
    await api("/api/thread/delete", { id });
    if (id === threadId) { setThread(null); $("result").replaceChildren(); showThread(null); }
    listThreads(); load(); showErr(null);
  } catch (e) { showErr(e); }
}
$("delchat").onclick = () => { if (threadId) removeChat(threadId, threadTitle); };
$("clearall").onclick = async () => {
  if (!confirm("Clear every chat, saved answer and dropped file? This can't be undone. Model scores are kept.")) return;
  try {
    const r = await api("/api/history/clear", { confirm: "delete everything" });
    setThread(null); $("result").replaceChildren(); showThread(null); listThreads(); load();
    alert("Cleared " + r.threads + " chats and " + r.answers + " saved answers.");
  } catch (e) { showErr(e); }
};
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.body.classList.remove("side-open");
  for (const m of document.querySelectorAll("details.menu[open]")) m.open = false;
});
// Phone: swipe right from the left edge opens the sidebar, swipe left closes it
let swipe = null;
document.addEventListener("touchstart", (e) => { const t = e.touches[0];
  swipe = (t.clientX < 28 || document.body.classList.contains("side-open")) ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!swipe) return; const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = Math.abs(t.clientY - swipe.y); swipe = null;
  if (dy > 60) return;
  if (dx > 60) document.body.classList.add("side-open"); else if (dx < -60) document.body.classList.remove("side-open");
}, { passive: true });
$("newconvo").onclick = () => { showView("chat"); setThread(null); $("result").replaceChildren(); showThread(null); $("task").focus(); };
for (const b of document.querySelectorAll(".idea")) b.onclick = () => { $("task").value = b.dataset.idea; grow(); $("task").focus(); };
function grow() { const t = $("task"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; canSend(); }
let running = false;
function canSend() { $("run").disabled = running || !$("task").value.trim(); }
$("task").addEventListener("input", grow);
// One plain line for what is happening now; the full step list folds away under it
function statusText(ev) {
  const e = ev[ev.length - 1];
  if (!e) return "Starting…";
  if (e.step === "route") return "Choosing a model…";
  if (e.step === "try") return "Asking " + shortModel(e.model) + "…";
  if (e.step === "check") return "Checking the answer…";
  if (e.step === "failed") return shortModel(e.model) + "'s answer didn't pass the check. Trying the next model…";
  if (e.step === "handoff") return "This needs another app. Opening options…";
  return "Working…";
}
// The wait survives the phone locking or Safari going to the background: the job id is kept and polled again.
const PENDING = "hivemind.pending";
function savePending(p) { try { p ? localStorage.setItem(PENDING, JSON.stringify(p)) : localStorage.removeItem(PENDING); } catch (e) {} }
function loadPending() { try { const p = JSON.parse(localStorage.getItem(PENDING) || "null");
  return p && Date.now() - p.t0 < 3600e3 ? p : null; } catch (e) { return null; } }
function scrollToLastQuestion() {
  const m = $("messages"), q = [...document.querySelectorAll("#convo .msg-user")].pop();
  if (q) m.scrollTop = q.offsetTop - m.offsetTop - 8; else scrollDown();
}
async function waitJob(p) {
  running = true; canSend();
  $("welcome").hidden = true;
  const status = el("span", {}, "Starting…"), clock = el("span", { class: "clock", "aria-hidden": "true" }, "");  // a screen reader would read every second
  const line = el("div", { class: "status", role: "status" }, el("span", { class: "typing", "aria-hidden": "true" }, el("span"), el("span"), el("span")), status, clock);
  const steps = el("ul", { class: "steps" }), how = el("details", { class: "how" }, el("summary", {}, "Show steps"), steps);
  const ask = canPush && isTouch && Notification.permission === "default" &&  // one tap, right when a wait starts
    el("button", { class: "btn ghost notify-ask", onclick: (e) => { e.currentTarget.remove(); pushOn(); } }, "Notify me when it's ready");
  const whoName = el("b", {}, "HiveMind"), draft = el("div", { class: "draft", "aria-live": "off" }),
    pendingMsg = aiMessage(false, el("div", { class: "who" }, whoName), el("div", {}, line, draft, how, ask || ""));
  $("result").replaceChildren(el("div", { class: "msg-user" }, el("div", { class: "bubble" }, p.task)), pendingMsg);
  scrollDown();
  const tick = setInterval(() => { clock.textContent = Math.round((Date.now() - p.t0) / 1000) + " s"; }, 1000);
  let misses = 0;
  try {
    for (;;) {
      let job;
      try { job = await api("/api/job?id=" + p.job_id); misses = 0; line.classList.remove("retry"); }
      catch (e) {
        if (/unknown job/.test(e.message)) { job = null; }
        else if (++misses <= 40) { line.classList.add("retry"); status.textContent = "Connection lost. Retrying…";
          await new Promise((r) => setTimeout(r, 3000)); continue; }
        else throw e;
      }
      if (!job) {  // the dashboard restarted or the job expired; the answer, if any, is in the conversation
        savePending(null); $("result").replaceChildren();
        if (p.thread_id) await openThread(p.thread_id); else showThread(null);
        showErr(new Error("Lost track of that request. If no answer shows, send it again."));
        if (!$("task").value) $("task").value = p.task; grow(); break;
      }
      const n = steps.childNodes.length;
      steps.replaceChildren(...job.events.map(stepLine));
      how.firstChild.textContent = "Show steps (" + job.events.length + ")";
      const said = statusText(job.events);  // unchanged text left alone: rewriting it re-announces it every poll
      if (!line.classList.contains("retry") && status.textContent !== said) status.textContent = said;
      const asking = [...job.events].reverse().find((e) => e.step === "try");  // swap to the logo of the AI asked now
      if (asking) { setAiDot(pendingMsg.firstChild, asking.model); whoName.textContent = (AI_LOGOS[aiFamily(asking.model)] || ["HiveMind"])[0]; }
      // The answer as it is written; it is checked once finished, and a failed check clears it for the next model.
      const m = $("messages"), atEnd = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
      const text = (job.draft && job.draft.text) || "";
      if (text !== draft.dataset.text) { draft.dataset.text = text; draft.replaceChildren(text ? md(text) : ""); if (atEnd) scrollDown(); }
      if (steps.childNodes.length !== n && how.open) scrollDown();
      if (job.done) {
        savePending(null);
        const out = job.result;
        if (out.error) throw new Error(out.text);
        $("result").replaceChildren();
        await openThread(out.thread_id);
        scrollToLastQuestion();
        // the one announcement per answer: #convo isn't a live region, since redrawing it would read the whole thread
        $("announce").textContent = (out.ok === false ? "Answer ready, but the checker objected. From " : "Answer ready from ") + whoName.textContent;
        if (document.hidden) document.title = "✓ Answer ready · HiveMind";
        listThreads(); load();
        break;
      }
      await new Promise((r) => setTimeout(r, document.hidden ? 2500 : job.draft ? 350 : 700));
    }
  } catch (e) {
    savePending(null); $("result").replaceChildren();
    if (!$("task").value) $("task").value = p.task; grow(); showErr(e);
    if (threadId) openThread(threadId); else showThread(null);
  } finally { clearInterval(tick); running = false; canSend(); }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.title = "HiveMind"; });
$("run").onclick = async () => {
  const task = $("task").value.trim();
  if (!task || running) return;
  running = true; canSend(); showErr(null);
  $("task").value = ""; grow(); composer.classList.remove("show-opts");
  try {
    const { job_id } = await api("/api/run", { task, category: $("cat").value, cwd: $("cwd").value.trim(), async: true,
                                               project: $("proj").hidden ? undefined : $("proj").value || undefined,
                                               upload_dir: uploadDir || undefined, thread_id: threadId || undefined,
                                               fresh: HM.takeFresh() || undefined, template_id: HM.templateId(task) });
    const p = { job_id, task, t0: Date.now(), thread_id: threadId };
    savePending(p);
    await waitJob(p);
  } catch (e) { running = false; canSend(); $("task").value = task; grow(); showErr(e); }
};
$("task").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  if (e.metaKey || e.ctrlKey || (!e.shiftKey && !isTouch)) { e.preventDefault(); $("run").click(); }
});
// Opening HiveMind starts a new chat (Noah 2026-10-31); only an answer still on its way brings back its chat.
showView("chat");
const pending = loadPending();
if (pending && pending.thread_id) openThread(pending.thread_id).then(() => waitJob(pending));
else { setThread(null); showThread(null); if (pending) waitJob(pending); }
// iOS keeps the Home Screen app in memory, so coming back after a while counts as opening it again.
const FRESH_AFTER_MS = 10 * 60e3;
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > FRESH_AFTER_MS && !running && !$("task").value.trim()) {
    showView("chat"); setThread(null); $("result").replaceChildren(); showThread(null); listThreads();
  }
});
listThreads();
load();
setInterval(() => { load(); if (!running) listThreads(); }, 20000);
