// Safeguard: every screen a person is allowed must be visible, tappable, hidden and shown again by Menu, on phone and desktop.
const { chromium } = require('./pw');
const ALL = ['home','sell','stock','pricing','chronic','invoices','items','payments','suppliers','customers','money','books','reports','staff','settings'];
const CASES = [
  {name:'no staff yet', staff:[], me:null, expect:ALL},
  {name:'only a pharmacist, no owner (Owner case)', staff:[{id:'ST-P', name:'Ali', role:'pharmacist', active:true}], me:'ST-P', expect:ALL},
  {name:'owner logged in', staff:[{id:'ST-O', name:'Owner', role:'owner', active:true}, {id:'ST-P', name:'Ali', role:'pharmacist', active:true}], me:'ST-O', expect:ALL},
  {name:'pharmacist default', staff:[{id:'ST-O', name:'Owner', role:'owner', active:true}, {id:'ST-P', name:'Ali', role:'pharmacist', active:true}], me:'ST-P', expect:['sell'], newinv:true},
  {name:'pharmacist custom', staff:[{id:'ST-O', name:'Owner', role:'owner', active:true}, {id:'ST-P', name:'Ali', role:'pharmacist', active:true, perms:['home','stock','chronic','money','staff']}], me:'ST-P', expect:['home','stock','chronic','money'], newinv:false},
  {name:'pharmacist no screens', staff:[{id:'ST-O', name:'Owner', role:'owner', active:true}, {id:'ST-P', name:'Ali', role:'cashier', active:true, perms:[]}], me:'ST-P', expect:[], newinv:false},
];
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const [w, h, size] of [[360, 640, 'small phone'], [390, 760, 'phone'], [768, 1000, 'tablet'], [1024, 768, 'iPad landscape'], [1280, 720, 'desktop']]) for (const lang of ['en', 'ar']) for (const c of CASES) {
    const page = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(700);
    const r = await page.evaluate(async ([c, lang]) => {
      E.staff = c.staff; S.staff = c.me ? c.staff.find(x => x.id === c.me) : null; if (lang === 'ar' && S.lang !== 'ar') document.getElementById('langBtn').click(); S.tab = 'home'; render();
      await new Promise(r => setTimeout(r, 150));
      const vis = [], bad = [];
      // phone: the screen list opens upward from Menu in the bottom bar; wider screens: the side list, shown and hidden by ☰ in the top bar
      const bar = document.getElementById('botbar'), phone = !!bar && getComputedStyle(bar).display !== 'none';
      const menu = phone ? bar.querySelector('[data-xbotmenu]') : document.querySelector('.hmenu');
      const listOpen = () => phone ? document.body.classList.contains('botmenu') : !document.body.classList.contains('navshut');
      const openList = () => { if (!listOpen()) menu.click(); }, closeList = () => { if (phone && listOpen()) menu.click(); };
      // a screen in a closed group is reached by tapping its group heading (which must itself be on screen), then the screen button
      const tapOk = el => { el.scrollIntoView({block:'nearest'}); const q = el.getBoundingClientRect(), top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return q.width > 20 && q.height > 20 && q.left >= 0 && q.right <= innerWidth + 0.5 && q.top >= 0 && q.bottom <= innerHeight && (top === el || el.contains(top)); };
      if (!tapOk(menu)) bad.push('Menu');
      for (const bt of document.querySelectorAll('nav.tabs [data-tab]')) { if (bt.hidden) continue; const k = bt.dataset.tab; openList();
        const head = bt.classList.contains('gshut') ? document.querySelector(`nav.tabs .ng[data-grp="${bt.dataset.g}"]`) : null;
        if (head) { if (!tapOk(head)) bad.push(k + ' heading'); head.click(); }
        if (!tapOk(bt)) bad.push(k); vis.push(k); if (head) head.click(); closeList(); }
      // Menu shows or hides the screen list, and stays on screen either way
      const seen = x => x && x.getBoundingClientRect().width > 0;
      const shown = () => [...document.querySelectorAll('nav.tabs [data-tab]')].filter(x => !x.hidden && (seen(x) || (x.classList.contains('gshut') && seen(document.querySelector(`nav.tabs .ng[data-grp="${x.dataset.g}"]`))))).map(x => x.dataset.tab);
      openList(); menu.click(); await new Promise(r => setTimeout(r, 50)); if (shown().length) bad.push('Menu did not hide the list'); if (!tapOk(menu)) bad.push('Menu gone when list hidden');
      menu.click(); await new Promise(r => setTimeout(r, 50)); const inMenu = shown(); closeList();
      const opened = []; for (const k of vis) { openList(); const bt = document.querySelector(`nav.tabs [data-tab="${k}"]`); if (bt.classList.contains('gshut')) document.querySelector(`nav.tabs .ng[data-grp="${bt.dataset.g}"]`).click(); bt.click(); await new Promise(r => setTimeout(r, 30)); if (S.tab !== k) opened.push(k); }
      const add = getComputedStyle(document.getElementById('addBtn')).display !== 'none';
      return {vis, bad, inMenu, notOpened:opened, add, own:isOwner()};
    }, [c, lang]);
    const same = (a, x) => [...a].sort().join() === [...x].sort().join();
    const ok = same(r.vis, c.expect) && same(r.inMenu, c.expect) && !r.bad.length && !r.notOpened.length && (c.newinv === undefined ? r.add : r.add === c.newinv) && !errs.length;
    if (!ok) { fails++; console.log('FAIL', size, lang, c.name, JSON.stringify(r), errs); }
    await page.close();
  }
  console.log(fails ? `${fails} FAILED` : `PASS all screens reachable: ${CASES.length} permission cases × 5 sizes × 2 languages`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
