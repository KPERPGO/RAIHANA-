// Keeps the app working with no internet: the page, icons and the Excel library are stored on the device.
const CACHE = "raihana-erp-v1", NOTES = "raihana-notes";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== NOTES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
let newer = false; // a newer page was saved since this worker started
const tell = () => self.clients.matchAll({type:"window"}).then(ws => ws.forEach(w => w.postMessage({type:"raihana-update"})));
self.addEventListener("message", e => { if (e.data === "raihana-check" && newer) tell(); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // sync always goes to the network
  // page: open the copy saved on the phone at once, and fetch the newest version in the background (a weak signal
  // used to keep the app on a blank screen until the internet answered). A new version is used from the next open,
  // and the open app is told, so it can offer "tap to update". With no saved copy yet, the page comes from the internet.
  if (req.mode === "navigate"){
    const saved = caches.match("./index.html"); newer = false; // this open gets the newest saved copy
    const fresh = fetch(req).then(async r => {
      if (!r.ok) return r;
      const c = await caches.open(CACHE), old = await c.match("./index.html"), txt = await r.clone().text(); // its own copy: the saved one may be on screen
      if (!old || (await old.text()) !== txt){ await c.put("./index.html", r.clone()); if (old){ newer = true; tell(); } }
      return r;
    });
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(saved.then(hit => hit || fresh).catch(() => fresh));
    return;
  }
  // everything else: cache first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok && (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdnjs/.test(url.hostname))){ const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; })));
});
// the day's stock list (shortage list and batches to sell first), saved by the app at its last use. Chrome on Android
// wakes the installed app about once a day for this, even when it is closed. Other phones get it when the app opens
self.addEventListener("periodicsync", e => { if (e.tag !== "raihana-daily") return;
  e.waitUntil(caches.open(NOTES).then(c => c.match("./daily-note.json")).then(r => r ? r.json() : null).then(n => n && n.title ? self.registration.showNotification(n.title, {body:n.body, tag:"raihana-daily", icon:"icon-192.png"}) : null).catch(() => {})); });
// the morning list sent by the pharmacy's Supabase function (all phones, also iPhone with the app on the Home Screen)
self.addEventListener("push", e => { let n = {}; try { n = e.data ? e.data.json() : {}; } catch { n = {body: e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(n.title || "Raihana", {body:n.body || "", tag:"raihana-daily", icon:"icon-192.png"})); });
self.addEventListener("notificationclick", e => { e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(ws => ws.length ? ws[0].focus() : self.clients.openWindow("./"))); });
