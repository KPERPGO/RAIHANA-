"""Builds the Raihana ERP from the first app's page (base.html) plus the ERP files.
Outputs: dist/erp-artifact.html (claude.ai preview) and dist/app/ (installable offline app).
With --site it also copies the app to the repository root, which GitHub Pages serves."""
import os, re, sys, json, shutil
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
base = open(os.path.join(HERE, "base.html"), encoding="utf-8").read()
shim = open(os.path.join(HERE, "shim.js"), encoding="utf-8").read()
erp = open(os.path.join(HERE, "erp.js"), encoding="utf-8").read()

def rep(old, new, count=1):
    global base
    if base.count(old) != count:
        sys.exit(f"patch failed ({base.count(old)} matches): {old[:80]}")
    base = base.replace(old, new)

# screens appear at once: no counting-up numbers and no slide-in (both looked like glitches on the phone)
rep("""  function countUp(root){
    if (calm()) return;""", """  function countUp(root){
    return; // ERP: totals show their real value straight away""")
rep("<title>Raihana Pharmacy Payables</title>", "<title>Raihana Pharmacy ERP</title>")
# audit F-01: every invoice line keeps a permanent id ("lid"), so sales, returns and stock changes stay on the right
# line when other lines are removed or moved. Old lines without an id use their position, which is what they were saved with.
rep("""  if (!i.lines || !i.lines.length) i.lines = [{}];
  S.draft = i;""", """  if (!i.lines || !i.lines.length) i.lines = [{}];
  if (id) i.lines.forEach((l, k) => { if (l.lid == null) l.lid = String(k); });
  S.draft = i;""")
rep("""  return `<div class="lineedit" data-line="${k}" data-no="${esc(l.no||"")}">""", """  return `<div class="lineedit" data-line="${k}" data-lid="${esc(l.lid ?? "")}" data-pid="${esc(l.pid ?? "")}" data-no="${esc(l.no||"")}">""")
rep("""    return {no: el.dataset.no || undefined, note:""", """    return {lid: el.dataset.lid || undefined, pid: el.dataset.pid || undefined, no: el.dataset.no || undefined, note:""")
# zero-stock protection: the ERP's one stock check (STOCK in erp.js) runs before an invoice edit, a receiving count or a
# return to the supplier is saved, so no batch goes below zero. A new line that looks like an item you have asks first.
rep("""  if (c.dup){ err.textContent = `${supName(inv.supplierId)} invoice ${inv.invoiceNo} is already in the app. Open that one instead of adding a duplicate.`; return; }
""", """  if (c.dup){ err.textContent = `${supName(inv.supplierId)} invoice ${inv.invoiceNo} is already in the app. Open that one instead of adding a duplicate.`; return; }
  { const stop = window.ERP_INV_GUARD?.(inv); if (stop){ err.innerHTML = stop; return; } }
""")
rep("""  if (Object.values(rl).some(r => !isNum(r.qty) || r.qty < 0)){ $("#rcErr").textContent = "Use whole numbers for received quantities."; return; }
""", """  if (Object.values(rl).some(r => !isNum(r.qty) || r.qty < 0)){ $("#rcErr").textContent = "Use whole numbers for received quantities."; return; }
  { const stop = window.ERP_RECV_GUARD?.(i, rl); if (stop){ $("#rcErr").textContent = stop; return; } }
""")
rep("""max:Math.max(0, n0(l.qty) + n0(l.bonus) - returnedQty(inv.id, k))}))""", """max:(m => isNum(m) ? Math.min(m, Math.max(0, n0(l.qty) + n0(l.bonus) - returnedQty(inv.id, k))) : Math.max(0, n0(l.qty) + n0(l.bonus) - returnedQty(inv.id, k)))(window.ERP_RET_MAX?.(inv, k))}))""")
rep("""  if (!isNum(amt) || amt <= 0){ err.textContent = "Enter the amount in IQD."; return; }
""", """  if (!isNum(amt) || amt <= 0){ err.textContent = "Enter the amount in IQD."; return; }
  { const stop = window.ERP_RET_GUARD?.($("#cInv").value, S.crPick); if (stop){ err.textContent = stop; return; } }
""")
# Excel/CSV upload: a new invoice can be filled from a file; the form then says the lines came from the file, not a photo
rep("""  openSheet(id ? "Edit invoice" : pre ? "Check scanned invoice" : "Add invoice", `
    ${pre ? `<div class="banner">Read from the photo. Check every line against the paper before saving. Nothing is saved until you tap Save.</div>` : ""}
    ${ex && ex.uncertain && ex.uncertain.length ? `<div class="sum"><b>Couldn't read clearly</b>""", """  const fromFile = ex?.source === "file";
  openSheet(id ? "Edit invoice" : pre ? (fromFile ? "Check invoice from file" : "Check scanned invoice") : "Add invoice", `
    ${pre ? `<div class="banner">${fromFile ? `Filled from the file ${esc(ex.file || "")}. Check every line against the paper invoice before saving. Blank prices, batches and expiry dates stay blank until you type them.` : "Read from the photo. Check every line against the paper before saving."} Nothing is saved until you tap Save.</div>` : ""}
    ${id ? "" : `<div class="actions"><button type="button" data-xinvfile="1">Fill lines from Excel or CSV</button></div>`}
    ${ex && ex.uncertain && ex.uncertain.length ? `<div class="sum"><b>${fromFile ? "Please check" : "Couldn't read clearly"}</b>""")
rep("""<b>Flagged when read from the photo</b>""", """<b>${i.extraction.source === "file" ? "Flagged when filled from the file" : "Flagged when read from the photo"}</b>""")
rep("""  if (!inv.id){ inv.pid = nextPid(); inv.id = inv.pid; inv.createdAt = new Date().toISOString(); inv.createdBy = S.meId; inv.receiving = "pending"; }
""", """  if (!inv.id){ inv.pid = nextPid(); inv.id = inv.pid; inv.createdAt = new Date().toISOString(); inv.createdBy = S.meId; inv.receiving = "pending"; }
  { // new lines get the next id, never one used before on this invoice; receiving checks follow their line
    const lidOf = (l, j) => String(l.lid ?? j), nums = [...(old?.lines || []).map(lidOf), ...inv.lines.filter(l => l.lid != null).map(l => l.lid)].map(Number).filter(Number.isFinite);
    let seq = Math.max(n0(old?.lidSeq), nums.length ? Math.max(...nums) + 1 : 0);
    inv.lines.forEach(l => { if (l.lid == null) l.lid = String(seq++); }); inv.lidSeq = seq;
    window.ERP_KEEP_PRODUCT?.(old, inv);
    if (old?.receivedLines){ const pos = {}; (old.lines || []).forEach((l, j) => pos[lidOf(l, j)] = j); const rl = {};
      inv.lines.forEach((l, k) => { const r = old.receivedLines[pos[l.lid]]; if (r) rl[k] = r; }); inv.receivedLines = rl; }
  }
""")
rep("""function returnedQty(invId, k){ return S.credits.filter(x => x.invoiceId === invId && x.lines).reduce((a,x) => a + n0(x.lines.find(y => y.k === k)?.qty), 0); }""",
    """function returnedQty(invId, k){ const l = S.invoices.find(i => i.id === invId)?.lines?.[k], lid = String(l?.lid ?? k);
  return S.credits.filter(x => x.invoiceId === invId && x.lines).reduce((a,x) => a + n0(x.lines.find(y => String(y.lid ?? y.k) === lid)?.qty), 0); }""")
rep("""return {k:+k, desc:l?.desc || "",""", """return {k:+k, lid:String(l?.lid ?? +k), desc:l?.desc || "",""")
NAV_OLD = re.search(r'<nav class="tabs".*?</nav>', base, re.S).group(0)
TABS = [("home","Home"),("sell","Sell"),("stock","Stock"),("pricing","Pricing"),("chronic","Chronic"),("invoices","Invoices"),("items","Items"),("payments","Payments"),("suppliers","Suppliers"),("customers","Customers"),("money","Cash box"),("books","Accounts"),("reports","Reports"),("staff","Staff"),("settings","Settings")]
# the menu is grouped by the work being done; every screen keeps its own route and permission
# Items lists the lines of purchase invoices (supplier, batch, unit cost), so it sits under Purchasing; the medicine catalogue is in Stock.
# A short name is shown on phones, where each heading takes one cell of the screen grid.
GROUP_SHORT = {"sales":"Sales", "admin":"Admin"}
GROUPS = [("home","Home",["home"]),("sales","Dispensing and sales",["sell"]),("patients","Patients",["customers","chronic"]),("inventory","Inventory",["stock"]),("purchasing","Purchasing",["invoices","items","suppliers"]),("pricing","Pricing",["pricing"]),("finance","Finance",["payments","money","books"]),("reports","Reports",["reports"]),("admin","Administration",["staff","settings"])]
assert sorted(k for _,_,ks in GROUPS for k in ks) == sorted(k for k,_ in TABS)
MENU_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
# The screen bar sits right under the top bar: Menu first, then one small button per screen
# .shell holds the screen bar and the page; on wide screens it turns into a side list (see CSS)
nav = ('<div class="shell"><nav class="tabs" aria-label="Sections"><div class="in">\n'
       f'  <button type="button" class="navmenu" data-xmenu="1" aria-label="Show or hide screens" aria-expanded="true">{MENU_SVG}<span>Menu</span></button>\n'
       '  <div class="tl">\n' + "\n".join(
           (f'  <span class="ng" data-grp="{g}"><span class="gl">{gn}</span><span class="gs">{GROUP_SHORT.get(g, gn)}</span><i class="nb" hidden></i></span>\n' if gn != dict(TABS)[ks[0]] else "") +
           "\n".join(f'  <button type="button" data-tab="{k}" data-g="{g}"{" class=\"gsep\"" if j == 0 and g != "home" and gn == dict(TABS)[ks[0]] else ""}{" aria-current=\"page\"" if k=="home" else ""}>{dict(TABS)[k]}</button>' for j, k in enumerate(ks))
           for g,gn,ks in GROUPS) + '\n  </div>\n</div></nav>')
rep(NAV_OLD, "")
rep('<div id="banner" class="wrap" hidden style="padding-block:8px 0"><div class="banner" id="bannerText"></div></div>\n<main class="wrap" id="view"></main>',
    '<div class="mcol"><div id="banner" class="wrap" hidden style="padding-block:8px 0"><div class="banner" id="bannerText"></div></div>\n<main class="wrap" id="view"></main></div></div>')
rep("nav.tabs .in{max-width:760px;margin:0 auto;display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}",
    "nav.tabs .in{max-width:1000px;margin:0 auto;display:flex;align-items:center;gap:6px;padding:6px max(12px,env(safe-area-inset-left,0px))}")
rep("payments:paymentsView, suppliers:suppliersView, reports:window.reportsView || (() => \"\")})[S.tab]()",
    "payments:paymentsView, suppliers:suppliersView, reports:window.reportsView || (() => \"\"), ...(window.ERP_VIEWS || {})})[S.tab]()")
ERP_CSS = """<style>
/* ERP: app shell. The page itself never grows: only the middle part scrolls, so the top bar and the tab bar stay on screen everywhere */
html,body{height:100%}
body{padding-bottom:0!important;display:flex;flex-direction:column;overflow:hidden;overscroll-behavior:none}
header.top{position:relative!important;top:auto!important;flex:none}
#banner{flex:none}
/* the page area is taller than short pages: keep sections and their rows at their own height instead of stretching to fill it */
main#view,main#view .sec{align-content:start}
main#view{flex:1 1 auto;min-height:0;width:100%;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-bottom:24px}
nav.tabs{position:relative!important;flex:none;bottom:auto!important;border-top:0!important;border-bottom:1px solid var(--line);padding-bottom:0!important;z-index:5}
body::before{display:none}
.sticky-save{bottom:0!important}
.toast{bottom:calc(20px + env(safe-area-inset-bottom,0px))}
@media print{html,body{height:auto;overflow:visible;display:block}}
/* ERP: touch-friendly sizes, wider screens, receipt printing */
/* every screen button is always on view: small buttons that wrap onto a second row when the screen is narrow */
nav.tabs .in{align-items:flex-start}
nav.tabs .tl{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px}
nav.tabs .tl button{flex:0 0 auto;min-width:0;min-height:34px!important;height:34px;padding:0 11px;border-radius:999px;font-size:13px;color:var(--muted);box-shadow:none!important}
nav.tabs .tl button:hover{background:var(--sunk);color:var(--fg)}
nav.tabs .tl button[aria-current="page"]{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);font-weight:600}
nav.tabs .navmenu{flex:none;min-width:0;min-height:34px!important;height:34px;padding:0 12px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--accent-ink)!important;background:var(--accent)!important;box-shadow:none!important}
@media (min-width:1000px){nav.tabs .in{max-width:1160px}nav.tabs .tl{gap:2px}nav.tabs .tl button{padding:0 10px}}
/* phone: Menu and all screens in one even grid of 5 columns (3 short rows), so no screen is ever hidden off the edge */
/* Menu hides or shows the screen list. Tablet and wider (iPad both ways): the list stands on the left, one screen per line */
.shell,.mcol{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column}
body.navshut nav.tabs .tl{display:none}
nav.tabs .ng,.nb[hidden]{display:none}
/* group headings open and close their screens (see navGroups); a closed group hides its screens except the one in use */
nav.tabs .tl button.gshut{display:none!important}
nav.tabs .ng{cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;border-radius:8px}
nav.tabs .ng:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
nav.tabs .ng[aria-expanded=true]{background:color-mix(in srgb,var(--accent) 10%,transparent)}
nav.tabs .ng .gl::after,nav.tabs .ng .gs::after{content:" ▸"}html[dir=rtl] nav.tabs .ng .gl::after,html[dir=rtl] nav.tabs .ng .gs::after{content:" ◂"}
nav.tabs .ng[aria-expanded=true] .gl::after,nav.tabs .ng[aria-expanded=true] .gs::after,html[dir=rtl] nav.tabs .ng[aria-expanded=true] .gl::after,html[dir=rtl] nav.tabs .ng[aria-expanded=true] .gs::after{content:" ▾"}
.crumb{color:var(--muted);font-weight:400}.crumb:empty{display:none}
.nb{display:inline-block;min-width:16px;height:16px;line-height:16px;border-radius:8px;background:var(--bad);color:#fff;font:600 10px/16px var(--mono);text-align:center;margin-inline-start:6px;font-style:normal}
body.navshut nav.tabs .in{display:flex}
@media (min-width:761px){.shell{flex-direction:row}
nav.tabs{width:200px;flex:none;border-bottom:0!important;border-inline-end:1px solid var(--line);overflow-y:auto}
nav.tabs .in{max-width:none;margin:0;flex-direction:column;align-items:stretch;gap:6px;padding:8px}
nav.tabs .tl{flex-direction:column;flex-wrap:nowrap;gap:0}
nav.tabs .ng{display:flex;align-items:center;min-height:28px;margin:3px 0 0;padding:0 8px;line-height:14px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--accent)}nav.tabs .ng[hidden]{display:none}nav.tabs .ng .gs{display:none}
nav.tabs .tl button{width:100%;height:26px;min-height:26px!important;padding:0 12px;border-radius:8px;font-size:14px;text-align:start;justify-content:flex-start}
nav.tabs .navmenu{justify-content:flex-start;height:34px;min-height:34px!important;border-radius:8px}
/* a group with no heading (Pricing, Reports) starts with a thin line, so it does not read as part of the group above */
nav.tabs .tl button.gsep{margin-top:5px;overflow:visible}nav.tabs .tl button.gsep::before{content:"";position:absolute;inset-inline:4px;top:-3px;border-top:1px solid var(--line)}nav.tabs .tl button{position:relative}
body.navshut nav.tabs{width:auto}}
@media (max-width:760px){nav.tabs .in{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;padding:5px 8px}nav.tabs .tl{display:contents}
nav.tabs .tl button,nav.tabs .navmenu{width:100%;height:30px;min-height:30px!important;padding:0 2px;font-size:12px;justify-content:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
nav.tabs .ng{display:flex;align-items:center;justify-content:center;gap:2px;height:30px;padding:0 2px;border:1px solid var(--line);font-size:9.5px;font-weight:700;letter-spacing:0;text-transform:uppercase;color:var(--accent);text-align:center;line-height:11px;overflow:hidden;white-space:nowrap}nav.tabs .ng[hidden]{display:none}
nav.tabs .ng .gl{display:none}nav.tabs .ng .nb{margin:0;min-width:14px;height:14px;line-height:14px;font-size:9px}nav.tabs .navmenu{gap:3px}nav.tabs .navmenu svg{width:14px;height:14px;flex:none}}
button,.btn{min-height:44px}
.row{min-height:52px}
.lineedit .lh button,.list .end button{min-height:36px}
input,select{min-height:44px}
.chips button{min-height:40px}
/* Home: quick buttons for the most common jobs */
.quickacts{display:flex;flex-wrap:wrap;gap:8px;order:-1}.quickacts button{min-height:44px;padding:0 16px;border-radius:999px;font-weight:600}
.repidx{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.repidx h3{margin:4px 2px 6px;font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}.repidx .row{min-height:44px}html[dir=rtl] .repidx .end{transform:scaleX(-1)}
@media (min-width:1000px){.wrap,header.top .in{max-width:1000px}.sheet .panel{max-width:900px}}
#printArea{display:none}
.tabsale{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.tabsale::-webkit-scrollbar{display:none}
.tabsale button{flex:0 0 auto;display:grid;gap:2px;text-align:start;min-width:120px;padding:8px 14px;border-radius:12px;background:var(--surface)}
.tabsale button span:last-child{font-size:12px;font-weight:500;color:var(--muted)}
.tabsale button[aria-selected="true"]{background:linear-gradient(120deg,var(--accent),var(--accent2));border-color:var(--accent);color:var(--accent-ink)}
.tabsale button[aria-selected="true"] span:last-child{color:inherit;opacity:.85}
.tabsale button.add{min-width:auto;align-content:center;border-style:dashed;color:var(--accent)}
.kbdhint{margin:0;font-size:12px}@media (hover:none),(max-width:700px){.kbdhint{display:none}}
.quick{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.quick button{display:grid;gap:3px;align-content:start;text-align:start;min-height:88px;padding:10px 12px;border-radius:12px;font-weight:500;background:var(--surface);border:1px solid var(--line);box-shadow:inset 0 -3px 0 var(--accent2)}
.quick button b{font-size:15px;overflow-wrap:anywhere}.quick button span{font-size:12px;color:var(--muted)}.quick button .num{font-size:14px;color:var(--fg);font-weight:600}
.quick button.out{opacity:.55;box-shadow:inset 0 -3px 0 var(--bad)}
.stepper{display:flex;gap:6px;align-items:stretch}.stepper button{min-width:52px;font-size:22px;line-height:1;padding:0}.stepper input{flex:1;text-align:center;font-size:18px;min-width:0}.stepper select{width:auto;flex:none}
table.prt tr.chg td{background:color-mix(in srgb,var(--accent2) 10%,transparent)}table.prt input{min-height:40px}
@media (max-width:640px){table.prt{min-width:0}table.prt thead{display:none}table.prt tr{display:grid;grid-template-columns:36px repeat(2,minmax(0,1fr));gap:4px 10px;padding:10px 12px;border-top:1px solid var(--line)}table.prt td{border:0;padding:0;text-align:start}table.prt td.ck{grid-row:span 3;padding-top:2px}table.prt td.nm{grid-column:2/-1}table.prt td[data-l]::before{content:attr(data-l);display:block;font-size:11.5px;color:var(--muted);font-family:var(--sans)}table.prt td input{width:100%!important;text-align:start!important}}
.sticky-save{position:sticky;bottom:calc(64px + env(safe-area-inset-bottom,0px));z-index:4;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--accent);border-radius:12px;padding:10px 14px;box-shadow:0 6px 20px rgba(0,0,0,.12)}
#ownerPin{position:fixed;inset:0;z-index:60;background:rgba(10,20,30,.55);display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top,0px)) 16px max(16px,env(safe-area-inset-bottom,0px));overflow:auto}
#lockScreen{position:fixed;inset:0;z-index:50;background:linear-gradient(160deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top,0px)) 16px max(16px,env(safe-area-inset-bottom,0px));overflow:auto}
.lockin{background:var(--surface);color:var(--fg);border-radius:18px;padding:20px;width:100%;max-width:380px;display:grid;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.lockhead{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.lockhead .ar{color:var(--accent2)}.lockhead .num{width:100%;color:var(--muted);font-size:13px}
.lockstaff{display:grid;gap:8px}.lockstaff button{display:grid;gap:2px;text-align:start;padding:14px 16px;min-height:64px;font-size:16px}.lockstaff span{font-size:12.5px;color:var(--muted);font-weight:500}
.pindots{display:flex;gap:10px;justify-content:center}.pindots span{width:14px;height:14px;border-radius:50%;border:2px solid var(--accent)}.pindots span.on{background:var(--accent)}
.pinpad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.pinpad button{min-height:64px;font-size:24px;border-radius:14px}
#boot{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--bg);transition:opacity .3s ease}
#boot.out{opacity:0;pointer-events:none}
#boot .ring{position:relative;width:132px;height:132px;display:grid;place-items:center}#boot .ring svg{position:absolute;inset:0}
#boot b{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--fg)}#boot .bn{font-size:14px;color:var(--muted)}#boot .ar{color:var(--accent2)}
.formula{display:grid;gap:2px;font-family:var(--mono);font-size:12.5px;background:var(--sunk);border-radius:8px;padding:8px 10px}
#view.enter > *,#view.enter .kpi,#view.enter .list > *{animation:none!important}
/* pop-up windows: always in the middle of the screen, inside scrolls, nothing moves when you choose something */
.sheet{align-items:center!important;padding:max(12px,env(safe-area-inset-top,0px)) 12px max(12px,env(safe-area-inset-bottom,0px))}
.sheet .panel{border-radius:16px!important;max-height:min(88vh,88dvh)!important;width:100%;overscroll-behavior:contain;padding-bottom:16px!important;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.sheet .panel{animation:popin .2s cubic-bezier(.2,.8,.2,1)!important}@keyframes popin{from{transform:scale(.97);opacity:0}to{transform:none;opacity:1}}
.sheet.stay,.sheet.stay .panel,.sheet.stay .pb > *{animation:none!important}
.permgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 12px}body.no-newinv #addBtn,body.no-newinv #scanBtn{display:none!important}

/* top bar */
header.top{background:var(--surface);box-shadow:0 1px 0 var(--line),0 4px 14px rgba(16,36,61,.06)}
header.top .in{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-block:10px}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.logo{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:var(--accent);border:1.5px solid var(--accent2);background:none}
.bt{display:grid;gap:1px;min-width:0}
.bn{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bn .ar{color:var(--accent2)}
.scr{display:flex;align-items:center;gap:7px;font-size:18px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.netdot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--good);box-shadow:0 0 0 3px var(--good-bg)}.netdot.off{background:var(--muted);box-shadow:0 0 0 3px var(--sunk)}
header.top .actions{display:flex;gap:6px;flex-wrap:nowrap;flex:none}
.hbtn{min-height:40px!important;height:40px;padding:0 12px;border-radius:10px;font-size:14px;font-weight:600;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--line)}
.hbtn.primary{background:var(--accent2);border-color:var(--accent2);color:#fff}
.row .s.bad{color:var(--bad)}
#staffBar:empty{display:none}
#staffBar{background:var(--sunk);border-top:1px solid var(--line)}
#staffBar .in2{max-width:1000px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:6px max(16px,env(safe-area-inset-left,0px));font-size:13px}
#staffBar .who{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
#staffBar .av{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2))}
#staffBar .who span.t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
#staffBar .who b{color:var(--fg)}
#staffBar .clock{color:var(--muted);white-space:nowrap}
#staffBar .actions{display:flex;gap:6px}#staffBar button{min-height:32px!important;height:32px;padding:0 10px;font-size:13px;border-radius:8px}
@media (max-width:560px){header.top .in{gap:8px;padding-block:8px}.logo{width:28px;height:28px}.scr{font-size:16px}.hbtn{padding:0 10px}#addBtn{font-size:0;width:40px;padding:0;justify-content:center}#addBtn::before{content:"+";font-size:22px;font-weight:500}#staffBar .clock{display:none}}
@media (max-width:360px){.bn{display:none}}
.paybtn{padding:16px!important;font-size:17px}
@media print{body{padding:0!important;background:#fff}body > *:not(#printArea){display:none!important}#printArea{display:block!important}#printArea #receipt{max-width:72mm!important;margin:0!important;padding:0!important}}
</style>"""
HEAD_OLD = re.search(r'<header class="top">.*?</header>', base, re.S).group(0)
HEAD_NEW = """<div id="boot" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
  <div class="ring"><svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true"><defs><linearGradient id="bootG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent2)"/></linearGradient></defs>
    <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="8"/><circle id="bootArc" cx="60" cy="60" r="52" fill="none" stroke="url(#bootG)" stroke-width="8" stroke-linecap="round" stroke-dasharray="326.73" stroke-dashoffset="326.73" transform="rotate(-90 60 60)"/></svg>
    <b id="bootPct">0%</b></div>
  <span class="bn">Raihana Pharmacy <span class="ar">صيدلية ريحانة</span></span>
</div>
<script>
/* loading screen: the ring moves smoothly toward how much has loaded, then fades out once everything is ready */
window.BOOT = (function(){
  let shown = 0, target = 8, done = false, raf = 0; const C = 326.73, t0 = Date.now();
  const arc = document.getElementById("bootArc"), pct = document.getElementById("bootPct"), el = document.getElementById("boot");
  function draw(){ shown += (target - shown) * 0.18 + (shown < target ? 0.4 : 0); if (shown > target) shown = target;
    arc.setAttribute("stroke-dashoffset", (C * (1 - shown / 100)).toFixed(2)); const n = Math.round(shown); pct.textContent = n + "%"; el.setAttribute("aria-valuenow", n);
    if (shown < target) raf = requestAnimationFrame(draw); else if (done){ el.classList.add("out"); setTimeout(() => el.remove(), 320); } else raf = 0; }
  const go = () => { if (!raf) raf = requestAnimationFrame(draw); };
  setTimeout(() => { if (!done) api.finish(); }, 12000); // never block the app if something is slow
  const api = { set(p){ if (done) return; target = Math.max(target, Math.min(99, p)); go(); }, finish(){ if (done) return; done = true; target = 100; go(); }, get done(){ return done; }, ms: () => Date.now() - t0 };
  const creep = setInterval(() => { if (done) return clearInterval(creep); if (target < 45) api.set(target + 1); }, 90); // keeps moving while the first files download
  go(); return api;
})();
</script>
<header class="top"><div class="in">
  <div class="brand">
    <span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17"><path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>
    <div class="bt"><span class="bn">Raihana Pharmacy <span class="ar">صيدلية ريحانة</span></span><span class="scr"><span id="netDot" class="netdot" aria-hidden="true"></span><span id="scrTitle">Home</span></span><small id="sub" hidden></small></div>
  </div>
  <div class="actions">
    <button id="scanBtn" class="hbtn primary" type="button" hidden>Scan invoice</button>
    <button id="addBtn" class="hbtn" type="button">+ Invoice</button>
    <button id="langBtn" class="hbtn" type="button" aria-label="Switch language">عربي</button>
  </div>
  <input type="file" id="photoIn" accept="image/jpeg,image/png,image/webp" hidden>
</div></header>"""
for _id in ('scanBtn','addBtn','langBtn','photoIn','sub'):
    if f'id="{_id}"' not in HEAD_OLD: sys.exit("header id missing in base: " + _id)
rep(HEAD_OLD, ERP_CSS + "\n" + HEAD_NEW + "\n" + nav)
rep('<div class="toast" id="toast" hidden></div>', '<div class="toast" id="toast" hidden></div>\n<div id="printArea"></div>')
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>',
    '<script>\n' + shim + '\n</script>\n<script defer src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>')  # Excel library loads in the background so the app opens fast
rep("<script>\n// motion:", "<script>\n" + erp + "\n</script>\n<script>\n// motion:")

dist = os.path.join(HERE, "..", "dist"); os.makedirs(os.path.join(dist, "app"), exist_ok=True)
open(os.path.join(dist, "erp-artifact.html"), "w", encoding="utf-8").write(base)

head = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1557b0"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png">
<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
"""
open(os.path.join(dist, "app", "index.html"), "w", encoding="utf-8").write(head + base + "\n</body></html>")
json.dump({"name":"Raihana Pharmacy ERP","short_name":"Raihana","start_url":"./","scope":"./","display":"standalone","background_color":"#edf3f8","theme_color":"#1557b0",
           "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}]},
          open(os.path.join(dist, "app", "manifest.webmanifest"), "w"), ensure_ascii=False)
shutil.copy(os.path.join(HERE, "sw.js"), os.path.join(dist, "app", "sw.js"))
shutil.copy(os.path.join(HERE, "supabase-setup.sql"), os.path.join(dist, "supabase-setup.sql"))
for size in (192, 512):
    im = Image.new("RGB", (size, size)); d = ImageDraw.Draw(im)
    for y in range(size):
        t = y / size; d.line([(0, y), (size, y)], fill=(int(21 + (11-21)*t), int(87 + (130-87)*t), int(176 + (144-176)*t)))
    w = size * 0.12; c = size / 2; L = size * 0.30
    d.rounded_rectangle([c - w, c - L, c + w, c + L], radius=int(w*0.4), fill="white")
    d.rounded_rectangle([c - L, c - w, c + L, c + w], radius=int(w*0.4), fill="white")
    im.save(os.path.join(dist, "app", f"icon-{size}.png"))
if "--site" in sys.argv:  # the icons stay as they are once the site has them, so their bytes don't change on every build
    root = os.path.join(HERE, "..")
    for f in ("index.html", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"):
        if f.startswith("icon") and os.path.exists(os.path.join(root, f)): continue
        shutil.copy(os.path.join(dist, "app", f), os.path.join(root, f))
print("built", len(base), "bytes")
