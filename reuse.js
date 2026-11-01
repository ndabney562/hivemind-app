// P-6: an answer HiveMind already had (same question, same folder, last 7 days) says so, with a way to ask again.
(() => {
  const when = (t) => new Date(t * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  HM.on("message", ({ el, turn }) => {
    if (!turn || !turn.reused || el.querySelector(".reused")) return;
    const note = document.createElement("div");
    note.className = "note reused";
    note.textContent = "You asked this " + when(turn.reused.ts) + " — saved answer below, no quota spent. ";
    const again = document.createElement("button");
    again.className = "btn ghost"; again.type = "button"; again.textContent = "Run again anyway";
    again.onclick = () => {
      HM.fresh = true;
      HM.fillComposer(turn.message);
      document.getElementById("run").click();
    };
    note.append(again);
    (el.querySelector(".ai-body")?.children[1] || el).prepend(note);  // above the answer, under the name
  });
})();
