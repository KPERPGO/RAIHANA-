const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// "Storage full" guard (24 Oct 2026): iPhones drop the app's local database connection after it sits in the background,
// and every save then failed with "Storage is full". Saves must reconnect by themselves, only a real full phone may say
// "full", a failed save must not show on screen as saved, and the owner sees a warning before the phone is full.
const { chromium } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // keep a handle on every database connection the app opens, so the test can drop it like the phone does
  await p.addInitScript(() => { const o = indexedDB.open.bind(indexedDB); window.__conns = []; indexedDB.open = (...a) => { const r = o(...a); r.addEventListener('success', () => __conns.push(r.result)); return r; }; });
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1200);
  const fromDisk = path => p.evaluate(path => new Promise(res => { const r = indexedDB.open('raihana-erp'); r.onsuccess = () => { const g = r.result.transaction('docs').objectStore('docs').get(path); g.onsuccess = () => { res(g.result || null); r.result.close(); }; }; }), path);

  // 1. the connection is lost in the background: the next save reconnects and is kept
  await p.evaluate(() => __conns.forEach(d => d.close()));
  let r = await p.evaluate(async () => { try { await write('shifts/SH-T1', {id:'SH-T1', staffId:'x', start:new Date().toISOString(), end:null}); return 'saved'; } catch(e){ return e.message; } });
  ok('save after a lost connection works', r === 'saved', r);
  ok('and is on the device', (await fromDisk('shifts/SH-T1'))?.id === 'SH-T1');
  r = await p.evaluate(async () => { __conns.forEach(d => d.close()); try { await write('shifts/SH-T1', {end:new Date().toISOString()}, true); return 'saved'; } catch(e){ return e.message; } });
  ok('ending the shift after another lost connection works', r === 'saved', r);
  ok('the shift end is on the device', !!(await fromDisk('shifts/SH-T1'))?.end);

  // 2. a real full phone says so, and the screen does not show the unsaved record
  r = await p.evaluate(async () => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(){ throw new DOMException('quota', 'QuotaExceededError'); };
    try { await write('expenses/EX-T1', {id:'EX-T1', amount:1000}); return 'saved'; } catch(e){ return e.message; } finally { IDBObjectStore.prototype.put = put; } });
  ok('full phone: clear "storage full" message', /storage is full/i.test(r), r);
  ok('full phone: record not shown as saved', await p.evaluate(async () => !(await S.db.doc('expenses/EX-T1').get()).exists));
  ok('full phone: record not queued for the cloud', await p.evaluate(() => !JSON.parse(localStorage.getItem('erp.dirty') || '[]').includes('expenses/EX-T1')));

  // 3. any other failure does not say "full": it says to reopen the app, and the old value stays
  r = await p.evaluate(async () => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(){ throw new DOMException('lost', 'UnknownError'); };
    try { await write('shifts/SH-T1', {note:'x'}, true); return 'saved'; } catch(e){ return e.message; } finally { IDBObjectStore.prototype.put = put; } });
  ok('other failure: "close the app and open it again", not "full"', /close the app fully/i.test(r) && !/full\b/i.test(r.replace(/fully/g, '')), r);
  ok('other failure: the shift keeps its saved value', await p.evaluate(async () => (await S.db.doc('shifts/SH-T1').get()).data().note === undefined));
  ok('saving works again afterwards', await p.evaluate(async () => { await write('shifts/SH-T1', {note:'y'}, true); return (await S.db.doc('shifts/SH-T1').get()).data().note === 'y'; }));

  // 4. warning before the phone is full: Home alert and the Settings line
  ok('space check runs on this browser', await p.evaluate(async () => !!(await ERP_STORE.check())?.quota));
  await p.evaluate(() => { ERP_STORE.info = {usage:850e6, quota:1e9, pct:0.85, persisted:false}; });
  ok('alert at 85% full', await p.evaluate(() => stockAlerts().some(a => a.type === 'storage' && a.sev === 3)));
  await p.evaluate(() => { ERP_STORE.info = {usage:100e6, quota:1e9, pct:0.1, persisted:true}; });
  ok('no alert at 10%', await p.evaluate(() => !stockAlerts().some(a => a.type === 'storage')));
  await p.evaluate(() => { ERP_STORE.info = {usage:850e6, quota:1e9, pct:0.85, persisted:false}; S.lang = 'en'; S.tab = 'settings'; render(); });
  await p.waitForTimeout(300);
  ok('Settings shows the space used', /Space used on this device[\s\S]{0,20}850\.0 MB \/ 1\.0 GB \(85%\)/.test(await p.evaluate(() => document.body.innerText)));
  await p.evaluate(() => { S.lang = 'ar'; render(); }); await p.waitForTimeout(300);
  ok('Arabic: space line translated', await p.evaluate(() => /المساحة المستخدمة على هذا الجهاز/.test(document.body.innerText) && /850\.0 MB \/ 1\.0 GB/.test(document.body.innerText)));

  ok('no page errors', !errs.length, errs);
  console.log(fails ? `${fails} FAILED` : 'PASS all storage checks'); await b.close(); process.exit(fails ? 1 : 0);
})();
