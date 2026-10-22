const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Audit probes (read-only copy of the ERP, fake claude.ai runtime, made-up test data only).
// Each probe prints OBSERVED facts; "DEFECT" means the observed behaviour breaks a control we expected.
const { chromium } = require('./pw');
const SP = ROOT + '';
const out = []; const rep = (id, defect, what, data) => out.push({id, result: defect ? 'DEFECT' : 'OK', what, data});
(async () => {
  const b = await chromium.launch();
  const fresh = async () => {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.addInitScript({ path: SP + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: require('./pw').XLSX_FILE, contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + SP + '/dist/erp-artifact.html'); await p.waitForTimeout(800);
    await p.evaluate(() => {
      Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}});
      __seed('suppliers', [{id:'SUP-T', name:'Test supplier', creditDays:30}]);
      __seed('invoices', [{id:'INV-T', supplierId:'SUP-T', invoiceNo:'T1', date:today(), type:'credit', status:'Approved for Posting', printedTotal:30000,
        lines:[{desc:'Alpha 10mg Tablet 10 tab', name:'Alpha', strength:'10mg', form:'Tablet', pack:10, qty:10, price:1000, value:10000, batch:'A1', expiry:'2028-01'},
               {desc:'Beta 20mg Syrup', name:'Beta', strength:'20mg', form:'Syrup', qty:10, price:2000, value:20000, batch:'B1', expiry:'2028-01'}]}]);
    });
    await p.waitForTimeout(400); return p;
  };
  const ids = p => p.evaluate(() => { const c = catalog(); return {a: c.find(x => x.name === 'Alpha')?.id, b: c.find(x => x.name === 'Beta')?.id}; });
  const stock = (p, id) => p.evaluate(id => { const x = catalog().find(q => q.id === id); return x ? stockOf(x, usedMap()).good : 'ITEM GONE'; }, id);
  const sell = (p, pid, qty, extra) => p.evaluate(async ([pid, qty, extra]) => {
    S.tab = 'sell'; render(); S.cart = []; S.cartMeta = {}; addToCart(pid); S.cart[0].qty = qty; if (extra?.price !== undefined) S.cart[0].price = extra.price; Object.assign(S.cartMeta, extra?.meta || {}); render();
    if (extra?.force) document.getElementById('xForce').checked = true;
    document.getElementById('sellForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));
    return {err: document.getElementById('xErr')?.textContent || '', sales: E.sales.length};
  }, [pid, qty, extra || {}]);
  const setPrice = (p, pid, v) => p.evaluate(async ([pid, v]) => { await write('products/' + pid, {id:pid, sellBox:v}); }, [pid, v]);

  // P1/P2/P10/P11: a cashier allowed only "Sell" tries sensitive actions; they must be refused unless the owner types the PIN
  { const p = await fresh(); const I = await ids(p); await setPrice(p, I.b, 3000); await p.waitForTimeout(150);
    await p.evaluate(async () => { __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}, {id:'ST-C', name:'Cashier', role:'cashier', active:true, perms:['sell']}]); });
    await p.waitForTimeout(150); await p.evaluate(() => { S.staff = E.staff.find(x => x.id === 'ST-C'); render(); });
    // owner dialog helper: answer = null (press Cancel) or a PIN
    const answer = pin => p.evaluate(async pin => { for (let i = 0; i < 40 && !document.getElementById('ownerPin'); i++) await new Promise(r => setTimeout(r, 25)); const el = document.getElementById('ownerPin'); if (!el) return 'no dialog';
      if (pin === null){ el.querySelector('[data-ocancel]').click(); return 'cancelled'; } for (const ch of pin) el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); await new Promise(r => setTimeout(r, 150)); return document.getElementById('ownerPin') ? 'still open: ' + el.querySelector('.err')?.textContent : 'accepted'; }, pin);
    const r0 = await sell(p, I.b, 1);
    const view = await p.evaluate(() => ({tabs:[...document.querySelectorAll('nav.tabs [data-tab]')].filter(b => !b.hidden).map(b => b.dataset.tab)}));
    await p.evaluate(() => { closeSheet(); render(); }); await p.waitForTimeout(150);
    const openedCard = await p.evaluate(async () => { const btn = document.querySelector('[data-xprod]'); if (!btn) return 'no item button on Sell'; btn.click(); await new Promise(r => setTimeout(r, 200)); return document.getElementById('prodForm') ? 'item card open' : 'not open'; });
    const priceAfter = await p.evaluate(id => catalog().find(x => x.id === id).sellBox, I.b);
    rep('P1', openedCard === 'item card open', 'Cashier (Sell only) taps an item on Sell to open the item card (price and write-off)', {cashierScreens:view.tabs, openedCard, priceAfter});
    // cancel sale: refused without the owner, works with the owner PIN, and records the reason
    const voidStep = () => p.evaluate(async () => { const s = E.sales[0]; receiptSheet(s.id); const btn = document.querySelector('[data-xsalevoid]'); btn.click(); document.getElementById('voidReason').value = 'customer changed mind'; btn.click(); });
    await voidStep(); const a1 = await answer(null); await p.waitForTimeout(200); const v1 = await p.evaluate(() => !!E.sales[0].voided);
    await p.evaluate(() => closeSheet()); await voidStep(); const a2 = await answer('9999'); const a3 = await answer('1234'); await p.waitForTimeout(250);
    const v2 = await p.evaluate(() => ({voided:!!E.sales[0].voided, reason:E.sales[0].voidReason, approvedBy:E.sales[0].approvedBy}));
    rep('P2', v1 || !v2.voided || v2.approvedBy !== 'ST-O', 'Cashier cancels a sale: refused when owner presses Cancel; wrong PIN refused; owner PIN allows it', {ownerCancelled:a1, voidedWithoutOwner:v1, wrongPin:a2, rightPin:a3, after:v2});
    const s11 = sell(p, I.b, 1, {price:1}); const a11 = await answer(null); const r1 = await s11;
    rep('P11', !r1.err.includes("owner"), 'Cashier sells at 1 IQD (box price 3000) and the owner presses Cancel', {dialog:a11, err:r1.err, sales:r1.sales});
    const s10 = sell(p, I.b, 50, {force:true}); const a10 = await answer(null); const r2 = await s10;
    rep('P10', !r2.err.includes("owner"), 'Cashier sells 50 with ~9 in stock ("sell anyway" ticked), owner presses Cancel', {dialog:a10, err:r2.err, stockAfter: await stock(p, I.b)});
    const s10b = sell(p, I.b, 50, {force:true}); const a10b = await answer('1234'); const r3 = await s10b;
    rep('P10b', !!r3.err, 'Same oversell, owner types the PIN: sale saved and marked approved', {dialog:a10b, err:r3.err, approvedBy: await p.evaluate(() => E.sales.sort((a,b) => a.at.localeCompare(b.at)).slice(-1)[0]?.approvedBy)});
    await p.close(); }

  // P3: invoice lines keep their identity when other lines are removed (through the real invoice editor)
  { const p = await fresh(); const I = await ids(p); await setPrice(p, I.a, 1500); await setPrice(p, I.b, 3000); await p.waitForTimeout(100);
    await sell(p, I.b, 4); const before = {alpha: await stock(p, I.a), beta: await stock(p, I.b)};
    const editRemove = (lineNo) => p.evaluate(async n => { closeSheet(); invoiceForm('INV-T'); await new Promise(r => setTimeout(r, 100));
      document.querySelectorAll('#lines .lineedit')[n].querySelector('[data-delline]').click(); await new Promise(r => setTimeout(r, 50));
      const left = document.querySelectorAll('#lines .lineedit').length; const rs = document.getElementById('fReason'); if (rs) rs.value = 'audit test';
      document.getElementById('fTotal').value = left === 1 ? '20000' : '30000';
      document.getElementById('invForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));
      return {linesInForm:left, saved:S.invoices.find(i => i.id === 'INV-T').lines.length, err:document.getElementById('formErr')?.textContent || ''}; }, lineNo);
    const tryUsed = await editRemove(1);   // Beta has sales: must be refused
    const afterUsed = {beta: await stock(p, I.b)};
    const rmUnused = await editRemove(0);  // Alpha has no sales: allowed, Beta must not move
    const after = {alpha: await stock(p, I.a), beta: await stock(p, I.b)};
    rep('P3', !(tryUsed.linesInForm === 2 && afterUsed.beta === before.beta && after.beta === before.beta), 'Sold 4 Beta (line 2). Tried to remove Beta (has sales), then removed Alpha (no sales)', {before, tryRemoveUsedLine:tryUsed, rmUnused, after, note:'Beta must stay at 6 boxes'});
    await p.close(); }

  // P4: correcting an invoice line's name in the invoice editor keeps the product (price, stock, sales)
  { const p = await fresh(); const I = await ids(p); await setPrice(p, I.b, 3000); await p.waitForTimeout(100); await sell(p, I.b, 2);
    await p.evaluate(async () => { closeSheet(); invoiceForm('INV-T'); await new Promise(r => setTimeout(r, 100)); document.querySelectorAll('#lines .lineedit')[1].querySelector('[data-f="name"]').value = 'Beta Plus';
      document.getElementById('fReason').value = 'name typo'; document.getElementById('invForm').requestSubmit(); await new Promise(r => setTimeout(r, 300)); });
    const r = await p.evaluate(oldId => { const c = catalog(); const x = c.find(q => q.id === oldId); return {sameId:!!x, name:x?.name, price:x?.sellBox ?? null, stock:x ? stockOf(x, usedMap()).good : null, products:c.length}; }, I.b);
    rep('P4', !(r.sameId && r.price === 3000 && r.stock === 8 && r.products === 2), 'Corrected an invoice line name (Beta to Beta Plus) after pricing and selling 2', r);
    await p.close(); }

  // P5: putting an invoice on hold removes its stock even after sales were made from it
  { const p = await fresh(); const I = await ids(p); await setPrice(p, I.b, 3000); await p.waitForTimeout(100); await sell(p, I.b, 2);
    await p.evaluate(async () => { closeSheet(); invoiceDetail('INV-T'); await new Promise(r => setTimeout(r, 100)); document.querySelector('[data-hold="INV-T"]').click(); await new Promise(r => setTimeout(r, 250)); }); await p.waitForTimeout(150);
    const held = await p.evaluate(() => S.invoices.find(i => i.id === 'INV-T').status === 'On Hold');
    rep('P5', held, 'Put the invoice On Hold after selling from it', {held, betaStock: await stock(p, I.b), catalogSize: await p.evaluate(() => catalog().length), saleStillCounts: await p.evaluate(() => E.sales.filter(s => !s.voided).length)});
    await p.close(); }

  // P6: restoring an older backup silently un-cancels a cancelled sale
  { const p = await fresh(); const I = await ids(p); await setPrice(p, I.b, 3000); await p.waitForTimeout(100); await sell(p, I.b, 1);
    await p.evaluate(async () => { closeSheet(); S.tab = 'settings'; render(); await backupAll(document.querySelector('[data-xbackup]')); });
    await p.evaluate(async () => { await write('sales/' + E.sales[0].id, {voided:true, voidedAt:nowIso()}, true); }); await p.waitForTimeout(150);
    const mid = await p.evaluate(() => E.sales[0].voided);
    await p.evaluate(async () => { const f = __saved[__saved.length - 1].blob; await restoreFile(new File([await f.text()], 'b.json')); window.__plan = {add:S.restore.add.length, replace:S.restore.replace.length, keep:S.restore.keep}; document.querySelector('[data-xrestore]')?.click(); }); await p.waitForTimeout(300);
    const end = await p.evaluate(() => !!E.sales[0].voided);
    rep('P6', mid && !end, 'Backup, then cancel a sale, then restore the backup', {voidedBeforeRestore:mid, voidedAfterRestore:end, plan: await p.evaluate(() => window.__plan)});
    await p.close(); }

  // P7/P8: day close is not a lock; cancelling a chronic sale keeps "given this month"
  { const p = await fresh(); const I = await ids(p); await setPrice(p, I.b, 3000); await p.waitForTimeout(100);
    await p.evaluate(async () => { await write('chronic/CH-T', {id:'CH-T', name:'Test patient', day:1, active:true, meds:[], given:{}}); }); await p.waitForTimeout(100);
    await sell(p, I.b, 1, {meta:{chronicId:'CH-T'}});
    await p.evaluate(async () => { closeSheet(); S.tab = 'money'; render(); document.getElementById('clAmt').value = '3000'; document.getElementById('closeForm').requestSubmit(); await new Promise(r => setTimeout(r, 250)); });
    const c1 = await p.evaluate(() => ({close: E.closes[0] && {expected:E.closes[0].expected, diff:E.closes[0].diff}}));
    await p.evaluate(async () => { closeSheet(); receiptSheet(E.sales[0].id); const b = document.querySelector('[data-xsalevoid]'); b.click(); document.getElementById('voidReason').value = 'test'; b.click(); await new Promise(r => setTimeout(r, 300)); }); await p.waitForTimeout(150);
    const c2 = await p.evaluate(() => ({expectedNow: dayCash(today()).expected, after: dayCash(today()).after, savedClose: E.closes[0].expected, chronicGiven: (E.chronic[0].given || {})[ym()] || null}));
    rep('P7', c2.expectedNow !== c2.savedClose || !c2.after, 'Closed the day with 3000 counted, then cancelled the sale: closed figure must stay, change shown as after closing', {...c1, ...c2});
    rep('P8', !!c2.chronicGiven, 'Cancelled the chronic patient\'s sale: card still says given this month', {chronicGiven:c2.chronicGiven});
    await p.close(); }

  // P9: two quick taps on Save sale
  { const p = await fresh(); const I = await ids(p); await setPrice(p, I.b, 3000); await p.waitForTimeout(100);
    const n = await p.evaluate(async id => { S.tab = 'sell'; render(); addToCart(id); render(); const f = document.getElementById('sellForm'); f.requestSubmit(); f.requestSubmit(); await new Promise(r => setTimeout(r, 400)); return E.sales.length; }, I.b);
    rep('P9', n !== 1, 'Double tap on Save sale', {salesSaved:n});
    // receipt numbers come from this device's count of today's sales: a second device makes the same number
    await p.evaluate(async () => { const s = structuredClone(E.sales[0]); s.id = 'SL-OTHERDEVICE'; s.no = s.no; await write('sales/' + s.id, s); }); await p.waitForTimeout(150);
    { const nums = await p.evaluate(() => { const a = E.sales[0].no; return {thisDevice:a, hasDeviceTag:/^\d{6}-[A-Z0-9]{3}-\d+$/.test(a)}; });
      rep('P9b', !nums.hasDeviceTag, 'Receipt number now carries a device tag (date-DEV-n), so two offline devices cannot make the same number', nums); }
    await p.close(); }

  // P12: customer payment larger than the debt
  { const p = await fresh();
    const r = await p.evaluate(async () => { await write('customers/CU-T', {id:'CU-T', name:'Test customer'}); await new Promise(r => setTimeout(r, 100)); custSheet('CU-T'); document.getElementById('cpAmt').value = '50000'; document.getElementById('cpForm').requestSubmit(); await new Promise(r => setTimeout(r, 250)); const first = custBalance('CU-T').bal, warn = document.getElementById('cpErr')?.textContent || document.querySelector('#cpForm .err')?.textContent || ''; document.getElementById('cpForm').requestSubmit(); await new Promise(r => setTimeout(r, 250)); return {afterFirstSave:first, warning:warn, afterSecondSave:custBalance('CU-T').bal}; });
    rep('P12', r.afterFirstSave < 0 || !r.warning, 'Customer with no debt "pays" 50,000: first Save must warn, second Save records credit', r);
    await p.close(); }

  // P13: script in an item name (from an invoice line) is shown as text
  { const p = await fresh();
    const r = await p.evaluate(async () => { window.__xss = 0; const inv = structuredClone(S.invoices[0]); inv.lines[0].name = '<img src=x onerror="window.__xss=1">'; await write('invoices/INV-T', inv); await new Promise(r => setTimeout(r, 200)); for (const t of ['stock','sell','pricing','home']){ S.tab = t; render(); } S.tab='stock'; render(); await new Promise(r => setTimeout(r, 300)); return window.__xss; });
    rep('P13', r === 1, 'HTML in an item name rendered on Stock, Sell, Pricing, Home', {scriptRan: r === 1});
    await p.close(); }

  // P14: sale edits after save? stock adjust has no reason gate for "more found"
  { const p = await fresh(); const I = await ids(p);
    await p.evaluate(async () => { __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}, {id:'ST-C', name:'Clerk', role:'pharmacist', active:true, perms:['stock']}]); await new Promise(r => setTimeout(r, 100)); S.staff = E.staff.find(x => x.id === 'ST-C'); });
    setTimeout(() => p.evaluate(() => document.querySelector('#ownerPin [data-ocancel]')?.click()).catch(() => {}), 700);
    const r = await p.evaluate(async id => { prodSheet(id); document.getElementById('aReason').value = 'Count correction (more found)'; document.getElementById('aQty').value = '500'; document.getElementById('adjForm').requestSubmit(); await new Promise(r => setTimeout(r, 1200)); const x = catalog().find(q => q.id === id); return {stock: stockOf(x, usedMap()).good, value: Math.round(stockOf(x, usedMap()).value)}; }, I.b);
    rep('P14', r.stock !== 10, 'Pharmacist with Stock adds 500 "found" boxes; owner presses Cancel', r);
    await p.close(); }

  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.log('CRASH', e); process.exit(1); });
