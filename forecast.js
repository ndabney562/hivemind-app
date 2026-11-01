// P-5: under each quota meter, about how many more tasks fit before routing stops at the floor, and when it resets.
(() => {
  const when = (t) => new Date(t * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  HM.on("state", (s) => {
    const fc = s.forecast || {};
    for (const m of document.querySelectorAll("#quota .meter[data-key]")) {
      m.querySelector(".fc")?.remove();
      const key = m.dataset.key, f = fc[key];
      const text = !(key in fc) ? (/free/.test(key) ? "free · no meter" : "")
        : f ? "~" + f.tasks + " task" + (f.tasks === 1 ? "" : "s") + (f.reset_at ? " · resets " + when(f.reset_at) : "")
        : "not enough data";
      if (text) {
        const d = document.createElement("div");
        d.className = "fc"; d.style.cssText = "font-size:12px;color:var(--muted);margin-top:2px";
        d.textContent = text;
        m.append(d);
      }
    }
  });
})();
