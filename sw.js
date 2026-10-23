// Keeps the app working with no internet: the page, icons and the Excel library are stored on the device.
const CACHE = "raihana-erp-v1", NOTES = "raihana-notes";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== NOTES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // sync always goes to the network
  // page: network first so updates arrive, cached copy when offline. Everything else: cache first.
  if (req.mode === "navigate"){ e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", cp)); return r; }).catch(() => caches.match("./index.html"))); return; }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok && (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdnjs/.test(url.hostname))){ const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; })));
});
// the day's stock list (shortage list and batches to sell first), saved by the app at its last use. Chrome on Android
// wakes the installed app about once a day for this, even when it is closed. Other phones get it when the app opens
self.addEventListener("periodicsync", e => { if (e.tag !== "raihana-daily") return;
  e.waitUntil(caches.open(NOTES).then(c => c.match("./daily-note.json")).then(r => r ? r.json() : null).then(n => n && n.title ? self.registration.showNotification(n.title, {body:n.body, tag:"raihana-daily", icon:"icon-192.png"}) : null).catch(() => {})); });
self.addEventListener("notificationclick", e => { e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(ws => ws.length ? ws[0].focus() : self.clients.openWindow("./"))); });
