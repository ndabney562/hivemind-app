// HM: the seam between index.html and the feature scripts loaded after it (forecast.js, …), so new features
// live in their own small files instead of growing index.html (Noah 2026-10-31).
// Events: "state" (the /api/state JSON after each refresh), "message" ({el, role, task_id, text, turn} after an
// answer renders), "newchat", "view:<name>" (the page element when a page opens).
// The service worker can't read localStorage, so the page keeps the token in IndexedDB for it (P-5 alerts).
// The friend copy (served anywhere but this Mac or its tailnet, e.g. GitHub Pages) has no Mac: it stays in phone
// mode and no /api request ever leaves the page (spec: sharing with friends).
const HM_NO_MAC = typeof location !== "undefined" && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname) &&
  !/\.ts\.net$/.test(location.hostname);
if (HM_NO_MAC) {
  const netFetch = window.fetch.bind(window);
  window.fetch = (input, init) => /^\/?api\//.test(String(input && input.url || input).replace(location.origin || "", ""))
    ? Promise.reject(new TypeError("no Mac in the friend copy")) : netFetch(input, init);
}
function hmIdb(fn) {
  try {
    const open = indexedDB.open("hivemind", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("auth");
    open.onsuccess = () => { try { fn(open.result.transaction("auth", "readwrite").objectStore("auth")); } catch (e) {} };
  } catch (e) {}
}
window.HM = (() => {
  const handlers = {};
  return {
    on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
    emit(event, data) {
      for (const fn of handlers[event] || []) {
        try { fn(data); } catch (e) { console.error("HM " + event, e); }  // a feature must never break the page
      }
    },
    api(path, body) { return window.api(path, body); },  // index.html's api(): adds the token
    noMac: HM_NO_MAC,
    // P-22: in the friend copy, "No HiveMind Phone Shortcut yet?" opens the setup page with the signed Shortcut
    shortcutLink: HM_NO_MAC ? "get.html#shortcut" : undefined,
    fresh: false,  // reuse.js: the next send skips HiveMind's saved answer (P-6)
    takeFresh() { const f = this.fresh; this.fresh = false; return f; },
    templateId(sent) { return undefined; },  // templates.js: the template the message was started from (P-8)
    fillComposer(text, select) {
      const t = document.getElementById("task");
      t.value = text;
      t.dispatchEvent(new Event("input", { bubbles: true }));
      t.focus();
      if (select) t.setSelectionRange(select[0], select[1]);
    },
  };
})();
HM.on("state", () => { if (typeof token === "string" && token) hmIdb((st) => st.put(token, "token")); });
