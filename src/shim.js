/* Raihana ERP device runtime.
   On claude.ai the page uses Claude's own storage. Installed on a phone or computer it uses this:
   a local database on the device (works with no internet), photo storage, file downloads,
   and optional cloud sync to the pharmacy's own Supabase project. */
(function(){
  if (window.claude && window.claude.use){ window.ERP_MODE = "claude"; return; }
  window.ERP_MODE = "device";
  const DBNAME = "raihana-erp";
  let dbp = null;
  // iPhones drop the database connection when the app sits in the background; forget it so the next save opens a new one
  const idb = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DBNAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("docs"); r.result.createObjectStore("blobs"); };
    r.onsuccess = () => { const d = r.result; d.onclose = () => { dbp = null; }; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
    r.onerror = () => { dbp = null; rej(r.error); };
  }));
  const tx1 = (store, mode, fn) => idb().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode); let out;
    try { out = fn(t.objectStore(store)); } catch(e){ try { t.abort(); } catch {} return rej(e); } // nothing of a half-written group is kept
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = t.onabort = () => rej(t.error || new DOMException("aborted", "AbortError")); }));
  const isFull = e => e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""));
  const tx = (store, mode, fn) => tx1(store, mode, fn).catch(e => { if (isFull(e)) throw e; try { dbp && dbp.then(d => d.close(), () => {}); } catch {} dbp = null; return tx1(store, mode, fn); }); // one retry on a fresh connection
  // every record by path, and the same records grouped by collection (a screen list reads only its own collection)
  const cache = new Map(), byColl = new Map(), subs = new Map();
  const collOf = p => p.split("/")[0];
  const cset = (p, v) => { cache.set(p, v); let m = byColl.get(collOf(p)); if (!m) byColl.set(collOf(p), m = new Map()); m.set(p, v); };
  const cdel = p => { cache.delete(p); byColl.get(collOf(p))?.delete(p); };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const readAll = () => idb().then(d => new Promise((res, rej) => {
    const rq = d.transaction("docs").objectStore("docs").openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c){ cset(c.key, c.value); c.continue(); } else res(); };
    rq.onerror = () => rej(rq.error);
  }));
  const loaded = readAll().catch(() => { dbp = null; return readAll(); }).catch(e => console.error("local load failed", e));
  const strip = v => { const o = {...v}; delete o.__ver; return o; };
  const clean = v => { const o = {...v}; delete o.__deleted; delete o.__rev; delete o.__ver; return o; };
  const snap = coll => ({docs: [...(byColl.get(coll) || [])].filter(([, v]) => !v.__deleted).map(([p, v]) => ({id: p.split("/").slice(1).join("/"), data: () => clean(v)}))});
  const emit = coll => (subs.get(coll) || []).forEach(cb => { try { cb(snap(coll)); } catch(e){ console.error(e); } });
  let dirty = new Set(lsGet("erp.dirty", []));
  // the fields an "update" changed, kept until the change reaches the cloud: {path: {field: [before, after]}}.
  // If another device saved the same record first, these fields are put on top of its copy (when it did not change them too).
  let patches = lsGet("erp.patches", {});
  const savePatches = () => lsSet("erp.patches", patches);
  // several records saved together in ONE device transaction: all of them are kept, or none (a sale and its customer, a return's stock lines)
  async function putMany(list, fromSync){
    if (!list.length) return;
    const prev = list.map(([p]) => [p, cache.has(p), cache.get(p)]);
    list.forEach(([p, v]) => cset(p, v));
    try { await tx("docs", "readwrite", s => { list.forEach(([p, v]) => s.put(v, p)); }); }
    catch(e){ prev.reverse().forEach(([p, had, v]) => had ? cset(p, v) : cdel(p)); // the screen must not show what the phone did not keep
      console.error("local save failed", e); window.ERP_STORE && ERP_STORE.check(); throw isFull(e) ? Object.assign(new Error("Storage is full on this device."), {code: "quota_exceeded"}) : Object.assign(new Error("Couldn't save on this device."), {code: "local_failed", detail: (e && (e.name + ": " + e.message)) || ""}); }
    if (!fromSync){ list.forEach(([p]) => dirty.add(p)); lsSet("erp.dirty", [...dirty]); SYNC.soon(); }
    new Set(list.map(([p]) => collOf(p))).forEach(emit);
  }
  const put = (path, val, fromSync) => putMany([[path, val]], fromSync);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const STAMPS = ["lastBy", "lastAt", "staffBy", "staffByName", "staffAt"]; // who saved last and when: never a reason to drop a change
  // what one write turns into on this device: [path, stored value]; "update" also notes the fields it changed
  function prep({path, data, op}){
    const cur = cache.get(path), ver = cur?.__ver || 0;
    if (op === "update"){
      if (!cur || cur.__deleted) throw Object.assign(new Error("not found"), {code: "not_found"});
      const pt = patches[path] ? {...patches[path]} : dirty.has(path) ? null : {}; // a full save is already waiting: that one goes up whole
      if (pt){ for (const k of Object.keys(data)) pt[k] = [k in pt ? pt[k][0] : cur[k], data[k]]; }
      return [[path, {...cur, ...data, __rev: Date.now(), __ver: ver}], pt];
    }
    return [[path, op === "delete" ? {__deleted: true, __rev: Date.now(), __ver: ver} : {...data, __rev: Date.now(), __ver: ver}], null];
  }
  async function writeOps(ops){
    await loaded;
    const done = ops.map(prep), had = {...patches};
    done.forEach(([[p], pt], i) => { if (pt) patches[p] = pt; else delete patches[p]; });
    try { await putMany(done.map(x => x[0])); } catch(e){ patches = had; throw e; }
    savePatches();
  }
  const db = {
    doc(path){ return {
      set: data => writeOps([{path, data, op: "set"}]),
      update: data => writeOps([{path, data, op: "update"}]),
      delete: () => writeOps([{path, op: "delete"}]),
      get: async () => { await loaded; const v = cache.get(path); return {exists: !!v && !v.__deleted, id: path.split("/").pop(), data: () => v ? clean(v) : undefined}; }
    }; },
    // [{path, data, merge}]: saved together, all or nothing
    batch: list => writeOps(list.map(x => ({path: x.path, data: x.data, op: x.merge ? "update" : "set"}))),
    collection(coll){ return { onSnapshot(cb, err){
      if (!subs.has(coll)) subs.set(coll, new Set()); subs.get(coll).add(cb);
      loaded.then(() => cb(snap(coll))).catch(e => err && err(e));
      return () => subs.get(coll).delete(cb);
    } }; }
  };
  /* how full the phone's storage is for this app; ask the phone to keep it (not clear it when space runs low) */
  const STORE = window.ERP_STORE = {
    info: null,
    async check(){
      try {
        const st = navigator.storage; if (!st || !st.estimate) return null;
        const {usage = 0, quota = 0} = await st.estimate(), persisted = st.persisted ? await st.persisted() : null;
        this.info = {usage, quota, pct: quota ? usage / quota : 0, persisted, at: Date.now()};
        window.render && window.render();
        return this.info;
      } catch { return null; }
    }
  };
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}).finally(() => STORE.check()); } catch {}
  window.ERP_LOCAL = {all: async () => { await loaded; return [...cache].filter(([, v]) => !v.__deleted).map(([p, v]) => [p, clean(v)]); }, put: (p, v) => writeOps([{path: p, data: v, op: "set"}])};

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
  // a weak signal can leave a request hanging with no answer: give up after 25 s so the next try can start
  const AUTH = "__auth", saveAuth = a => tx("blobs", "readwrite", s => s.put({token: a.token, refresh: a.refresh, exp: a.exp}, AUTH)).catch(() => {});
  const fetchT = (url, o = {}, ms = SYNC.timeoutMs || 25000) => { const ac = typeof AbortController === "function" ? new AbortController() : null, t = ac && setTimeout(() => ac.abort(), ms);
    return fetch(url, ac ? {...o, signal: ac.signal} : o).catch(e => { throw e && e.name === "AbortError" ? new Error("The cloud did not answer in time. It will try again by itself.") : e; }).finally(() => t && clearTimeout(t)); };
  const SYNC = window.ERP_SYNC = {
    cfg: () => lsGet("erp.sync", null),
    status: lsGet("erp.syncStatus", {state: "off"}),
    set(st){ this.status = {...st, at: new Date().toISOString()}; if (st.state === "ok") this.status.okAt = this.status.at; else if (this.lastOk()) this.status.okAt = this.lastOk(); lsSet("erp.syncStatus", this.status); window.render && window.render(); },
    lastOk(){ return this.status?.okAt || lsGet("erp.syncStatus", {}).okAt || null; },
    // the cloud refused this device's sign-in (password changed, or the session was ended): it needs the password again.
    // Everything saved meanwhile stays on the device in the upload list and goes up after signing in.
    signedOut(){ return !!this.cfg()?.signedOut; },
    async relogin(password){ const c = this.cfg(); if (!c) throw new Error("Connect cloud sync first."); if (!password) throw new Error("Type the password.");
      const keep = c.ver || 0; await this.login(c.url, c.anon, c.email, password, keep); },
    pending: () => dirty.size,
    t: null, fails: 0,
    soon(ms = 1500){ clearTimeout(this.t); this.t = setTimeout(() => this.run(), ms); },
    // after a failed try: again in 5 s, 15 s, 30 s, then every minute (the timer below), so a short drop costs seconds, not minutes
    retry(){ const ms = [5000, 15000, 30000][this.fails++]; if (ms) this.soon(ms); },
    // the pharmacy types these by hand: fix the usual slips (http, missing https, trailing slash, spaces) before using them
    cleanUrl(u){ u = String(u || "").trim().replace(/\s+/g, "").replace(/\/+$/, ""); if (u && !/^[a-z]+:\/\//i.test(u)) u = "https://" + u; return /^http:\/\/(?!localhost|127\.)/i.test(u) ? u.replace(/^http:/i, "https:") : u; },
    async login(url, anon, email, password, ver = 0){
      url = this.cleanUrl(url); anon = String(anon || "").trim(); email = String(email || "").trim();
      let r; try { r = await fetch(url + "/auth/v1/token?grant_type=password", {method: "POST", headers: {apikey: anon, "Content-Type": "application/json"}, body: JSON.stringify({email, password})}); }
      catch { throw new Error("Can't reach the cloud. Check the internet, and that the Project URL looks like https://xxxx.supabase.co"); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(/invalid login/i.test(j.error_description || j.msg || "") ? "Wrong email or password. Check them and try again." : r.status === 401 || /api key|apikey/i.test(j.message || j.msg || "") ? "The public key is not right. Copy the Publishable key again from Supabase." : (j.error_description || j.msg || "Sign-in failed. Check the Project URL, key, email and password."));
      const fresh = {token: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000};
      await saveAuth(fresh); lsSet("erp.sync", {url, anon, email, ...fresh, ver});
      for (const [p, v] of cache) if (!v.__ver && !v.__deleted) dirty.add(p); lsSet("erp.dirty", [...dirty]); // a device with data joins the pharmacy: upload it
      lsSet("erp.userId", j.user?.id || me().id); lsSet("erp.userName", j.user?.user_metadata?.name || email);
      this.run();
    },
    // forgot PIN: the owner proves who they are with the cloud email and password. Nothing is saved: the token is only used
    // to ask the server whether this account is on the pharmacy list (erp_members), then thrown away
    async verify(email, password, url, anon){ // url and anon: typed by hand when this device is not connected; nothing is saved
      const c = url ? {url: this.cleanUrl(url), anon: String(anon || "").trim()} : this.cfg();
      if (!c || !c.url || !c.anon) throw new Error("Type the Project URL and the Publishable key from Supabase.");
      email = String(email || "").trim(); if (!email || !password) throw new Error("Type the email and password.");
      let r; try { r = await fetch(c.url + "/auth/v1/token?grant_type=password", {method: "POST", headers: {apikey: c.anon, "Content-Type": "application/json"}, body: JSON.stringify({email, password})}); }
      catch { throw new Error("Can't reach the cloud. Check the internet and try again."); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw new Error(r.status === 400 || /invalid/i.test(j.error_description || j.msg || "") ? "Wrong email or password. Check them and try again." : "Sign-in failed (" + r.status + "). Try again.");
      let m; try { m = await fetch(c.url + "/rest/v1/rpc/erp_is_member", {method: "POST", headers: {apikey: c.anon, Authorization: "Bearer " + j.access_token, "Content-Type": "application/json"}, body: "{}"}); }
      catch { throw new Error("Can't reach the cloud. Check the internet and try again."); }
      if (!m.ok || (await m.json().catch(() => false)) !== true) throw new Error("This account is not on the pharmacy list.");
      return true;
    },
    clearConflicts(){ lsSet("erp.conflicts", 0); this.set({state: "ok"}); },
    logout(){ lsSet("erp.sync", null); this.set({state: "off"}); },
    // Supabase gives each refresh token once: using an old one again ends the session on every device.
    // So only one tab refreshes at a time, and it first takes the newest token another tab may have saved.
    async token(c, force){ // force: the cloud refused the current one, so refresh even if it looks unexpired
      if (!force && Date.now() < c.exp - 60000) return c.token;
      const was = c.token;
      const go = async () => {
        // the newest sign-in any tab saved: the device database is the same at once in every tab (the browser's quick storage can lag behind)
        const saved = await tx("blobs", "readonly", s => s.get(AUTH)).catch(() => null);
        for (const f of [this.cfg(), saved]) if (f && f.refresh && f.refresh !== c.refresh && (f.exp || 0) > (c.exp || 0)) Object.assign(c, {token: f.token, refresh: f.refresh, exp: f.exp});
        if (Date.now() < c.exp - 60000 && !(force && c.token === was)) return c.token; // another tab already refreshed it
        let r; try { r = await fetchT(c.url + "/auth/v1/token?grant_type=refresh_token", {method: "POST", headers: {apikey: c.anon, "Content-Type": "application/json"}, body: JSON.stringify({refresh_token: c.refresh})}); }
        catch { throw new Error("Can't reach the cloud. It will try again by itself."); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token){
          if ([400, 401, 403].includes(r.status)){ const f2 = this.cfg(); if (f2){ f2.signedOut = true; lsSet("erp.sync", f2); } const e = new Error("Signed out of the cloud. Type the password again in Settings."); e.signedOut = true; throw e; }
          throw new Error("The cloud is not answering (" + r.status + "). It will try again by itself.");
        }
        Object.assign(c, {token: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000});
        await saveAuth(c);
        const f3 = this.cfg() || {}; lsSet("erp.sync", {...f3, token: c.token, refresh: c.refresh, exp: c.exp}); return c.token;
      };
      return navigator.locks?.request ? navigator.locks.request("erp-sync-token", go) : go();
    },
    busy: false,
    async run(){
      const c = this.cfg(); if (!c || this.busy) return;
      if (c.signedOut){ if (this.status.state !== "signedout") this.set({state: "signedout", msg: "Signed out of the cloud. Type the password again in Settings."}); return; }
      if (!navigator.onLine){ this.set({state: "offline"}); return; }
      this.busy = true;
      try {
        await loaded;
        const tok = await this.token(c), h = {apikey: c.anon, Authorization: "Bearer " + tok, "Content-Type": "application/json"};
        let renewed = false; // the cloud says the sign-in ran out early: get a fresh one once, then ask again
        const call = async (url, o = {}) => { let r = await fetchT(url, {...o, headers: h});
          if (r.status === 401 && !renewed){ renewed = true; h.Authorization = "Bearer " + await this.token(c, true); r = await fetchT(url, {...o, headers: h}); }
          return r; };
        let lost = 0;
        for (let round = 0; round < 3 && dirty.size; round++){ // a record merged with another device's copy goes up again in the next round
          const send = [...dirty].map(p => ({path: p, data: strip(cache.get(p)), base: cache.get(p)?.__ver || 0, rev: cache.get(p)?.__rev, device: me().id}));
          let again = false;
          for (let i = 0; i < send.length; i += 100){
            const batch = send.slice(i, i + 100);
            const r = await call(c.url + "/rest/v1/rpc/erp_push", {method: "POST", body: JSON.stringify({rows: batch.map(({rev, ...x}) => x)})});
            if (r.status === 404) throw new Error("The cloud setup is old. Run the newest setup SQL in Supabase.");
            if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "This account is not on the pharmacy list. Ask the owner to add it." : "Cloud refused the changes (" + r.status + ").");
            const keep = [];
            for (const x of await r.json()){
              const sent = batch.find(b => b.path === x.path), cur = cache.get(x.path);
              if (!sent || !cur) continue;
              if (x.ok){ // changed again while sending: it stays waiting, and its next upload builds on what the cloud has now
                if (cur.__rev === sent.rev){ dirty.delete(x.path); delete patches[x.path]; } else if (patches[x.path]) for (const k in patches[x.path]) patches[x.path][k][0] = sent.data[k];
                cur.__ver = x.ver; keep.push([x.path, cur]); continue; }
              const pt = patches[x.path], theirs = x.data || {};
              if (pt && round < 2 && !theirs.__deleted){ // only some fields were changed here: put them on top of the other device's copy
                const merged = {...theirs}, still = {}; let clash = false;
                for (const [k, [before, after]] of Object.entries(pt)){
                  if (STAMPS.includes(k) || same(theirs[k], before) || same(theirs[k], after)){ merged[k] = after; still[k] = [theirs[k], after]; } else clash = true; // both changed this field: the first save keeps it
                }
                if (clash) lost++;
                patches[x.path] = still; await put(x.path, {...merged, __rev: Date.now(), __ver: x.ver}, true); dirty.add(x.path); again = true; continue;
              }
              lost++; dirty.delete(x.path); delete patches[x.path]; await put(x.path, {...theirs, __rev: theirs.__rev || 0, __ver: x.ver}, true); // another device saved first: take theirs, yours is kept in the cloud (erp_conflicts)
            }
            if (keep.length) await tx("docs", "readwrite", s => keep.forEach(([p, v]) => s.put(v, p)));
            lsSet("erp.dirty", [...dirty]); savePatches();
          }
          if (!again) break;
        }
        if (lost) lsSet("erp.conflicts", (lsGet("erp.conflicts", 0)) + lost);
        let since = Math.max(0, (c.ver || 0) - 100), top = c.ver || 0, more = true; // a little overlap, in case a change committed late
        while (more){
          const r = await call(c.url + "/rest/v1/erp_docs?select=path,data,ver&ver=gt." + since + "&order=ver.asc&limit=500");
          if (!r.ok) throw new Error("Couldn't read from the cloud (" + r.status + ").");
          const rows = await r.json(), take = [];
          for (const row of rows){ const cur = cache.get(row.path); if (!dirty.has(row.path) && (!cur || (cur.__ver || 0) < row.ver)) take.push([row.path, {...row.data, __ver: row.ver}]); since = Math.max(since, row.ver); top = Math.max(top, row.ver); }
          await putMany(take, true); // one device transaction and one screen update per 500 records, not one per record
          more = rows.length === 500;
        }
        const f = this.cfg(); if (f) lsSet("erp.sync", {...f, ver: Math.max(top, f.ver || 0)}); // write over the newest copy: another tab may have saved a newer sign-in token
        this.fails = 0;
        this.set(lsGet("erp.conflicts", 0) ? {state: "ok", conflicts: lsGet("erp.conflicts", 0)} : {state: "ok"});
      } catch(e){ this.set(e.signedOut ? {state: "signedout", msg: e.message} : {state: "error", msg: /failed to fetch|load failed|networkerror/i.test(e.message || "") ? "Can't reach the cloud. It will try again by itself." : e.message}); if (!e.signedOut) this.retry(); }
      finally { this.busy = false; }
    }
  };
  window.addEventListener("online", () => { SYNC.fails = 0; SYNC.run(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (dirty.size || SYNC.status.state !== "ok")) SYNC.soon(300); }); // back to the app: send what is waiting
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
