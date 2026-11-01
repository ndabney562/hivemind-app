// HiveMind service worker. The Mac sends an empty push (hivemindcore/push.py): no text passes through the push
// service. On a push this fetches the text from the Mac (/api/notices/latest, with the token the page saved in
// IndexedDB): "Your answer is ready", or an alert such as "Claude is logged out". Any failure shows a generic line.
// It also keeps the app shell (page, scripts, icons) so the app opens with the Mac off (phone-only mode). Network
// first, so a running Mac always serves fresh files; /api/* is never cached.
const SHELL_CACHE = "hivemind-shell-v1";
// Relative to this script, so the friend copy works under a GitHub Pages subpath too.
const SHELL = ["./", "manifest.webmanifest", "hm.js", "forecast.js", "judge.js", "reuse.js", "templates.js", "compare.js",
               "profile.js", "phone.js", "setup.js", "icons/icon-180.png", "icons/icon-192.png?v=2", "icons/icon-512.png?v=2"];
const BASE = new URL("./", self.location.href);
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname) ||
      url.pathname.startsWith(BASE.pathname + "api/")) return;
  const key = url.pathname === BASE.pathname || url.pathname === BASE.pathname + "index.html" ? BASE.pathname : e.request;
  e.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), 3000);
      const r = await fetch(e.request, { signal: stop.signal });
      clearTimeout(timer);
      if (r.ok) cache.put(key, r.clone());
      return r;
    } catch (err) {
      return (await cache.match(key, { ignoreSearch: true })) || Response.error();
    }
  })());
});
function savedToken() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("hivemind", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("auth");
      open.onsuccess = () => {
        try {
          const req = open.result.transaction("auth").objectStore("auth").get("token");
          req.onsuccess = () => resolve(req.result || "");
          req.onerror = () => resolve("");
        } catch (e) { resolve(""); }
      };
      open.onerror = () => resolve("");
    } catch (e) { resolve(""); }
  });
}
async function latestText() {
  try {
    // the phone may not reach the Mac (Tailscale half up, Mac asleep): show the fallback before iOS gives up on us
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 4000);
    const r = await fetch("/api/notices/latest", { headers: { "X-HiveMind-Token": await savedToken() }, signal: stop.signal });
    const n = r.ok ? await r.json() : {};
    return n && n.text ? [n.text, n.kind || "notice"] : ["HiveMind needs you", "notice"];
  } catch (e) { return ["HiveMind needs you", "notice"]; }
}
self.addEventListener("push", (e) => {
  e.waitUntil(latestText().then(([body, tag]) => self.registration.showNotification("HiveMind", {
    body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag })));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow(BASE.href);
  }));
});
