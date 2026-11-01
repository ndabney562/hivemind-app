// About you, automatically (Noah 2026-11-01): a one-time start page, and a "Learned: … · Undo" line under the answer
// a fact came from. Sensitive facts (health, money, relationships…) still wait for a Keep on the About you page.
(() => {
  let profile = null, asked = false;
  const mk = (tag, attrs, text) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (text) e.textContent = text; return e; };
  const show = (p) => { profile = p; if (typeof renderProfile === "function") renderProfile(p); fillAll(); };
  async function act(body) {
    try { show(await HM.api("/api/profile", body)); return true; } catch (e) { if (typeof showErr === "function") showErr(e); return false; }
  }

  function fill(box) {
    const id = box.dataset.task, p = profile;
    if (!p) return;
    const kept = p.facts.filter((f) => f.auto && f.source === id), waiting = p.suggested.filter((f) => f.source === id);
    box.replaceChildren();
    box.hidden = !kept.length && !waiting.length;
    for (const f of kept) {
      const undo = mk("button", { type: "button", className: "btn ghost", title: "Forget this and don't learn it again" }, "Undo");
      undo.style.cssText = "min-height:32px;padding:2px 10px;margin-left:6px";
      undo.onclick = () => act({ action: "undo", id: f.id });
      box.append(mk("div", {}, "Learned: " + f.text), undo);
    }
    if (waiting.length) {
      const go = mk("button", { type: "button", className: "btn ghost" },
        waiting.length + (waiting.length === 1 ? " private fact waits" : " private facts wait") + " for your OK on About you");
      go.style.cssText = "min-height:32px;padding:2px 10px";
      go.onclick = () => document.querySelector('.nav-btn[data-view="you"]')?.click();
      box.append(go);
    }
  }
  const fillAll = () => document.querySelectorAll(".learned[data-task]").forEach(fill);

  HM.on("message", ({ el, task_id, turn }) => {
    if (!task_id || el.querySelector(".learned")) return;
    const box = mk("div", { className: "learned", hidden: true });
    box.dataset.task = task_id;
    box.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:13px;color:var(--muted);margin:6px 0";
    (el.querySelector(".ai-body") || el).append(box);
    fill(box);
    // learning runs on the Mac's local model after the answer: look again while it may still be working
    const age = turn && turn.ts ? Date.now() - new Date(turn.ts).getTime() : 0;
    if (age < 120000) for (const ms of [4000, 12000, 30000]) setTimeout(async () => {
      try { show(await HM.api("/api/profile")); } catch (e) {}
    }, ms);
  });

  function welcome() {
    const d = mk("dialog", { id: "welcome-dialog" });
    d.setAttribute("aria-labelledby", "welcome-title");
    const field = (id, label, ph) => {
      const input = mk("input", { id, className: "field", placeholder: ph, maxLength: 200 });
      input.style.cssText = "width:100%;margin:4px 0 12px";
      return [mk("label", { htmlFor: id }, label), input];
    };
    const style = mk("select", { id: "welcome-style", className: "pick" });
    style.append(mk("option", { value: "" }, "No preference"), mk("option", { value: "short" }, "Short"),
      mk("option", { value: "detailed" }, "Detailed"));
    style.style.cssText = "margin:4px 0 16px;min-height:44px";
    const save = mk("button", { type: "button", className: "btn good" }, "Save");
    const skip = mk("button", { type: "button", className: "btn ghost" }, "Skip");
    for (const b of [save, skip]) b.style.minHeight = "44px";
    const val = (id) => d.querySelector("#" + id).value.trim();
    d.addEventListener("close", () => d.remove());  // Esc or back closes it too: the button must be able to reopen it
    const done = () => d.close();
    save.onclick = async () => {
      if (await act({ action: "welcome", name: val("welcome-name"), does: val("welcome-does"), goals: val("welcome-goals"), style: style.value })) done();
    };
    skip.onclick = async () => { if (await act({ action: "welcome" })) done(); };
    const row = mk("div"); row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    row.append(skip, save);
    d.append(mk("h3", { id: "welcome-title" }, "Welcome to HiveMind"),
      mk("p", { className: "lead" }, "A few basics so answers fit you. Every question is optional. After this, HiveMind learns from your messages by itself, and you can undo anything."),
      ...field("welcome-name", "Your name", "e.g. Alex"),
      ...field("welcome-does", "What you do", "e.g. College student, history and CS"),
      ...field("welcome-goals", "What you're working toward", "e.g. Ship my iOS game"),
      mk("label", { htmlFor: "welcome-style" }, "Answers"), mk("br"), style, row);
    document.body.append(d);
    d.showModal();
    document.activeElement?.blur?.();  // on a phone the keyboard would cover Save and Skip
  }
  const maybeWelcome = (p) => { if (p && !p.welcomed && !asked) { asked = true; welcome(); } };

  // About you: a way back to the start page until it is answered
  const again = mk("button", { type: "button", className: "btn good", hidden: true }, "Fill in the basics");
  again.style.cssText = "min-height:44px;margin:0 0 16px";
  again.onclick = () => { if (!document.getElementById("welcome-dialog")) welcome(); };
  document.querySelector("#view-you .lead")?.after(again);

  HM.on("state", (s) => {
    if (!s.profile) return;
    profile = s.profile;
    fillAll();
    again.hidden = !!s.profile.welcomed;
    maybeWelcome(s.profile);
  });
  // A slow phone link can deliver the first state before this script runs (live 2026-11-01): ask once ourselves.
  HM.api("/api/profile").then((p) => { if (!profile) profile = p; again.hidden = !!p.welcomed; maybeWelcome(p); }).catch(() => {});
})();
