// Grouped menu: group headings, every screen still reachable, crumb, screen finder (button and Ctrl+K), alert count, Arabic.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) for (const vp of [{ width: 1100, height: 800 }, { width: 390, height: 800 }]) {
    const ctx = await b.newContext({ viewport: vp }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); const tag = lang + ' ' + vp.width;
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    const tabs = await page.$$eval('nav.tabs [data-tab]', a => a.map(x => x.dataset.tab));
    ok(tabs.length === 15, tag + ' all 15 screens still in the menu', tabs);
    const heads = await page.$$eval('nav.tabs .ng', a => a.map(x => ({ t: x.textContent.trim(), v: x.offsetParent !== null })));
    ok(heads.length === 6, tag + ' six group headings', heads);
    ok(heads.every(h => h.v), tag + ' headings visible (side menu, or one cell each in the phone grid)', heads);
    const names = await page.$$eval('nav.tabs [data-tab]', a => a.map(x => x.textContent.trim()));
    ok(new Set(names).size === names.length, tag + ' no two screens share a name', names);
    ok(names[tabs.indexOf('money')] === (lang === 'en' ? 'Cash box' : 'صندوق النقد'), tag + ' Money is called Cash box', names[tabs.indexOf('money')]);
    const grpOf = await page.evaluate(() => { const out = {}; let g = ''; for (const el of document.querySelector('nav.tabs .tl').children) { if (el.classList.contains('ng')) g = el.dataset.grp; else if (el.dataset.tab) out[el.dataset.tab] = g; } return out; });
    ok(grpOf.items === 'purchasing' && grpOf.invoices === 'purchasing' && grpOf.stock === 'inventory', tag + ' Items (invoice lines) sits under Purchasing', grpOf);
    await page.evaluate(() => { S.tab = 'stock'; render(); }); await page.waitForTimeout(300);
    const crumb = await page.textContent('#crumb'); ok(lang === 'en' ? /Inventory/.test(crumb) : /المخزون/.test(crumb), tag + ' crumb shows the group', crumb);
    await page.evaluate(() => { S.tab = 'home'; render(); }); await page.waitForTimeout(200);
    ok((await page.textContent('#crumb')).trim() === '', tag + ' Home has no crumb');
    await page.click('#finderBtn'); await page.waitForTimeout(300);
    ok(await page.isVisible('#finderQ'), tag + ' finder opens from the button');
    await page.fill('#finderQ', lang === 'en' ? 'chron' : 'مزمن'); await page.waitForTimeout(200);
    ok(await page.locator('#finderList [data-xfindgo]').count() === 1, tag + ' finder filters to one screen');
    await page.press('#finderQ', 'Enter'); await page.waitForTimeout(400);
    ok(await page.evaluate(() => S.tab) === 'chronic', tag + ' Enter goes to the screen', await page.evaluate(() => S.tab));
    await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
    ok(await page.isVisible('#finderQ'), tag + ' Ctrl+K opens the finder');
    await page.evaluate(() => closeSheet());
    await page.evaluate(() => { E.chronic.push({ id: 'C-T', name: 'Test', active: true }); navCount.at = 0; });
    await page.evaluate(() => { navCount.v = { patients: 3 }; navCount.at = Date.now(); navGroups(); });
    ok(await page.evaluate(() => document.querySelector('.ng[data-grp="patients"] .nb').textContent) === '3', tag + ' group shows its alert count');
    ok(!errs.length, tag + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all menu checks'); process.exit(fails ? 1 : 0);
})();
