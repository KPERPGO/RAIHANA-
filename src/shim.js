/* Raihana ERP device runtime.
   On claude.ai the page uses Claude's own storage. Installed on a phone or computer it uses this:
   a local database on the device (works with no internet), photo storage, file downloads,
   and optional cloud sync to the pharmacy's own Supabase project. */
(function(){
  if (window.claude && window.claude.use){ window.ERP_MODE = "claude"; return; }
  window.ERP_MODE = "device";
  const DBNAME = "raihana-erp";
  let dbp = null;
  const idb = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DBNAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("docs"); r.result.createObjectStore("blobs"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (store, mode, fn) => idb().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }));
  const cache = new Map(), subs = new Map();
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const loaded = idb().then(d => new Promise(res => {
    const rq = d.transaction("docs").objectStore("docs").openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c){ cache.set(c.key, c.value); c.continue(); } else res(); };
    rq.onerror = () => res();
  })).catch(() => {});
  const strip = v => { const o = {...v}; delete o.__ver; return o; };
  const clean = v => { const o = {...v}; delete o.__deleted; delete o.__rev; delete o.__ver; return o; };
  const snap = coll => ({docs: [...cache].filter(([p, v]) => p.split("/")[0] === coll && !v.__deleted).map(([p, v]) => ({id: p.split("/").slice(1).join("/"), data: () => clean(v)}))});
  const emit = coll => (subs.get(coll) || []).forEach(cb => { try { cb(snap(coll)); } catch(e){ console.error(e); } });
  let dirty = new Set(lsGet("erp.dirty", []));
  async function put(path, val, fromSync){
    cache.set(path, val);
    try { await tx("docs", "readwrite", s => s.put(val, path)); }
    catch(e){ throw Object.assign(new Error("Storage is full or blocked on this device."), {code: "quota_exceeded"}); }
    if (!fromSync){ dirty.add(path); lsSet("erp.dirty", [...dirty]); SYNC.soon(); }
    emit(path.split("/")[0]);
  }
  const db = {
    doc(path){ return {
      set: async data => { await loaded; return put(path, {...data, __rev: Date.now(), __ver: cache.get(path)?.__ver || 0}); },
      update: async data => { await loaded; const cur = cache.get(path); if (!cur || cur.__deleted) throw Object.assign(new Error("not found"), {code: "not_found"}); return put(path, {...cur, ...data, __rev: Date.now(), __ver: cur.__ver || 0}); },
      delete: async () => { await loaded; return put(path, {__deleted: true, __rev: Date.now(), __ver: cache.get(path)?.__ver || 0}); },
      get: async () => { await loaded; const v = cache.get(path); return {exists: !!v && !v.__deleted, id: path.split("/").pop(), data: () => v ? clean(v) : undefined}; }
    }; },
    collection(coll){ return { onSnapshot(cb, err){
      if (!subs.has(coll)) subs.set(coll, new Set()); subs.get(coll).add(cb);
      loaded.then(() => cb(snap(coll))).catch(e => err && err(e));
      return () => subs.get(coll).delete(cb);
    } }; }
  };
  window.ERP_LOCAL = {all: async () => { await loaded; return [...cache].filter(([, v]) => !v.__deleted).map(([p, v]) => [p, clean(v)]); }, put: (p, v) => put(p, {...v, __rev: Date.now(), __ver: cache.get(p)?.__ver || 0})};

  /* photos of paper invoices stay on the device (and sync as files later) */
  const urls = {};
  const assets = { async upload(file){ const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""); await tx("blobs", "readwrite", s => s.put(file, id)); return {id}; } };
  async function fixImg(img){
    const m = /\/_blob\/([0-9a-f]+)/.exec(img.getAttribute("src") || ""); if (!m) return;
    const id = m[1]; if (!urls[id]){ const b = await tx("blobs", "readonly", s => s.get(id)).catch(() => null); if (!b) return; urls[id] = URL.createObjectURL(b); }
    img.src = urls[id];
  }
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; (n.tagName === "IMG" ? [n] : n.querySelectorAll("img[src^='/_blob/']")).forEach(fixImg); }))).observe(document.documentElement, {childList: true, subtree: true});

  const downloads = { async save({filename, data}){ const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); } };

  const me = () => ({id: lsGet("erp.userId", null) || (() => { const id = "dev_" + Math.random().toString(36).slice(2, 10); lsSet("erp.userId", id); return id; })(), name: lsGet("erp.userName", "")});
  const user = { me: async () => me(), can: async () => true, profiles: async ids => { const names = lsGet("erp.names", {}); return Object.fromEntries(ids.map(id => [id, {name: names[id] || ""}])); } };

  /* ---------- cloud sync (Supabase). Off until the pharmacy connects its own project in Settings ---------- */
  const SYNC = window.ERP_SYNC = {
    cfg: () => lsGet("erp.sync", null),
    status: lsGet("erp.syncStatus", {state: "off"}),
    set(st){ this.status = {...st, at: new Date().toISOString()}; lsSet("erp.syncStatus", this.status); window.render && window.render(); },
    pending: () => dirty.size,
    t: null,
    soon(){ clearTimeout(this.t); this.t = setTimeout(() => this.run(), 1500); },
    async login(url, anon, email, password){
      const r = await fetch(url.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {method: "POST", headers: {apikey: anon, "Content-Type": "application/json"}, body: JSON.stringify({email, password})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error_description || j.msg || "Sign-in failed. Check the email and password.");
      lsSet("erp.sync", {url: url.replace(/\/$/, ""), anon, email, token: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, ver: 0});
      for (const [p, v] of cache) if (!v.__ver && !v.__deleted) dirty.add(p); lsSet("erp.dirty", [...dirty]); // a device with data joins the pharmacy: upload it
      lsSet("erp.userId", j.user?.id || me().id); lsSet("erp.userName", j.user?.user_metadata?.name || email);
      this.run();
    },
    clearConflicts(){ lsSet("erp.conflicts", 0); this.set({state: "ok"}); },
    logout(){ lsSet("erp.sync", null); this.set({state: "off"}); },
    async token(c){
      if (Date.now() < c.exp - 60000) return c.token;
      const r = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", {method: "POST", headers: {apikey: c.anon, "Content-Type": "application/json"}, body: JSON.stringify({refresh_token: c.refresh})});
      const j = await r.json(); if (!r.ok) throw new Error("Signed out. Sign in again in Settings.");
      Object.assign(c, {token: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000}); lsSet("erp.sync", c); return c.token;
    },
    busy: false,
    async run(){
      const c = this.cfg(); if (!c || this.busy) return;
      if (!navigator.onLine){ this.set({state: "offline"}); return; }
      this.busy = true;
      try {
        await loaded;
        const tok = await this.token(c), h = {apikey: c.anon, Authorization: "Bearer " + tok, "Content-Type": "application/json"};
        const send = [...dirty].map(p => ({path: p, data: strip(cache.get(p)), base: cache.get(p)?.__ver || 0, rev: cache.get(p)?.__rev, device: me().id}));
        let lost = 0;
        for (let i = 0; i < send.length; i += 100){
          const batch = send.slice(i, i + 100);
          const r = await fetch(c.url + "/rest/v1/rpc/erp_push", {method: "POST", headers: h, body: JSON.stringify({rows: batch.map(({rev, ...x}) => x)})});
          if (r.status === 404) throw new Error("The cloud setup is old. Run the newest setup SQL in Supabase.");
          if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "This account is not on the pharmacy list. Ask the owner to add it." : "Cloud refused the changes (" + r.status + ").");
          for (const x of await r.json()){
            const sent = batch.find(b => b.path === x.path), cur = cache.get(x.path);
            if (x.ok){ if (cur && cur.__rev === sent.rev){ dirty.delete(x.path); cur.__ver = x.ver; await tx("docs", "readwrite", s => s.put(cur, x.path)); } else if (cur) cur.__ver = x.ver; }
            else { lost++; dirty.delete(x.path); await put(x.path, {...x.data, __rev: x.data.__rev || 0, __ver: x.ver}, true); } // another device saved first: take theirs, yours is kept in the cloud (erp_conflicts)
          }
          lsSet("erp.dirty", [...dirty]);
        }
        if (lost) lsSet("erp.conflicts", (lsGet("erp.conflicts", 0)) + lost);
        let since = Math.max(0, (c.ver || 0) - 100), top = c.ver || 0, more = true; // a little overlap, in case a change committed late
        while (more){
          const r = await fetch(c.url + "/rest/v1/erp_docs?select=path,data,ver&ver=gt." + since + "&order=ver.asc&limit=500", {headers: h});
          if (!r.ok) throw new Error("Couldn't read from the cloud (" + r.status + ").");
          const rows = await r.json();
          for (const row of rows){ const cur = cache.get(row.path); if (!dirty.has(row.path) && (!cur || (cur.__ver || 0) < row.ver)) await put(row.path, {...row.data, __ver: row.ver}, true); since = Math.max(since, row.ver); top = Math.max(top, row.ver); }
          more = rows.length === 500;
        }
        c.ver = top; lsSet("erp.sync", c);
        this.set(lsGet("erp.conflicts", 0) ? {state: "ok", conflicts: lsGet("erp.conflicts", 0)} : {state: "ok"});
      } catch(e){ this.set({state: "error", msg: e.message}); }
      finally { this.busy = false; }
    }
  };
  window.addEventListener("online", () => SYNC.run());
  window.addEventListener("offline", () => SYNC.set({state: "offline"}));
  setInterval(() => SYNC.run(), 60000);
  setTimeout(() => SYNC.run(), 2000);

  window.claude = { use: async name => {
    if (name === "db") return db;
    if (name === "assets") return assets;
    if (name === "downloads") return downloads;
    if (name === "user") return user;
    return null; // photo reading needs Claude: only on claude.ai for now
  } };
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
