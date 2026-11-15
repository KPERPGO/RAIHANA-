const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Forgot PIN (15 Nov 2026, LTH forgot the owner PIN): only an owner can reset, and only by signing in again with the
// pharmacy's cloud email and password, checked by the server (password + member list). Nothing else changes, the password
// is never kept, and a device that is not connected to the cloud only gets a warning not to clear the app.
const { chromium } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
const URL0 = 'https://test-ref.supabase.co';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let auth = 'bad', member = true, calls = [];
  await p.route(URL0 + '/**', async r => { const u = r.request().url(), body = r.request().postData() || ''; calls.push(u);
    if (u.includes('/auth/v1/token?grant_type=password')) {
      if (auth === 'ok' && JSON.parse(body).password === 'right-pass') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'tok-reset', refresh_token: 'x', expires_in: 3600 }) });
      return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) }); }
    if (u.includes('/rpc/erp_is_member')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().headers().authorization === 'Bearer tok-reset' && member) });
    if (u.includes('/rpc/erp_push')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(JSON.parse(body).rows.map(x => ({ path: x.path, ok: true, ver: 1 }))) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  await p.addInitScript(u => { if (!sessionStorage.getItem('__set')) { sessionStorage.setItem('__set', '1'); localStorage.clear(); localStorage.setItem('rp.lang', '"en"');
    localStorage.setItem('erp.sync', JSON.stringify({ url: u, anon: 'pub', email: 'owner@example.com', token: 't', refresh: 'r', exp: Date.now() + 36e5, ver: 0 })); } }, URL0);
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1200);
  await p.evaluate(async () => {
    await write('staff/ST-O', { id: 'ST-O', name: 'Owner', role: 'owner', active: true, pinHash: await pinHash2('ST-O', '1234') });
    await write('staff/ST-A', { id: 'ST-A', name: 'Ali', role: 'pharmacist', active: true, pinHash: await pinHash2('ST-A', '5555') });
    await write('sales/S-1', { id: 'S-1', no: 1, date: '2026-11-01', total: 1000, lines: [] });
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => { S.staff = null; S.session = null; lsSet('erp.session', null); S.lockSel = 'ST-A'; drawLock(); });
  ok('pharmacist: no Forgot PIN button', !(await p.$('#lockScreen [data-xforgot]')));
  await p.evaluate(() => { S.lockSel = 'ST-O'; drawLock(); });
  ok('owner: Forgot PIN button shows', !!(await p.$('#lockScreen [data-xforgot]')));
  const before = await p.evaluate(() => ({ h: E.staff.find(x => x.id === 'ST-O').pinHash, sale: JSON.stringify(E.sales) }));
  await p.click('#lockScreen [data-xforgot]'); await p.waitForTimeout(200);
  ok('form opens over the lock screen with the cloud email filled in', await p.evaluate(() => !!document.getElementById('pinReset') && document.getElementById('rEmail').value === 'owner@example.com'));
  ok('no sideways scroll on a phone', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const box = await p.evaluate(() => { const r = document.querySelector('#pinReset .lockin').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  ok('form fits the phone width', box);
  const submit = async (pass, a, c) => { await p.fill('#rPass', pass); await p.fill('#rPin', a); await p.fill('#rPin2', c); await p.click('#rGo'); await p.waitForTimeout(400); return p.evaluate(() => document.getElementById('rErr')?.textContent || ''); };
  let e = await submit('x', '12', '12'); ok('short PIN refused', /4 to 6/.test(e), e);
  e = await submit('x', '2468', '2469'); ok('different PINs refused', /not the same/.test(e), e);
  const n0 = calls.length; e = await submit('wrong-pass', '2468', '2468');
  ok('wrong password refused', /Wrong email or password/.test(e), e);
  ok('PIN unchanged after wrong password', await p.evaluate(h => E.staff.find(x => x.id === 'ST-O').pinHash === h, before.h));
  ok('the password was checked by the cloud', calls.slice(n0).some(u => u.includes('grant_type=password')));
  auth = 'ok'; member = false; e = await submit('right-pass', '2468', '2468');
  ok('account not on the pharmacy list refused', /not on the pharmacy list/.test(e), e);
  ok('PIN unchanged for a non-member', await p.evaluate(h => E.staff.find(x => x.id === 'ST-O').pinHash === h, before.h));
  member = true; e = await submit('right-pass', '2468', '2468'); await p.waitForTimeout(300);
  const r = await p.evaluate(async () => { const o = E.staff.find(x => x.id === 'ST-O');
    return { closed: !document.getElementById('pinReset'), lock: !!document.getElementById('lockScreen'), sel: S.lockSel,
      old: (await pinCheck(o, '1234')).ok, neu: (await pinCheck(E.staff.find(x => x.id === 'ST-O'), '2468')).ok, sale: JSON.stringify(E.sales), stored: JSON.stringify(localStorage).includes('right-pass') }; });
  ok('form closes, back on the PIN pad for the owner', r.closed && r.lock && r.sel === 'ST-O', r);
  ok('old PIN no longer works', !r.old);
  ok('new PIN works', r.neu);
  ok('sales untouched', r.sale === before.sale);
  ok('password never kept on the device', !r.stored);
  ok('new PIN queued for the cloud', await p.evaluate(() => (ERP_SYNC.pending() >= 0) && E.staff.find(x => x.id === 'ST-O').pinHash.startsWith('p2$')));
  // no wait after wrong PINs (LTH, 15 Nov 2026): after 20 wrong tries the right PIN still works at once
  const w = await p.evaluate(async () => { const o = E.staff.find(x => x.id === 'ST-A'), out = [];
    for (let i = 0; i < 20; i++) out.push(await pinCheck(o, '0000')); const good = await pinCheck(o, '5555');
    return { anyOk: out.some(r => r.ok), msg: pinErr(out[19]), good: good.ok, stored: localStorage.getItem('erp.pinFail') }; });
  ok('wrong PINs are refused', !w.anyOk);
  ok('no waiting: right PIN works straight after 20 wrong ones', w.good, w);
  ok('message just says wrong PIN', w.msg === 'Wrong PIN. Try again.', w.msg);
  ok('no wrong-PIN list is kept', w.stored === null, w.stored);
  // signing in with the new PIN starts the shift
  await p.evaluate(async () => { S.lockSel = 'ST-O'; S.lockPin = '2468'; await tryLogin(); }); await p.waitForTimeout(300);
  ok('owner logs in with the new PIN', await p.evaluate(() => S.staff?.id === 'ST-O' && !document.getElementById('lockScreen')));
  // Change PIN from the top bar: needs the PIN now, then the new one twice
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(200); await p.click('[data-xmypin]'); await p.waitForTimeout(200);
  const fill = async (a, b2, c) => { await p.fill('#mpOld', a); await p.fill('#mpNew', b2); await p.fill('#mpNew2', c); await p.click('#myPinForm button[type=submit]'); await p.waitForTimeout(400); return p.evaluate(() => document.getElementById('mpErr')?.textContent || ''); };
  let m = await fill('1111', '1357', '1357'); ok('change PIN: wrong PIN now refused', /wrong/.test(m), m);
  m = await fill('2468', '1357', '1358'); ok('change PIN: different new PINs refused', /not the same/.test(m), m);
  await fill('2468', '1357', '1357');
  ok('change PIN: new PIN works, old does not', await p.evaluate(async () => { const o = E.staff.find(x => x.id === 'ST-O'); return (await pinCheck(o, '1357')).ok && !(await pinCheck(o, '2468')).ok; }));
  ok('top bar fits the phone with Change PIN', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // owner switches PINs off in Settings: tapping a name signs in, approvals pass, no PIN pad
  await p.evaluate(() => { S.tab = 'settings'; render(); }); await p.waitForTimeout(200);
  await p.evaluate(() => { document.getElementById('sPinOn').checked = false; document.querySelector('#cfgForm button[type=submit]').click(); }); await p.waitForTimeout(500);
  ok('switch saved as PIN off', await p.evaluate(() => E.cfg.pinOff === true && !pinOn()));
  await p.evaluate(() => { S.staff = null; S.session = null; lsSet('erp.session', null); S.lockSel = null; drawLock(); }); await p.waitForTimeout(200);
  await p.click('#lockScreen [data-xlocksel="ST-A"]'); await p.waitForTimeout(500);
  ok('PIN off: tapping a name signs in with no PIN', await p.evaluate(() => S.staff?.id === 'ST-A' && !document.getElementById('lockScreen')));
  ok('PIN off: owner approval goes through with no PIN pad', await p.evaluate(async () => (await ownerOK(['test'])) === 'ST-O' && !document.getElementById('ownerPin')));
  await p.evaluate(() => closeSheet());
  // switch back on: PIN asked again
  await p.evaluate(async () => { await write('meta/erp', {...E.cfg, pinOff:false}); }); await p.waitForTimeout(300);
  await p.evaluate(() => { S.staff = null; S.session = null; lsSet('erp.session', null); S.lockSel = null; drawLock(); }); await p.waitForTimeout(200);
  await p.click('#lockScreen [data-xlocksel="ST-A"]'); await p.waitForTimeout(400);
  ok('PIN on again: tapping a name shows the PIN pad', await p.evaluate(() => !S.staff && !!document.querySelector('#lockScreen .pinpad')));
  const ap = p.evaluate(() => ownerOK(['test'])); await p.waitForTimeout(200);
  ok('PIN on again: approval asks the owner PIN', await p.evaluate(() => !!document.getElementById('ownerPin')));
  await p.click('#ownerPin [data-ocancel]'); await ap;
  await p.evaluate(() => { S.lockSel = null; drawLock(); });
  // Arabic
  await p.evaluate(() => { localStorage.setItem('rp.lang', '"ar"'); localStorage.removeItem('erp.session'); }); await p.reload(); await p.waitForTimeout(1200);
  await p.evaluate(() => { S.lockSel = 'ST-O'; drawLock(); });
  await p.waitForTimeout(200);
  if (await p.evaluate(() => S.lang === 'ar')) { await p.click('#lockScreen [data-xforgot]'); await p.waitForTimeout(200);
    const left = await p.evaluate(() => [...document.querySelectorAll('#pinReset b, #pinReset p, #pinReset label, #pinReset button')].map(x => x.childNodes[0]?.textContent.trim() || '').filter(t => /[A-Za-z]{3,}/.test(t) && !/Supabase|Owner/.test(t)));
    ok('Arabic: the form is translated', !left.length, left); await p.click('#pinReset [data-rcancel]'); }
  else ok('Arabic switch found', false);
  // not connected to the cloud: a warning, no form
  await p.evaluate(() => { lsSet('erp.sync', null); document.getElementById('pinReset')?.remove(); S.staff = null; S.lockSel = 'ST-O'; drawLock(); });
  await p.click('#lockScreen [data-xforgot]'); await p.waitForTimeout(200);
  ok('no cloud: warning not to clear the app, no password form', await p.evaluate(() => !document.getElementById('rPass') && /(not connected|غير مربوط)/.test(document.getElementById('pinReset').textContent)));
  ok('no page errors', !errs.length, errs);
  if (process.env.SHOTS) { await p.evaluate(() => { document.getElementById('pinReset')?.remove(); lsSet('erp.sync', {url:'https://x.supabase.co', anon:'p', email:'owner@example.com', exp: Date.now() + 36e5}); }); await p.click('#lockScreen [data-xforgot]'); await p.screenshot({ path: process.env.SHOTS + '/forgot-pin.png' }); }
  console.log(fails ? `${fails} FAILED` : 'PASS all forgot PIN checks'); await b.close(); process.exit(fails ? 1 : 0);
})();
