// P-4: under the Scoreboard, how often the judge's pass/fail matched your Good/Bad rating, per task type.
(() => {
  HM.on("state", (s) => {
    const card = document.getElementById("score")?.closest(".card");
    if (!card) return;
    card.querySelector(".agree")?.remove();
    const a = s.agreement || {}, cats = Object.keys(a).sort();
    if (!cats.length) return;
    const d = document.createElement("p");
    d.className = "agree"; d.style.cssText = "font-size:13px;color:var(--muted);margin:8px 0 0";
    d.textContent = "Judge agrees with you: " + cats.map((c) => c + " " + a[c].agree + "/" + a[c].n).join(" · ");
    card.append(d);
  });
})();
