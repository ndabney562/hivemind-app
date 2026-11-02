// P-8: saved prompts. Chips above an empty chat (and a picker under Options) fill the box with the blank
// selected; "Save as template" under each answer keeps its question; Settings → Templates renames and deletes.
const blankRange = (text) => { const i = text.indexOf("___"); return i >= 0 ? [i, i + 3] : [text.length, text.length]; };
// The template id when the sent text still starts from it: everything around the blank unchanged (P-8 metric).
const fromTemplate = (t, sent) => {
  if (!t) return undefined;
  const v = (sent || "").trim(), [a, b] = blankRange(t.text), pre = t.text.slice(0, a).trim(), post = t.text.slice(b).trim();
  if (!v || (!pre && !post)) return undefined;  // a template that is only the blank would match anything
  return v.startsWith(pre) && v.endsWith(post) && v.length >= pre.length + post.length ? t.id : undefined;
};
(() => {
  let list = [], used = null;  // used: the template the box was filled from, until the text stops matching it
  const $ = (id) => document.getElementById(id);
  const mk = (tag, attrs, text) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (text) e.textContent = text; return e; };
  const fill = (t) => {
    HM.fillComposer(t.text, blankRange(t.text));
    used = t;
  };
  HM.templateId = (sent) => { const t = used; used = null; return fromTemplate(t, sent); };
  const row = mk("div", { className: "tpl-row", ariaLabel: "Templates" });
  const pick = mk("select", { className: "pick", ariaLabel: "Template" });
  function draw() {
    row.replaceChildren(...list.map((t) => {
      const b = mk("button", { type: "button", className: "tpl-chip", title: t.text }, t.name);
      b.onclick = () => fill(t);
      return b;
    }));
    pick.replaceChildren(mk("option", { value: "" }, "Template…"), ...list.map((t) => mk("option", { value: t.id }, t.name)));
    drawSettings();
  }
  pick.onchange = () => { const t = list.find((x) => x.id === pick.value); pick.value = ""; if (t) fill(t); };
  // #result holds the question being answered right now: the chips go as soon as it is sent (review 2026-11-01)
  const empty = () => ["convo", "result"].every((id) => !$(id) || !$(id).childNodes.length);
  const showRow = () => { row.hidden = !list.length || !empty(); };
  async function load() {
    try { list = (await HM.api("/api/templates")).templates || []; } catch (e) { return; }
    draw(); showRow();
  }
  async function act(body) {  // true when the Mac saved it
    try { list = (await HM.api("/api/templates", body)).templates || list; draw(); showRow(); return true; }
    catch (e) { alert(e.message || String(e)); return false; }
  }
  // Settings → Templates
  const card = mk("div", { className: "card", id: "tpl-card" });
  function drawSettings() {
    card.replaceChildren(mk("h3", {}, "Templates"),
      mk("p", { className: "lead" }, "Tap one above an empty chat to fill the box. ___ is the blank you type over."),
      ...list.map((t) => {
        const line = mk("div");
        line.style.cssText = "display:flex;gap:8px;align-items:center;margin:6px 0";
        const name = mk("span", { title: t.text }, t.name);
        name.style.flex = "1";
        const rn = mk("button", { type: "button", className: "btn ghost" }, "Rename");
        rn.onclick = () => { const n = prompt("Template name", t.name); if (n && n.trim()) act({ action: "rename", id: t.id, name: n.trim() }); };
        const del = mk("button", { type: "button", className: "btn ghost" }, "Delete");
        del.onclick = () => { if (confirm("Delete the template “" + t.name + "”?")) act({ action: "delete", id: t.id }); };
        line.append(name, rn, del);
        return line;
      }));
  }
  HM.on("view:settings", () => {
    const inner = document.querySelector("#view-settings .page-inner");
    if (inner && !card.isConnected) inner.append(card);
  });
  HM.on("newchat", () => setTimeout(showRow, 0));  // the page empties the chat just after this event
  HM.on("state", () => { if (!list.length) load(); });  // the first load can run before the page has its token
  HM.on("message", ({ el, turn }) => {
    showRow();
    const actions = el.querySelector(".ai-actions");
    if (!actions || !turn || !turn.message || actions.querySelector(".tpl-save")) return;
    const b = mk("button", { type: "button", className: "btn ghost tpl-save", title: "Save this question as a template" }, "Save as template");
    b.onclick = () => {
      const text = turn.message.trim().slice(0, 2000);
      act({ action: "add", name: text.split("\n")[0].slice(0, 40), text }).then((ok) => { if (ok) { b.textContent = "Saved"; b.disabled = true; } });
    };
    actions.append(b);
  });
  for (const id of ["convo", "result"]) if ($(id)) new MutationObserver(showRow).observe($(id), { childList: true });
  const composer = $("composer");
  if (composer) composer.prepend(row);
  if ($("opts")) $("opts").append(pick);
  load();
})();
