// P-7: "Compare 2 models" under Options. Both answers side by side (stacked on a phone), no judge: your pick is
// the check, saved as ratings for both, and the picked answer (A when both) continues the chat.
// An unpicked compare is kept in this browser until you pick, so a reload, the push tap or the 10-minute
// fresh chat never strands two answers you already spent quota on.
(() => {
  const KEY = "hivemind.compare";
  const $ = (id) => document.getElementById(id);
  const mk = (tag, attrs, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); e.append(...kids); return e; };
  const save = (c) => { try { c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY); } catch (e) {} };
  const saved = () => { try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); return c && Date.now() - c.t0 < 7 * 86400e3 ? c : null; } catch (e) { return null; } };
  const box = mk("input", { type: "checkbox", id: "cmp" });
  const label = mk("label", { className: "pick", title: "Ask the top 2 models at once and pick the better answer" }, box, " Compare 2 models");
  label.style.cssText = "display:inline-flex;align-items:center;gap:6px;min-height:44px;cursor:pointer;white-space:nowrap";
  const cost = mk("div", { className: "hint", ariaLive: "polite" });
  cost.style.cssText = "margin:0 0 6px";
  cost.hidden = true;
  const project = () => !$("proj").hidden && $("proj").value;
  let reqNo = 0, busy = false;
  async function showPair() {
    if (!box.checked) { cost.hidden = true; return; }
    const n = ++reqNo, q = new URLSearchParams({ task: $("task").value.trim() || "?", category: $("cat").value, cwd: $("cwd").value.trim(),
      followup: typeof threadId !== "undefined" && threadId ? "1" : "" });
    try {
      const p = await HM.api("/api/compare/pair?" + q);
      if (n !== reqNo) return;
      if (p.reason) { box.checked = false; cost.textContent = "Can't compare: " + p.reason; }
      else cost.textContent = p.models.join(" + ") + " · " + p.cost;
      cost.hidden = false;
    } catch (e) { cost.textContent = String(e.message || e); cost.hidden = false; }
  }
  box.onchange = showPair;
  HM.on("newchat", () => {
    box.checked = false; cost.hidden = true;
    setTimeout(() => { if (saved() && !busy) resume(); }, 0);  // the page clears the chat just after this event
  });

  function column(a, letter) {
    const body = typeof md === "function" ? md(a.text || "") : mk("div", { textContent: a.text || "" });
    const col = mk("div", { className: "card" + (a.ok ? "" : " fail") },
      mk("div", { className: "who" }, mk("b", { textContent: letter + " · " + a.model })), body);
    col.style.cssText = "min-width:0;overflow-wrap:anywhere";
    return col;
  }
  function show(c) {
    const res = c.result;
    $("welcome").hidden = true;
    const grid = mk("div", { className: "cmp-grid" }, column(res.answers[0], "A"), column(res.answers[1], "B"));
    grid.style.cssText = "display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))";
    const pickRow = mk("div", { className: "ai-actions" });
    pickRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px";
    for (const [choice, text] of [["a", "A is better"], ["b", "B is better"], ["both_good", "Both good"], ["both_bad", "Both bad"]]) {
      const b = mk("button", { type: "button", className: "btn ghost", textContent: text });
      b.style.minHeight = "44px";
      b.onclick = async () => {
        for (const x of pickRow.querySelectorAll("button")) x.disabled = true;
        try {
          const out = await HM.api("/api/compare/pick", { compare_id: res.compare_id, choice, thread_id: c.thread_id || undefined });
          save(null);
          $("result").replaceChildren();
          await openThread(out.thread_id);
          listThreads();
        } catch (e) { showErr(e); for (const x of pickRow.querySelectorAll("button")) x.disabled = false; }
      };
      pickRow.append(b);
    }
    $("result").replaceChildren(mk("div", { className: "msg-user" }, mk("div", { className: "bubble", textContent: c.task })),
                                mk("div", {}, grid, pickRow));
    scrollDown();
  }
  async function resume() {
    const c = saved();
    if (!c) return;
    if (c.result) return show(c);
    busy = true; running = true; canSend();
    $("welcome").hidden = true;
    const status = mk("div", { className: "status", role: "status", textContent: "Asking 2 models…" });
    $("result").replaceChildren(mk("div", { className: "msg-user" }, mk("div", { className: "bubble", textContent: c.task })), status);
    scrollDown();
    let misses = 0;
    try {
      for (;;) {
        let st;
        try { st = await HM.api("/api/job?id=" + c.job_id); misses = 0; }
        catch (e) {
          if (/unknown job/.test(e.message)) { save(null); throw new Error("Lost track of that compare (HiveMind restarted). Send it again."); }
          if (++misses > 40) throw e;
          status.textContent = "Connection lost. Retrying…";
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (st.done) {
          if (!st.result || !st.result.answers) { save(null); throw new Error((st.result && (st.result.error || st.result.text)) || "compare failed"); }
          c.result = st.result;
          save(c);
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      show(c);
    } catch (e) {
      status.textContent = "Compare failed: " + (e.message || e); showErr(e);
      if (!$("task").value) { $("task").value = c.task; grow(); }
    } finally { busy = false; running = false; canSend(); }
  }
  async function start(task) {
    if (project()) { showErr(new Error("Compare doesn't work with a project: pick No project, or turn Compare off.")); return; }
    $("task").value = ""; grow();
    try {
      const { job_id } = await HM.api("/api/compare", { task, category: $("cat").value, cwd: $("cwd").value.trim(),
        upload_dir: uploadDir || undefined, thread_id: threadId || undefined, async: true });
      uploadDir = null; uploaded = []; if (typeof showFiles === "function") showFiles();
      save({ job_id, task, thread_id: threadId, t0: Date.now() });
      await resume();
    } catch (e) { showErr(e); $("task").value = task; grow(); }
  }
  // While the switch is on, Send compares instead of running the normal cascade.
  $("run").addEventListener("click", (e) => {
    const task = $("task").value.trim();
    if (!box.checked || !task || running) return;
    e.preventDefault(); e.stopImmediatePropagation();
    start(task);
  }, true);
  if ($("opts")) $("opts").append(label);
  const composer = $("composer");
  if (composer) composer.prepend(cost);
  resume();
})();
