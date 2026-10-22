/* ---------- Raihana ERP modules (2026-10-21): stock by batch, cashier, customers on debt,
   chronic patient cards with shortage alerts, money (cash box, expenses, profit), settings.
   Stock is worked out from the purchase invoices: what came in, minus returns, sales and write-offs. ---------- */
const E = {staff:[], shifts:[], prods:[], sales:[], moves:[], customers:[], custpays:[], chronic:[], expenses:[], closes:[], counts:[], events:[], cfg:{}};
/* several sales open at once: one tab per customer at the counter */
S.tabs = lsGet("erp.tabs", null) || [{n:1, lines:lsGet("erp.cart", []), meta:lsGet("erp.cartMeta", {})}];
S.tabAt = Math.min(lsGet("erp.tabAt", 0), S.tabs.length - 1); S.sellPeriod = lsGet("erp.sellPeriod", "today");
const actTab = () => S.tabs[S.tabAt] || (S.tabs[S.tabAt = 0] = S.tabs[0] || {n:1, lines:[], meta:{}});
Object.defineProperty(S, "cart", {get: () => actTab().lines, set: v => { actTab().lines = v; }});
Object.defineProperty(S, "cartMeta", {get: () => actTab().meta, set: v => { actTab().meta = v; }});
function newTab(){ const used = new Set(S.tabs.map(t => t.n)); let n = 1; while (used.has(n)) n++; S.tabs.push({n, lines:[], meta:{}}); S.tabAt = S.tabs.length - 1; saveCart(); }
function closeTab(i){ S.tabs.splice(i, 1); if (!S.tabs.length) S.tabs.push({n:1, lines:[], meta:{}}); S.tabAt = Math.min(S.tabAt, S.tabs.length - 1); saveCart(); }
S.sellQ = ""; S.stockF = "all"; S.stockQ = ""; S.chrQ = ""; S.moneyM = today().slice(0,7);
const UNUSABLE = ["Damaged","Wrong item","Short expiry"];
const EXP_CATS = ["Rent","Salaries","Electricity","Generator","Internet and phone","Transport","Cleaning","Other"];
const ALERT_DAYS = () => isNum(E.cfg.alertDays) ? E.cfg.alertDays : 7;
const hkey = s => { let h = 5381; for (const ch of s) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return "P" + h.toString(36); };
// a product is named by its line text, unless the line remembers the product it was first saved as (see ERP_KEEP_PRODUCT)
const pidOf = l => l.pid || hkey(prodKey(l));
// audit F-05: correcting a line's name, dose or pack keeps it the same product, so its prices, stock and sales stay together
window.ERP_KEEP_PRODUCT = (old, inv) => { if (!old) return; const was = {}; (old.lines || []).forEach((l, j) => was[String(l.lid ?? j)] = pidOf(l));
  inv.lines.forEach(l => { const w = was[l.lid]; if (w && !l.pid && w !== hkey(prodKey(l))) l.pid = w; }); };
const nowIso = () => new Date().toISOString();
const pad2 = n => String(n).padStart(2, "0");
const hm = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const localDT = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const hrsTxt = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`; };
const ym = d => (d || today()).slice(0,7);
const monthLen = m => new Date(+m.slice(0,4), +m.slice(5,7), 0).getDate();
const nextYm = m => { const y = +m.slice(0,4), mo = +m.slice(5,7); return mo === 12 ? `${y+1}-01` : `${y}-${String(mo+1).padStart(2,"0")}`; };
const newId = p => p + "-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase();
const saveCart = () => { lsSet("erp.tabs", S.tabs); lsSet("erp.tabAt", S.tabAt); };

/* ---- catalogue: one product per name + dose + form + pack, built from every invoice line, plus your own settings ---- */
/* catalog and stock use are worked out once per screen draw and reused (cleared on every draw, data change and save) */
const MEMO = {}; const clearMemo = () => { MEMO.cat = MEMO.used = null; };
function catalog(){ return MEMO.cat || (MEMO.cat = buildCatalog()); }
function buildCatalog(){
  const map = new Map();
  for (const inv of S.invoices){ if (inv.status === "On Hold") continue;
    (inv.lines || []).forEach((l, k) => { const id = pidOf(l), a = attrs(l); let p = map.get(id);
      if (!p){ p = {id, name:a.name || l.desc, strength:a.strength, form:a.form, pack:a.pack, blisters:a.blisters, fridge:a.fridge, desc:l.desc, lines:[], lastDate:""}; map.set(id, p); }
      p.lines.push({inv, k, l}); if ((inv.date || "") >= p.lastDate){ p.lastDate = inv.date || ""; p.fridge = a.fridge; } }); }
  for (const m of E.prods){ let p = map.get(m.id); if (!p){ p = {id:m.id, name:m.name || "Item", strength:m.strength, form:m.form, pack:null, blisters:null, fridge:!!m.fridge, desc:"", lines:[], lastDate:""}; map.set(m.id, p); } p.m = m; }
  for (const p of map.values()){ const m = p.m || {};
    if (m.name) p.name = m.name; if (m.strength) p.strength = m.strength; if (m.form) p.form = m.form;
    const L = isNum(m.sub) && m.sub > 0 ? {sub:m.sub, subName:m.subName || "piece", midName:m.midName || "", midN:isNum(m.midN) ? m.midN : null, own:true} : levelDefaults(p);
    p.sub = L.sub; p.subName = p.sub > 1 ? L.subName : "box"; p.midName = p.sub > 1 && L.midN > 1 && L.midN < p.sub ? L.midName : ""; p.midN = p.midName ? L.midN : null; p.levelsOwn = !!L.own;
    p.legacyPer = isNum(m.sub) && m.sub > 0 ? m.sub : 1;
    p.barcode = m.barcode || ""; p.sellBox = isNum(m.sellBox) ? m.sellBox : null;
    p.sellMid = isNum(m.sellMid) ? m.sellMid : (p.sellBox && p.midName ? Math.ceil(p.sellBox / (p.sub / p.midN) / 250) * 250 : null);
    p.sellSub = isNum(m.sellSub) ? m.sellSub : (p.sellBox && p.sub > 1 ? Math.ceil(p.sellBox / p.sub / 250) * 250 : null);
    p.min = isNum(m.min) ? m.min : null; p.sci = m.sci || ""; p.shelf = m.shelf || ""; }
  return [...map.values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
}
/* packaging levels. Stock is counted in the smallest unit; every sale and stock change also stores how many
   smallest units a box had at that moment ("per"), so changing the levels later never changes past stock */
const PIECE_FORMS = {"Ampoule":"ampoule","Vial":"vial","Pen":"pen","Prefilled syringe":"syringe","Suppository":"suppository","Pessary":"pessary","Vaginal capsule":"capsule","Sachet":"sachet","Needle":"needle"};
function levelDefaults(p){
  const f = p.form || "", pack = isNum(p.pack) && p.pack > 1 ? p.pack : null, bl = isNum(p.blisters) && p.blisters > 1 ? p.blisters : null;
  if (/^(Tablet|Capsule)$/.test(f) && pack){
    const small = f === "Tablet" ? "tablet" : "capsule";
    if (bl && pack > bl && pack % bl === 0) return {sub:pack, subName:small, midName:"strip", midN:pack / bl};
    return {sub:pack, subName:small, midName:"", midN:null};
  }
  if (PIECE_FORMS[f] && pack) return {sub:pack, subName:PIECE_FORMS[f], midName:"", midN:null};
  return {sub:1, subName:"box", midName:"", midN:null};
}
const unitPer = (p, mode) => mode === "mid" ? n0(p.midN) || 1 : mode === "sub" ? 1 : p.sub;
const unitName = (p, mode) => mode === "mid" ? p.midName : mode === "sub" ? p.subName : "box";
const lvlPrice = (p, mode) => mode === "mid" ? p.sellMid : mode === "sub" ? p.sellSub : p.sellBox;
// lowest price staff may charge without the owner (audit P-01): the unit's set price, else the box price shared out; null: no price set at all
const floorPrice = (p, mode) => { const own = lvlPrice(p, mode); return isNum(own) ? own : isNum(p.sellBox) ? Math.floor(p.sellBox / p.sub * unitPer(p, mode)) : null; };
const unitModes = p => ["box", ...(p.midName ? ["mid"] : []), ...(p.sub > 1 ? ["sub"] : [])];
const unitOpts = (p, sel) => unitModes(p).map(k => `<option value="${k}" ${sel === k ? "selected" : ""}>${esc(k === "box" ? "Box" : unitName(p, k))}</option>`).join("");
const levelText = p => p.sub <= 1 ? "Box only" : p.midName ? `1 box = ${p.sub / p.midN} ${p.midName}s × ${p.midN} ${p.subName}s` : `1 box = ${p.sub} ${p.subName}s`;
const r6 = v => Math.round(v * 1e6) / 1e6;
/* money rules: amounts of money are whole IQD, rounded once when they are saved. Unit costs keep all their decimals
   (cost of one tablet can be 412.5 IQD) and are only rounded on screen, so totals add up exactly */
const wIQD = v => Math.round(n0(v));
const lineTot = c => wIQD(n0(c.qty) * wIQD(c.price));
const cartTotals = (lines, meta) => { const sub = lines.reduce((a,c) => a + lineTot(c), 0), disc = Math.min(sub, Math.max(0, wIQD(meta?.disc))); return {sub, disc, total: sub - disc}; };
/* PRICING: the one place every price and profit % is worked out (Pricing, bulk %, import, item card, Sell, Excel).
   Formulas as given by the owner; m is a decimal (25% = 0.25):
     Markup % = (Selling price − Cost) ÷ Cost × 100          Selling price = Cost × (1 + m)
     Margin % = (Selling price − Cost) ÷ Selling price × 100  Selling price = Cost ÷ (1 − m)
   Nothing is rounded inside; only the final selling price is rounded (whole IQD, or the step the owner picks). */
const PRICING = {
  markupPct: (sp, cp) => isNum(sp) && isNum(cp) && cp > 0 ? (sp - cp) / cp * 100 : null,
  marginPct: (sp, cp) => isNum(sp) && isNum(cp) && sp > 0 ? (sp - cp) / sp * 100 : null,
  fromMarkup: (cp, pct) => isNum(cp) && cp > 0 && isNum(pct) && pct > -100 ? cp * (1 + pct / 100) : null,
  fromMargin: (cp, pct) => isNum(cp) && cp > 0 && isNum(pct) && pct < 100 ? cp / (1 - pct / 100) : null,
  price: (cp, pct, mode) => mode === "margin" ? PRICING.fromMargin(cp, pct) : PRICING.fromMarkup(cp, pct),
  round: (v, step) => isNum(v) ? (step > 1 ? Math.round(v / step) * step : Math.round(v)) : null,
  pctTxt: v => isNum(v) ? `${Math.round(v * 10) / 10}%` : "—"
};
const subCostNow = p => { const c = lastCostBox(p); return isNum(c) ? c / p.sub : null; }; // used when stock had no batch left
function usedMap(fresh){ if (fresh) return buildUsed(); return MEMO.used || (MEMO.used = buildUsed()); } // fresh: the caller changes it
function buildUsed(){
  const u = {}, add = (key, q, per, cost) => { const x = u[key] || (u[key] = {b:0, raw:0, c:0}); if (isNum(per) && per > 0) x.b += n0(q) / per; else x.raw += n0(q); x.c += n0(q) * n0(cost); };
  for (const s of E.sales) if (!s.voided) for (const ln of s.lines || []) for (const a of ln.alloc || []) add(a.key, a.q, a.per, a.cost);
  for (const m of E.moves) if (!m.voided) add(m.key, m.q, m.per, m.cost);
  return u;
}
const usedBoxes = (used, key, p) => { const x = used[key]; return x ? x.b + x.raw / p.legacyPer : 0; };
// cost of one sellable unit from this invoice line: net cost after every discount, spread over paid + bonus
function subCost(inv, k, p){ const r = itemDiscounts(inv).rows[k]; return r && isNum(r.perUnit) ? r.perUnit / p.sub : null; }
// a batch is one invoice line, named by its permanent line id (old lines: their position)
const lineKey = (inv, k) => inv.id + ":" + (inv.lines?.[k]?.lid ?? k);
function lineInUse(invId, lid){
  const key = invId + ":" + lid;
  if (E.sales.some(s => !s.voided && (s.lines || []).some(ln => (ln.alloc || []).some(a => a.key === key)))) return "it has sales";
  if (E.moves.some(m => !m.voided && m.key === key)) return "it has stock changes";
  if (S.credits.some(x => x.invoiceId === invId && (x.lines || []).some(y => String(y.lid ?? y.k) === lid))) return "it has a return to the supplier";
  return "";
}
function batchesOf(p, used){
  return p.lines.map(({inv, k, l}) => {
    const key = lineKey(inv, k), rl = inv.receivedLines?.[k];
    let boxes = n0(l.qty) + n0(l.bonus);
    if (rl && isNum(rl.qty)) boxes = UNUSABLE.includes(rl.issue) ? 0 : rl.qty;
    const outB = n0(returnedQty(inv.id, k)) + usedBoxes(used, key, p), inn = r6(boxes * p.sub);
    const ml = monthsLeft(l.expiry);
    return {key, inv, k, l, batch:l.batch || "", expiry:l.expiry || "", in:inn, left:r6((boxes - outB) * p.sub), cost:subCost(inv, k, p), expired: ml !== null && ml < 0, ml};
  }).sort((a,b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"));
}
function stockOf(p, used){
  const bs = batchesOf(p, used), adj = r6(usedBoxes(used, "adj:" + p.id, p) * p.sub);
  const good = r6(bs.filter(b => !b.expired).reduce((a,b) => a + b.left, 0) - adj);
  const exp = bs.filter(b => b.expired).reduce((a,b) => a + Math.max(0, b.left), 0);
  const next = bs.find(b => b.left > 0 && !b.expired);
  // value at cost: what is left in each batch, plus stock found at a count (minus stock sold with no batch left)
  const value = Math.max(0, bs.reduce((a,b) => a + Math.max(0, b.left) * n0(b.cost), 0) - n0(used["adj:" + p.id]?.c));
  return {bs, good, exp, next, value};
}
const UNIT_AR = {tablet:"حبة", tablets:"حبات", capsule:"كبسولة", capsules:"كبسولات", suppository:"تحميلة", suppositorys:"تحاميل", pessary:"تحميلة مهبلية", pessarys:"تحاميل مهبلية", needle:"إبرة", needles:"إبر", blister:"شريط", blisters:"أشرطة", bottle:"قنينة", bottles:"قناني", tube:"أنبوب", tubes:"أنابيب", box:"علبة", boxes:"علب", strip:"شريط", strips:"أشرطة", piece:"حبة", pieces:"حبات", pen:"قلم", pens:"أقلام", ampoule:"أمبولة", ampoules:"أمبولات", vial:"فيال", vials:"فيالات", syringe:"سرنجة", syringes:"سرنجات", sachet:"كيس", sachets:"أكياس"};
const unitW = w => S.lang === "ar" ? (UNIT_AR[w] || w) : w;
function qtyText(p, q){
  if (!isNum(q)) return "—"; const neg = q < 0; q = Math.abs(q);
  q = Math.round(q * 1000) / 1000;
  if (p.sub <= 1) return (neg ? "−" : "") + q + " " + unitW(q === 1 ? "box" : "boxes");
  const b = Math.floor(q / p.sub + 1e-9); let r = Math.round((q - b * p.sub) * 1000) / 1000; const parts = [b ? `${b} ${unitW(b === 1 ? "box" : "boxes")}` : ""];
  if (p.midName){ const m = Math.floor(r / p.midN + 1e-9); r = Math.round((r - m * p.midN) * 1000) / 1000; if (m) parts.push(`${m} ${unitW(p.midName + (m === 1 ? "" : "s"))}`); }
  if (r) parts.push(`${r} ${unitW(p.subName + (r === 1 ? "" : "s"))}`);
  return (neg ? "−" : "") + parts.filter(Boolean).join(" + ") || "0";
}
const pname = p => `${p.name}${p.strength ? " " + p.strength : ""}`;
function lowStock(cat, used){ return cat.filter(p => { const s = stockOf(p, used); return p.min !== null ? s.good < p.min * p.sub : s.good <= 0 && p.lines.length; }); }

/* every movement of one item, newest first: what came in, what was sold, written off, returned and counted, by whom */
function stockHistory(p, s){
  const out = [], who = x => x.staffByName || x.staffName || (x.lastBy ? whoName(x.lastBy) : "");
  for (const b of s.bs) out.push({at:b.inv.createdAt || b.inv.date, date:b.inv.date, what:"Came in", ref:`${supName(b.inv.supplierId)} · ${b.inv.invoiceNo || ""}${b.batch ? " · batch " + b.batch : ""}`, q:b.in, who:""});
  for (const x of E.sales) for (const l of x.lines || []) if (l.pid === p.id){ const q = (l.alloc || []).reduce((a, y) => a + n0(y.q), 0);
    out.push({at:x.at, date:x.date, what: x.voided ? "Sold, then cancelled" : "Sold", ref:`Receipt ${x.no || x.id}${x.approvedBy && (l.alloc || []).some(y => String(y.key).startsWith("adj:")) ? " · past the stock, owner approved" : ""}`, q: x.voided ? 0 : -q, who:x.staffName || ""}); }
  for (const x of E.moves) if (x.pid === p.id && !x.voided) out.push({at:x.at, date:x.date, what:x.reason, ref:x.note || "", q:-n0(x.q), who:who(x) + (x.approvedBy && x.approvedBy !== x.staffBy ? " · approved" : "")});
  const keys = new Map(p.lines.map(({inv, k}) => [inv.id + ":" + k, true]));
  for (const c of S.credits) for (const y of c.lines || []) if (keys.has(c.invoiceId + ":" + y.k)) out.push({at:c.date, date:c.date, what:"Returned to supplier", ref:`${supName(c.supplierId)}${c.verified ? "" : " · not confirmed yet"}`, q:-n0(y.qty) * p.sub, who:""});
  for (const c of E.counts) for (const y of c.lines || []) if (y.pid === p.id) out.push({at:c.at, date:c.date, what:"Stocktake", ref:`counted ${qtyText(p, y.counted)}, system ${qtyText(p, y.system)}`, q:0, who:c.approvedBy ? whoName(c.approvedBy) : ""});
  return out.sort((a, b) => String(b.at || b.date || "").localeCompare(String(a.at || a.date || "")));
}
function stockHistoryHtml(p, s){
  const h = stockHistory(p, s); if (!h.length) return "";
  return `<div class="sec"><h2>Stock history</h2><div class="list">${h.slice(0, 60).map(x => `<div class="row" style="cursor:default"><span class="main"><span class="t">${esc(x.what)}</span><span class="s">${esc(String(x.at || x.date || "").slice(0, 16).replace("T", " "))}${x.ref ? " · " + esc(x.ref) : ""}${x.who ? " · " + esc(x.who) : ""}</span></span><span class="end num">${x.q ? (x.q > 0 ? "+" : "−") + esc(qtyText(p, Math.abs(x.q))) : ""}</span></div>`).join("")}</div>${h.length > 60 ? `<p class="note">Showing the newest 60. The Excel download has all of them.</p>` : ""}</div>`;
}

/* ---- stock alerts: each names the item, how much, when, and what to do. The owner can switch types off in Settings ---- */
const ALERT_TYPES = [["neg","Stock below zero"],["out","Out of stock"],["low","Low stock"],["expired","Expired stock"],["expiring","Expiring in 3 months"],["blocked","Sales blocked"],["override","Sold past the stock"],["diff","Stocktake differences"],["dup","Possible duplicate items"],["unapproved","Stock changes without approval"],["sync","Cloud sync failed"]];
function stockAlerts(){
  const off = new Set(E.cfg.alertsOff || []), cat = catalog(), used = usedMap(), out = [], since = addDays(today(), -7), add = (type, sev, p, what, qty, when, act) => { if (!off.has(type)) out.push({type, sev, pid:p?.id || "", name: p ? pname(p) : "", what, qty, when, act}); };
  for (const p of cat){ const s = stockOf(p, used);
    if (s.good < -1e-6 || s.bs.some(b => b.left < -1e-6)) add("neg", 3, p, "Stock below zero", qtyText(p, Math.min(s.good, ...s.bs.map(b => b.left))), "", "Do a stocktake for this item.");
    else if (s.good <= 0 && (p.lines.length || p.min !== null)) add("out", 2, p, "Out of stock", "0", p.lastDate ? `last bought ${p.lastDate}` : "", "Restock it, or remove it from open sales.");
    else if (p.min !== null && s.good < p.min * p.sub) add("low", 1, p, "Low stock", qtyText(p, s.good), `alert below ${p.min} boxes`, "Order more.");
    for (const b of s.bs){ if (b.left <= 1e-6) continue;
      if (b.expired) add("expired", 2, p, "Expired stock", qtyText(p, b.left), `batch ${b.batch || "—"} · ${b.expiry}`, "Write it off or return it to the supplier.");
      else if (b.ml !== null && b.ml <= 3) add("expiring", 1, p, "Expiring in 3 months", qtyText(p, b.left), `batch ${b.batch || "—"} · ${b.expiry}`, "Sell it first or return it to the supplier."); } }
  const byId = Object.fromEntries(cat.map(p => [p.id, p]));
  for (const e of E.events) if (e.type === "blocked_sale" && e.date >= since){ const p = byId[e.pid]; add("blocked", 1, p || {id:e.pid, name:e.name}, "Sale blocked", p ? `${qtyText(p, e.want)} wanted · ${qtyText(p, e.avail)} available` : "", `${String(e.at).slice(0, 16).replace("T", " ")}${e.staffName ? " · " + e.staffName : ""}`, "Restock it."); }
  for (const x of E.sales) if (!x.voided && x.date >= since && x.approvedBy) for (const l of x.lines || []) if ((l.alloc || []).some(a => String(a.key).startsWith("adj:"))){ const p = byId[l.pid]; add("override", 1, p || {id:l.pid, name:l.name}, "Sold past the stock", p ? qtyText(p, (l.alloc || []).filter(a => String(a.key).startsWith("adj:")).reduce((a, y) => a + n0(y.q), 0)) : "", `${x.date} · receipt ${x.no || ""} · approved by ${whoName(x.approvedBy) || "owner"}`, "Do a stocktake for this item."); }
  const lastCount = [...E.counts].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))[0];
  if (lastCount && lastCount.date >= addDays(today(), -30)) for (const y of lastCount.lines || []) if (y.diff){ const p = byId[y.pid]; add("diff", 1, p || {id:y.pid, name:y.name}, "Stocktake difference", p ? (y.diff > 0 ? "+" : "−") + qtyText(p, Math.abs(y.diff)) : String(y.diff), lastCount.date, "Check why: a sale not entered, a loss, or a counting mistake."); }
  if (!off.has("dup")){ const groups = {}; for (const p of cat){ const k = normName(`${p.name} ${p.strength || ""}`); (groups[k] = groups[k] || []).push(p); }
    for (const g of Object.values(groups)) if (g.length > 1) add("dup", 1, g[0], "Possible duplicate items", `${g.length} items`, g.map(pname).join(" / "), "Open each item and check the pack size; if they are the same, use one name on new invoices."); }
  for (const m of E.moves) if (!m.voided && !m.approvedBy && m.note !== "Stocktaking" && m.date >= addDays(today(), -30)){ const p = byId[m.pid]; add("unapproved", 2, p || {id:m.pid, name:m.pid}, "Stock change without approval", p ? qtyText(p, Math.abs(m.q)) : "", `${m.date} · ${m.reason}${m.staffByName ? " · " + m.staffByName : ""}`, "Check this change with the person who made it."); }
  if (window.ERP_SYNC?.cfg?.() && ERP_SYNC.status?.state === "error") add("sync", 3, null, "Cloud sync failed", "", ERP_SYNC.status.msg || "", "Open Settings and tap Sync now.");
  return out.sort((a, b) => b.sev - a.sev);
}
function alertRow(a){ return `<button type="button" class="alert row" ${a.pid ? `data-xprod="${esc(a.pid)}"` : `data-tab="settings"`}><span class="dot ${a.sev >= 2 ? "bad" : ""}"></span><span class="main" style="display:grid;gap:2px"><span><b>${esc(a.name || "")}</b>${a.name ? " · " : ""}<span>${esc(a.what)}</span>${a.qty ? ` · <span style="unicode-bidi:isolate">${esc(a.qty)}</span>` : ""}</span><span class="s">${a.when ? `<span>${esc(a.when)}</span> · ` : ""}<span>${esc(a.act)}</span></span></span></button>`; }
function alertsHome(){
  const all = stockAlerts(); if (!all.length) return "";
  const counts = ALERT_TYPES.map(([k, l]) => [k, l, all.filter(a => a.type === k).length]).filter(x => x[2]);
  return `<section class="sec"><div class="sechead"><h2>Stock alerts</h2>${all.length > 6 ? `<button type="button" data-xalerts="1">See all ${all.length}</button>` : ""}</div>
    <div class="chips">${counts.map(([k, l, n]) => `<button type="button" data-xalerts="${k}">${esc(l)} · ${n}</button>`).join("")}</div>
    <div class="list">${all.slice(0, 6).map(alertRow).join("")}</div></section>`;
}
function alertsSheet(type){ const all = stockAlerts().filter(a => type === "1" || a.type === type);
  openSheet("Stock alerts", `<div class="list">${all.slice(0, 300).map(alertRow).join("") || `<div class="empty">No alerts.</div>`}</div>${all.length > 300 ? `<p class="note">Showing the first 300.</p>` : ""}`); }
function alertSettings(){ const off = new Set(E.cfg.alertsOff || []);
  return `<fieldset style="border:0;padding:0;margin:0;display:grid;gap:6px"><b style="font-size:14px">Stock alerts on Home</b><div class="permgrid">${ALERT_TYPES.map(([k, l]) => `<label class="check"><input type="checkbox" data-xalert="${k}" ${off.has(k) ? "" : "checked"}> ${esc(l)}</label>`).join("")}</div><p class="note">Low stock uses "Alert when below" on each item.</p></fieldset>`; }

/* ---- STOCK: the one stock check. Every save that takes stock out (sale, write-off, return to the supplier, invoice
   edit, receiving) asks it right before writing, with stock worked out fresh at that moment, not what the screen showed.
   Nothing may take a batch below zero. The one exception, by the owner's rule (22 Oct 2026): selling past zero, only
   with the owner's PIN. Staff are never offered it. Zero stock never removes an item: it stays in every list. ---- */
const STOCK = {
  // boxes already taken out of one invoice line: sold, written off or counted less (and returned, unless left out)
  outBoxes(inv, k, p, used, noReturns){ return usedBoxes(used, lineKey(inv, k), p || {legacyPer:1}) + (noReturns ? 0 : n0(returnedQty(inv.id, k))); },
  shortText: (p, avail) => avail > 0 ? `${pname(p)}: NOT ENOUGH STOCK — Available quantity: ${qtyText(p, avail)}. This sale cannot be completed. Lower the quantity or remove the item from the invoice.`
    : `${pname(p)}: OUT OF STOCK — Available quantity: 0. This sale cannot be completed. Restock the item or remove it from the invoice.`,
  // blocked attempts are kept as small records, so the owner sees them in the alerts
  async log(type, data){ if (S.readOnly) return; const id = newId("EV"); try { await write("events/" + id, {id, type, at:nowIso(), date:today(), staffId:S.staff?.id || null, staffName:S.staff?.name || "", ...data}); } catch(e){ /* an alert record must never stop the work */ } },
  // a new invoice line that is not an item you have, but looks like one: ask before making a second item
  sameAs:{},
  // largest whole number of boxes that can still go back to the supplier from one invoice line (null: not known here)
  retMax(inv, k){ const l = inv.lines?.[k], p = l && catalog().find(x => x.id === pidOf(l)); if (!p) return null;
    const b = stockOf(p, usedMap(true)).bs.find(x => x.key === lineKey(inv, k)); return b ? Math.max(0, Math.floor(b.left / p.sub + 1e-9)) : null; }
};
const boxesText = (p, boxes) => p ? qtyText(p, r6(boxes * p.sub)) : String(r6(boxes));
window.ERP_INV_GUARD = inv => {
  const old = inv.id ? S.invoices.find(x => x.id === inv.id) : null, used = usedMap(true), cat = catalog(), msgs = [];
  if (old){ const pos = {}; (old.lines || []).forEach((l, j) => pos[String(l.lid ?? j)] = j);
    inv.lines.forEach((l, i) => { const j = l.lid == null ? undefined : pos[l.lid]; if (j === undefined) return;
      if (isNum(old.receivedLines?.[j]?.qty)) return; // stock follows the received count, not the invoice quantity
      const p = cat.find(x => x.id === pidOf(old.lines[j])), out = STOCK.outBoxes(old, j, p, used);
      if (n0(l.qty) + n0(l.bonus) < out - 1e-6) msgs.push(`Line ${i + 1} (${l.desc}): ${boxesText(p, out)} already sold, written off or returned. Paid + bonus can't be less than that. Cancel those first.`); }); }
  if (msgs.length) return msgs.map(m => `<span style="display:block">${esc(m)}</span>`).join("");
  const ids = new Set(cat.map(x => x.id)), match = itemMatcher(), ask = [];
  inv.lines.forEach((l, i) => { if (l.pid || (old && l.lid != null) || !l.desc) return; const key = prodKey(l), id = hkey(key); if (ids.has(id)) return;
    const ans = STOCK.sameAs[key]; if (ans === "new") return; if (ans){ l.pid = ans; return; }
    const a = attrs(l); let m = match(`${a.name || ""} ${a.strength || ""}`.trim(), ""); if (!m.pid) m = match(l.desc, "");
    if (m.pid && m.pid !== id) ask.push({i, l, key, pid:m.pid}); });
  if (!ask.length) return "";
  return `<b style="display:block">Is this an item you already have?</b>${ask.map(x => { const p = cat.find(y => y.id === x.pid);
    return `<label style="color:var(--fg)">Line ${x.i + 1}: ${esc(x.l.desc)}<select data-xsame="${esc(x.key)}"><option value="">Choose…</option><option value="${esc(x.pid)}">Same item as ${esc(pname(p))}</option><option value="new">A new item</option></select></label>`; }).join("")}<span style="display:block">Choose for each line, then tap Save again.</span>`;
};
window.ERP_RECV_GUARD = (inv, rl) => { const used = usedMap(true), cat = catalog();
  for (const [k, r] of Object.entries(rl)){ const l = inv.lines?.[+k]; if (!l) continue; const p = cat.find(x => x.id === pidOf(l)), usable = UNUSABLE.includes(r.issue) ? 0 : n0(r.qty), out = STOCK.outBoxes(inv, +k, p, used, true);
    if (usable < out - 1e-6) return `${l.desc}: ${boxesText(p, out)} already sold or written off. The usable received quantity can't be less than that.`; }
  return ""; };
window.ERP_RET_MAX = (inv, k) => STOCK.retMax(inv, k);
window.ERP_RET_GUARD = (invId, pick) => { const inv = S.invoices.find(i => i.id === invId); if (!inv) return "";
  for (const [k, v] of Object.entries(pick || {})){ if (!(v > 0)) continue; const max = STOCK.retMax(inv, +k);
    if (max !== null && v > max) return `${inv.lines[+k]?.desc}: only ${max} left from this invoice line (the rest was sold or written off). Stock can't go below zero.`; }
  return ""; };

/* ---- chronic patient cards ---- */
function chrDate(c){
  const m0 = ym(), given = c.given || {};
  const m = given[m0] ? nextYm(m0) : m0, d = Math.min(Math.max(1, n0(c.day) || 1), monthLen(m));
  return `${m}-${String(d).padStart(2,"0")}`;
}
const chrNeedQty = (md, p) => n0(md.qty) * unitPer(p, md.mode === "sub" || md.mode === "mid" ? md.mode : "box");
function chronicNeeds(withinDays){
  const cat = catalog(), byId = Object.fromEntries(cat.map(p => [p.id, p])), used = usedMap(), lim = addDays(today(), withinDays);
  const need = {};
  const cards = E.chronic.filter(c => c.active !== false && !c.deleted);
  for (const c of cards){ const d = chrDate(c); if (withinDays !== null && d > lim) continue;
    for (const md of c.meds || []){ const p = byId[md.pid]; if (!p) continue; const n = need[p.id] || (need[p.id] = {p, q:0, cards:[]}); n.q += chrNeedQty(md, p); n.cards.push(c); } }
  return Object.values(need).map(n => { const have = stockOf(n.p, used).good; return {...n, have, short: Math.max(0, n.q - have), missing: have <= 0}; }).sort((a,b) => b.short - a.short);
}
function chrStatus(c, needsSoon){
  const d = chrDate(c), dl = days(today(), d), cat = catalog(), byId = Object.fromEntries(cat.map(p => [p.id, p])), used = usedMap();
  const shortMeds = (c.meds || []).filter(md => { const p = byId[md.pid]; return !p || stockOf(p, used).good < chrNeedQty(md, p); });
  return {d, dl, shortMeds, givenThis: !!(c.given || {})[ym()]};
}

/* ---- money ---- */
function saleCost(s){ return (s.lines || []).reduce((a,ln) => a + (ln.alloc || []).reduce((b,x) => b + n0(x.q) * n0(x.cost), 0), 0); }
/* customer returns (audit P-03): part of a receipt comes back. Each return is stock-change records (moves) that carry
   saleId: back on the shelf puts the units back on the same batch (q below 0); damaged keeps them out (q 0). The refund
   sits on the same records, so the cash box, the customer's debt, the dashboard and monthly money all read it from there */
const saleReturns = sid => E.moves.filter(m => !m.voided && m.saleId === sid);
const returnedOf = (sid, li) => saleReturns(sid).filter(m => m.saleLine === li).reduce((a, m) => a + n0(m.rq), 0);
const refundsWhere = f => E.moves.filter(m => !m.voided && m.saleId && f(m));
const debtOn = () => E.cfg.debtOn === true; // owner's rule (22 Oct 2026): no selling on debt unless switched on in Settings
function custBalance(cid){
  const debt = E.sales.filter(s => !s.voided && s.method === "debt" && s.customerId === cid).reduce((a,s) => a + n0(s.total), 0)
    - refundsWhere(m => m.refundBy === "debt" && m.customerId === cid).reduce((a, m) => a + n0(m.refund), 0);
  const paid = E.custpays.filter(x => !x.voided && x.customerId === cid).reduce((a,x) => a + n0(x.amount), 0);
  return {debt, paid, bal: debt - paid};
}
function cashParts(d, keep){ // d = null: any date (a shift can run past midnight); keep() then picks the time window
  const sum = (arr, f) => arr.reduce((a, x) => a + n0(f(x)), 0), on = x => d == null || x.date === d;
  const sales = sum(E.sales.filter(s => keep(s) && on(s) && s.method === "cash"), s => s.total);
  const cin = sum(E.custpays.filter(x => keep(x) && on(x)), x => x.amount);
  const sup = sum(S.payments.filter(p => p.verified && (d == null ? keep(p) : p.date === d) && /cash/i.test(p.method || "")), p => p.amount);
  const exp = sum(E.expenses.filter(x => keep(x) && on(x) && x.fromCash !== false), x => x.amount);
  const debtSales = sum(E.sales.filter(s => keep(s) && on(s) && s.method === "debt"), s => s.total);
  const ref = sum(E.moves.filter(m => keep(m) && m.saleId && on(m) && m.refundBy === "cash"), m => m.refund); // cash given back for returns
  return {sales, cin, sup, exp, ref, debtSales, expected: sales + cin - sup - exp - ref};
}
const closeOf = d => E.closes.find(x => x.id === d) || null;
// a closed day shows what it was closed with; sales, payments and cancels made after closing are shown apart ("after")
function dayCash(d){
  const now = cashParts(d, x => !x.voided), cut = closeOf(d)?.at; if (!cut) return {...now, after:0};
  const atClose = cashParts(d, x => (x.at || "") <= cut && (!x.voided || (x.voidedAt || "") > cut));
  return {...atClose, closed:true, after: now.expected - atClose.expected, now};
}
function monthMoney(m){
  const ss = E.sales.filter(s => !s.voided && ym(s.date) === m);
  const rets = refundsWhere(x => ym(x.date) === m), refunds = rets.reduce((a, x) => a + n0(x.refund), 0), retCost = rets.reduce((a, x) => a + n0(x.q) * n0(x.cost), 0);
  const sales = ss.reduce((a,s) => a + n0(s.total), 0) - refunds, cost = ss.reduce((a,s) => a + saleCost(s), 0) + retCost; // returned stock (q below 0) lowers the cost
  const exps = E.expenses.filter(x => !x.voided && ym(x.date) === m), expenses = exps.reduce((a,x) => a + n0(x.amount), 0);
  const byCat = {}; exps.forEach(x => byCat[x.category] = (byCat[x.category] || 0) + n0(x.amount));
  const mv = E.moves.filter(x => !x.voided && !x.saleId && ym(x.date) === m), writeoff = mv.reduce((a,x) => a + n0(x.q) * n0(x.cost), 0); // found stock has q below 0, so it lowers the loss
  const noCost = ss.some(s => (s.lines || []).some(ln => (ln.alloc || []).some(a => !isNum(a.cost)))) || mv.some(x => !isNum(x.cost));
  return {count: ss.length, sales, refunds, cost, gross: sales - cost, expenses, byCat, writeoff, net: sales - cost - expenses - writeoff, noCost, purchases: monthStats(m).purchases};
}

/* ---------- views ---------- */
function periodRange(k){
  const d = today(); if (k === "today") return [d, d];
  if (k === "week"){ const t = new Date(), back = (t.getDay() + 1) % 7; return [addDays(d, -back), d]; } // week starts Saturday
  return [d.slice(0,8) + "01", d];
}
function inPeriod(s, k){
  if (S.sellStaff && s.staffId !== S.sellStaff) return false;
  if (k === "custom"){ const t = localDT(s.at || s.date); return (!S.sellFrom || t >= S.sellFrom) && (!S.sellTo || t <= S.sellTo); }
  const [from, to] = periodRange(k); return s.date >= from && s.date <= to;
}
function salesStats(k){
  const [from, to] = k === "custom" ? [S.sellFrom || "", S.sellTo || ""] : periodRange(k), ss = E.sales.filter(s => !s.voided && inPeriod(s, k));
  const rets = refundsWhere(m => inPeriod(m, k)), refunds = rets.reduce((a, m) => a + n0(m.refund), 0), cashRef = rets.filter(m => m.refundBy === "cash").reduce((a, m) => a + n0(m.refund), 0);
  const total = ss.reduce((a,s) => a + n0(s.total), 0) - refunds, cost = ss.reduce((a,s) => a + saleCost(s), 0) + rets.reduce((a, m) => a + n0(m.q) * n0(m.cost), 0);
  const items = {}; ss.forEach(s => (s.lines || []).forEach(l => { const x = items[l.pid] || (items[l.pid] = {pid:l.pid, name:l.name, qty:0, total:0, unit:l.unit}); x.total += n0(l.total); x.qty += n0(l.qty); }));
  const hours = Array(24).fill(0); ss.forEach(s => { const h = new Date(s.at || s.date).getHours(); if (isFinite(h)) hours[h] += n0(s.total); });
  const days = {}; ss.forEach(s => days[s.date] = (days[s.date] || 0) + n0(s.total));
  return {from, to, count:ss.length, total, cash:ss.filter(s => s.method !== "debt").reduce((a,s) => a + n0(s.total), 0) - cashRef, debt:ss.filter(s => s.method === "debt").reduce((a,s) => a + n0(s.total), 0) - (refunds - cashRef), refunds, disc:ss.reduce((a,s) => a + n0(s.discount), 0), profit:total - cost, avg: ss.length ? total / ss.length : 0, top:Object.values(items).sort((a,b) => b.total - a.total).slice(0,5), hours, days, voided:E.sales.filter(s => s.voided && inPeriod(s, k)).length,
    byStaff:Object.values(ss.reduce((m, s) => { const id = s.staffId || "-", x = m[id] || (m[id] = {id, name:s.staffName || "No login", count:0, total:0}); x.count++; x.total += n0(s.total); return m; }, {})).sort((a,b) => b.total - a.total)};
}
function quickItems(cat, used){
  const since = addDays(today(), -30), score = {};
  E.sales.filter(s => !s.voided && s.date >= since).forEach(s => (s.lines || []).forEach(l => score[l.pid] = (score[l.pid] || 0) + 1));
  const pinned = cat.filter(p => p.m?.quick), top = cat.filter(p => !p.m?.quick && score[p.id]).sort((a,b) => score[b.id] - score[a.id]);
  return [...pinned, ...top].slice(0, 12).map(p => ({p, s:stockOf(p, used)}));
}
function sellDash(){
  const k = S.sellPeriod, st = salesStats(k), f = v => Math.round(v).toLocaleString("en-US");
  const maxH = Math.max(1, ...st.hours), hrs = st.hours.map((v, h) => ({v, h})).filter(x => x.v);
  const dayList = Object.entries(st.days).sort(), maxD = Math.max(1, ...dayList.map(x => x[1]));
  const staffOpts = E.staff.filter(x => !x.deleted);
  return `<section class="sec"><div class="sechead"><h2>Sales · <span class="num" id="liveClock">${esc(localDT(nowIso()).replace("T", " "))}</span> <span class="pill good">Live</span></h2></div>
    <div class="chips" role="group" aria-label="Period">${[["today","Today"],["week","This week"],["month","This month"],["custom","Pick dates and times"]].map(([v,l]) => `<button type="button" data-xper="${v}" aria-pressed="${k === v}">${l}</button>`).join("")}</div>
    ${k === "custom" ? `<div class="grid2"><label>From<input type="datetime-local" id="sellFrom" value="${esc(S.sellFrom || today() + "T00:00")}"></label><label>To<input type="datetime-local" id="sellTo" value="${esc(S.sellTo || today() + "T23:59")}"></label></div>` : ""}
    ${staffOpts.length ? `<label>Pharmacist<select id="sellStaff"><option value="">Everyone</option>${staffOpts.map(x => `<option value="${esc(x.id)}" ${S.sellStaff === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
    <div class="kpis">
      <div class="kpi lead"><span class="l">${k === "today" ? "Sold today" : k === "week" ? "Sold this week" : k === "month" ? "Sold this month" : "Sold in this time"}</span><span class="v num">${iqd(st.total)}</span><span class="l">${st.count} receipts · average ${iqd(st.avg)}</span></div>
      <div class="kpi"><span class="l">Cash</span><span class="v num">${iqd(st.cash)}</span></div>
      ${!debtOn() && !st.debt ? "" : `<div class="kpi"><span class="l">On debt</span><span class="v num" style="color:var(--${st.debt ? "warn" : "fg"})">${iqd(st.debt)}</span></div>`}
      <div class="kpi"><span class="l">Profit (after cost)</span><span class="v num" style="color:var(--good)">${iqd(st.profit)}</span><span class="l">${st.total ? "Margin " + PRICING.pctTxt(PRICING.marginPct(st.total, st.total - st.profit)) : "—"}</span></div>
      <div class="kpi"><span class="l">Discounts given</span><span class="v num">${iqd(st.disc)}</span>${st.voided ? `<span class="l">${st.voided} cancelled</span>` : ""}${st.refunds ? `<span class="l">Returns −${iqd(st.refunds)}</span>` : ""}</div>
    </div>
    ${st.count ? `<div class="grid2 stack" style="align-items:start">
      <div class="list"><div class="row" style="cursor:default"><span class="main"><span class="t">Top items</span></span></div>${st.top.map(x => `<button type="button" class="row" data-xprod="${esc(x.pid)}"><span class="main"><span class="t">${esc(x.name)}</span><span class="s"><span class="num">${x.qty}</span> sold</span></span><span class="end num">${iqd(x.total)}</span></button>`).join("")}</div>
      <div class="list" style="padding:12px 14px;display:grid;gap:6px"><b>${k === "today" ? "Busy hours" : "By day"}</b>
        ${(k === "today" ? hrs.map(x => [String(x.h).padStart(2,"0") + ":00", x.v, maxH]) : dayList.map(([d, v]) => [d.slice(5), v, maxD])).map(([l, v, m]) => `<div style="display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:8px;align-items:center;font-size:12.5px"><span class="num note">${l}</span><span style="height:12px;border-radius:6px;background:var(--sunk);overflow:hidden"><span style="display:block;height:100%;width:${Math.round(v / m * 100)}%;background:linear-gradient(90deg,var(--accent),var(--accent2))"></span></span><span class="num">${v ? f(v) : ""}</span></div>`).join("")}</div>
    </div>
    ${st.byStaff.length > 1 || (st.byStaff[0] && st.byStaff[0].id !== "-") ? `<div class="list"><div class="row" style="cursor:default"><span class="main"><span class="t">By pharmacist</span></span></div>${st.byStaff.map(x => `<div class="row" style="cursor:default"><span class="main"><span class="t">${esc(x.name)}</span><span class="s"><span class="num">${x.count}</span> receipts</span></span><span class="end num">${iqd(x.total)}</span></div>`).join("")}</div>` : ""}` : `<p class="note">No sales ${k === "today" ? "today" : k === "week" ? "this week" : "this month"} yet.</p>`}</section>`;
}
function sellView(){
  const cat = catalog(), used = usedMap(), q = S.sellQ.trim().toLowerCase();
  const hits = q ? cat.filter(p => (p.barcode && p.barcode === S.sellQ.trim()) || [p.name, p.strength, p.form, p.sci, p.desc, p.barcode].join(" ").toLowerCase().includes(q)).slice(0, 12) : [];
  const byId = Object.fromEntries(cat.map(p => [p.id, p]));
  const lines = S.cart.map((c, i) => ({c, i, p: byId[c.pid]})).filter(x => x.p);
  const {sub, total} = cartTotals(lines.map(x => x.c), S.cartMeta);
  const chr = S.cartMeta.chronicId ? E.chronic.find(c => c.id === S.cartMeta.chronicId) : null;
  const tabName = t => { const ch = t.meta?.chronicId && E.chronic.find(c => c.id === t.meta.chronicId); const cu = t.meta?.customerId && E.customers.find(c => c.id === t.meta.customerId); return ch ? ch.name : cu ? cu.name : t.meta?.newName || `Customer ${t.n}`; };
  const tabSum = t => cartTotals(t.lines || [], t.meta).total;
  const quick = quickItems(cat, used);
  return `<section class="sec">
    <div class="tabsale" role="tablist" aria-label="Open sales">${S.tabs.map((t, i) => `<button type="button" role="tab" aria-selected="${i === S.tabAt}" data-xtab="${i}"><span>${esc(tabName(t))}</span><span class="num">${(t.lines || []).length ? iqd(Math.max(0, tabSum(t))) : "empty"}</span></button>`).join("")}<button type="button" class="add" data-xnewtab="1" aria-label="New customer">+ Customer</button></div>
    <div style="display:flex;gap:8px"><input id="sellQ" type="search" autocomplete="off" enterkeyhint="search" placeholder="Scan barcode or type a name" value="${esc(S.sellQ)}" style="flex:1">${window.BarcodeDetector && window.ERP_MODE === "device" ? `<button type="button" data-xcam="1" aria-label="Scan with camera">📷</button>` : ""}</div>
    <p class="note kbdhint">Keys: F2 search · ↑ ↓ results · F4 unit · + − quantity · F9 save · F10 print</p>
    ${q ? `<div class="list">${hits.length ? hits.map(p => { const s = stockOf(p, used); return `<button type="button" class="row" data-xadd="${esc(p.id)}"><span class="main"><span class="t">${esc(pname(p))}</span><span class="s">${esc(p.form || "")}${p.fridge ? " · براد" : ""} · ${esc(qtyText(p, s.good))} in stock${s.next ? ` · exp ${esc(s.next.expiry)}` : ""}</span></span><span class="end num">${p.sellBox ? iqd(p.sellBox) : `<span class="pill warn">No price</span>`}</span></button>`; }).join("") : `<div class="empty">No item matches. Items appear here once they are on a purchase invoice, or add one under Stock.</div>`}</div>` : ""}
    ${!q && quick.length ? `<div class="quick">${quick.map(({p, s}) => `<button type="button" data-xadd="${esc(p.id)}" ${s.good <= 0 ? 'class="out"' : ""}><b>${esc(p.name)}</b><span>${esc(p.strength ? p.strength.slice(0, 28) : p.form || "")}</span><span class="num">${p.sellBox ? f0(p.sellBox) : "No price"}</span>${s.good <= 0 ? `<span class="pill bad">Out</span>` : ""}</button>`).join("")}</div>` : !q ? `<p class="note">Quick buttons appear here for the items you sell most. You can also pin an item: open it under Stock and tick "Quick button on Sell".</p>` : ""}
  </section>
  <section class="sec"><div class="sechead"><h2>${esc(tabName(actTab()))}</h2><div class="actions">${lines.length ? `<button type="button" data-xclear="1">Clear</button>` : ""}${S.tabs.length > 1 ? `<button type="button" class="danger" data-xclosetab="1">Close</button>` : ""}</div></div>
    ${chr ? `<div class="banner">Chronic card: <b>${esc(chr.name)}</b>. Saving this sale marks this month as given.</div>` : ""}
    ${closeOf(today()) ? `<div class="banner">Today's cash box is already closed. Sales saved now show under "Changes after closing" in Money.</div>` : ""}
    <div class="list">${lines.length ? lines.map(({c, i, p}) => { const s = stockOf(p, used), needQ = n0(c.qty) * unitPer(p, c.mode);
      return `<div class="lineedit" style="border:0;border-top:1px solid var(--line);border-radius:0">
        <div class="lh"><b style="color:var(--fg)">${esc(pname(p))}</b><button type="button" class="danger" data-xrm="${i}" style="padding:4px 10px">Remove</button></div>
        <div class="stepper"><button type="button" data-xstep="${i}" data-d="-1" aria-label="One less">−</button><input class="num" inputmode="decimal" data-xq="${i}" value="${esc(c.qty)}" aria-label="Quantity"><button type="button" data-xstep="${i}" data-d="1" aria-label="One more">+</button>
          <select data-xmode="${i}" aria-label="Sell by">${unitOpts(p, c.mode)}</select></div>
        <div class="grid2"><label>Price each (IQD)<input class="num" inputmode="numeric" data-xp="${i}" value="${esc(c.price ?? "")}" placeholder="Enter price"></label>
          <label>Line total<input class="num" value="${lineTot(c).toLocaleString("en-US")}" disabled></label></div>
        ${needQ > s.good ? `<span class="err">${esc(s.good <= 0 ? STOCK.shortText(p, 0) : `Only ${qtyText(p, s.good)} in stock.`)}</span>` : ""}${!isNum(c.price) ? `<span class="err">Enter a price. Set the usual price under Stock so it fills in next time.</span>` : ""}
      </div>`; }).join("") : `<div class="empty">Tap a quick button, scan, or search an item to start this sale.</div>`}</div>
    ${lines.length ? `<form id="sellForm" class="sum" style="gap:10px">
      <div class="r"><span>Subtotal</span><span class="num">${iqd(sub)}</span></div>
      <div class="grid2"><label>Discount (IQD)<input id="xDisc" class="num" inputmode="numeric" value="${esc(S.cartMeta.disc ?? "")}"></label>
      ${debtOn() ? "" : `<input type="hidden" id="xMethod" value="cash">`}${!debtOn() ? "" : `<label>Payment<select id="xMethod"><option value="cash" ${S.cartMeta.method !== "debt" ? "selected" : ""}>Cash</option><option value="debt" ${S.cartMeta.method === "debt" ? "selected" : ""}>On debt (دين)</option></select></label>`}</div>
      ${`<label>${S.cartMeta.method === "debt" ? "Customer" : "Customer (optional)"}<select id="xCust"><option value="">${S.cartMeta.method === "debt" ? "Choose customer" : "No customer"}</option>${E.customers.filter(c => !c.deleted).map(c => `<option value="${esc(c.id)}" ${S.cartMeta.customerId === c.id ? "selected" : ""}>${esc(c.name)}${c.phone ? " · " + esc(c.phone) : ""}</option>`).join("")}<option value="__new" ${S.cartMeta.customerId === "__new" ? "selected" : ""}>+ New customer</option></select></label>
      ${S.cartMeta.customerId === "__new" ? `<div class="grid2"><label>Customer name<input id="xCName" value="${esc(S.cartMeta.newName || "")}"></label><label>Phone<input id="xCPhone" inputmode="tel" value="${esc(S.cartMeta.newPhone || "")}"></label></div>` : ""}`}
      ${S.cartMeta.method !== "debt" ? `<div class="grid2"><label>Cash received (IQD)<input id="xGiven" class="num" inputmode="numeric" value="${esc(S.cartMeta.given ?? "")}"></label><label>Change to give back<input id="xChange" class="num" value="${isNum(S.cartMeta.given) && S.cartMeta.given >= total ? (S.cartMeta.given - total).toLocaleString("en-US") : ""}" disabled></label></div>` : ""}
      <div class="r big"><span>Total</span><span class="num">${iqd(total)}</span></div>
      <p class="err" id="xErr">${S.sellErr && S.sellErr.cart === JSON.stringify(S.cart) ? S.sellErr.html : ""}</p>
      <button type="submit" class="primary paybtn">Save sale · ${iqd(total)}</button></form>` : ""}
  </section>
  ${sellDash()}
  <section class="sec"><div class="sechead"><h2>Receipts</h2><span class="note">${esc(S.sellPeriod === "custom" ? [S.sellFrom, S.sellTo].filter(Boolean).join(" to ").replace(/T/g, " ") : periodRange(S.sellPeriod).join(" to "))}</span></div>
    <div class="list">${E.sales.filter(s => inPeriod(s, S.sellPeriod)).sort((a,b) => (b.at || "").localeCompare(a.at || "")).slice(0, 50).map(saleRow).join("") || `<div class="empty">No receipts yet.</div>`}</div></section>`;
}
const f0 = v => Math.round(v).toLocaleString("en-US");
function saleRow(s){
  const cu = E.customers.find(c => c.id === s.customerId);
  return `<button type="button" class="row" data-xsale="${esc(s.id)}"><span class="main"><span class="t">Receipt <span class="num">${esc(s.no || s.id)}</span>${cu ? " · " + esc(cu.name) : ""}</span><span class="s">${esc(s.date)} ${esc(hm(s.at))} · ${(s.lines || []).length} items${s.staffName ? " · " + esc(s.staffName) : ""} · ${s.method === "debt" ? "On debt" : "Cash"}</span></span><span class="end"><span class="num">${iqd(s.total)}</span>${s.voided ? `<span class="pill bad">Cancelled</span>` : ""}</span></button>`;
}
function stockView(){
  const cat = catalog(), used = usedMap(), q = S.stockQ.trim().toLowerCase();
  const rows = cat.map(p => ({p, s: stockOf(p, used)}));
  const f = S.stockF;
  const passK = (f, {p, s}) => f === "out" ? s.good <= 0 : f === "low" ? (p.min !== null ? s.good < p.min * p.sub : s.good <= 0) : f === "noexp" ? s.bs.some(b => b.left > 1e-6 && !b.expiry) : f === "exp" ? s.bs.some(b => b.left > 0 && b.ml !== null && b.ml >= 0 && b.ml <= 3) : f === "expired" ? s.exp > 0 : f === "fridge" ? p.fridge : f === "noprice" ? !p.sellBox : true;
  const pass = r => passK(f, r);
  const list = rows.filter(pass).filter(({p}) => !q || [p.name, p.strength, p.form, p.sci, p.barcode, p.desc].join(" ").toLowerCase().includes(q));
  const cnt = k => rows.filter(r => passK(k, r)).length;
  const value = rows.reduce((a,r) => a + r.s.value, 0);
  return `<section class="kpis"><div class="kpi lead"><span class="l">Stock value at cost (after discounts and bonus)</span><span class="v num">${iqd(value)}</span></div>
    <div class="kpi"><span class="l">Items</span><span class="v num">${cat.length}</span></div><div class="kpi"><span class="l">Low or out of stock</span><span class="v num" style="color:var(--bad)">${cnt("low")}</span></div></section>
  <section class="sec"><div class="sechead"><h2>Stock</h2><div class="actions"><button type="button" class="primary" data-xcount="1">Stocktaking</button><button type="button" data-xprod="__new">+ Item</button></div></div>
    <input id="stockQ" type="search" placeholder="Name, dose, barcode" value="${esc(S.stockQ)}">
    <div class="chips">${[["all","All"],["out","Out of stock"],["low","Low"],["exp","Expiring 3 months"],["expired","Expired"],["noexp","No expiry date"],["fridge","Refrigerated"],["noprice","No sell price"]].map(([k,l]) => `<button type="button" data-xsf="${k}" aria-pressed="${f === k}">${l} · ${cnt(k)}</button>`).join("")}</div>
    <div class="list">${list.length ? list.map(({p, s}) => `<button type="button" class="row" data-xprod="${esc(p.id)}"><span class="main"><span class="t">${esc(pname(p))}</span><span class="s">${esc(p.form || "")}${p.fridge ? " · براد" : ""}${s.next ? ` · next expiry ${esc(s.next.expiry)}` : ""}${s.exp ? ` · ${esc(qtyText(p, s.exp))} expired` : ""}${p.shelf ? ` · shelf ${esc(p.shelf)}` : ""}</span></span><span class="end"><span class="num">${esc(qtyText(p, s.good))}</span>${s.good <= 0 ? `<span class="pill bad">Out</span>` : p.min !== null && s.good < p.min * p.sub ? `<span class="pill warn">Low</span>` : ""}${p.sellBox ? `<span class="s num">${iqd(p.sellBox)}</span>` : `<span class="pill">No price</span>`}</span></button>`).join("") : `<div class="empty">No items here.</div>`}</div>
    <p class="note">Stock comes from your purchase invoices (paid + bonus, or what you counted in Receiving), minus returns to suppliers, sales and write-offs. Expired batches are not sold.</p></section>`;
}
function prodSheet(id){
  const cat = catalog(), p = id === "__new" ? {id:"__new", name:"", strength:"", form:"", sub:1, subName:"piece", lines:[], fridge:false} : cat.find(x => x.id === id); if (!p) return;
  const used = usedMap(), s = id === "__new" ? null : stockOf(p, used), m = p.m || {};
  openSheet(id === "__new" ? "Add item" : pname(p), `
    ${s ? `<div class="sum"><div class="r big"><span>In stock</span><span class="num">${esc(qtyText(p, s.good))}</span></div>${s.exp ? `<div class="r"><span>Expired, not for sale</span><span class="num">${esc(qtyText(p, s.exp))}</span></div>` : ""}<div class="r"><span>Value at cost</span><span class="num">${iqd(s.value)}</span></div></div>` : ""}
    <form id="prodForm" data-id="${esc(p.id)}" style="display:grid;gap:12px">
      <div class="grid2 stack"><label>Name<input id="pName" value="${esc(m.name || p.name || "")}" required></label><label>Dose<input id="pStr" value="${esc(m.strength || p.strength || "")}"></label></div>
      <div class="grid2"><label>Dosage form<input id="pForm" list="formList" value="${esc(m.form || p.form || "")}"></label><label>Scientific name<input id="pSci" value="${esc(m.sci || "")}"></label></div>
      <div class="grid2"><label>Barcode<input id="pBar" class="num" inputmode="numeric" value="${esc(m.barcode || "")}" placeholder="Scan into this box"></label><label>Shelf / place<input id="pShelf" value="${esc(m.shelf || "")}"></label></div>
      <div class="sum levels" style="gap:10px"><b>Packaging and prices</b>
        <p class="note">${p.levelsOwn ? "Set by you." : `Starting setup for ${esc(p.form || "this item")}${p.blisters ? `, from "${p.blisters}×" on the invoice` : isNum(p.pack) && p.pack > 1 ? `, from pack ${p.pack} on the invoice` : ""}. Change it to match the box.`} Now: <b>${esc(levelText(p))}</b></p>
        <div class="grid2"><label>Box price (IQD)<input id="pSellBox" class="num" inputmode="numeric" value="${esc(m.sellBox ?? "")}"></label><span class="note" id="pProfit">${(() => { const c = lastCostBox(p); return isNum(c) ? `Cost per box ${f0(c)}${isNum(m.sellBox) ? ` · Markup ${PRICING.pctTxt(PRICING.markupPct(m.sellBox, c))} · Margin ${PRICING.pctTxt(PRICING.marginPct(m.sellBox, c))}` : ""}` : "No invoice cost yet"; })()}</span></div>
        <div class="grid2"><label>Middle unit<select id="pMidName">${["","strip","blister","bottle","tube","sachet"].map(u => `<option value="${u}" ${p.midName === u ? "selected" : ""}>${u || "None"}</option>`).join("")}</select></label><label>How many in one box<input id="pMidCount" class="num" inputmode="numeric" value="${p.midName ? p.sub / p.midN : ""}"></label></div>
        <div class="grid2"><label>Price per middle unit (IQD)<input id="pSellMid" class="num" inputmode="numeric" value="${esc(m.sellMid ?? "")}" placeholder="${p.sellMid && !isNum(m.sellMid) ? "auto " + f0(p.sellMid) : ""}"></label><span></span></div>
        <div class="grid2"><label>Smallest unit<select id="pSubName">${["","tablet","capsule","piece","ampoule","vial","pen","syringe","suppository","pessary","sachet","needle","strip"].map(u => `<option value="${u}" ${(p.sub > 1 ? p.subName : "") === u ? "selected" : ""}>${u || "None"}</option>`).join("")}</select></label><label>How many in one ${p.midName ? "middle unit" : "box"}<input id="pSubCount" class="num" inputmode="numeric" value="${p.sub > 1 ? (p.midName ? p.midN : p.sub) : ""}"></label></div>
        <div class="grid2"><label>Price per smallest unit (IQD)<input id="pSellSub" class="num" inputmode="numeric" value="${esc(m.sellSub ?? "")}" placeholder="${p.sellSub && !isNum(m.sellSub) ? "auto " + f0(p.sellSub) : ""}"></label><span></span></div>
        <p class="note">Example for tablets: box → strip (3 in a box) → tablet (10 in a strip). For syrup or cream, leave both as None. Stock already sold or counted stays exact if you change this later.</p></div>
      <div class="grid2"><label>Alert when below (boxes)<input id="pMin" class="num" inputmode="numeric" value="${esc(m.min ?? "")}"></label><label class="check" style="align-self:end"><input type="checkbox" id="pCold" ${p.fridge ? "checked" : ""}> Refrigerated (براد)</label></div>
      <label class="check"><input type="checkbox" id="pQuick" ${m.quick ? "checked" : ""}> Quick button on Sell</label>
      ${s && s.bs.length && s.bs.some(b => b.left !== b.in) && p.sub !== (isNum(m.sub) ? m.sub : 1) ? "" : ""}
      <p class="err" id="pErr"></p><button type="submit" class="primary">Save item</button></form>
    ${s ? `<div class="sec"><h2>Batches (nearest expiry sold first)</h2><div class="tablewrap"><table><thead><tr><th>Batch</th><th>Expiry</th><th>Supplier · invoice</th><th class="n">Came in</th><th class="n">Left</th><th class="n">Cost each</th></tr></thead><tbody>
      ${s.bs.map(b => `<tr><td class="num">${esc(b.batch || "—")}</td><td class="num">${esc(b.expiry || "Not provided")}${b.expired ? ` <span class="pill bad">Expired</span>` : b.ml !== null && b.ml <= 3 ? ` <span class="pill warn">Soon</span>` : ""}</td><td>${esc(supName(b.inv.supplierId))} · ${esc(b.inv.invoiceNo)}</td><td class="n num">${esc(qtyText(p, b.in))}</td><td class="n num"><b>${esc(qtyText(p, b.left))}</b></td><td class="n num">${isNum(b.cost) ? Math.round(b.cost).toLocaleString("en-US") : "—"}</td></tr>`).join("") || `<tr><td colspan="6" class="note">No batches yet.</td></tr>`}</tbody></table></div></div>
    <form id="adjForm" data-id="${esc(p.id)}" class="sum" style="gap:10px"><b>Write off or correct stock</b>
      <div class="grid2"><label>Batch<select id="aKey">${s.bs.map(b => `<option value="${esc(b.key)}">${esc(b.batch || "no batch")} · ${esc(b.expiry || "")} · ${esc(qtyText(p, b.left))} left</option>`).join("")}<option value="adj:${esc(p.id)}">No batch</option></select></label>
      <label>Reason<select id="aReason">${["Expired","Damaged","Lost or missing","Count correction (less found)","Count correction (more found)","Used in pharmacy","Other"].map(r => `<option>${r}</option>`).join("")}</select></label></div>
      <div class="grid2"><label>Quantity<input id="aQty" class="num" inputmode="decimal" required></label><label>Unit<select id="aUnit">${unitOpts(p, "box")}</select></label></div>
      <label>Note<input id="aNote"></label><p class="err" id="aErr"></p><button type="submit">Save stock change</button></form>
    ${(m.priceHistory || []).length ? `<div class="sec"><h2>Price history</h2><div class="list">${[...m.priceHistory].reverse().map(h => `<div class="row" style="cursor:default"><span class="main"><span class="t num">${isNum(h.oldBox) ? f0(h.oldBox) : "—"} → ${isNum(h.box) ? f0(h.box) : "—"} IQD</span><span class="s">${esc((h.at || "").slice(0,10))} · ${esc(h.source || "")}${h.by ? " · " + esc(whoName(h.by)) : ""}</span></span></div>`).join("")}</div></div>` : ""}
    ${s ? stockHistoryHtml(p, s) : ""}` : ""}`);
}
function chronicView(){
  const soon = chronicNeeds(ALERT_DAYS()), month = chronicNeeds(null), short = soon.filter(n => n.short > 0);
  const q = S.chrQ.trim().toLowerCase();
  const cards = E.chronic.filter(c => !c.deleted).filter(c => !q || [c.name, c.phone, c.notes].join(" ").toLowerCase().includes(q)).map(c => ({c, st: chrStatus(c)})).sort((a,b) => a.st.d.localeCompare(b.st.d));
  const due = cards.filter(x => x.c.active !== false && x.st.dl <= ALERT_DAYS());
  return `<section class="kpis"><div class="kpi lead"><span class="l">Chronic patients</span><span class="v num">${E.chronic.filter(c => !c.deleted && c.active !== false).length}</span></div>
    <div class="kpi"><span class="l">Due in ${ALERT_DAYS()} days</span><span class="v num">${due.length}</span></div><div class="kpi"><span class="l">Medicines short for them</span><span class="v num" style="color:${short.length ? "var(--bad)" : "inherit"}">${short.length}</span></div></section>
  ${short.length ? `<section class="sec"><div class="sechead"><h2>Order before the pickup date</h2></div><div class="list">${short.map(n => `<button type="button" class="alert row" data-xprod="${esc(n.p.id)}"><span class="dot ${n.missing ? "bad" : ""}"></span><span><b>${esc(pname(n.p))}</b>: ${n.missing ? "missing (0 in stock)" : `have ${esc(qtyText(n.p, n.have))}`}, need ${esc(qtyText(n.p, n.q))} for ${n.cards.length} patient${n.cards.length === 1 ? "" : "s"} (${n.cards.map(c => esc(c.name)).join(", ")}). Order at least <b>${esc(qtyText(n.p, n.short))}</b>.</span></button>`).join("")}</div></section>` : due.length ? `<div class="banner" style="background:var(--good-bg);color:var(--good)">Stock covers every patient due in the next ${ALERT_DAYS()} days.</div>` : ""}
  <section class="sec"><div class="sechead"><h2>Patient cards</h2><button type="button" class="primary" data-xchr="__new">+ Card</button></div>
    <input id="chrQ" type="search" placeholder="Patient name or phone" value="${esc(S.chrQ)}">
    <div class="list">${cards.length ? cards.map(({c, st}) => `<button type="button" class="row" data-xchr="${esc(c.id)}"><span class="main"><span class="t">${esc(c.name)}${c.active === false ? ` <span class="pill">Stopped</span>` : ""}</span><span class="s">Every month on day ${esc(c.day)} · ${(c.meds || []).length} medicines${c.phone ? " · " + esc(c.phone) : ""}</span></span><span class="end"><span class="num">${esc(st.d)}</span>${st.givenThis ? `<span class="pill good">Given this month</span>` : st.dl < 0 ? `<span class="pill bad">${-st.dl} days late</span>` : st.dl <= ALERT_DAYS() ? `<span class="pill warn">In ${st.dl} days</span>` : ""}${st.shortMeds.length && c.active !== false ? `<span class="pill bad">${st.shortMeds.length} short</span>` : ""}</span></button>`).join("") : `<div class="empty">No chronic cards yet. Add a patient with the medicines they take every month and the day they collect them.</div>`}</div></section>
  ${month.length ? `<section class="sec"><div class="sechead"><h2>One full month for all patients</h2></div><div class="tablewrap"><table><thead><tr><th>Medicine</th><th class="n">Patients</th><th class="n">Needed per month</th><th class="n">In stock</th><th class="n">To order</th></tr></thead><tbody>${month.map(n => `<tr><td>${esc(pname(n.p))}</td><td class="n num">${n.cards.length}</td><td class="n num">${esc(qtyText(n.p, n.q))}</td><td class="n num">${esc(qtyText(n.p, n.have))}</td><td class="n num">${n.short ? `<b style="color:var(--bad)">${esc(qtyText(n.p, n.short))}</b>` : "—"}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
}
function chrSheet(id){
  const c = id === "__new" ? {id:"__new", name:"", phone:"", day:"", meds:[], active:true, notes:""} : E.chronic.find(x => x.id === id); if (!c) return;
  S.chrMeds = (c.meds || []).map(m => ({...m}));
  const st = id === "__new" ? null : chrStatus(c);
  openSheet(id === "__new" ? "New chronic card" : c.name, `
    ${st ? `<div class="sum"><div class="r big"><span>Next pickup</span><span class="num">${esc(st.d)}</span></div><div class="r"><span>This month</span><span>${st.givenThis ? "Given ✓" : "Not given yet"}</span></div>${st.shortMeds.length ? `<div class="r"><span>Short in stock</span><span class="err">${st.shortMeds.length} medicine${st.shortMeds.length === 1 ? "" : "s"}</span></div>` : ""}</div>
      <div class="actions">${st.givenThis ? "" : `<button type="button" class="primary" data-xgive="${esc(c.id)}">Give this month's medicines</button>`}${st.givenThis ? `<button type="button" data-xungive="${esc(c.id)}">Mark not given this month</button>` : `<button type="button" data-xgivenoff="${esc(c.id)}">Mark given (no sale)</button>`}</div>` : ""}
    <form id="chrForm" data-id="${esc(c.id)}" style="display:grid;gap:12px">
      <div class="grid2 stack"><label>Patient name<input id="cName" value="${esc(c.name)}" required></label><label>Phone<input id="cPhone" inputmode="tel" value="${esc(c.phone || "")}"></label></div>
      <div class="grid2"><label>Pickup day each month (1 to 31)<input id="cDay" class="num" inputmode="numeric" value="${esc(c.day)}" required></label><label class="check" style="align-self:end"><input type="checkbox" id="cActive" ${c.active !== false ? "checked" : ""}> Active</label></div>
      <div class="sec"><h2>Monthly medicines</h2><div id="chrMeds"></div>
        <input id="cAddQ" type="search" autocomplete="off" placeholder="Type to search your stock, then tap a medicine">
        <div id="chrPickBox" class="list" style="max-height:280px;overflow-y:auto;-webkit-overflow-scrolling:touch"></div></div>
      <label>Notes (doctor, diagnosis, allergies)<textarea id="chrNotes">${esc(c.notes || "")}</textarea></label>
      <p class="err" id="cErr"></p><button type="submit" class="primary">Save card</button>
      ${id === "__new" ? "" : `<button type="button" class="danger" data-xchrdel="${esc(c.id)}">Delete card</button>`}</form>`);
  drawChrMeds(); drawChrPick();
}
function drawChrPick(){
  const box = $("#chrPickBox"); if (!box) return; const q = ($("#cAddQ")?.value || "").trim().toLowerCase(), used = usedMap(), have = new Set(S.chrMeds.map(m => m.pid));
  const list = catalog().filter(p => !q || [p.name, p.strength, p.form, p.sci, p.desc, p.barcode].join(" ").toLowerCase().includes(q) || p.barcode === q);
  box.innerHTML = list.length ? list.map(p => { const s = stockOf(p, used); return `<button type="button" class="row" data-xcpick="${esc(p.id)}" ${have.has(p.id) ? "disabled" : ""}><span class="main"><span class="t">${esc(pname(p))}</span><span class="s">${esc(p.form || "")}${p.fridge ? " · براد" : ""}${have.has(p.id) ? " · already on this card" : ""}</span></span><span class="end"><span class="num">${esc(qtyText(p, s.good))}</span>${s.good <= 0 ? `<span class="pill bad">Out</span>` : ""}</span></button>`; }).join("") : `<div class="empty">No medicine in stock matches. Add new items under Stock first.</div>`;
}
function drawChrMeds(){
  const box = $("#chrMeds"); if (!box) return; const cat = catalog(), byId = Object.fromEntries(cat.map(p => [p.id, p])), used = usedMap();
  box.innerHTML = S.chrMeds.length ? `<div class="list">${S.chrMeds.map((m, i) => { const p = byId[m.pid]; const have = p ? stockOf(p, used).good : 0;
    return `<div class="lineedit" style="border:0;border-top:1px solid var(--line);border-radius:0"><div class="lh"><b style="color:var(--fg)">${esc(p ? pname(p) : "Item not found")}</b><button type="button" class="danger" data-xcrm="${i}" style="padding:4px 10px">Remove</button></div>
      <div class="lg"><label>Each month<input class="num" inputmode="decimal" data-xcq="${i}" value="${esc(m.qty)}"></label><label>Unit<select data-xcm="${i}">${p ? unitOpts(p, m.mode || "box") : `<option value="box">Box</option>`}</select></label><label>In stock<input value="${p ? esc(qtyText(p, have)) : "—"}" disabled></label></div>
      ${p && have < chrNeedQty(m, p) ? `<span class="err">${have <= 0 ? "Missing: none in stock." : "Not enough in stock for this month."}</span>` : ""}</div>`; }).join("")}</div>` : `<p class="note">No medicines yet.</p>`;
}
function customersView(){
  const rows = E.customers.filter(c => !c.deleted).map(c => ({c, b: custBalance(c.id)})).sort((a,b) => b.b.bal - a.b.bal);
  const tot = rows.reduce((a,r) => a + Math.max(0, r.b.bal), 0);
  return `${debtOn() || tot ? `<section class="kpis"><div class="kpi lead"><span class="l">Customers owe you (دين)</span><span class="v num">${iqd(tot)}</span></div></section>` : ""}
  <section class="sec"><div class="sechead"><h2>Customers</h2><button type="button" class="primary" data-xcust="__new">+ Customer</button></div>
    <div class="list">${rows.length ? rows.map(({c, b}) => `<button type="button" class="row" data-xcust="${esc(c.id)}"><span class="main"><span class="t">${esc(c.name)}</span><span class="s">${esc(c.phone || "")}${E.chronic.some(x => x.customerId === c.id || x.name === c.name) ? " · chronic card" : ""}</span></span><span class="end num" style="color:var(--${b.bal > 0 ? "bad" : "good"})">${iqd(b.bal)}</span></button>`).join("") : `<div class="empty">No customers yet. They are added when you sell on debt, or here.</div>`}</div></section>`;
}
function custSheet(id){
  const c = id === "__new" ? {id:"__new", name:"", phone:"", notes:""} : E.customers.find(x => x.id === id); if (!c) return;
  const b = id === "__new" ? null : custBalance(c.id);
  const ss = E.sales.filter(s => s.customerId === c.id && !s.voided).sort((a,b) => (b.at || "").localeCompare(a.at || ""));
  const ps = E.custpays.filter(x => x.customerId === c.id && !x.voided).sort((a,b) => (b.date || "").localeCompare(a.date || ""));
  openSheet(id === "__new" ? "Add customer" : c.name, `
    ${b && (debtOn() || b.debt || b.paid) ? `<div class="sum"><div class="r"><span>Bought on debt</span><span class="num">${iqd(b.debt)}</span></div><div class="r"><span>Paid</span><span class="num">−${iqd(b.paid)}</span></div><div class="r big"><span>Still owes</span><span class="num" style="color:var(--${b.bal > 0 ? "bad" : "good"})">${iqd(b.bal)}</span></div></div>
    <form id="cpForm" data-id="${esc(c.id)}" class="sum" style="gap:10px"><b>Customer paid</b><div class="grid2"><label>Amount (IQD)<input id="cpAmt" class="num" inputmode="numeric" value="${b.bal > 0 ? b.bal : ""}" required></label><label>Date<input id="cpDate" type="date" value="${today()}"></label></div><label>Note<input id="cpNote"></label><p class="err" id="cpErr"></p><button type="submit" class="primary">Save payment</button></form>` : ""}
    <form id="custForm" data-id="${esc(c.id)}" style="display:grid;gap:12px"><div class="grid2 stack"><label>Name<input id="kName" value="${esc(c.name)}" required></label><label>Phone<input id="kPhone" inputmode="tel" value="${esc(c.phone || "")}"></label></div><label>Notes<textarea id="kNotes">${esc(c.notes || "")}</textarea></label><button type="submit">Save customer</button></form>
    ${ss.length ? `<div class="sec"><h2>Purchases</h2><div class="list">${ss.map(saleRow).join("")}</div></div>` : ""}
    ${ps.length ? `<div class="sec"><h2>Payments</h2><div class="list">${ps.map(x => `<div class="row" style="cursor:default"><span class="main"><span class="t">${esc(x.date)}</span><span class="s">${esc(x.note || "")}</span></span><span class="end"><span class="num">${iqd(x.amount)}</span><button type="button" class="danger" data-xcpvoid="${esc(x.id)}" style="padding:4px 10px">Cancel</button></span></div>`).join("")}</div></div>` : ""}`);
}
function moneyView(){
  const d = today(), dc = dayCash(d), cl = E.closes.find(x => x.id === d), mm = monthMoney(S.moneyM);
  const exps = E.expenses.filter(x => !x.voided && ym(x.date) === S.moneyM).sort((a,b) => (b.date || "").localeCompare(a.date || ""));
  return `<section class="sec"><div class="sechead"><h2>Cash box today · ${esc(d)}</h2></div>
    <div class="sum"><div class="r"><span>Cash sales</span><span class="num">${iqd(dc.sales)}</span></div><div class="r"><span>Customers paid debt</span><span class="num">+${iqd(dc.cin)}</span></div><div class="r"><span>Paid to suppliers in cash</span><span class="num">−${iqd(dc.sup)}</span></div><div class="r"><span>Expenses from the box</span><span class="num">−${iqd(dc.exp)}</span></div><div class="r big"><span>Cash that should be in the box</span><span class="num">${iqd(dc.expected)}</span></div><div class="r"><span>Sold on debt today (not in the box)</span><span class="num">${iqd(dc.debtSales)}</span></div>
    ${dc.closed && dc.after ? `<div class="r"><span>Changes after closing (new sales, payments, cancels)</span><span class="num" style="color:var(--warn)">${dc.after > 0 ? "+" : "−"}${iqd(Math.abs(dc.after))}</span></div>` : ""}</div>
    <form id="closeForm" class="sum" style="gap:10px"><b>Close the day</b><label>Cash counted in the box (IQD)<input id="clAmt" class="num" inputmode="numeric" value="${cl ? esc(cl.counted) : ""}" required></label>${cl ? `<p class="note">Closed${cl.lastBy ? " by " + esc(whoName(cl.lastBy)) : ""}: difference <b class="num" style="color:var(--${Math.abs(cl.diff) <= TOL ? "good" : "bad"})">${iqd(cl.diff)}</b></p>` : ""}<label>Note<input id="clNote" value="${esc(cl?.note || "")}"></label><button type="submit">${cl ? "Update day close" : "Save day close"}</button></form></section>
  <section class="sec"><div class="sechead"><h2>Profit by month</h2><input id="moneyM" type="month" value="${esc(S.moneyM)}" style="width:auto"></div>
    <div class="sum"><div class="r"><span>Sales (${mm.count})</span><span class="num">${iqd(mm.sales)}</span></div><div class="r"><span>Cost of what was sold</span><span class="num">−${iqd(mm.cost)}</span></div><div class="r big"><span>Gross profit</span><span class="num">${iqd(mm.gross)}</span></div><div class="r"><span>Expenses</span><span class="num">−${iqd(mm.expenses)}</span></div><div class="r"><span>${mm.writeoff < 0 ? "Extra stock found at counts" : "Expired, damaged or lost stock (less any found)"}</span><span class="num">${mm.writeoff < 0 ? "+" : "−"}${iqd(Math.abs(mm.writeoff))}</span></div><div class="r big"><span>Net profit</span><span class="num" style="color:var(--${mm.net >= 0 ? "good" : "bad"})">${iqd(mm.net)}</span></div><div class="r"><span>Bought from suppliers this month</span><span class="num">${iqd(mm.purchases)}</span></div></div>
    ${mm.noCost ? `<p class="note">Some sales or stock changes have no cost because the item has no purchase invoice yet, so profit may be a little off.</p>` : ""}</section>
  <section class="sec"><div class="sechead"><h2>Expenses</h2><button type="button" class="primary" data-xexp="1">+ Expense</button></div>
    <div class="list">${exps.length ? exps.map(x => `<div class="row" style="cursor:default"><span class="main"><span class="t">${esc(x.category)}</span><span class="s">${esc(x.date)}${x.note ? " · " + esc(x.note) : ""}${x.fromCash === false ? " · not from cash box" : ""}</span></span><span class="end"><span class="num">${iqd(x.amount)}</span><button type="button" class="danger" data-xexpvoid="${esc(x.id)}" style="padding:4px 10px">Cancel</button></span></div>`).join("") : `<div class="empty">No expenses this month.</div>`}</div>
    ${Object.keys(mm.byCat).length ? `<p class="note">${Object.entries(mm.byCat).map(([k,v]) => `${esc(k)}: <span class="num">${iqd(v)}</span>`).join(" · ")}</p>` : ""}</section>`;
}
function settingsView(){
  const sy = window.ERP_SYNC, c = sy?.cfg();
  return `<section class="sec"><h2>Settings</h2>
    <form id="cfgForm" class="sum" style="gap:10px"><div class="grid2 stack"><label>Pharmacy name on receipts<input id="cfgName" value="${esc(E.cfg.name || "صيدلية ريحانة · Raihana Pharmacy")}"></label><label>Phone on receipts<input id="cfgPhone" value="${esc(E.cfg.phone || "")}"></label></div>
      <label>Warn about chronic pickups this many days ahead<input id="sDays" class="num" inputmode="numeric" value="${ALERT_DAYS()}"></label>
      <label class="check"><input type="checkbox" id="sDebt" ${debtOn() ? "checked" : ""}> Allow selling on debt (دين)</label>
      <label>Discount staff may give without your PIN (% of the receipt)<input id="sDisc" class="num" inputmode="decimal" value="${esc(n0(E.cfg.staffDiscPct))}"></label>
      <p class="note">Staff also need your PIN to sell below the set price, cancel a sale or payment or expense, write off or add stock, and save a stocktake. Nobody can sell more than the stock shows; only the owner can, with the owner PIN.</p>${alertSettings()}<button type="submit">Save settings</button></form></section>
  <section class="sec"><h2>Where your data is</h2><div class="sum">
    ${window.ERP_MODE === "claude" ? `<p>You are using the claude.ai version. Data is saved online in your Claude account and shared on every device where you open this link. It needs internet. Photo scan works here.</p>` :
    `<p>Installed app. Data is saved on this device first, so it works with no internet.</p>
     <div class="r"><span>Cloud sync</span><span>${!c ? "Not connected" : sy.status.state === "ok" ? "✓ Up to date" : sy.status.state === "offline" ? "Offline, will sync later" : sy.status.state === "error" ? esc(sy.status.msg || "Error") : "Connecting…"}</span></div>
     <div class="r"><span>Changes waiting to upload</span><span class="num">${sy.pending()}</span></div>
     ${c ? `<p class="note">Signed in as ${esc(c.email)}.</p><div class="actions"><button type="button" data-xsync="1">Sync now</button><button type="button" class="danger" data-xlogout="1">Sign out of sync</button></div>` :
     `<form id="syncForm" style="display:grid;gap:10px"><p class="note">Fill these in once your Supabase project is ready. Type the password yourself; it is never saved in a file.</p><label>Project URL<input id="yUrl" placeholder="https://xxxx.supabase.co"></label><label>Public (anon) key<input id="yKey"></label><div class="grid2 stack"><label>Email<input id="yEmail" type="email"></label><label>Password<input id="yPass" type="password" autocomplete="current-password"></label></div><p class="err" id="yErr"></p><button type="submit" class="primary">Connect</button></form>`}`}
  </div></section>
  <section class="sec"><h2>Backup</h2><div class="sum"><p>Full backup of everything (invoices, payments, stock changes, sales, customers, chronic cards, expenses) as one file. Keep it on another device or in Google Drive.</p>
    <div class="actions"><button type="button" class="primary" data-xbackup="1" ${S.dl ? "" : "disabled"}>Download full backup</button><button type="button" data-act="export" ${S.dl ? "" : "disabled"}>Download Excel</button></div>
    ${S.readOnly ? "" : `<label>Restore from a backup file<input type="file" id="restoreIn" accept="application/json,.json"></label><p class="note">You see what will change before anything is saved. Nothing is deleted, and nothing you changed or cancelled after the backup is undone.</p>`}</div></section>
  <section class="sec"><h2>Install on phone or computer</h2><div class="sum"><p><b>iPhone:</b> open the app link in Safari, tap Share, then Add to Home Screen.</p><p><b>Android:</b> open the link in Chrome, tap the menu, then Install app.</p><p><b>Computer:</b> open the link in Chrome or Edge and click the install icon in the address bar.</p></div></section>`;
}

/* ---- stocktaking: count the shelves, the app shows the difference and fixes stock in one step ---- */
S.count = lsGet("erp.count", null);
function countSheet(){
  if (!S.count) S.count = {started:nowIso(), counts:{}, q:""};
  const cat = catalog(), used = usedMap(), q = (S.count.q || "").trim().toLowerCase();
  const list = cat.filter(p => !q || [p.name, p.strength, p.form, p.barcode, p.shelf].join(" ").toLowerCase().includes(q) || p.barcode === q);
  const done = Object.keys(S.count.counts).length;
  openSheet("Stocktaking", `<p class="note">Count what is on the shelf and in the fridge, not expired stock. Type boxes and loose small units. You can stop and come back; the count is kept on this device until you save it.</p>
    <div class="actions"><button type="button" data-xctfile="1">Fill from Excel or CSV</button></div>
    <input id="ctQ" type="search" placeholder="Scan barcode or type a name" value="${esc(S.count.q || "")}">
    <div class="list" id="ctList">${list.map(p => { const sys = stockOf(p, used).good, c = S.count.counts[p.id], b = c !== undefined ? Math.floor(c / p.sub) : "", r = c !== undefined && p.sub > 1 ? c - Math.floor(c / p.sub) * p.sub : "";
      const mm = c !== undefined && p.midName ? Math.floor((c - Math.floor(c / p.sub) * p.sub) / p.midN) : "", rr = c !== undefined && p.sub > 1 ? c - Math.floor(c / p.sub) * p.sub - (p.midName ? n0(mm) * p.midN : 0) : "";
      return `<div class="lineedit" data-ct="${esc(p.id)}" style="border:0;border-top:1px solid var(--line);border-radius:0"><div class="lh"><b style="color:var(--fg)">${esc(pname(p))}</b><span>System: <span class="num">${esc(qtyText(p, sys))}</span></span></div>
        <div class="lg"><label>Boxes counted<input class="num" inputmode="numeric" data-ctb="${esc(p.id)}" value="${b}"></label>${p.midName ? `<label>Loose ${esc(p.midName)}s<input class="num" inputmode="numeric" data-ctm="${esc(p.id)}" value="${mm}"></label>` : ""}${p.sub > 1 ? `<label>Loose ${esc(p.subName)}s<input class="num" inputmode="numeric" data-cts="${esc(p.id)}" value="${rr}"></label>` : ""}<label>Difference<input data-ctd="${esc(p.id)}" value="${c === undefined ? "" : esc(c === sys ? "Matches ✓" : (c > sys ? "+" : "−") + qtyText(p, Math.abs(c - sys)))}" disabled></label></div></div>`; }).join("") || `<div class="empty">No item matches.</div>`}</div>
    <div class="sum"><div class="r"><span>Items counted</span><span class="num" id="ctDone">${done}</span></div><p class="err" id="ctErr"></p>
    <div class="actions"><button type="button" class="primary" data-xctsave="1">Save count and fix stock</button><button type="button" class="danger" data-xctdrop="1">Throw away this count</button></div></div>
    ${E.counts.length ? `<div class="sec"><h2>Past stocktakes</h2><div class="list">${[...E.counts].sort((a,b) => (b.at || "").localeCompare(a.at || "")).slice(0,10).map(x => `<div class="row" style="cursor:default"><span class="main"><span class="t">${esc(x.date)}</span><span class="s">${(x.lines || []).length} items counted · ${(x.lines || []).filter(l => l.diff).length} differences${x.lastBy ? " · " + esc(whoName(x.lastBy)) : ""}</span></span><span class="end num">${iqd(x.valueDiff)}</span></div>`).join("")}</div></div>` : ""}`);
}
function ctRead(pid){
  const p = catalog().find(x => x.id === pid); if (!p) return;
  const v = a => parseNum(document.querySelector(`[data-${a}="${pid}"]`)?.value), b = v("ctb"), mm = v("ctm"), r = v("cts");
  if (!isNum(b) && !isNum(r) && !isNum(mm)) delete S.count.counts[pid]; else S.count.counts[pid] = n0(b) * p.sub + n0(mm) * n0(p.midN) + n0(r);
  lsSet("erp.count", S.count);
  const sys = stockOf(p, usedMap()).good, c = S.count.counts[pid], d = document.querySelector(`[data-ctd="${pid}"]`);
  if (d) d.value = c === undefined ? "" : c === sys ? "Matches ✓" : (c > sys ? "+" : "−") + qtyText(p, Math.abs(c - sys));
  const dn = $("#ctDone"); if (dn) dn.textContent = Object.keys(S.count.counts).length;
}
async function ctSave(btn){
  const entries = Object.entries(S.count?.counts || {}); if (!entries.length){ $("#ctErr").textContent = "Count at least one item."; return; }
  btn.disabled = true;
  try {
    const by = await ownerOK([`Save stocktaking and correct stock (${entries.length} items counted)`]); if (!by){ $("#ctErr").textContent = NEED_OWNER; return; }
    const cat = catalog(), used = usedMap(true), lines = []; let valueDiff = 0;
    for (const [pid, counted] of entries){ const p = cat.find(x => x.id === pid); if (!p) continue;
      const st = stockOf(p, used), sys = st.good, diff = counted - sys; lines.push({pid, name:pname(p), system:sys, counted, diff});
      if (!diff) continue;
      if (diff < 0){ let need = -diff; // less found: take it from the nearest-expiry batches first
        for (const b of st.bs){ if (need <= 0) break; if (b.expired || b.left <= 0) continue; const q = r6(Math.min(b.left, need)), mid = newId("MV");
          await write("moves/" + mid, {id:mid, pid, key:b.key, q, per:p.sub, reason:"Count correction (less found)", note:"Stocktaking", date:today(), at:nowIso(), cost: isNum(b.cost) ? b.cost : null}); valueDiff -= q * n0(b.cost); need -= q; }
        if (need > 0){ const mid = newId("MV"), c0 = subCostNow(p); await write("moves/" + mid, {id:mid, pid, key:"adj:" + pid, q:need, per:p.sub, reason:"Count correction (less found)", note:"Stocktaking", date:today(), at:nowIso(), cost:c0}); valueDiff -= need * n0(c0); }
      } else { const mid = newId("MV"), cost = st.next?.cost ?? st.bs[st.bs.length - 1]?.cost ?? null;
        await write("moves/" + mid, {id:mid, pid, key:"adj:" + pid, q:-diff, per:p.sub, reason:"Count correction (more found)", note:"Stocktaking", date:today(), at:nowIso(), cost: isNum(cost) ? cost : null}); valueDiff += diff * n0(cost); }
    }
    const cid = newId("ST"); await write("counts/" + cid, {id:cid, date:today(), at:nowIso(), started:S.count.started, lines, valueDiff:Math.round(valueDiff), approvedBy:by});
    S.count = null; lsSet("erp.count", null); closeSheet(); toast(`Stocktaking saved. ${lines.filter(l => l.diff).length} items corrected.`);
  } catch(x){ $("#ctErr").textContent = x.message; } finally { btn.disabled = false; }
}
document.addEventListener("input", ev => { const t = ev.target;
  if (t.id === "ccAmt"){ const v = Math.round(Number(t.value.replace(/[,\s]/g, ""))), e = S.countExp; if (t.value.trim() && isFinite(v) && isNum(e)){ const el = $("#ccDiff"); el.textContent = diffTxt(v - e); el.className = v === e ? "note" : "err"; if (S.lang === "ar") translate(el); } return; }
  if (t.dataset.ctb || t.dataset.cts || t.dataset.ctm) ctRead(t.dataset.ctb || t.dataset.cts || t.dataset.ctm);
  if (t.id === "ctQ"){ S.count.q = t.value; lsSet("erp.count", S.count); countSheet(); const q = $("#ctQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
});
document.addEventListener("click", ev => { const t = ev.target.closest("button"); if (!t) return;
  if (t.dataset.xcount){ countSheet(); }
  if (t.dataset.xctsave){ ctSave(t); }
  if (t.dataset.xctdrop){ if (t.dataset.sure !== "1"){ t.dataset.sure = "1"; t.textContent = "Tap again to throw it away"; return; } S.count = null; lsSet("erp.count", null); closeSheet(); toast("Count thrown away."); }
});

/* ---- pricing: one by one, many at once with a % on cost, or import a price file from the old system ---- */
S.pr = {mode:"markup", ...(lsGet("erp.prDraft", null) || {edits:{}, sel:[], f:"all", q:"", pct:"", round:250})};
const prSave = () => lsSet("erp.prDraft", S.pr);
function lastCostBox(p){ // newest invoice line's cost per box, after every discount and the bonus
  const l = [...p.lines].sort((a,b) => (b.inv.date || "").localeCompare(a.inv.date || ""))[0]; if (!l) return null;
  const c = subCost(l.inv, l.k, p); return isNum(c) ? c * p.sub : null;
}
const roundTo = PRICING.round;
function prVal(p, k){ const e = S.pr.edits[p.id]; return e && k in e ? e[k] : (k === "box" ? p.m?.sellBox ?? null : k === "mid" ? p.m?.sellMid ?? null : p.m?.sellSub ?? null); }
/* markup is profit as a % of cost; profit margin is profit as a % of the sell price. 20% markup = 16.7% margin */
const prProfit = r => S.pr.mode === "margin" ? PRICING.marginPct(r.box, r.cost) : PRICING.markupPct(r.box, r.cost);
function marginTxt(price, cost){ const mu = PRICING.markupPct(price, cost), mg = PRICING.marginPct(price, cost); if (mu === null) return "";
  return `<b class="num">${f0(price - cost)}</b><div class="note"><span ${S.pr.mode === "markup" ? 'style="font-weight:700;color:var(--fg)"' : ""}>Markup ${PRICING.pctTxt(mu)}</span> · <span ${S.pr.mode === "margin" ? 'style="font-weight:700;color:var(--fg)"' : ""}>Margin ${PRICING.pctTxt(mg)}</span></div>`; }
function pricingView(){
  const cat = catalog(), q = S.pr.q.trim().toLowerCase(), f = S.pr.f, sel = new Set(S.pr.sel);
  const rows = cat.map(p => ({p, cost:lastCostBox(p), box:prVal(p, "box")}));
  const passF = (k, r) => k === "noprice" ? !isNum(r.box) : k === "below" ? isNum(r.box) && isNum(r.cost) && r.box < r.cost : k === "low" ? isNum(r.box) && isNum(r.cost) && r.box >= r.cost && prProfit(r) < 10 : k === "changed" ? !!S.pr.edits[r.p.id] : true;
  const list = rows.filter(r => passF(f, r)).filter(({p}) => !q || [p.name, p.strength, p.form, p.barcode, p.sci].join(" ").toLowerCase().includes(q));
  const nChanged = Object.keys(S.pr.edits).length, priced = rows.filter(r => isNum(r.p.m?.sellBox)).length;
  return `<section class="kpis"><div class="kpi lead"><span class="l">Items with a sell price</span><span class="v num">${priced} / ${cat.length}</span></div>
    <button type="button" class="kpi tap" data-xprf="noprice"><span class="l">No sell price</span><span class="v num" style="color:var(--warn)">${rows.filter(r => !isNum(r.p.m?.sellBox)).length}</span><span class="l">tap to see</span></button>
    <button type="button" class="kpi tap" data-xprf="below"><span class="l">Selling below cost</span><span class="v num" style="color:var(--bad)">${rows.filter(r => passF("below", r)).length}</span><span class="l">tap to see</span></button></section>
  <section class="sec"><div class="sechead"><h2>Pricing</h2><div class="actions"><button type="button" data-ximp="1">Import price file</button></div></div>
    <input id="prQ" type="search" placeholder="Name, dose, barcode" value="${esc(S.pr.q)}">
    <div class="chips">${[["all","All"],["noprice","No price"],["below","Below cost"],["low",`${S.pr.mode === "margin" ? "Margin" : "Markup"} under 10%`],["changed","Changed, not saved"]].map(([k,l]) => `<button type="button" data-xprf="${k}" aria-pressed="${f === k}">${l} · ${rows.filter(r => passF(k, r)).length}</button>`).join("")}</div>
    <div class="sum" style="gap:10px"><b>Change many at once</b>
      <div class="chips" role="group" aria-label="Work out price by">${[["markup","Markup on cost"],["margin","Profit margin on sell price"]].map(([k,l]) => `<button type="button" data-xprmode="${k}" aria-pressed="${S.pr.mode === k}">${l}</button>`).join("")}</div>
      <div class="note formula">${S.pr.mode === "margin" ? `<div>Margin % = (Selling price − Cost) ÷ Selling price × 100</div><div>Selling price = Cost ÷ (1 − Margin)</div><div>Example: cost 10,000 and margin 20% (0.20): 10,000 ÷ 0.80 = 12,500</div>` : `<div>Markup % = (Selling price − Cost) ÷ Cost × 100</div><div>Selling price = Cost × (1 + Markup)</div><div>Example: cost 10,000 and markup 20% (0.20): 10,000 × 1.20 = 12,000</div>`}</div>
      <div class="grid2"><label>${S.pr.mode === "margin" ? "Profit margin (%)" : "Markup (%)"}<input id="prPct" class="num" inputmode="decimal" value="${esc(S.pr.pct)}" placeholder="e.g. 20"></label>
      <label>Round to<select id="prRound">${[[250,"250 IQD"],[500,"500 IQD"],[1000,"1,000 IQD"],[1,"No rounding"]].map(([v,l]) => `<option value="${v}" ${+S.pr.round === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <div class="actions"><button type="button" data-xprapply="sel">Apply to ticked (${sel.size})</button><button type="button" data-xprapply="all">Apply to all shown (${list.length})</button><button type="button" data-xprsel="all">Tick all shown</button>${sel.size ? `<button type="button" data-xprsel="none">Untick all</button>` : ""}</div>
      <p class="note">This only fills in the prices below so you can check them. Nothing is saved until you tap Save. Cost is the newest invoice's cost per box after every discount and the bonus.</p></div>
    <div class="tablewrap"><table class="prt"><thead><tr><th></th><th>Item</th><th class="n">Cost per box</th><th class="n">Sell per box</th><th class="n">Profit per box</th><th class="n">Sell per middle unit</th><th class="n">Sell per smallest unit</th></tr></thead><tbody>
    ${list.map(({p, cost, box}) => { const sub = prVal(p, "sub"), ch = !!S.pr.edits[p.id];
      return `<tr ${ch ? 'class="chg"' : ""}><td class="ck"><input type="checkbox" data-xprck="${esc(p.id)}" ${sel.has(p.id) ? "checked" : ""} aria-label="Tick ${esc(p.name)}"></td><td class="nm"><b>${esc(p.name)}</b><div class="note">${esc(p.strength || p.form || "")}${p.barcode ? " · " + esc(p.barcode) : ""}</div><div class="note">${esc(levelText(p))}</div></td>
        <td class="n num" data-l="Cost per box">${isNum(cost) ? f0(cost) : "—"}</td><td class="n" data-l="Sell per box"><input class="num" inputmode="numeric" data-xprb="${esc(p.id)}" value="${isNum(box) ? box : ""}" style="width:110px;text-align:end"></td>
        <td class="n" data-l="Profit per box" data-xprm="${esc(p.id)}" style="color:var(--${isNum(box) && isNum(cost) && box < cost ? "bad" : "good"})">${marginTxt(box, cost)}</td>
        <td class="n" data-l="Sell per middle unit">${p.midName ? (() => { const mv = prVal(p, "mid"); return `<input class="num" inputmode="numeric" data-xprmid="${esc(p.id)}" value="${isNum(mv) ? mv : ""}" placeholder="${p.sellMid && !isNum(mv) ? "auto " + f0(p.sellMid) : esc(p.midName)}" style="width:100px;text-align:end">`; })() : `<span class="note">—</span>`}</td>
        <td class="n" data-l="Sell per smallest unit">${p.sub > 1 ? `<input class="num" inputmode="numeric" data-xprs="${esc(p.id)}" value="${isNum(sub) ? sub : ""}" placeholder="${p.sellSub && !isNum(sub) ? "auto " + f0(p.sellSub) : esc(p.subName)}" style="width:100px;text-align:end">` : `<span class="note">box only</span>`}</td></tr>`; }).join("") || `<tr><td colspan="7" class="note">No items here.</td></tr>`}</tbody></table></div>
    <div class="sticky-save" ${nChanged ? "" : "hidden"}><span><b class="num">${nChanged}</b> prices changed</span><div class="actions"><button type="button" data-xprdrop="1">Undo changes</button><button type="button" class="primary" data-xprsave="1">Save ${nChanged} prices</button></div></div>
  </section>`;
}
function prSet(pid, k, v){
  const p = catalog().find(x => x.id === pid); if (!p) return;
  const e = S.pr.edits[pid] || {}; e[k] = v;
  const same = (e.box === undefined || e.box === (p.m?.sellBox ?? null)) && (e.sub === undefined || e.sub === (p.m?.sellSub ?? null)) && (e.mid === undefined || e.mid === (p.m?.sellMid ?? null));
  if (same) delete S.pr.edits[pid]; else S.pr.edits[pid] = e; prSave();
}
async function prSaveAll(btn, edits, source){
  if (!canUse("pricing")) throw new Error("The owner has not given you this screen.");
  const cat = catalog(), ids = Object.keys(edits); if (!ids.length) return 0; btn && (btn.disabled = true);
  let n = 0;
  try {
    for (const pid of ids){ const p = cat.find(x => x.id === pid); if (!p) continue; const e = edits[pid], m = p.m || {};
      const box = "box" in e ? e.box : m.sellBox ?? null, sub = "sub" in e ? e.sub : m.sellSub ?? null, mid = "mid" in e ? e.mid : m.sellMid ?? null;
      const cost = lastCostBox(p), hist = [...(m.priceHistory || []), {at:nowIso(), by:S.meId, box, mid, sub, oldBox:m.sellBox ?? null, oldMid:m.sellMid ?? null, oldSub:m.sellSub ?? null, cost, markupPct:PRICING.markupPct(box, cost), marginPct:PRICING.marginPct(box, cost), mode:S.pr.mode, source}].slice(-30);
      await write("products/" + pid, {...m, id:pid, sellBox:box, sellMid:mid, sellSub:sub, priceHistory:hist, ...(e.barcode && !m.barcode ? {barcode:e.barcode} : {})}); n++; }
  } finally { btn && (btn.disabled = false); }
  return n;
}
/* reading Excel or CSV files: shared by the price import, the invoice upload and the stocktaking upload */
const normName = v => String(v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function guessCol(headers, words, taken = []){ return headers.findIndex((h, i) => !taken.includes(i) && words.some(w => normName(h).includes(normName(w)))); }
// guess each column in turn, so one column is never picked twice
function guessCols(headers, spec){ const map = {}, taken = []; for (const [k, words] of spec){ map[k] = guessCol(headers, words, taken); if (map[k] >= 0) taken.push(map[k]); } return map; }
const cellNum = v => { const x = typeof v === "number" ? v : parseNum(v); return isNum(x) ? x : null; };
const numColOf = (rows, i) => rows.slice(0, 20).filter(r => isNum(cellNum(r[i]))).length >= Math.min(3, rows.length);
const pickSheet = fn => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,.xls,.csv,text/csv"; inp.onchange = () => inp.files[0] && fn(inp.files[0]); inp.click(); };
async function readSheetFile(file){
  if (!window.XLSX){ toast("The Excel reader didn't load. Check the internet connection and try again."); return null; }
  try {
    const wb = /\.(csv|txt)$/i.test(file.name) ? XLSX.read((await file.text()).replace(/^\uFEFF/, ""), {type:"string"}) : XLSX.read(await file.arrayBuffer(), {type:"array"}), ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, {header:1, defval:"", raw:true}).filter(r => r.some(c => String(c).trim() !== ""));
    if (grid.length < 2){ toast("That file has no rows."); return null; }
    let hi = grid.slice(0, 10).findIndex(r => r.filter(c => typeof c === "string" && c.trim()).length >= 2); if (hi < 0) hi = 0;
    return {file:file.name, headers:grid[hi].map((h, i) => String(h).trim() || `Column ${i + 1}`), rows:grid.slice(hi + 1)};
  } catch(e){ toast("That file couldn't be read. Use .xlsx, .xls or .csv."); return null; }
}
// find a stock item for a row of a file: barcode first, then exact name, then a close name that the user must check
// "20 mg" and "20mg" are the same dose when matching names
const matchKey = v => normName(v).replace(/(\d)\s+(?=\p{L})/gu, "$1");
function itemMatcher(){
  const cat = catalog(), by = {}; cat.forEach(p => { by[matchKey(pname(p))] = p; by[matchKey(p.name)] = by[matchKey(p.name)] || p; });
  return (name, bc) => {
    let p = bc && cat.find(x => x.barcode && x.barcode === bc), how = p ? "barcode" : "";
    if (!p && name){ p = by[matchKey(name)]; if (p) how = "name"; }
    if (!p && name){ const t = new Set(matchKey(name).split(" ").filter(w => w.length > 1)); let best = null, sc = 0;
      for (const x of cat){ const u = matchKey(pname(x)).split(" ").filter(w => w.length > 1); if (!u.length || !t.size) continue; const hit = u.filter(w => t.has(w)).length; const s2 = hit / Math.max(t.size, Math.min(u.length, 4)); if (s2 > sc){ sc = s2; best = x; } }
      if (best && sc >= 0.5){ p = best; how = "check"; } }
    return {pid: p ? p.id : "", how};
  };
}
const NAME_WORDS = ["name","item","product","drug","description","اسم","المادة","الصنف","المنتج","البيان"], BARCODE_WORDS = ["barcode","bar code","code","ean","باركود","الباركود"];

/* import a price list: Excel or CSV from MyPharma or any old system */
async function readPriceFile(file){
  const F = await readSheetFile(file); if (!F) return;
  const {headers, rows} = F;
  const map = {name: guessCol(headers, NAME_WORDS), barcode: guessCol(headers, BARCODE_WORDS),
    price: guessCol(headers, ["sell","retail","price","بيع","سعر"]), mid: guessCol(headers, ["strip","blister","شريط"]), sub: guessCol(headers, ["piece","tablet","unit price","حبة","مفرد"])};
  if (map.sub === map.price) map.sub = -1; if (map.mid === map.price) map.mid = -1; if (map.mid === map.sub) map.sub = -1;
  if (map.name < 0) map.name = headers.findIndex((h, i) => !numColOf(rows, i));
  if (map.price < 0){ for (let i = headers.length - 1; i >= 0; i--) if (i !== map.barcode && numColOf(rows, i)){ map.price = i; break; } }
  S.imp = {...F, map}; impMatch(); impSheet();
}
function impMatch(){
  const I = S.imp, match = itemMatcher(), cell = (r, k) => I.map[k] >= 0 ? r[I.map[k]] : "";
  const num = v => { const x = cellNum(v); return x > 0 ? x : null; };
  I.out = I.rows.map((r, i) => {
    const name = String(cell(r, "name") ?? "").trim(), bc = String(cell(r, "barcode") ?? "").trim(), price = num(cell(r, "price")), sub = num(cell(r, "sub")), mid = num(cell(r, "mid"));
    const {pid, how} = match(name, bc);
    return {i, name, bc, price, sub, mid, pid, how, use: !!pid && how !== "check" && !!price};
  });
}
function impSheet(){
  const I = S.imp, cat = catalog(), ok = I.out.filter(o => o.use).length, opts = h => `<option value="-1">Not in file</option>` + I.headers.map((x, i) => `<option value="${i}" ${h === i ? "selected" : ""}>${esc(x)}</option>`).join("");
  const sorted = [...I.out].sort((a,b) => ({check:0, "":1, name:2, barcode:3}[a.how] - ({check:0, "":1, name:2, barcode:3}[b.how])));
  openSheet("Import prices", `<p class="note">${esc(I.file)} · ${I.rows.length} rows. Check which column is which, then check the matches. Only ticked rows are saved.</p>
    <div class="grid2"><label>Item name column<select data-ximap="name">${opts(I.map.name)}</select></label><label>Barcode column<select data-ximap="barcode">${opts(I.map.barcode)}</select></label>
    <label>Sell price per box column<select data-ximap="price">${opts(I.map.price)}</select></label><label>Middle unit (strip) price column<select data-ximap="mid">${opts(I.map.mid ?? -1)}</select></label><label>Smallest unit price column<select data-ximap="sub">${opts(I.map.sub)}</select></label></div>
    <div class="sum"><div class="r"><span>Matched by barcode</span><span class="num">${I.out.filter(o => o.how === "barcode").length}</span></div><div class="r"><span>Matched by name</span><span class="num">${I.out.filter(o => o.how === "name").length}</span></div><div class="r"><span>Close match, please check</span><span class="num">${I.out.filter(o => o.how === "check").length}</span></div><div class="r"><span>Not in your stock</span><span class="num">${I.out.filter(o => !o.pid).length}</span></div></div>
    <div class="tablewrap"><table><thead><tr><th>Save</th><th>In the file</th><th>Your item</th><th class="n">Now</th><th class="n">From file</th></tr></thead><tbody>
    ${sorted.slice(0, 400).map(o => { const p = cat.find(x => x.id === o.pid); return `<tr><td><input type="checkbox" data-ximuse="${o.i}" ${o.use ? "checked" : ""} ${!o.pid || !o.price ? "disabled" : ""} aria-label="Save this row"></td><td>${esc(o.name || "—")}${o.bc ? `<div class="note num">${esc(o.bc)}</div>` : ""}</td>
      <td><select data-ximpid="${o.i}" style="min-width:180px"><option value="">Not in stock · skip</option>${cat.map(x => `<option value="${esc(x.id)}" ${x.id === o.pid ? "selected" : ""}>${esc(pname(x))}</option>`).join("")}</select>${o.how === "check" ? `<span class="pill warn">Check</span>` : o.how ? `<span class="pill good">${o.how === "barcode" ? "Barcode" : "Name"}</span>` : ""}</td>
      <td class="n num">${p && isNum(p.m?.sellBox) ? f0(p.m.sellBox) : "—"}</td><td class="n num"><b>${o.price ? f0(o.price) : "—"}</b>${o.mid ? `<div class="note">${f0(o.mid)} middle</div>` : ""}${o.sub ? `<div class="note">${f0(o.sub)} smallest</div>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
    ${I.rows.length > 400 ? `<p class="note">Showing the first 400 rows. All matched rows are still saved.</p>` : ""}
    <label class="check"><input type="checkbox" id="imBar" checked> Also save the barcode from the file when the item has none</label>
    <p class="err" id="imErr"></p><button type="button" class="primary" data-ximsave="1">Save ${ok} prices from the file</button>`);
}

// a pop-up that changes to a different page starts at its top, so the "check these" note is the first thing seen
const sheetTop = () => document.querySelectorAll("#sheet, #sheet *").forEach(el => { if (el.scrollTop) el.scrollTop = 0; });
/* ---- fill a new purchase invoice from an Excel or CSV file. Only what is in the file is filled in:
   a blank price, batch or expiry stays blank, and nothing is saved until the invoice form's Save ---- */
const INV_COLS = [["bonus","Bonus qty",["bonus","free","بونص","مجاني","هدية"]],["discPct","Discount %",["discount %","disc %","نسبة الخصم","خصم %"]],["discAmt","Discount (IQD)",["discount","disc","خصم"]],
  ["expiry","Expiry",["expiry","exp","expire","الصلاحية","انتهاء"]],["batch","Batch",["batch","lot","باج","الوجبة","وجبة"]],["cold","Refrigerated",["fridge","cold","refrigerat","براد","تبريد"]],
  ["value","Line value",["value","amount","total","line total","القيمة","المبلغ","الاجمالي","الإجمالي"]],["price","Unit price",["unit price","price","cost","السعر","سعر"]],["qty","Paid qty",["qty","quantity","الكمية","العدد"]],["desc","Product",NAME_WORDS]];
const TOTAL_ROW = /^(total|sub ?total|grand total|net|المجموع|الاجمالي|الإجمالي|المجموع الصافي|الصافي)(?=[\s:.]|$)/i; // \b does not work after Arabic letters
const YES = /^(yes|y|true|1|x|✓|✔|نعم|براد)$/i;
// expiry as YYYY-MM from an Excel date, 2027-05, 05/2027, 5/27 or 15/05/2027 (day first). Anything else stays blank and is flagged.
function expiryOf(v){
  if (v === "" || v == null) return {v:""};
  if (typeof v === "number" && v > 20000 && v < 80000) return {v:new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 7)};
  const s = String(v).trim().replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)), mm = n => n >= 1 && n <= 12, two = n => String(n).padStart(2, "0");
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})(?:[-\/.]\d{1,2})?$/); if (m && mm(+m[2])) return {v:`${m[1]}-${two(+m[2])}`};
  m = s.match(/^(?:\d{1,2}[-\/.])?(\d{1,2})[-\/.](\d{4}|\d{2})$/); if (m && mm(+m[1])) return {v:`${m[2].length === 2 ? 2000 + +m[2] : m[2]}-${two(+m[1])}`};
  return {v:"", bad:s};
}
async function readInvoiceFile(file){
  const F = await readSheetFile(file); if (!F) return;
  const map = guessCols(F.headers, INV_COLS.map(([k, , w]) => [k, w]));
  if (map.desc < 0) map.desc = F.headers.findIndex((h, i) => !Object.values(map).includes(i) && !numColOf(F.rows, i));
  S.invImp = {...F, map, base:S.invImpBase}; invImpParse(); invImpSheet();
}
function invImpParse(){
  const I = S.invImp, cell = (r, k) => I.map[k] >= 0 ? r[I.map[k]] : "", lines = [], flags = []; let skipped = 0, merged = 0;
  const plain = d => normName(String(d).replace(/\(?\s*براد\s*\)?/g, ""));
  I.rows.forEach((r, i) => {
    const desc = String(cell(r, "desc") ?? "").trim(), qty = cellNum(cell(r, "qty")), price = cellNum(cell(r, "price")), value = cellNum(cell(r, "value")), row = i + 1;
    if (!desc && !isNum(qty)) { skipped++; return; }
    if (TOTAL_ROW.test(desc) && !(qty > 0)) { skipped++; return; }
    const prev = lines[lines.length - 1];
    // the owner's rule: a quantity with no value is bonus for the priced line of the same product above it
    if (qty > 0 && !isNum(price) && !isNum(value) && prev && isNum(prev.price) && (!desc || plain(desc) === plain(prev.desc))){
      prev.bonus = n0(prev.bonus) + qty; prev.note = [prev.note, `Row ${row}: qty ${qty} with no value = bonus`].filter(Boolean).join(" · "); merged++; return; }
    const ex = expiryOf(cell(r, "expiry")), dp = cellNum(cell(r, "discPct")), da = cellNum(cell(r, "discAmt")), b = cellNum(cell(r, "bonus"));
    const l = {desc, qty, bonus: b > 0 ? b : null, price, value, discPct: dp > 0 ? dp : null, discAmt: !(dp > 0) && da > 0 ? da : null,
      batch: String(cell(r, "batch") ?? "").trim(), expiry: ex.v, cold: /براد/.test(desc) || YES.test(String(cell(r, "cold") ?? "").trim())};
    if (!desc) flags.push(`Row ${row}: no product name.`);
    if (ex.bad) flags.push(`Row ${row}: expiry "${ex.bad}" not understood, left blank.`);
    if (qty > 0 && !isNum(price) && !isNum(value)) l.note = "No value in the file; no matching priced line above";
    lines.push(l);
  });
  Object.assign(I, {lines, flags, skipped, merged});
}
function invImpSheet(){
  const I = S.invImp, opts = h => `<option value="-1">Not in file</option>` + I.headers.map((x, i) => `<option value="${i}" ${h === i ? "selected" : ""}>${esc(x)}</option>`).join("");
  const blank = k => I.lines.filter(l => !isNum(l[k]) && !l[k]).length;
  openSheet("Fill invoice from a file", `<p class="note">${esc(I.file)} · ${I.rows.length} rows. Check which column is which. Nothing is saved now: the lines go into the invoice form, where you check them against the paper and tap Save.</p>
    <div class="grid2">${[...INV_COLS].reverse().map(([k, label]) => `<label>${esc(label)} column<select data-xiicol="${k}">${opts(I.map[k])}</select></label>`).join("")}</div>
    <div class="sum"><div class="r"><span>Invoice lines</span><span class="num">${I.lines.length}</span></div>${I.merged ? `<div class="r"><span>Bonus rows joined to the line above</span><span class="num">${I.merged}</span></div>` : ""}${I.skipped ? `<div class="r"><span>Empty or total rows left out</span><span class="num">${I.skipped}</span></div>` : ""}
      <div class="r"><span>Lines with no price</span><span class="num">${blank("price")}</span></div><div class="r"><span>Lines with no batch</span><span class="num">${blank("batch")}</span></div><div class="r"><span>Lines with no expiry</span><span class="num">${blank("expiry")}</span></div>
      ${I.flags.slice(0, 12).map(f => `<div class="note">• ${esc(f)}</div>`).join("")}${I.flags.length > 12 ? `<div class="note">• ${I.flags.length - 12} more</div>` : ""}</div>
    <div class="tablewrap"><table><thead><tr><th>Product</th><th class="n">Qty</th><th class="n">Bonus</th><th class="n">Price</th><th class="n">Value</th><th>Batch</th><th>Expiry</th></tr></thead><tbody>
    ${I.lines.slice(0, 60).map(l => `<tr><td>${esc(l.desc || "—")}${l.cold ? ` <span class="pill">براد</span>` : ""}</td><td class="n num">${isNum(l.qty) ? f0(l.qty) : "—"}</td><td class="n num">${l.bonus ? f0(l.bonus) : ""}</td><td class="n num">${isNum(l.price) ? f0(l.price) : "—"}</td><td class="n num">${isNum(l.value) ? f0(l.value) : "—"}</td><td>${esc(l.batch || "—")}</td><td class="num">${esc(l.expiry || "—")}</td></tr>`).join("")}</tbody></table></div>
    ${I.lines.length > 60 ? `<p class="note">Showing the first 60 lines. All of them go into the invoice.</p>` : ""}
    <p class="err" id="iiErr"></p><div class="actions"><button type="button" class="primary" data-xiifill="1">Put ${I.lines.length} lines into the invoice</button><button type="button" data-xiiback="1">Back to the invoice</button></div>`);
}
function invImpFill(){
  const I = S.invImp; if (!I.lines.length){ $("#iiErr").textContent = "No lines found. Check the Product and Paid qty columns."; return; }
  const base = I.base || {supplierId:S.suppliers[0]?.id || "__new", date:today(), type:"credit", lines:[]}, kept = (base.lines || []).filter(l => l.desc || isNum(l.qty));
  const ex = base.extraction || {}, uncertain = [...(ex.uncertain || []), ...I.flags];
  const pre = {...base, lines:[...kept, ...I.lines], extraction:{...ex, uncertain:[...new Set(uncertain)], at:nowIso(), source: ex.source === "photo" ? "photo" : "file", file:I.file}};
  S.invImp = null; S.invImpBase = null; invoiceForm(null, pre); sheetTop();
  toast(`${I.lines.length} lines filled in from the file. Check them, then tap Save invoice.`);
}

/* ---- fill the stocktaking count from an Excel or CSV file (for example a count made on paper and typed up).
   The numbers go into the open count for review; saving still needs the owner, as with a count typed by hand ---- */
const CT_COLS = [["loose","Loose small units",["loose","pieces","tablets","units","مفرد","حبة","حبات"]],["count","Count",["count","counted","qty","quantity","stock","on hand","balance","boxes","الكمية","العدد","الرصيد","الجرد","المخزون"]],["barcode","Barcode",BARCODE_WORDS],["name","Item name",NAME_WORDS]];
async function readCountFile(file){
  const F = await readSheetFile(file); if (!F) return;
  const map = guessCols(F.headers, CT_COLS.map(([k, , w]) => [k, w]));
  if (map.name < 0) map.name = F.headers.findIndex((h, i) => !Object.values(map).includes(i) && !numColOf(F.rows, i));
  if (map.count < 0){ for (let i = F.headers.length - 1; i >= 0; i--) if (!Object.values(map).includes(i) && numColOf(F.rows, i)){ map.count = i; break; } }
  S.ctImp = {...F, map, unit:"box"}; ctImpMatch(); ctImpSheet();
}
function ctImpMatch(){
  const I = S.ctImp, match = itemMatcher(), cell = (r, k) => I.map[k] >= 0 ? r[I.map[k]] : "";
  I.out = I.rows.map((r, i) => {
    const name = String(cell(r, "name") ?? "").trim(), bc = String(cell(r, "barcode") ?? "").trim(), c = cellNum(cell(r, "count")), lo = cellNum(cell(r, "loose"));
    const ok = (isNum(c) && c >= 0) || (isNum(lo) && lo >= 0), {pid, how} = name || bc ? match(name, bc) : {pid:"", how:""};
    return {i, name, bc, count: isNum(c) && c >= 0 ? c : null, loose: isNum(lo) && lo >= 0 ? lo : null, ok, pid, how, use: ok && !!pid && how !== "check"};
  }).filter(o => o.name || o.bc);
}
// the count column is boxes or smallest units (owner picks); loose units are always smallest units
const ctImpUnits = (o, p) => (o.count == null ? 0 : S.ctImp.unit === "box" ? o.count * p.sub : o.count) + n0(o.loose);
function ctImpSheet(){
  const I = S.ctImp, cat = catalog(), used = usedMap(), opts = h => `<option value="-1">Not in file</option>` + I.headers.map((x, i) => `<option value="${i}" ${h === i ? "selected" : ""}>${esc(x)}</option>`).join("");
  const sorted = [...I.out].sort((a,b) => ({check:0, "":1, name:2, barcode:3}[a.how] - ({check:0, "":1, name:2, barcode:3}[b.how]))), ok = I.out.filter(o => o.use).length;
  openSheet("Fill count from a file", `<p class="note">${esc(I.file)} · ${I.out.length} rows. Check which column is which, then check the matches. Ticked rows go into the count; you still check them and the owner saves the count.</p>
    <div class="grid2">${[...CT_COLS].reverse().map(([k, label]) => `<label>${esc(label)} column<select data-xcicol="${k}">${opts(I.map[k])}</select></label>`).join("")}
      <label>The count column is in<select id="ciUnit"><option value="box" ${I.unit === "box" ? "selected" : ""}>Boxes</option><option value="sub" ${I.unit === "sub" ? "selected" : ""}>Smallest units (tablets, pieces)</option></select></label></div>
    <div class="sum"><div class="r"><span>Matched by barcode</span><span class="num">${I.out.filter(o => o.how === "barcode").length}</span></div><div class="r"><span>Matched by name</span><span class="num">${I.out.filter(o => o.how === "name").length}</span></div><div class="r"><span>Close match, please check</span><span class="num">${I.out.filter(o => o.how === "check").length}</span></div><div class="r"><span>Not in your stock</span><span class="num">${I.out.filter(o => !o.pid).length}</span></div>${I.out.some(o => !o.ok) ? `<div class="r"><span>No count in the row</span><span class="num">${I.out.filter(o => !o.ok).length}</span></div>` : ""}</div>
    <div class="tablewrap"><table><thead><tr><th>Use</th><th>In the file</th><th>Your item</th><th class="n">System</th><th class="n">Counted</th></tr></thead><tbody>
    ${sorted.slice(0, 400).map(o => { const p = cat.find(x => x.id === o.pid); return `<tr><td><input type="checkbox" data-xciuse="${o.i}" ${o.use ? "checked" : ""} ${!o.pid || !o.ok ? "disabled" : ""} aria-label="Use this row"></td><td>${esc(o.name || "—")}${o.bc ? `<div class="note num">${esc(o.bc)}</div>` : ""}</td>
      <td><select data-xcipid="${o.i}" style="min-width:180px"><option value="">Not in stock · skip</option>${cat.map(x => `<option value="${esc(x.id)}" ${x.id === o.pid ? "selected" : ""}>${esc(pname(x))}</option>`).join("")}</select>${o.how === "check" ? `<span class="pill warn">Check</span>` : o.how ? `<span class="pill good">${o.how === "barcode" ? "Barcode" : "Name"}</span>` : ""}</td>
      <td class="n num">${p ? esc(qtyText(p, stockOf(p, used).good)) : "—"}</td><td class="n num"><b>${p && o.ok ? esc(qtyText(p, ctImpUnits(o, p))) : o.ok ? esc(String(o.count ?? "") + (o.loose ? " + " + o.loose : "")) : "—"}</b></td></tr>`; }).join("")}</tbody></table></div>
    ${I.out.length > 400 ? `<p class="note">Showing the first 400 rows. All ticked rows are still used.</p>` : ""}
    <p class="err" id="ciErr"></p><div class="actions"><button type="button" class="primary" data-xcifill="1">Put ${ok} items into the count</button><button type="button" data-xciback="1">Back to the count</button></div>`);
}
function ctImpFill(){
  const I = S.ctImp, cat = catalog(), use = I.out.filter(o => o.use && o.pid && o.ok); if (!use.length){ $("#ciErr").textContent = "Tick at least one row."; return; }
  if (!S.count) S.count = {started:nowIso(), counts:{}, q:""};
  const add = {}; for (const o of use){ const p = cat.find(x => x.id === o.pid); if (p) add[o.pid] = n0(add[o.pid]) + ctImpUnits(o, p); } // the same item on two rows (shelf + fridge) is added up
  Object.assign(S.count.counts, add); lsSet("erp.count", S.count); S.ctImp = null; countSheet(); sheetTop();
  toast(`${Object.keys(add).length} items filled in from the file. Check them, then save the count.`);
}
document.addEventListener("click", ev => { const t = ev.target.closest("button"); if (!t) return; const d = t.dataset;
  if (d.xoversell){ S.oversell = true; $("#sellForm")?.requestSubmit(); }
  if (d.xalerts) alertsSheet(d.xalerts);
  if (d.xinvfile){ S.invImpBase = $("#invForm") ? readInvoice() : null; pickSheet(readInvoiceFile); }
  if (d.xiifill) invImpFill();
  if (d.xiiback){ const b = S.invImp?.base; S.invImp = null; S.invImpBase = null; b ? invoiceForm(null, b) : invoiceForm(null); }
  if (d.xctfile) pickSheet(readCountFile);
  if (d.xcifill) ctImpFill();
  if (d.xciback){ S.ctImp = null; countSheet(); }
});
document.addEventListener("change", ev => { const t = ev.target, d = t.dataset;
  if (d.xsame !== undefined){ if (t.value) STOCK.sameAs[d.xsame] = t.value; else delete STOCK.sameAs[d.xsame]; }
  if (d.xiicol){ S.invImp.map[d.xiicol] = +t.value; invImpParse(); invImpSheet(); }
  if (d.xcicol){ S.ctImp.map[d.xcicol] = +t.value; ctImpMatch(); ctImpSheet(); }
  if (t.id === "ciUnit"){ S.ctImp.unit = t.value; ctImpSheet(); }
  if (d.xciuse !== undefined){ S.ctImp.out.find(o => o.i === +d.xciuse).use = t.checked; const b = document.querySelector("[data-xcifill]"); if (b) b.textContent = `Put ${S.ctImp.out.filter(o => o.use).length} items into the count`; }
  if (d.xcipid !== undefined){ const o = S.ctImp.out.find(o => o.i === +d.xcipid); o.pid = t.value; o.how = t.value ? "name" : ""; o.use = !!t.value && o.ok; ctImpSheet(); }
});

/* ---- staff: PIN login per pharmacist, shifts from login to logout, work hours and salary ---- */
S.session = lsGet("erp.session", null); S.staff = null; S.staffM = today().slice(0,7);
/* screen permissions: the owner ticks which screens each employee may use. "newinv" is the + Invoice / Scan buttons.
   Staff stays owner-only, so nobody can give themselves more screens */
const PERM_SCREENS = [["newinv","New purchase invoice"],["home","Home"],["sell","Sell"],["stock","Stock"],["pricing","Pricing"],["chronic","Chronic"],["invoices","Invoices"],["items","Items"],["payments","Payments"],["suppliers","Suppliers"],["customers","Customers"],["money","Money"],["reports","Reports"],["settings","Settings"]];
const DEFAULT_PERMS = ["sell","newinv"];
const myPerms = () => { const me = S.staff && (E.staff.find(x => x.id === S.staff.id) || S.staff); return Array.isArray(me?.perms) ? me.perms : DEFAULT_PERMS; };
const canUse = k => isOwner() || (k !== "staff" && myPerms().includes(k));
// PINs are stored as a slow PBKDF2 hash ("p2$..."); older quick SHA-256 hashes still work and are upgraded at the next good login
async function pinHash2(id, pin){ const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const b = await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:new TextEncoder().encode("raihana|" + id), iterations:150000}, k, 256); return "p2$" + Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join(""); }
async function pinHash(id, pin){ const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("raihana|" + id + "|" + pin)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join(""); }
const activeStaff = () => E.staff.filter(x => !x.deleted && x.active !== false);
const hasOwner = () => activeStaff().some(x => x.role === "owner");
// until an owner is added, whoever uses the app counts as the owner, so nobody can be locked out of Staff
const isOwner = () => !hasOwner() || S.staff?.role === "owner";
function shiftHours(sh, from, to){ // hours of a shift inside [from, to); an open shift counts until now
  const a = Math.max(Date.parse(sh.start), from ? Date.parse(from) : -Infinity), b = Math.min(sh.end ? Date.parse(sh.end) : Date.now(), to ? Date.parse(to) : Infinity);
  return b > a ? (b - a) / 36e5 : 0;
}
function monthWork(staffId, m){
  const from = new Date(+m.slice(0,4), +m.slice(5,7) - 1, 1).toISOString(), to = new Date(+m.slice(0,4), +m.slice(5,7), 1).toISOString();
  const sh = E.shifts.filter(x => x.staffId === staffId && !x.voided && shiftHours(x, from, to) > 0).sort((a,b) => a.start.localeCompare(b.start));
  const hours = sh.reduce((a,x) => a + shiftHours(x, from, to), 0), days = new Set(sh.map(x => localDT(x.start).slice(0,10))).size;
  const st = E.staff.find(x => x.id === staffId) || {}, rate = n0(st.rate);
  const pay = wIQD(st.payType === "monthly" ? (isNum(st.expHours) && st.expHours > 0 && st.prorate ? rate * Math.min(1, hours / st.expHours) : rate) : st.payType === "daily" ? rate * days : rate * hours);
  const sales = E.sales.filter(s => !s.voided && s.staffId === staffId && ym(s.date) === m);
  return {sh, hours, days, pay, sales:sales.reduce((a,s) => a + n0(s.total), 0), count:sales.length, open: sh.find(x => !x.end)};
}
function lockHtml(){
  const list = activeStaff(), sel = S.lockSel && list.find(x => x.id === S.lockSel);
  return `<div class="lockin"><div class="lockhead"><b>Raihana Pharmacy</b> <span class="ar">صيدلية ريحانة</span><span class="num" id="lockClock">${esc(localDT(nowIso()).replace("T", " "))}</span></div>
    ${sel ? `<p>Hello <b>${esc(sel.name)}</b>. Enter your PIN to start your shift.</p>
      <div class="pindots">${[0,1,2,3,4,5].map(i => `<span class="${(S.lockPin || "").length > i ? "on" : ""}"></span>`).join("")}</div><p class="err" id="lockErr">${esc(S.lockErr || "")}</p>
      <div class="pinpad">${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-xpin="${n}">${n}</button>`).join("")}<button type="button" data-xpinback="1" aria-label="Back">←</button><button type="button" data-xpin="0">0</button><button type="button" class="primary" data-xpinok="1">OK</button></div>
      <button type="button" data-xlocksel="" style="width:100%">Choose another name</button>` :
    `<p>Who is working now?</p><div class="lockstaff">${list.map(x => { const o = E.shifts.find(y => y.staffId === x.id && !y.end && !y.voided); return `<button type="button" data-xlocksel="${esc(x.id)}"><b>${esc(x.name)}</b><span>${esc(x.role === "owner" ? "Owner" : x.role === "cashier" ? "Cashier" : "Pharmacist")}${o ? " · on shift since " + esc(hm(o.start)) : ""}</span></button>`; }).join("")}</div>`}</div>`;
}
function drawLock(){
  let el = $("#lockScreen"); const need = S.ready && activeStaff().length && !S.staff;
  if (!need){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement("div"); el.id = "lockScreen"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
  el.innerHTML = lockHtml(); if (S.lang === "ar") translate(el);
}
async function tryLogin(){
  const st = activeStaff().find(x => x.id === S.lockSel), pin = S.lockPin || ""; if (!st) return;
  if (pin.length < 4){ S.lockErr = "PIN is 4 to 6 digits."; drawLock(); return; }
  const ck = await pinCheck(st, pin); if (!ck.ok){ S.lockErr = pinErr(ck); S.lockPin = ""; drawLock(); return; }
  let sh = E.shifts.find(x => x.staffId === st.id && !x.end && !x.voided && x.device === DEVICE_ID);
  const fresh = !sh; if (fresh){ sh = {id:newId("SH"), staffId:st.id, staffName:st.name, start:nowIso(), end:null, device:DEVICE_ID}; await write("shifts/" + sh.id, sh); }
  S.session = {staffId:st.id, shiftId:sh.id}; lsSet("erp.session", S.session); S.staff = st; S.lockSel = null; S.lockPin = ""; S.lockErr = "";
  drawLock(); render(); toast(`Shift started at ${hm(sh.start)}. Welcome ${st.name}.`); syncNow();
  if (fresh) cashSheet("open");
}
/* ---- cash count at every shift start and end: what the drawer should hold, what was counted, and the difference ---- */
const curShift = () => S.session && E.shifts.find(x => x.id === S.session.shiftId) || null;
const stampOf = x => x.at || x.createdAt || "";
function shiftCash(sh, end){ return cashParts(null, x => !x.voided && stampOf(x) >= sh.start && stampOf(x) <= end); }
function drawerNow(sh){ // the last end-of-shift count is what should be in the drawer when the next shift starts
  const prev = E.shifts.filter(x => x.id !== sh.id && !x.voided && x.end && isNum(x.closeCount)).sort((a,b) => b.end.localeCompare(a.end))[0];
  return prev ? prev.closeCount : null; }
function shiftExpected(sh, end){ const base = isNum(sh.openCount) ? sh.openCount : drawerNow(sh), c = shiftCash(sh, end);
  return {base, c, expected: base === null ? null : base + c.expected}; }
function syncNow(){ try { if (window.ERP_SYNC?.cfg?.()) window.ERP_SYNC.run(); } catch(e){ /* sync problems show in Settings */ } }
function cashLine(sh){ // one line per count, red when the drawer did not match
  const one = (l, c, d) => isNum(c) ? `<span class="s${isNum(d) && d ? " bad" : ""}">${l}: ${iqd(c)}${isNum(d) ? " · " + diffTxt(d) : ""}</span>` : "";
  return one("Cash at start", sh.openCount, sh.openDiff) + one("Cash at end", sh.closeCount, sh.closeDiff); }
const diffTxt = d => d === 0 ? "Matches ✓" : d < 0 ? `Short by ${iqd(-d)}` : `Extra ${iqd(d)}`;
function cashSheet(kind){
  const sh = curShift(); if (!sh) return; const end = kind === "end";
  const x = end ? shiftExpected(sh, nowIso()) : {expected: drawerNow(sh)}, c = x.c;
  S.countExp = x.expected;
  openSheet(end ? "Count the cash: end of shift" : "Count the cash: start of shift", `<div class="sum">
    ${end ? `<div class="r"><span>Counted at the start</span><span class="num">${x.base === null ? "Not counted" : iqd(x.base)}</span></div>
    <div class="r"><span>Cash sales</span><span class="num">${iqd(c.sales)}</span></div>
    ${c.cin ? `<div class="r"><span>Customer payments</span><span class="num">${iqd(c.cin)}</span></div>` : ""}
    ${c.ref ? `<div class="r"><span>Cash given back for returns</span><span class="num">−${iqd(c.ref)}</span></div>` : ""}
    ${c.exp ? `<div class="r"><span>Expenses paid from the drawer</span><span class="num">−${iqd(c.exp)}</span></div>` : ""}
    ${c.sup ? `<div class="r"><span>Supplier payments in cash</span><span class="num">−${iqd(c.sup)}</span></div>` : ""}` : ""}
    <div class="r"><b>Should be in the drawer</b><b class="num">${x.expected === null ? "Not known yet" : iqd(x.expected)}</b></div></div>
    <label>Cash you counted (IQD)<input id="ccAmt" type="text" inputmode="numeric" autocomplete="off"></label>
    <p class="note" id="ccDiff">${end ? "Count every note in the drawer. The owner sees any difference." : "Count the drawer before you sell. The owner sees any difference."}</p><p class="err" id="ccErr"></p>
    <button type="button" class="primary" data-xcashcount="${kind}">${end ? "Save count and end shift" : "Save count"}</button>`);
  setTimeout(() => $("#ccAmt")?.focus(), 50);
}
async function saveCashCount(kind, btn){
  const sh = curShift(), raw = ($("#ccAmt")?.value || "").replace(/[,\s]/g, ""), amt = Math.round(Number(raw));
  if (!sh) return; if (raw === "" || !isFinite(amt) || amt < 0){ $("#ccErr").textContent = "Type the cash you counted."; return; }
  btn.disabled = true;
  try {
    if (kind === "open"){ const e = drawerNow(sh);
      await write("shifts/" + sh.id, {openCount:amt, openExpected:e, openDiff:e === null ? null : amt - e}, true);
      closeSheet(); toast(e === null || amt === e ? "Cash count saved." : `Cash count saved. ${diffTxt(amt - e)}.`); render(); syncNow(); return; }
    const end = nowIso(), x = shiftExpected(sh, end);
    await write("shifts/" + sh.id, {closeCount:amt, closeExpected:x.expected, closeDiff:x.expected === null ? null : amt - x.expected}, true);
    closeSheet(); syncNow(); await endShift(false, end);
  } catch(e){ $("#ccErr").textContent = e.message; btn.disabled = false; }
}
async function endShift(lockOnly, at){
  if (!S.staff) return; const nm = S.staff.name;
  if (!lockOnly && S.session?.shiftId){ try { await write("shifts/" + S.session.shiftId, {end:at || nowIso()}, true); } catch(e){ toast(e.message); return; } }
  S.session = lockOnly ? S.session : null; lsSet("erp.session", S.session); S.staff = null; S.lockSel = null;
  if (lockOnly){ S.lockSel = null; } render(); drawLock(); toast(lockOnly ? "Screen locked." : `Shift ended for ${nm}.`);
}
const DEVICE_ID = lsGet("erp.device", null) || (() => { const id = "D" + Math.random().toString(36).slice(2, 9); lsSet("erp.device", id); return id; })();
function staffView(){
  const list = E.staff.filter(x => !x.deleted), m = S.staffM;
  if (!list.length) return `<section class="sec"><h2>Staff and shifts</h2><div class="sum" style="gap:10px"><p>Add yourself first as the <b>owner</b>. After that, the app asks for a PIN when it opens, and you choose which screens each employee can use.</p><button type="button" class="primary" data-xstaff="__new">+ Add the owner (you)</button></div></section>`;
  const rows = list.map(x => ({x, w:monthWork(x.id, m)}));
  const late = E.shifts.filter(x => !x.end && !x.voided && Date.now() - Date.parse(x.start) > 14 * 36e5);
  return `<section class="kpis"><div class="kpi lead"><span class="l">Salaries for ${esc(m)}</span><span class="v num">${iqd(rows.reduce((a,r) => a + r.w.pay, 0))}</span><span class="l">${hrsTxt(rows.reduce((a,r) => a + r.w.hours, 0))} worked</span></div>
    <div class="kpi"><span class="l">On shift now</span><span class="v num">${E.shifts.filter(x => !x.end && !x.voided).length}</span></div><div class="kpi"><span class="l">Staff</span><span class="v num">${activeStaff().length}</span></div></section>
  ${!hasOwner() ? `<div class="banner bad" style="border:0">There is no owner yet, so everyone sees every screen. Add yourself as the owner (Role: Owner) to protect the owner screens.</div>` : ""}
  ${(() => { const off = E.shifts.filter(x => !x.voided && (x.start || "").slice(0,7) === m && ((isNum(x.openDiff) && x.openDiff) || (isNum(x.closeDiff) && x.closeDiff))); return off.length ? `<div class="banner bad" style="border:0">${off.length} cash count${off.length === 1 ? "" : "s"} did not match this month. Open the person below to see each shift.</div>` : ""; })()}
  ${late.length ? `<div class="banner bad" style="border:0">${late.length} shift${late.length === 1 ? "" : "s"} open for more than 14 hours. Someone may have forgotten to end their shift. Open the person below to fix it.</div>` : ""}
  <section class="sec"><div class="sechead"><h2>Staff</h2><div class="actions"><input id="staffM" type="month" value="${esc(m)}" style="width:auto"><button type="button" class="primary" data-xstaff="__new">+ Staff</button></div></div>
    <div class="list">${rows.map(({x, w}) => `<button type="button" class="row" data-xstaff="${esc(x.id)}"><span class="main"><span class="t">${esc(x.name)} <span class="pill">${esc(x.role === "owner" ? "Owner" : x.role === "cashier" ? "Cashier" : "Pharmacist")}</span>${x.active === false ? ` <span class="pill">Stopped</span>` : ""}</span><span class="s">${hrsTxt(w.hours)} · ${w.days} days · ${w.count} sales ${iqd(w.sales)}${w.open ? ` · on shift since ${esc(hm(w.open.start))}` : ""}</span></span><span class="end"><span class="num">${iqd(w.pay)}</span><span class="s">${esc(x.payType === "monthly" ? "monthly" : x.payType === "daily" ? "per day" : "per hour")}</span></span></button>`).join("")}</div>
    <p class="note">Hours run from login to "End shift". Salary: per hour = rate × hours; per day = rate × days worked; monthly = fixed, or shared by hours worked if you tick that option.</p></section>`;
}
function staffSheet(id){
  const x = id === "__new" ? {id:"__new", name:"", role: hasOwner() ? "pharmacist" : "owner", payType:"hourly", rate:null, active:true} : E.staff.find(y => y.id === id); if (!x) return;
  const w = id === "__new" ? null : monthWork(x.id, S.staffM);
  openSheet(id === "__new" ? "Add staff" : x.name, `
    ${w ? `<div class="sum"><div class="r"><span>Month</span><span class="num">${esc(S.staffM)}</span></div><div class="r"><span>Hours worked</span><span class="num">${hrsTxt(w.hours)}</span></div><div class="r"><span>Days worked</span><span class="num">${w.days}</span></div><div class="r"><span>Sales made</span><span class="num">${w.count} · ${iqd(w.sales)}</span></div><div class="r big"><span>Salary</span><span class="num">${iqd(w.pay)}</span></div></div>` : ""}
    <form id="staffForm" data-id="${esc(x.id)}" style="display:grid;gap:12px">
      <div class="grid2 stack"><label>Name<input id="fName" value="${esc(x.name)}" required></label><label>Role<select id="fRole">${[["owner","Owner (sees everything)"],["pharmacist","Pharmacist"],["cashier","Cashier"]].map(([v,l]) => `<option value="${v}" ${x.role === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <div class="grid2"><label>${id === "__new" ? "PIN (4 to 6 digits)" : "New PIN (leave empty to keep)"}<input id="fPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6"></label><label>Phone<input id="fPhone" inputmode="tel" value="${esc(x.phone || "")}"></label></div>
      <div class="grid2"><label>Paid<select id="fPay">${[["hourly","Per hour"],["daily","Per day worked"],["monthly","Monthly salary"]].map(([v,l]) => `<option value="${v}" ${x.payType === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Rate (IQD)<input id="fRate" class="num" inputmode="numeric" value="${esc(x.rate ?? "")}"></label></div>
      <div class="grid2"><label>Expected hours per month (monthly only)<input id="fExp" class="num" inputmode="numeric" value="${esc(x.expHours ?? "")}"></label><label class="check" style="align-self:end"><input type="checkbox" id="fPro" ${x.prorate ? "checked" : ""}> Pay monthly salary by hours worked</label></div>
      <fieldset id="fPerms" class="sum" style="gap:8px" ${x.role === "owner" ? "hidden" : ""}><b>Screens this person can use</b>
        <div class="permgrid">${PERM_SCREENS.map(([k,l]) => `<label class="check"><input type="checkbox" data-fperm="${k}" ${(Array.isArray(x.perms) ? x.perms : DEFAULT_PERMS).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <p class="note">Staff is for the owner only.</p></fieldset>
      <label class="check"><input type="checkbox" id="fActive" ${x.active !== false ? "checked" : ""}> Can log in</label>
      <p class="err" id="fErr"></p><button type="submit" class="primary">Save</button></form>
    ${w ? `<div class="sec"><h2>Shifts in ${esc(S.staffM)}</h2><div class="list">${w.sh.length ? [...w.sh].reverse().map(sh => `<div class="row" style="cursor:default;flex-wrap:wrap"><span class="main"><span class="t num">${esc(localDT(sh.start).replace("T", " "))} → ${sh.end ? esc(hm(sh.end)) : "now"}</span><span class="s">${hrsTxt(shiftHours(sh))}${sh.fixedBy ? " · end time fixed by owner" : ""}</span>${cashLine(sh)}</span><span class="end">${isOwner() ? `<label style="font-size:12px">End<input type="datetime-local" data-xshend="${esc(sh.id)}" value="${sh.end ? esc(localDT(sh.end)) : ""}" style="min-width:190px"></label>` : ""}</span></div>`).join("") : `<div class="empty">No shifts this month.</div>`}</div></div>` : ""}`);
}
document.addEventListener("click", ev => { const t = ev.target.closest("[data-hold],[data-approve]"); if (!t) return;
  if (t.dataset.approve !== undefined){ if (!isOwner()){ ev.preventDefault(); ev.stopImmediatePropagation(); toast("Only the owner can approve invoices."); return; }
    const by = $("#apBy"); if (by && S.staff?.name) by.value = S.staff.name; return; }
  const inv = S.invoices.find(i => i.id === t.dataset.hold); if (!inv || inv.status === "On Hold") return;
  const why = (inv.lines || []).map((l, k) => lineInUse(inv.id, String(l.lid ?? k))).find(Boolean);
  if (why){ ev.preventDefault(); ev.stopImmediatePropagation(); toast(`This invoice can't be put on hold because a line ${why}.`); }
}, true);
document.addEventListener("click", ev => { const t = ev.target.closest("[data-delline]"), el = t?.closest(".lineedit"); if (!el || !S.draft?.id || !el.dataset.lid) return;
  const why = lineInUse(S.draft.id, el.dataset.lid); if (!why) return;
  ev.preventDefault(); ev.stopImmediatePropagation(); toast(`This line can't be removed because ${why}. Cancel those first, or correct the line instead.`);
}, true);
document.addEventListener("click", ev => { const t = ev.target.closest("[data-tab],[data-tab-go],[data-xgo],#addBtn,#scanBtn"); if (!t) return;
  const k = t.id === "addBtn" || t.id === "scanBtn" ? "newinv" : t.dataset.tab || t.dataset.tabGo || t.dataset.xgo;
  if (k && !canUse(k)){ ev.preventDefault(); ev.stopImmediatePropagation(); toast("The owner has not given you this screen."); }
}, true);
/* Menu button shows or hides the list of screens; the choice is kept on this device */
function navShut(on){ document.body.classList.toggle("navshut", on); lsSet("erp.navShut", on);
  const m = document.querySelector("nav.tabs .navmenu"); if (m) m.setAttribute("aria-expanded", String(!on)); }
navShut(lsGet("erp.navShut") === true);

document.addEventListener("click", ev => { const t = ev.target.closest("button"); if (!t) return; const d = t.dataset;
  if (d.xmenu){ navShut(!document.body.classList.contains("navshut")); return; }
  if (d.xgo){ closeSheet(); S.tab = d.xgo; render(); return; }
  if (d.xlocksel !== undefined){ S.lockSel = d.xlocksel || null; S.lockPin = ""; S.lockErr = ""; drawLock(); return; }
  if (d.xpin !== undefined){ if ((S.lockPin || "").length < 6){ S.lockPin = (S.lockPin || "") + d.xpin; S.lockErr = ""; } drawLock(); if (S.lockPin.length === 6) tryLogin(); return; }
  if (d.xpinback){ S.lockPin = (S.lockPin || "").slice(0, -1); drawLock(); return; }
  if (d.xpinok){ tryLogin(); return; }
  if (d.xstaff){ if (!isOwner()){ toast("Only the owner can do this."); return; } staffSheet(d.xstaff); return; }
  if (d.xendshift){ if (t.dataset.sure !== "1"){ t.dataset.sure = "1"; t.textContent = "Tap again to end shift"; setTimeout(() => { t.dataset.sure = ""; t.textContent = "End shift"; }, 4000); return; } if (curShift()) cashSheet("end"); else endShift(false); return; }
  if (d.xlock){ endShift(true); return; }
  if (d.xcashcount){ saveCashCount(d.xcashcount, t); return; }
  if (d.xcountopen){ cashSheet("open"); return; }
});
document.addEventListener("keydown", ev => { if (!$("#lockScreen") || !S.lockSel) return; if (/^\d$/.test(ev.key)){ S.lockPin = ((S.lockPin || "") + ev.key).slice(0, 6); drawLock(); } else if (ev.key === "Backspace"){ S.lockPin = (S.lockPin || "").slice(0, -1); drawLock(); } else if (ev.key === "Enter") tryLogin(); });
document.addEventListener("change", async ev => { const t = ev.target;
  if (t.id === "staffM" && t.value){ S.staffM = t.value; render(); }
  if (t.id === "fRole"){ const fp = $("#fPerms"); if (fp) fp.hidden = t.value === "owner"; }
  if (t.dataset.xshend && t.value){ if (!isOwner()){ toast("Only the owner can do this."); return; } const sh = E.shifts.find(x => x.id === t.dataset.xshend); const end = new Date(t.value).toISOString(); if (end <= sh.start){ toast("End must be after the start."); return; }
    try { await write("shifts/" + sh.id, {end, fixedBy:S.staff?.id || null}, true); toast("Shift end saved."); staffSheet(sh.staffId); } catch(e){ toast(e.message); } }
});
document.addEventListener("submit", async ev => { if (ev.target.id !== "staffForm") return; ev.preventDefault();
  if (!isOwner()){ toast("Only the owner can do this."); return; }
  const f = ev.target, err = $("#fErr"), isNew = f.dataset.id === "__new", id = isNew ? newId("ST") : f.dataset.id, name = $("#fName").value.trim(), pin = $("#fPin").value.trim();
  if (!name){ err.textContent = "Enter the name."; return; }
  if ((isNew || pin) && !/^\d{4,6}$/.test(pin)){ err.textContent = "PIN must be 4 to 6 digits."; return; }
  const old = E.staff.find(x => x.id === id) || {}, role = $("#fRole").value;
  if (!isNew && old.role === "owner" && role !== "owner" && activeStaff().filter(x => x.role === "owner").length < 2){ err.textContent = "Keep at least one owner."; return; }
  if (role !== "owner" && !activeStaff().some(x => x.role === "owner" && x.id !== id)){ err.textContent = "Add yourself as the owner first, so you keep every screen. Choose Role: Owner."; return; }
  const rate = parseNum($("#fRate").value), exp = parseNum($("#fExp").value);
  const doc = {...old, id, name, role, phone:$("#fPhone").value.trim(), payType:$("#fPay").value, rate:isNum(rate) ? rate : null, expHours:isNum(exp) ? exp : null, prorate:$("#fPro").checked, active:$("#fActive").checked, perms:[...document.querySelectorAll("[data-fperm]")].filter(c => c.checked).map(c => c.dataset.fperm), createdAt:old.createdAt || nowIso()};
  if (pin) doc.pinHash = await pinHash2(id, pin);
  // adding the first owner: the person at the device is the owner, so switch to them (ending any other open shift here)
  const first = isNew && role === "owner" && !hasOwner(), prevShift = first && S.session?.shiftId;
  if (first) S.staff = doc;
  try { await write("staff/" + id, doc); toast("Saved."); if (first){ S.staff = doc; const sh = {id:newId("SH"), staffId:id, staffName:name, start:nowIso(), end:null, device:DEVICE_ID}; S.session = {staffId:id, shiftId:sh.id}; lsSet("erp.session", S.session); await write("shifts/" + sh.id, sh); if (prevShift) await write("shifts/" + prevShift, {end:nowIso()}, true); } closeSheet(); render(); } catch(x){ err.textContent = x.message; }
});
setInterval(() => { const t = localDT(nowIso()).replace("T", " "); ["liveClock","lockClock","topClock"].forEach(i => { const el = document.getElementById(i); if (el && el.textContent !== t) el.textContent = t; }); }, 1000);
function staffAfterData(){
  // keep the signed-in person in step with the data; a shift ended elsewhere signs this device out
  if (S.session){ const st = activeStaff().find(x => x.id === S.session.staffId), sh = E.shifts.find(x => x.id === S.session.shiftId);
    if (st && sh && !sh.end) S.staff = st; else if (E.staff.length && (E.shifts.length || !st)){ S.staff = null; if (sh?.end || !st){ S.session = null; lsSet("erp.session", null); } } }
  drawLock();
}

/* ---------- owner approval (audit F-02, F-04) ----------
   Screens only decide what people see. Sensitive actions also check here when they save: a member of staff can do them
   only if the owner types their PIN on the spot. Wrong PINs lock that person for a growing time on this device. */
const PIN_TRIES = 5;
async function pinCheck(st, pin){
  const all = lsGet("erp.pinFail", {}), f = all[st.id] || {n:0, until:0};
  if (f.n >= PIN_TRIES && Date.now() < f.until) return {ok:false, wait:f.until - Date.now()};
  const v2 = String(st.pinHash || "").startsWith("p2$");
  if ((v2 ? await pinHash2(st.id, pin) : await pinHash(st.id, pin)) === st.pinHash){ delete all[st.id]; lsSet("erp.pinFail", all);
    if (!v2) write("staff/" + st.id, {pinHash:await pinHash2(st.id, pin)}, true).catch(() => {});
    return {ok:true}; }
  f.n++; if (f.n >= PIN_TRIES) f.until = Date.now() + 30000 * 2 ** (f.n - PIN_TRIES); all[st.id] = f; lsSet("erp.pinFail", all);
  return {ok:false, left:Math.max(0, PIN_TRIES - f.n), wait:f.n >= PIN_TRIES ? f.until - Date.now() : 0};
}
const pinErr = r => r.wait ? `Too many wrong PINs. Try again in ${Math.ceil(r.wait / 1000)} seconds.` : `Wrong PIN. ${r.left} tries left.`;
// resolves to the approving owner's id (the person themself when they are the owner), or null when cancelled
function ownerOK(why, o = {}){ // o.always: ask the PIN even when the owner is the one signed in
  const owners = activeStaff().filter(x => x.role === "owner" && x.pinHash);
  if (isOwner() && !(o.always && owners.length)) return Promise.resolve(S.staff?.id || "owner");
  if (!owners.length) return Promise.resolve(null);
  return new Promise(done => {
    const st = {sel: owners.length === 1 ? owners[0].id : owners.find(x => x.id === S.staff?.id)?.id || null, pin:"", err:""};
    const el = document.createElement("div"); el.id = "ownerPin"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el);
    const finish = v => { el.remove(); document.removeEventListener("keydown", key, true); done(v); };
    const draw = () => { const o = owners.find(x => x.id === st.sel);
      el.innerHTML = `<div class="lockin"><b>Owner approval needed</b><ul class="note" style="margin:0;padding-inline-start:18px">${why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
        ${o ? `<p>${esc(o.name)}, enter your PIN to allow this.</p><div class="pindots">${[0,1,2,3,4,5].map(i => `<span class="${st.pin.length > i ? "on" : ""}"></span>`).join("")}</div><p class="err">${esc(st.err)}</p>
          <div class="pinpad">${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-opin="${n}">${n}</button>`).join("")}<button type="button" data-opinback="1" aria-label="Back">←</button><button type="button" data-opin="0">0</button><button type="button" class="primary" data-opinok="1">OK</button></div>`
        : `<div class="lockstaff">${owners.map(x => `<button type="button" data-osel="${esc(x.id)}"><b>${esc(x.name)}</b><span>Owner</span></button>`).join("")}</div>`}
        <button type="button" data-ocancel="1">Cancel</button></div>`;
      if (S.lang === "ar") translate(el); };
    const ok = async () => { const o = owners.find(x => x.id === st.sel); if (!o) return;
      if (st.pin.length < 4){ st.err = "PIN is 4 to 6 digits."; return draw(); }
      const r = await pinCheck(o, st.pin); st.pin = ""; if (r.ok) return finish(o.id); st.err = pinErr(r); draw(); };
    const press = d => { if (st.pin.length < 6) st.pin += d; st.err = ""; draw(); if (st.pin.length === 6) ok(); };
    el.addEventListener("click", ev => { const b = ev.target.closest("button"); ev.stopPropagation(); if (!b) return; const d = b.dataset;
      if (d.ocancel) return finish(null); if (d.osel){ st.sel = d.osel; return draw(); }
      if (d.opin !== undefined) return press(d.opin); if (d.opinback){ st.pin = st.pin.slice(0, -1); return draw(); } if (d.opinok) ok(); });
    const key = ev => { if (/^\d$/.test(ev.key) && st.sel) press(ev.key); else if (ev.key === "Backspace"){ st.pin = st.pin.slice(0, -1); draw(); } else if (ev.key === "Enter") ok(); else if (ev.key === "Escape") finish(null); else return; ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener("keydown", key, true); draw();
  });
}
const NEED_OWNER = "Not saved: this needs the owner's approval.";

/* ---------- actions ---------- */
function addToCart(pid){
  const p = catalog().find(x => x.id === pid); if (!p) return;
  const ex = S.cart.find(c => c.pid === pid && c.mode === "box");
  if (ex) ex.qty = n0(ex.qty) + 1; else S.cart.push({pid, mode:"box", qty:1, price:p.sellBox});
  S.sellQ = ""; saveCart(); render(); setTimeout(() => $("#sellQ")?.focus(), 0);
}
async function saveSale(e){
  e.preventDefault(); if (S.saving) return; S.saving = true;
  try { await saveSaleNow(); } finally { S.saving = false; }
}
async function saveSaleNow(){
  const force = S.oversell === true; S.oversell = false; // set only by the "Owner: sell anyway" button
  const err = $("#xErr"), cat = catalog(), byId = Object.fromEntries(cat.map(p => [p.id, p])), used = usedMap(true);
  const lines = S.cart.map(c => ({c, p: byId[c.pid]})).filter(x => x.p && n0(x.c.qty) > 0);
  if (!lines.length){ err.textContent = "Add at least one item."; return; }
  if (lines.some(x => !isNum(x.c.price))){ err.textContent = "Every item needs a price."; return; }
  const frac = lines.find(x => !Number.isInteger(n0(x.c.qty))); // audit P-06: no half bottles; a part of a box is sold as strips or tablets
  if (frac){ err.textContent = `${pname(frac.p)}: the quantity must be a whole number. To sell part of a box, choose the strip or tablet unit.`; return; }
  const method = debtOn() ? $("#xMethod").value : "cash";
  let customerId = S.cartMeta.customerId || null;
  if (method === "debt" && !customerId){ err.textContent = "Choose the customer for a debt sale."; return; }
  const newName = customerId === "__new" ? ($("#xCName")?.value || "").trim() : ""; if (customerId === "__new" && !newName){ err.textContent = "Enter the customer's name."; return; }
  const out = [], why = [], short = []; let overs = false;
  for (const {c, p} of lines){
    let need = r6(n0(c.qty) * unitPer(p, c.mode)); const alloc = [];
    for (const b of stockOf(p, used).bs){ if (need <= 0) break; if (b.expired || b.left <= 0) continue; const q = r6(Math.min(b.left, need)); alloc.push({key:b.key, batch:b.batch, expiry:b.expiry, q, per:p.sub, cost: isNum(b.cost) ? b.cost : null}); const ux = used[b.key] || (used[b.key] = {b:0, raw:0}); ux.b += q / p.sub; need = r6(need - q); }
    if (need > 0){ // stock found at a stocktake has no batch: it is sold after the batches, at the newest cost
      const st = stockOf(p, used), free = r6(st.good - st.bs.filter(b => !b.expired && b.left > 0).reduce((a, b) => a + b.left, 0));
      if (free > 0){ const q = r6(Math.min(free, need)), ak = "adj:" + p.id; alloc.push({key:ak, batch:"", expiry:"", q, per:p.sub, cost:subCostNow(p)}); const ux = used[ak] || (used[ak] = {b:0, raw:0, c:0}); ux.b += q / p.sub; need = r6(need - q); } }
    if (need > 0){ if (!force){ short.push({p, want:r6(n0(c.qty) * unitPer(p, c.mode)), avail:r6(n0(c.qty) * unitPer(p, c.mode) - need)}); continue; }
      alloc.push({key:"adj:" + p.id, batch:"", expiry:"", q:need, per:p.sub, cost:subCostNow(p)}); why.push(`Sell ${pname(p)} past the stock (${qtyText(p, need)} more than shown)`); overs = true; }
    const list = floorPrice(p, c.mode); if (!isNum(list)) why.push(`${pname(p)} has no set price (sold at ${f0(c.price)} IQD)`); else if (wIQD(c.price) < list) why.push(`${pname(p)} at ${f0(c.price)} instead of ${f0(list)} IQD`);
    out.push({pid:p.id, name:pname(p), mode:c.mode, unit: unitName(p, c.mode), per:unitPer(p, c.mode), qty:n0(c.qty), price:wIQD(c.price), total:lineTot(c), alloc});
  }
  if (short.length){ // checked again here, at the moment of saving: never sold past zero without the owner
    short.forEach(x => STOCK.log("blocked_sale", {pid:x.p.id, name:pname(x.p), want:x.want, avail:x.avail}));
    // kept in S so the message stays when the screen redraws (the alert record above redraws it), until the cart changes
    S.sellErr = {cart:JSON.stringify(S.cart), html: short.map(x => `<span style="display:block">${esc(STOCK.shortText(x.p, x.avail))}</span>`).join("") + `<button type="button" data-xoversell="1" style="margin-top:8px">Owner: sell anyway (owner PIN)</button>`};
    err.innerHTML = S.sellErr.html; return; }
  S.sellErr = null;
  const {sub, disc} = cartTotals(lines.map(x => x.c), {disc:parseNum($("#xDisc").value)});
  const given = method === "cash" ? parseNum($("#xGiven")?.value) : null; // audit P-07
  if (isNum(given) && wIQD(given) < sub - disc){ err.textContent = `Cash received (${f0(given)} IQD) is less than the total (${f0(sub - disc)} IQD). Take the rest, or choose "On debt".`; return; }
  const discMax = Math.floor(sub * n0(E.cfg.staffDiscPct) / 100); if (disc > discMax) why.push(`Discount ${f0(disc)} IQD (staff may give up to ${f0(discMax)})`);
  let approvedBy = null; if (why.length && (!isOwner() || overs)){ approvedBy = await ownerOK(why, {always:overs}); if (!approvedBy){ err.textContent = NEED_OWNER; return; } }
  if (customerId === "__new"){ customerId = newId("CU"); try { await write("customers/" + customerId, {id:customerId, name:newName, phone:($("#xCPhone")?.value || "").trim(), createdAt:nowIso()}); } catch(x){ err.textContent = x.message; return; } }
  const id = newId("SL"), d = today(), pre = d.replace(/-/g,"").slice(2) + "-" + DEVICE_ID.slice(1, 4).toUpperCase() + "-", no = pre + String(E.sales.filter(s => s.date === d && String(s.no || "").startsWith(pre)).length + 1).padStart(3,"0");
  const sale = {id, no, date:d, at:nowIso(), staffId:S.staff?.id || null, staffName:S.staff?.name || "", shiftId:S.session?.shiftId || null, lines:out, subtotal:sub, discount:disc, total:sub - disc, method, customerId, chronicId:S.cartMeta.chronicId || null, createdBy:S.meId, ...(isNum(given) ? {given:wIQD(given), change:wIQD(given) - (sub - disc)} : {}), ...(approvedBy ? {approvedBy, approvedFor:why} : {})};
  try {
    await write("sales/" + id, sale);
    if (sale.chronicId){ const ch = E.chronic.find(x => x.id === sale.chronicId); if (ch) await write("chronic/" + ch.id, {given:{...(ch.given || {}), [ym(d)]:id}}, true); }
    closeTab(S.tabAt); render(); toast("Sale saved."); receiptSheet(id, sale);
  } catch(x){ err.textContent = x.message; }
}
function receiptHtml(s){
  const cu = E.customers.find(c => c.id === s.customerId);
  return `<div id="receipt" style="font-family:var(--mono);font-size:13px;background:#fff;color:#000;padding:12px;border-radius:8px;max-width:320px;margin:0 auto">
    <div style="text-align:center;font-weight:600">${esc(E.cfg.name || "صيدلية ريحانة · Raihana Pharmacy")}</div>${E.cfg.phone ? `<div style="text-align:center">${esc(E.cfg.phone)}</div>` : ""}
    <div style="text-align:center">Receipt ${esc(s.no)} · ${esc(s.date)} ${esc(hm(s.at))}</div>${s.staffName ? `<div style="text-align:center">Pharmacist: ${esc(s.staffName)}</div>` : ""}<hr>
    ${(s.lines || []).map(l => `<div>${esc(l.name)}</div><div style="display:flex;justify-content:space-between"><span>${l.qty} ${esc(l.unit)} × ${Math.round(l.price).toLocaleString("en-US")}</span><span>${Math.round(l.total).toLocaleString("en-US")}</span></div>`).join("")}<hr>
    ${s.discount ? `<div style="display:flex;justify-content:space-between"><span>Discount</span><span>−${Math.round(s.discount).toLocaleString("en-US")}</span></div>` : ""}
    <div style="display:flex;justify-content:space-between;font-weight:600"><span>Total IQD</span><span>${Math.round(s.total).toLocaleString("en-US")}</span></div>
    ${isNum(s.given) ? `<div style="display:flex;justify-content:space-between"><span>Cash</span><span>${Math.round(s.given).toLocaleString("en-US")}</span></div><div style="display:flex;justify-content:space-between"><span>Change</span><span>${Math.round(s.change).toLocaleString("en-US")}</span></div>` : ""}
    <div>${s.method === "debt" ? `On debt: ${esc(cu?.name || "")}` : `Paid cash${cu ? " · " + esc(cu.name) : ""}`}</div><div style="text-align:center;margin-top:6px">شكراً لزيارتكم</div></div>`;
}
function receiptSheet(id, fresh){
  const s = fresh || E.sales.find(x => x.id === id); if (!s) return;
  openSheet("Receipt " + (s.no || ""), `${receiptHtml(s)}
    <div class="actions"><button type="button" class="primary" data-xprint="${esc(s.id)}">Print receipt</button>${s.voided ? `<span class="pill bad">Cancelled</span>` : S.readOnly ? "" : `${(s.lines || []).some((l, i) => returnedOf(s.id, i) < n0(l.qty)) ? `<button type="button" data-xsaleret="${esc(s.id)}">Return items</button>` : ""}<button type="button" class="danger" data-xsalevoid="${esc(s.id)}">Cancel sale (stock goes back)</button>`}</div>
    ${saleReturns(s.id).filter(m => m.rq).length ? `<div class="sec"><h2>Returns</h2><div class="list">${saleReturns(s.id).filter(m => m.rq).map(m => { const l = s.lines?.[m.saleLine] || {}; return `<div class="row" style="cursor:default"><span class="main"><span class="t">${esc(l.name || "")} · <span class="num">${m.rq}</span> ${esc(l.unit || "")}</span><span class="s">${esc(m.date)} · ${esc(m.reason)}${m.note ? " · " + esc(m.note) : ""}</span></span><span class="end num">−${iqd(m.refund)}</span></div>`; }).join("")}</div></div>` : ""}
    ${s.voided && s.voidReason ? `<p class="note">Cancelled: ${esc(s.voidReason)}</p>` : ""}
    ${window.ERP_MODE === "claude" ? `<p class="note">Printing works in the installed app. On claude.ai you can show this screen to the customer.</p>` : ""}
    <div class="sec"><h2>Batches used</h2><div class="list">${(s.lines || []).map(l => `<div class="row" style="cursor:default"><span class="main"><span class="t">${esc(l.name)}</span><span class="s">${(l.alloc || []).map(a => `${a.batch ? "batch " + esc(a.batch) : "no batch"}${a.expiry ? " exp " + esc(a.expiry) : ""} × ${a.q}`).join(", ")}</span></span></div>`).join("")}</div></div>`);
}
function giveChronic(id){
  const c = E.chronic.find(x => x.id === id); if (!c) return; const cat = catalog(), byId = Object.fromEntries(cat.map(p => [p.id, p]));
  const open = S.tabs.findIndex(t => t.meta?.chronicId === c.id); if (open >= 0) S.tabAt = open; else if (S.cart.length) newTab();
  S.cart = (c.meds || []).filter(m => byId[m.pid]).map(m => { const p = byId[m.pid]; const mode = unitModes(p).includes(m.mode) ? m.mode : "box"; return {pid:m.pid, mode, qty:n0(m.qty), price:lvlPrice(p, mode)}; });
  const cu = E.customers.find(x => x.id === c.customerId);
  S.cartMeta = {chronicId:c.id, customerId: cu ? cu.id : null}; saveCart(); closeSheet(); S.tab = "sell"; render(); window.scrollTo(0,0);
}
function returnSheet(id){
  const s = E.sales.find(x => x.id === id); if (!s || s.voided) return;
  openSheet("Return items", `<form id="retForm" data-id="${esc(s.id)}" style="display:grid;gap:12px"><p class="note">Receipt <span class="num">${esc(s.no)}</span> · ${esc(s.date)}</p>
    ${(s.lines || []).map((l, i) => { const left = r6(n0(l.qty) - returnedOf(s.id, i)); return `<label><span>${esc(l.name)}</span> <span class="note">sold <span class="num">${l.qty}</span> ${esc(l.unit)}${left < n0(l.qty) ? ` · <span class="num">${left}</span> can still come back` : ""}</span><input class="num" inputmode="numeric" data-xrq="${i}" placeholder="0" ${left <= 0 ? "disabled" : ""}></label>`; }).join("")}
    <label>What happens to the items<select id="rWhere"><option value="shelf">Back on the shelf (stock goes back)</option><option value="damaged">Damaged or opened (stock stays out)</option></select></label>
    <label>Reason<input id="rReason"></label>
    <p class="note"><span>${s.method === "debt" ? "The refund comes off the customer's debt." : "The refund is paid from the cash box."}</span> <span>Needs the owner's PIN.</span></p>
    <p class="err" id="rErr"></p><button type="submit" class="primary">Save return</button></form>`);
}
async function saveReturn(f){
  const s = E.sales.find(x => x.id === f.dataset.id), err = $("#rErr"); if (!s || s.voided) return;
  const picks = [...f.querySelectorAll("[data-xrq]")].map(el => ({i:+el.dataset.xrq, q:parseNum(el.value)})).filter(x => isNum(x.q) && x.q !== 0);
  if (!picks.length){ err.textContent = "Enter how many come back."; return; }
  for (const x of picks){ const l = s.lines[x.i], left = r6(n0(l.qty) - returnedOf(s.id, x.i));
    if (!(x.q > 0) || !Number.isInteger(x.q)){ err.textContent = `${l.name}: enter a whole number.`; return; }
    if (x.q > left + 1e-9){ err.textContent = `${l.name}: only ${left} ${l.unit} can come back from this receipt.`; return; } }
  const reason = $("#rReason").value.trim(), shelf = $("#rWhere").value === "shelf"; if (!reason){ err.textContent = "Write the reason for the return."; return; }
  const share = n0(s.subtotal) > 0 ? 1 - n0(s.discount) / n0(s.subtotal) : 1; // the receipt discount is shared out over the lines
  const parts = picks.map(x => { const l = s.lines[x.i]; return {x, l, refund: wIQD(x.q * n0(l.total) / n0(l.qty) * share)}; }), total = parts.reduce((a, y) => a + y.refund, 0);
  const by = await ownerOK([`Return ${parts.map(y => `${y.x.q} ${y.l.unit} ${y.l.name}`).join(", ")} from receipt ${s.no} (refund ${iqd(total)})`]); if (!by){ err.textContent = NEED_OWNER; return; }
  const rid = newId("RT"), at = nowIso(), recs = [];
  for (const {x, l, refund} of parts){
    const base = {pid:l.pid, saleId:s.id, saleNo:s.no, saleLine:x.i, returnId:rid, customerId:s.customerId || null, refundBy: s.method === "debt" ? "debt" : "cash", note:reason, date:today(), at, staffId:S.staff?.id || null, approvedBy:by};
    const alloc = l.alloc || [];
    if (!shelf){ recs.push({...base, key:alloc[0]?.key || "adj:" + l.pid, q:0, per:alloc[0]?.per ?? null, cost:0, reason:"Customer return (damaged)", rq:x.q, refund}); continue; }
    let units = r6(x.q * n0(l.per)), first = true;
    for (const a of [...alloc].reverse()){ if (units <= 1e-9) break; // newest batch taken goes back first, never more than this receipt took from it
      const back = [...saleReturns(s.id), ...recs].filter(m => m.key === a.key && m.saleLine === x.i).reduce((t, m) => t - n0(m.q), 0), q = r6(Math.min(units, n0(a.q) - back)); if (q <= 0) continue;
      recs.push({...base, key:a.key, q:-q, per:a.per, cost:a.cost, reason:"Customer return", rq: first ? x.q : 0, refund: first ? refund : 0}); first = false; units = r6(units - q); }
  }
  try { for (const r of recs){ const mid = newId("MV"); await write("moves/" + mid, {id:mid, ...r}); } }
  catch(e){ err.textContent = e.message; return; }
  closeSheet(); toast(`Return saved. Refund ${iqd(total)}.`); receiptSheet(s.id);
}
async function cancelSale(id){
  const s = E.sales.find(x => x.id === id), reason = ($("#voidReason")?.value || "").trim(); if (!s) return;
  if (saleReturns(id).length){ toast("Items from this receipt were already returned. Return the rest instead of cancelling."); return; }
  if (!reason){ toast("Write the reason for cancelling."); $("#voidReason")?.focus(); return; }
  const by = await ownerOK([`Cancel receipt ${s.no} (${iqd(s.total)})`]); if (!by){ toast(NEED_OWNER); return; }
  try {
    await write("sales/" + id, {voided:true, voidedAt:nowIso(), voidReason:reason, voidedBy:S.staff?.id || null, approvedBy:by}, true);
    const ch = s.chronicId && E.chronic.find(c => c.id === s.chronicId), m = ch && Object.keys(ch.given || {}).find(k => ch.given[k] === id);
    if (m){ const g = {...ch.given}; delete g[m]; await write("chronic/" + ch.id, {given:g}, true); }
    closeSheet(); toast("Sale cancelled. Stock is back.");
  } catch(e){ toast(e.message); }
}
async function cancelRecord(coll, id, what, after){
  const by = await ownerOK([`Cancel ${what}`]); if (!by){ toast(NEED_OWNER); return; }
  try { await write(coll + "/" + id, {voided:true, voidedAt:nowIso(), voidedBy:S.staff?.id || null, approvedBy:by}, true); after(); } catch(e){ toast(e.message); }
}
async function backupAll(btn){
  if (!S.dl){ toast("Download isn't available here."); return; } btn.disabled = true;
  try {
    const data = {app:"Raihana ERP", version:1, exportedAt:nowIso(), collections:{suppliers:S.suppliers, invoices:S.invoices, payments:S.allPayments || S.payments, credits:S.allCredits, meta:Object.entries(S.meta || {}).map(([id, v]) => ({id, ...v})), products:E.prods, sales:E.sales, moves:E.moves, customers:E.customers, custpays:E.custpays, chronic:E.chronic, expenses:E.expenses, closes:E.closes, counts:E.counts, staff:E.staff, shifts:E.shifts}};
    await S.dl.save({filename:`Raihana_ERP_Backup_${today()}.json`, data:new Blob([JSON.stringify(data)], {type:"application/json"})});
    toast("Backup saved."); window.markBackup?.();
  } catch(e){ toast(e?.code === "declined" ? "Download cancelled." : "Backup failed. Try again."); } finally { btn.disabled = false; }
}
/* restore (audit F-03): shows what will change first, adds records that are missing, and replaces a record only when the
   file's copy is newer. A record changed or cancelled on this device after the backup is always kept as it is. */
const RESTORE_COLLS = ["suppliers","invoices","payments","credits","meta","products","sales","moves","customers","custpays","chronic","expenses","closes","counts","staff","shifts","events"];
const recStamp = d => [d?.lastAt, d?.updatedAt, d?.voidedAt, d?.deletedAt, d?.staffAt, d?.at, d?.createdAt].filter(x => typeof x === "string").sort().pop() || "";
function deviceColl(coll){
  return ({suppliers:S.suppliers, invoices:S.invoices, payments:S.allPayments || S.payments, credits:S.allCredits || S.credits, meta:Object.entries(S.meta || {}).map(([id, v]) => ({id, ...v})),
    products:E.prods, sales:E.sales, moves:E.moves, customers:E.customers, custpays:E.custpays, chronic:E.chronic, expenses:E.expenses, closes:E.closes, counts:E.counts, staff:E.staff, shifts:E.shifts})[coll] || [];
}
function restorePlan(j){
  const plan = {add:[], replace:[], keep:0, same:0};
  for (const coll of RESTORE_COLLS){ const have = new Map(deviceColl(coll).map(d => [d.id, d]));
    for (const doc of j.collections?.[coll] || []){ if (!doc || typeof doc.id !== "string" || !doc.id || doc.id.includes("/")) continue;
      const cur = have.get(doc.id);
      if (!cur){ plan.add.push([coll, doc]); continue; }
      if (JSON.stringify(cur) === JSON.stringify(doc)){ plan.same++; continue; }
      const gone = x => !!(x.voided || x.deleted);
      if (gone(cur) && !gone(doc)) { plan.keep++; continue; }        // never bring back something cancelled here
      if (recStamp(doc) > recStamp(cur)) plan.replace.push([coll, doc]); else plan.keep++; } }
  return plan;
}
async function restoreFile(file){
  let j; try { j = JSON.parse(await file.text()); if (!j || typeof j.collections !== "object") throw 0; } catch(e){ toast("That file couldn't be restored. Choose a Raihana ERP backup file."); return; }
  const plan = S.restore = restorePlan(j), byColl = list => Object.entries(list.reduce((m, [c]) => (m[c] = (m[c] || 0) + 1, m), {})).map(([c, n]) => `${c} ${n}`).join(", ") || "none";
  openSheet("Restore backup", `<div class="sum"><div class="r"><span>Backup made</span><span class="num">${esc(String(j.exportedAt || "").slice(0,16).replace("T", " ") || "unknown")}</span></div>
    <div class="r"><span>Missing here, will be added</span><span class="num">${plan.add.length}</span></div><p class="note">${esc(byColl(plan.add))}</p>
    <div class="r"><span>Newer in the file, will replace</span><span class="num">${plan.replace.length}</span></div><p class="note">${esc(byColl(plan.replace))}</p>
    <div class="r"><span>Changed or cancelled here after the backup, kept</span><span class="num">${plan.keep}</span></div>
    <div class="r"><span>Already the same</span><span class="num">${plan.same}</span></div></div>
    <p class="note">Nothing is deleted. Records you changed or cancelled after this backup stay as they are.</p><p class="err" id="rsErr"></p>
    <button type="button" class="primary" data-xrestore="1" ${plan.add.length + plan.replace.length ? "" : "disabled"}>Restore ${plan.add.length + plan.replace.length} records</button>`);
}
async function restoreRun(btn){
  const plan = S.restore; if (!plan) return; if (!isOwner()){ toast("Only the owner can do this."); return; }
  btn.disabled = true; let n = 0;
  try { for (const [coll, doc] of [...plan.add, ...plan.replace]){ await write(coll + "/" + doc.id, doc); n++; } S.restore = null; closeSheet(); toast(`Restored ${n} records.`); }
  catch(e){ $("#rsErr").textContent = `${e.message} ${n} records were restored before the stop; restoring the same file again finishes the rest.`; btn.disabled = false; }
}
async function camScan(){
  if (!window.BarcodeDetector) return;
  openSheet("Scan barcode", `<video id="camV" playsinline muted style="width:100%;border-radius:10px;background:#000"></video><p class="note">Point the camera at the barcode.</p>`);
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}); } catch { $("#sheetBody").innerHTML = `<p>Camera not allowed. Allow camera access for this app, or type the barcode.</p>`; return; }
  const v = $("#camV"); v.srcObject = stream; await v.play().catch(() => {});
  const det = new BarcodeDetector(); let on = true;
  const stop = () => { on = false; stream.getTracks().forEach(t => t.stop()); };
  const obs = new MutationObserver(() => { if ($("#sheet").hidden){ stop(); obs.disconnect(); } }); obs.observe($("#sheet"), {attributes:true});
  const loop = async () => { if (!on) return; try { const r = await det.detect(v); if (r[0]){ stop(); closeSheet(); handleCode(r[0].rawValue); return; } } catch {} requestAnimationFrame(loop); };
  loop();
}
function handleCode(code){
  const p = catalog().find(x => x.barcode && x.barcode === code.trim());
  if (p) addToCart(p.id); else { S.sellQ = code; render(); toast("No item has this barcode yet. Add it to the item under Stock."); }
}

document.addEventListener("click", ev => {
  const t = ev.target.closest("button"); if (!t) return; const d = t.dataset;
  if (d.xadd){ addToCart(d.xadd); return; }
  if (d.xtab !== undefined){ S.tabAt = +d.xtab; saveCart(); render(); return; }
  if (d.xnewtab){ newTab(); render(); setTimeout(() => $("#sellQ")?.focus(), 0); return; }
  if (d.xclosetab){ if (S.cart.length && t.dataset.sure !== "1"){ t.dataset.sure = "1"; t.textContent = "Tap again to close"; return; } closeTab(S.tabAt); render(); return; }
  if (d.xstep !== undefined){ const c = S.cart[+d.xstep]; c.qty = Math.max(1, n0(c.qty) + +d.d); saveCart(); render(); return; }
  if (d.xprf){ S.pr.f = d.xprf; prSave(); S.tab = "pricing"; render(); return; }
  if (d.xprsel){ S.pr.sel = d.xprsel === "none" ? [] : [...document.querySelectorAll("[data-xprck]")].map(x => x.dataset.xprck); prSave(); render(); return; }
  if (d.xprmode){ S.pr.mode = d.xprmode; prSave(); render(); return; }
  if (d.xprapply){ const pct = parseNum(S.pr.pct); if (!isNum(pct)){ toast("Type the % first."); return; }
    if (S.pr.mode === "margin" && !(pct < 100)){ toast("A profit margin must be under 100%."); return; }
    if (S.pr.mode === "markup" && !(pct > -100)){ toast("A markup must be above −100%."); return; }
    const ids = d.xprapply === "sel" ? S.pr.sel : [...document.querySelectorAll("[data-xprck]")].map(x => x.dataset.xprck); let n = 0, skip = 0;
    const cat = catalog(); for (const id of ids){ const p = cat.find(x => x.id === id), c = p && lastCostBox(p); if (!isNum(c)){ skip++; continue; } if (!(c > 0)){ skip++; continue; } const rr = +S.pr.round || 1, rs = Math.min(rr, 250), at = cost => PRICING.price(cost, pct, S.pr.mode);
      prSet(id, "box", roundTo(at(c), rr)); if (p.midName) prSet(id, "mid", Math.max(rs, roundTo(at(c / (p.sub / p.midN)), rs))); if (p.sub > 1) prSet(id, "sub", Math.max(rs, roundTo(at(c / p.sub), rs))); n++; }
    render(); toast(`${n} prices filled in. Check them, then tap Save.${skip ? ` ${skip} items have no cost.` : ""}`); return; }
  if (d.xprdrop){ S.pr.edits = {}; prSave(); render(); toast("Changes undone."); return; }
  if (d.xprsave){ prSaveAll(t, S.pr.edits, "Pricing").then(n => { S.pr.edits = {}; prSave(); render(); toast(`${n} prices saved.`); }).catch(e => toast(e.message)); return; }
  if (d.ximp){ pickSheet(readPriceFile); return; }
  if (d.ximsave){ const I = S.imp, use = I.out.filter(o => o.use && o.pid && o.price), bar = $("#imBar").checked, edits = {};
    if (!use.length){ $("#imErr").textContent = "Tick at least one row."; return; }
    for (const o of use){ const p = catalog().find(x => x.id === o.pid); edits[o.pid] = {box:o.price, ...(o.mid && p?.midName ? {mid:o.mid} : {}), ...(o.sub && p?.sub > 1 ? {sub:o.sub} : {}), ...(bar && o.bc ? {barcode:o.bc} : {})}; }
    prSaveAll(t, edits, "Import: " + I.file).then(n => { closeSheet(); S.imp = null; render(); toast(`${n} prices saved.`); }).catch(e => { $("#imErr").textContent = e.message; }); return; }
  if (d.xper){ S.sellPeriod = d.xper; lsSet("erp.sellPeriod", d.xper); render(); return; }
  if (d.xrm !== undefined){ S.cart.splice(+d.xrm, 1); if (!S.cart.length) S.cartMeta = {}; saveCart(); render(); return; }
  if (d.xclear){ S.cart = []; S.cartMeta = {}; saveCart(); render(); return; }
  if (d.xsale){ receiptSheet(d.xsale); return; }
  if (d.xsaleret){ returnSheet(d.xsaleret); return; }
  if (d.xprint){ const s = E.sales.find(x => x.id === d.xprint); if (!s) return; const pa = $("#printArea"); pa.innerHTML = receiptHtml(s); try { window.print(); } catch {} return; }
  if (d.xsalevoid){ if (t.dataset.sure !== "1"){ t.dataset.sure = "1"; t.textContent = "Confirm cancel"; t.insertAdjacentHTML("beforebegin", `<label style="flex-basis:100%">Reason for cancelling<input id="voidReason"></label>`); if (S.lang === "ar") translate(t.parentElement); $("#voidReason").focus(); return; }
    cancelSale(d.xsalevoid); return; }
  if (d.xprod){ if (!canUse("stock")){ toast("The owner has not given you this screen."); return; } prodSheet(d.xprod); return; }
  if (d.xsf){ S.stockF = d.xsf; render(); return; }
  if (d.xchr){ chrSheet(d.xchr); return; }
  if (d.xgive){ giveChronic(d.xgive); return; }
  if (d.xgivenoff || d.xungive){ const c = E.chronic.find(x => x.id === (d.xgivenoff || d.xungive)); const g = {...(c.given || {})}; if (d.xgivenoff) g[ym()] = "manual"; else delete g[ym()];
    write("chronic/" + c.id, {given:g}, true).then(() => { toast(d.xgivenoff ? "Marked given this month." : "Marked not given."); chrSheet(c.id); }).catch(e => toast(e.message)); return; }
  if (d.xcpick){ S.chrMeds.push({pid:d.xcpick, qty:1, mode:"box"}); $("#cAddQ").value = ""; $("#cErr").textContent = ""; drawChrMeds(); drawChrPick(); return; }
  if (d.xcrm !== undefined){ S.chrMeds.splice(+d.xcrm, 1); drawChrMeds(); drawChrPick(); return; }
  if (d.xchrdel){ if (t.dataset.sure !== "1"){ t.dataset.sure = "1"; t.textContent = "Tap again to delete"; return; }
    write("chronic/" + d.xchrdel, {deleted:true, deletedAt:nowIso()}, true).then(() => { closeSheet(); toast("Card deleted."); }).catch(e => toast(e.message)); return; }
  if (d.xcust){ custSheet(d.xcust); return; }
  if (d.xcpvoid){ if (t.dataset.sure !== "1"){ t.dataset.sure = "1"; t.textContent = "Tap again to cancel"; return; } const x = E.custpays.find(y => y.id === d.xcpvoid);
    cancelRecord("custpays", d.xcpvoid, `customer payment ${iqd(x?.amount)}`, () => { toast("Payment cancelled."); custSheet(x?.customerId); }); return; }
  if (d.xexp){ openSheet("Add expense", `<form id="expForm" style="display:grid;gap:12px"><div class="grid2"><label>Type<select id="eCat">${EXP_CATS.map(c => `<option>${c}</option>`).join("")}</select></label><label>Date<input id="eDate" type="date" value="${today()}"></label></div><label>Amount (IQD)<input id="eAmt" class="num" inputmode="numeric" required></label><label class="check"><input type="checkbox" id="eCash" checked> Paid from the cash box</label><label>Note<input id="eNote"></label><p class="err" id="eErr"></p><button type="submit" class="primary">Save expense</button></form>`); return; }
  if (d.xexpvoid){ if (t.dataset.sure !== "1"){ t.dataset.sure = "1"; t.textContent = "Tap again to cancel"; return; } const x = E.expenses.find(y => y.id === d.xexpvoid);
    cancelRecord("expenses", d.xexpvoid, `expense ${x?.category || ""} ${iqd(x?.amount)}`, () => toast("Expense cancelled.")); return; }
  if (d.xbackup){ backupAll(t); return; }
  if (d.xrestore){ restoreRun(t); return; }
  if (d.xsync){ window.ERP_SYNC?.run(); toast("Syncing…"); return; }
  if (d.xlogout){ window.ERP_SYNC?.logout(); render(); return; }
  if (d.xcam){ camScan(); return; }
});
document.addEventListener("input", ev => {
  const t = ev.target, d = t.dataset;
  const keep = id => { const el = document.getElementById(id); if (el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
  if (t.id === "sellQ"){ S.sellQ = t.value; render(); keep("sellQ"); return; }
  if (t.id === "stockQ"){ S.stockQ = t.value; render(); keep("stockQ"); return; }
  if (t.id === "chrQ"){ S.chrQ = t.value; render(); keep("chrQ"); return; }
  if (d.xq !== undefined){ S.cart[+d.xq].qty = n0(parseNum(t.value)); saveCart(); return; }
  if (d.xp !== undefined){ const v = parseNum(t.value); S.cart[+d.xp].price = isNum(v) ? wIQD(v) : null; saveCart(); return; }
  if (t.id === "xDisc"){ S.cartMeta.disc = wIQD(parseNum(t.value)); saveCart(); return; }
  if (t.id === "xGiven"){ const v = parseNum(t.value); S.cartMeta.given = isNum(v) ? v : null; saveCart();
    const tot = cartTotals(S.cart, S.cartMeta).total, ch = $("#xChange"); if (ch) ch.value = isNum(v) && v >= tot ? (v - tot).toLocaleString("en-US") : ""; return; }
  if (t.id === "xCName"){ S.cartMeta.newName = t.value; return; } if (t.id === "xCPhone"){ S.cartMeta.newPhone = t.value; return; }
  if (d.xcq !== undefined){ S.chrMeds[+d.xcq].qty = n0(parseNum(t.value)); return; }
  if (t.id === "cAddQ"){ drawChrPick(); return; }
  if (t.id === "prQ"){ S.pr.q = t.value; prSave(); render(); keep("prQ"); return; }
  if (t.id === "prPct"){ S.pr.pct = t.value; prSave(); return; }
  if (t.id === "pSellBox"){ const el = $("#pProfit"), p = catalog().find(x => x.id === t.form?.dataset.id), c = p && lastCostBox(p), v = parseNum(t.value); if (el && isNum(c)){ el.textContent = `Cost per box ${f0(c)}${isNum(v) ? ` · Markup ${PRICING.pctTxt(PRICING.markupPct(wIQD(v), c))} · Margin ${PRICING.pctTxt(PRICING.marginPct(wIQD(v), c))}` : ""}`; if (S.lang === "ar") translate(el); } return; }
  if (d.xprb || d.xprs || d.xprmid){ const pid = d.xprb || d.xprs || d.xprmid, v = parseNum(t.value); prSet(pid, d.xprb ? "box" : d.xprmid ? "mid" : "sub", isNum(v) ? wIQD(v) : null);
    const p = catalog().find(x => x.id === pid), m = document.querySelector(`[data-xprm="${pid}"]`); if (m && d.xprb){ const c = lastCostBox(p); m.innerHTML = marginTxt(isNum(v) ? wIQD(v) : null, c); m.style.color = `var(--${isNum(v) && isNum(c) && v < c ? "bad" : "good"})`; }
    const n = Object.keys(S.pr.edits).length, bar = document.querySelector(".sticky-save"); if (bar){ bar.hidden = !n; bar.querySelector("b").textContent = n; bar.querySelector("[data-xprsave]").textContent = `Save ${n} prices`; } t.closest("tr")?.classList.toggle("chg", !!S.pr.edits[pid]); return; }
});
document.addEventListener("change", ev => {
  const t = ev.target, d = t.dataset;
  if (d.xq !== undefined || d.xp !== undefined || t.id === "xDisc"){ render(); return; }
  if (d.xmode !== undefined){ const c = S.cart[+d.xmode], p = catalog().find(x => x.id === c.pid); c.mode = t.value; c.price = p ? lvlPrice(p, c.mode) ?? null : null; saveCart(); render(); return; }
  if (t.id === "xMethod"){ S.cartMeta.method = t.value; saveCart(); render(); return; }
  if (t.id === "xCust"){ S.cartMeta.customerId = t.value; saveCart(); render(); return; }
  if (d.xcm !== undefined){ S.chrMeds[+d.xcm].mode = t.value; drawChrMeds(); return; }
  if (t.id === "prRound"){ S.pr.round = +t.value; prSave(); return; }
  if (d.xprck){ const set = new Set(S.pr.sel); t.checked ? set.add(d.xprck) : set.delete(d.xprck); S.pr.sel = [...set]; prSave(); const b = document.querySelector('[data-xprapply="sel"]'); if (b) b.textContent = `Apply to ticked (${set.size})`; return; }
  if (d.ximap){ S.imp.map[d.ximap] = +t.value; impMatch(); impSheet(); return; }
  if (d.ximuse !== undefined){ S.imp.out[+d.ximuse].use = t.checked; const b = document.querySelector("[data-ximsave]"); if (b) b.textContent = `Save ${S.imp.out.filter(o => o.use).length} prices from the file`; return; }
  if (d.ximpid !== undefined){ const o = S.imp.out[+d.ximpid]; o.pid = t.value; o.how = t.value ? "name" : ""; o.use = !!t.value && !!o.price; impSheet(); return; }
  if (t.id === "sellFrom"){ S.sellFrom = t.value; render(); return; }
  if (t.id === "sellTo"){ S.sellTo = t.value; render(); return; }
  if (t.id === "sellStaff"){ S.sellStaff = t.value; render(); return; }
  if (t.id === "moneyM" && t.value){ S.moneyM = t.value; render(); return; }
  if (t.id === "restoreIn" && t.files?.[0]){ if (!isOwner()){ toast("Only the owner can do this."); t.value = ""; return; } restoreFile(t.files[0]); t.value = ""; return; }
});
/* keys on Sell (audit P-08, P-09). Only keys the browser leaves free: F1, F3, F5, F6, F7 and F11 stay with the browser.
   A scanner types like a keyboard, so a code typed while nothing is focused, or while the last receipt is still open, goes
   into the search box and starts the next sale. */
const typing = el => !!el && (el.matches?.("input,select,textarea") || el.isContentEditable);
function sellKeys(ev){
  if (S.tab !== "sell" || $("#lockScreen") || $("#ownerPin") || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const open = !$("#sheet").hidden, rcpt = open && $("#sheet #receipt");
  if (ev.key === "F10"){ $("#sheet [data-xprint]")?.click(); return !!rcpt; }
  if (open && !rcpt) return false;
  if (ev.key.length === 1 && ev.key !== " " && !"+-".includes(ev.key) && !typing(ev.target)){
    if (open) closeSheet(); const q = $("#sellQ"); if (!q) return false;
    q.focus(); q.value += ev.key; q.dispatchEvent(new Event("input", {bubbles:true})); return true; }
  if (open) return false;
  const c = S.cart[S.cart.length - 1];
  switch (ev.key){
    case "F2": { const q = $("#sellQ"); q?.focus(); q?.select(); return true; }
    case "F4": { if (!c) return true; const p = catalog().find(x => x.id === c.pid), ms = p ? unitModes(p) : ["box"]; c.mode = ms[(ms.indexOf(c.mode) + 1) % ms.length]; c.price = p ? lvlPrice(p, c.mode) ?? null : null; saveCart(); render(); return true; }
    case "F8": if (!debtOn()) return true; S.cartMeta.method = S.cartMeta.method === "debt" ? "cash" : "debt"; saveCart(); render(); return true;
    case "F9": $("#sellForm")?.requestSubmit(); return true;
    case "+": case "-": if (!c || typing(ev.target)) return false; c.qty = Math.max(1, n0(c.qty) + (ev.key === "+" ? 1 : -1)); saveCart(); render(); return true;
    case "ArrowDown": case "ArrowUp": { const rows = [...document.querySelectorAll(".list [data-xadd]")], i = rows.indexOf(ev.target); if (!rows.length) return false;
      if (ev.target.id === "sellQ"){ if (ev.key !== "ArrowDown") return false; rows[0].focus(); return true; }
      if (i < 0) return false; (ev.key === "ArrowDown" ? rows[Math.min(i + 1, rows.length - 1)] : i ? rows[i - 1] : $("#sellQ")).focus(); return true; }
  }
  return false;
}
document.addEventListener("keydown", ev => {
  if (sellKeys(ev)){ ev.preventDefault(); return; }
  if (ev.target.id === "sellQ" && ev.key === "Enter"){ ev.preventDefault(); const v = ev.target.value.trim(); if (!v) return;
    const cat = catalog(), p = cat.find(x => x.barcode && x.barcode === v); if (p){ addToCart(p.id); return; }
    const hits = cat.filter(x => [x.name, x.strength, x.form, x.sci, x.desc].join(" ").toLowerCase().includes(v.toLowerCase())); if (hits.length === 1) addToCart(hits[0].id); else if (hits.length > 1) document.querySelector(".list [data-xadd]")?.focus(); }
  if (ev.target.id === "pBar" && ev.key === "Enter") ev.preventDefault();
});
document.addEventListener("submit", async ev => {
  const f = ev.target, id = f.id;
  if (!["sellForm","prodForm","adjForm","chrForm","custForm","cpForm","expForm","closeForm","cfgForm","syncForm","retForm"].includes(id)) return;
  ev.preventDefault();
  const num = sel => { const v = parseNum($(sel)?.value); return isNum(v) ? v : null; };
  const fail = (sel, x) => { const e = $(sel); if (e) e.textContent = x.message || x; };
  try {
    if (id === "sellForm") return saveSale(ev);
    if (id === "retForm") return saveReturn(f);
    if (id === "prodForm"){
      if (!canUse("stock")) return fail("#pErr", "The owner has not given you this screen.");
      const pid = f.dataset.id === "__new" ? newId("PX") : f.dataset.id, name = $("#pName").value.trim(); if (!name) return fail("#pErr", "Enter the name.");
      let midName = $("#pMidName").value, subName = $("#pSubName").value; const midCount = num("#pMidCount"), subCount = num("#pSubCount");
      if (midName && !(midCount > 1 && Number.isInteger(midCount))) return fail("#pErr", "Enter how many middle units are in one box (a whole number above 1).");
      if (subName && !(subCount > 1 && Number.isInteger(subCount))) return fail("#pErr", `Enter how many smallest units are in one ${midName ? "middle unit" : "box"} (a whole number above 1).`);
      let sub = 1, midN = null;
      if (midName && subName){ sub = midCount * subCount; midN = subCount; }
      else if (midName){ sub = midCount; subName = midName; midName = ""; }
      else if (subName){ sub = subCount; }
      else subName = "box";
      const bc = $("#pBar").value.trim(); const clash = bc && catalog().find(x => x.barcode === bc && x.id !== pid); if (clash) return fail("#pErr", `This barcode is already on ${pname(clash)}.`);
      const om = catalog().find(x => x.id === pid)?.m || {}, wq = v => isNum(v) ? wIQD(v) : v, nb = wq(num("#pSellBox")), ns = wq(num("#pSellSub")), nmid = wq(num("#pSellMid"));
      const priceChanged = (om.sellBox ?? null) !== nb || (om.sellSub ?? null) !== ns || (om.sellMid ?? null) !== nmid;
      const okBy = priceChanged && !canUse("pricing") ? await ownerOK([`Change the sell price of ${name}`]) : S.staff?.id || null; if (priceChanged && !canUse("pricing") && !okBy) return fail("#pErr", NEED_OWNER);
      const priceHistory = priceChanged ? [...(om.priceHistory || []), {at:nowIso(), by:S.meId, staffBy:S.staff?.id || null, approvedBy:okBy, box:nb, mid:nmid, sub:ns, oldBox:om.sellBox ?? null, oldMid:om.sellMid ?? null, oldSub:om.sellSub ?? null, source:"Item card"}].slice(-30) : (om.priceHistory || []);
      await write("products/" + pid, {...om, priceHistory, id:pid, name, strength:$("#pStr").value.trim(), form:$("#pForm").value.trim(), sci:$("#pSci").value.trim(), barcode:bc, shelf:$("#pShelf").value.trim(), sub, subName, midName, midN, sellBox:nb, sellMid:midName ? nmid : null, sellSub:ns, min:num("#pMin"), fridge:$("#pCold").checked, quick:$("#pQuick").checked});
      toast("Item saved."); prodSheet(pid); return;
    }
    if (id === "adjForm"){
      const pid = f.dataset.id, p = catalog().find(x => x.id === pid), q = num("#aQty"); if (!(q > 0)) return fail("#aErr", "Enter a quantity above 0.");
      const units = r6(q * unitPer(p, $("#aUnit").value)), reason = $("#aReason").value, more = reason === "Count correction (more found)", key = $("#aKey").value;
      const st = stockOf(p, usedMap(true)), b = st.bs.find(x => x.key === key), mid = newId("MV");
      if (!more){ const lim = Math.max(0, key.startsWith("adj:") ? st.good : n0(b?.left)); if (units > lim + 1e-9) return fail("#aErr", `Only ${qtyText(p, lim)} left ${key.startsWith("adj:") ? "in stock" : "in this batch"}. Stock can't go below zero.`); }
      const by = await ownerOK([`${reason}: ${qtyText(p, units)} of ${pname(p)}`]); if (!by) return fail("#aErr", NEED_OWNER);
      await write("moves/" + mid, {id:mid, pid, key, q: more ? -units : units, per:p.sub, reason, note:$("#aNote").value.trim(), date:today(), at:nowIso(), cost: b && isNum(b.cost) ? b.cost : subCostNow(p), approvedBy:by});
      toast("Stock updated."); prodSheet(pid); return;
    }
    if (id === "chrForm"){
      const cid = f.dataset.id === "__new" ? newId("CH") : f.dataset.id, name = $("#cName").value.trim(), day = num("#cDay");
      if (!name) return fail("#cErr", "Enter the patient's name."); if (!(day >= 1 && day <= 31)) return fail("#cErr", "Pickup day must be 1 to 31.");
      if (!S.chrMeds.length) return fail("#cErr", "Add at least one medicine.");
      const old = E.chronic.find(x => x.id === cid) || {};
      let customerId = old.customerId || E.customers.find(c => !c.deleted && c.name.trim() === name)?.id || null;
      if (!customerId){ customerId = newId("CU"); await write("customers/" + customerId, {id:customerId, name, phone:$("#cPhone").value.trim(), createdAt:nowIso(), notes:"Chronic patient"}); }
      await write("chronic/" + cid, {...old, id:cid, name, phone:$("#cPhone").value.trim(), day, active:$("#cActive").checked, notes:$("#chrNotes").value.trim(), meds:S.chrMeds.filter(m => n0(m.qty) > 0), customerId, given:old.given || {}, createdAt:old.createdAt || nowIso()});
      toast("Card saved."); chrSheet(cid); return;
    }
    if (id === "custForm"){
      const cid = f.dataset.id === "__new" ? newId("CU") : f.dataset.id, name = $("#kName").value.trim(); if (!name) return;
      const old = E.customers.find(x => x.id === cid) || {};
      await write("customers/" + cid, {...old, id:cid, name, phone:$("#kPhone").value.trim(), notes:$("#kNotes").value.trim(), createdAt:old.createdAt || nowIso()}); toast("Customer saved."); custSheet(cid); return;
    }
    if (id === "cpForm"){
      const amt = num("#cpAmt"); if (!(amt > 0)) return fail("#cpErr", "Enter the amount."); const pid = newId("CP"), pd = $("#cpDate").value || today();
      if (pd !== today() && closeOf(pd)) return fail("#cpErr", "That day is already closed. Use today's date.");
      const owes = custBalance(f.dataset.id).bal; if (amt > owes && f.dataset.over !== String(amt)){ f.dataset.over = String(amt); return fail("#cpErr", `This is more than the customer owes (${iqd(Math.max(0, owes))}). Tap Save payment again to keep the extra as the customer's credit.`); }
      await write("custpays/" + pid, {id:pid, customerId:f.dataset.id, amount:wIQD(amt), date:$("#cpDate").value || today(), note:$("#cpNote").value.trim(), at:nowIso()}); toast("Payment saved."); custSheet(f.dataset.id); return;
    }
    if (id === "expForm"){
      const amt = num("#eAmt"); if (!(amt > 0)) return fail("#eErr", "Enter the amount."); const xid = newId("EX"), ed = $("#eDate").value || today();
      if (ed !== today() && closeOf(ed)) return fail("#eErr", "That day is already closed. Use today's date.");
      await write("expenses/" + xid, {id:xid, category:$("#eCat").value, amount:wIQD(amt), date:$("#eDate").value || today(), fromCash:$("#eCash").checked, note:$("#eNote").value.trim(), at:nowIso()}); closeSheet(); toast("Expense saved."); return;
    }
    if (id === "closeForm"){
      const amt = num("#clAmt"); if (!isNum(amt)) return;
      if (closeOf(today())){ const by = await ownerOK(["Change today's day close"]); if (!by){ toast(NEED_OWNER); return; } }
      const dc = cashParts(today(), x => !x.voided);
      await write("closes/" + today(), {id:today(), counted:wIQD(amt), expected:dc.expected, diff:wIQD(amt) - dc.expected, note:$("#clNote").value.trim(), at:nowIso()}); toast("Day closed."); return;
    }
    if (id === "cfgForm"){
      if (!isOwner()){ toast("Only the owner can do this."); return; }
      await write("meta/erp", {...E.cfg, name:$("#cfgName").value.trim(), phone:$("#cfgPhone").value.trim(), alertDays: Math.max(1, Math.min(31, num("#sDays") || 7)), alertsOff: [...document.querySelectorAll("[data-xalert]")].filter(x => !x.checked).map(x => x.dataset.xalert), staffDiscPct: Math.max(0, Math.min(100, num("#sDisc") || 0)), debtOn: $("#sDebt").checked}); toast("Settings saved."); return;
    }
    if (id === "syncForm"){
      $("#yErr").textContent = "Connecting…";
      await window.ERP_SYNC.login($("#yUrl").value.trim(), $("#yKey").value.trim(), $("#yEmail").value.trim(), $("#yPass").value); render(); return;
    }
  } catch(x){ const e = f.querySelector(".err"); if (e) e.textContent = x.message; else toast(x.message); }
});

/* ---------- hook into the app: tabs, home screen, Excel, Arabic ---------- */
window.ERP_VIEWS = {none:() => `<div class="empty">The owner has not given you any screens yet. Ask the owner to tick your screens under Staff.</div>`, staff:staffView, pricing:pricingView, sell:sellView, stock:stockView, chronic:chronicView, customers:customersView, money:moneyView, settings:settingsView};
const baseHomeExtras = homeExtras;
homeExtras = window.homeExtras = function(){
  const used = usedMap(), cat = catalog(), low = lowStock(cat, used).length, soon = chronicNeeds(ALERT_DAYS()).filter(n => n.short > 0);
  const dueCards = E.chronic.filter(c => !c.deleted && c.active !== false && chrStatus(c).dl <= ALERT_DAYS() && !chrStatus(c).givenThis).length;
  const td = E.sales.filter(s => !s.voided && s.date === today());
  return `<section class="kpis" aria-label="Today">
    <button type="button" class="kpi tap" data-tab="sell"><span class="l">Sales today</span><span class="v num">${iqd(td.reduce((a,s) => a + n0(s.total), 0))}</span><span class="l">${td.length} receipts · tap to sell</span></button>
    <button type="button" class="kpi tap" data-tab="chronic"><span class="l">Chronic pickups in ${ALERT_DAYS()} days</span><span class="v num">${dueCards}</span><span class="l" ${soon.length ? 'style="color:var(--bad)"' : ""}>${soon.length ? `${soon.length} medicines short` : "stock is enough"}</span></button>
    <button type="button" class="kpi tap" data-tab="stock"><span class="l">Low or out of stock</span><span class="v num" ${low ? 'style="color:var(--bad)"' : ""}>${low}</span><span class="l">tap to see</span></button>
    <button type="button" class="kpi tap" data-tab="customers"><span class="l">Customers owe you</span><span class="v num">${iqd(E.customers.reduce((a,c) => a + Math.max(0, custBalance(c.id).bal), 0))}</span><span class="l">tap to see</span></button>
  </section>
  ${alertsHome()}
  ${soon.length ? `<section class="sec"><div class="sechead"><h2>Chronic patients: order now</h2></div><div class="list">${soon.slice(0,5).map(n => `<button type="button" class="alert row" data-xprod="${esc(n.p.id)}"><span class="dot ${n.missing ? "bad" : ""}"></span><span><b>${esc(pname(n.p))}</b> ${n.missing ? "is missing" : "is short"}: need ${esc(qtyText(n.p, n.q))}, have ${esc(qtyText(n.p, n.have))}.</span></button>`).join("")}</div></section>` : ""}
  ${baseHomeExtras()}`;
};
const baseExtraSheets = window.extraSheets;
window.extraSheets = function(add){
  baseExtraSheets?.(add);
  const cat = catalog(), used = usedMap();
  add("Stock", cat.map(p => { const s = stockOf(p, used); return {"Item":p.name, "Dose":p.strength || "", "Form":p.form || "", "Barcode":p.barcode, "Packaging":levelText(p), "Sell price middle unit (IQD)":p.m?.sellMid ?? "", "Sell price smallest unit (IQD)":p.m?.sellSub ?? "", "In stock":qtyText(p, s.good), "In stock (small units)":s.good, "Expired":s.exp, "Next expiry":s.next?.expiry || "", "Sell price box (IQD)":p.sellBox ?? "", "Cost per box (IQD)":(c => isNum(c) ? Math.round(c) : "")(lastCostBox(p)), "Markup %":(c => { const v = PRICING.markupPct(p.sellBox, c); return isNum(v) ? Math.round(v * 10) / 10 : ""; })(lastCostBox(p)), "Margin %":(c => { const v = PRICING.marginPct(p.sellBox, c); return isNum(v) ? Math.round(v * 10) / 10 : ""; })(lastCostBox(p)), "Value at cost (IQD)":Math.round(s.value), "Refrigerated":p.fridge ? "Yes" : "No"}; }));
  add("Sales", E.sales.flatMap(s => (s.lines || []).map(l => ({"Receipt":s.no, "Date":s.date, "Time":hm(s.at), "Pharmacist":s.staffName || "", "Item":l.name, "Qty":l.qty, "Unit":l.unit, "Price (IQD)":l.price, "Line total (IQD)":l.total, "Cost (IQD)":Math.round((l.alloc || []).reduce((a,x) => a + n0(x.q) * n0(x.cost), 0)), "Batches":(l.alloc || []).map(a => `${a.batch || "-"} × ${a.q}`).join("; "), "Receipt discount (IQD)":s.discount, "Receipt total (IQD)":s.total, "Payment":s.method === "debt" ? "Debt" : "Cash", "Customer":E.customers.find(c => c.id === s.customerId)?.name || "", "Cancelled":s.voided ? "Yes" : ""}))));
  add("Customers", E.customers.filter(c => !c.deleted).map(c => { const b = custBalance(c.id); return {"Name":c.name, "Phone":c.phone || "", "Bought on debt (IQD)":b.debt, "Paid (IQD)":b.paid, "Owes (IQD)":b.bal}; }));
  add("Chronic cards", E.chronic.filter(c => !c.deleted).flatMap(c => (c.meds || []).map(m => { const p = cat.find(x => x.id === m.pid); return {"Patient":c.name, "Phone":c.phone || "", "Day each month":c.day, "Next pickup":chrDate(c), "Active":c.active !== false ? "Yes" : "No", "Medicine":p ? pname(p) : m.pid, "Qty per month":m.qty, "Unit":p ? unitName(p, m.mode || "box") : "box", "In stock":p ? qtyText(p, stockOf(p, used).good) : ""}; })));
  add("Expenses", E.expenses.map(x => ({"Date":x.date, "Type":x.category, "Amount (IQD)":x.amount, "From cash box":x.fromCash === false ? "No" : "Yes", "Note":x.note || "", "Cancelled":x.voided ? "Yes" : ""})));
  add("Stock changes", E.moves.map(x => { const p = cat.find(y => y.id === x.pid); return {"Date":x.date, "Item":p ? pname(p) : x.pid, "Reason":x.reason, "Small units":x.q, "Note":x.note || ""}; }));
  const st = cat.map(p => ({p, s:stockOf(p, used)}));
  add("Out of stock", st.filter(x => x.s.good <= 0).map(({p, s}) => ({"Item":pname(p), "Form":p.form || "", "Barcode":p.barcode, "In stock (small units)":s.good, "Last bought":p.lastDate || "", "Sell price per box (IQD)":p.sellBox ?? ""})));
  add("Low stock", st.filter(({p, s}) => p.min !== null && s.good > 0 && s.good < p.min * p.sub).map(({p, s}) => ({"Item":pname(p), "In stock":qtyText(p, s.good), "Alert below (boxes)":p.min})));
  add("Batches and expiry", st.flatMap(({p, s}) => s.bs.map(b => ({"Item":pname(p), "Batch":b.batch, "Expiry":b.expiry, "Supplier":supName(b.inv.supplierId), "Invoice":b.inv.invoiceNo, "Came in (small units)":b.in, "Left (small units)":b.left, "Expired":b.expired ? "Yes" : ""}))));
  add("Stock movements", st.flatMap(({p, s}) => stockHistory(p, s).map(h => ({"When":String(h.at || h.date || "").slice(0, 16).replace("T", " "), "Item":pname(p), "Movement":h.what, "Details":h.ref, "Small units":h.q, "By":h.who}))));
  add("Stock discrepancies", E.counts.flatMap(c => (c.lines || []).filter(y => y.diff).map(y => ({"Stocktake date":c.date, "Item":y.name, "System (small units)":y.system, "Counted (small units)":y.counted, "Difference":y.diff}))));
  add("Stock alerts", stockAlerts().map(a => ({"Type":a.what, "Item":a.name, "Quantity":a.qty, "When":a.when, "What to do":a.act})));
};
Object.assign(AR, {
"Sell":"بيع","Stock":"المخزون","Chronic":"المزمنين","Customers":"الزبائن","Money":"الحسابات","Settings":"الإعدادات",
"Stock, sales, chronic patients, suppliers and money · IQD":"المخزون والمبيعات والمرضى المزمنين والموردين والحسابات · دينار",
"Scan barcode or type a name":"امسح الباركود أو اكتب الاسم","This sale":"هذه البيعة","Clear":"مسح","Qty":"الكمية","Sell by":"البيع بـ","Box":"علبة","Price each (IQD)":"سعر الواحدة (دينار)","Line total":"مجموع السطر",
"Subtotal":"المجموع الفرعي","Discount (IQD)":"الخصم (دينار)","On debt (دين)":"دين","Customer":"الزبون","Choose customer":"اختر الزبون","+ New customer":"+ زبون جديد","Customer name":"اسم الزبون","Phone":"الهاتف",
"Sell even if stock shows less (fix stock later)":"بع حتى لو المخزون أقل (صحح المخزون لاحقاً)","Today's sales":"مبيعات اليوم","No sales yet today.":"لا مبيعات اليوم بعد.","Scan or search an item to start a sale.":"امسح أو ابحث عن مادة لبدء البيع.",
"Sales today":"مبيعات اليوم","Low or out of stock":"قليل أو نافد","Customers owe you":"ديون الزبائن","Customers owe you (دين)":"ديون الزبائن","stock is enough":"المخزون كافٍ","Chronic patients: order now":"المرضى المزمنين: اطلب الآن",
"Stock value at cost (after discounts and bonus)":"قيمة المخزون بالكلفة (بعد الخصم والبونص)","+ Item":"+ مادة","Low":"قليل","Expiring 3 months":"تنتهي خلال 3 أشهر","No sell price":"بدون سعر بيع","Out":"نافد","No price":"بدون سعر",
"Add item":"إضافة مادة","In stock":"في المخزون","Value at cost":"القيمة بالكلفة","Scientific name":"الاسم العلمي","Barcode":"الباركود","Shelf / place":"الرف / المكان","Sell smaller units?":"بيع وحدات أصغر؟","How many in one box":"كم واحدة في العلبة",
"Sell price per box (IQD)":"سعر بيع العلبة (دينار)","Sell price per small unit (IQD)":"سعر بيع الوحدة الصغيرة (دينار)","Alert when below (boxes)":"نبه عندما يقل عن (علب)","Refrigerated (براد)":"براد","Save item":"حفظ المادة",
"Batches (nearest expiry sold first)":"الوجبات (الأقرب انتهاءً تباع أولاً)","Came in":"الوارد","Left":"المتبقي","Cost each":"كلفة الواحدة","Write off or correct stock":"شطب أو تصحيح المخزون","Quantity":"الكمية","Unit":"الوحدة","Note":"ملاحظة","Save stock change":"حفظ تغيير المخزون","Stock changes":"تغييرات المخزون",
"Chronic patients":"المرضى المزمنين","Medicines short for them":"أدوية ناقصة لهم","Order before the pickup date":"اطلب قبل موعد الاستلام","Patient cards":"بطاقات المرضى","+ Card":"+ بطاقة","Patient name or phone":"اسم المريض أو الهاتف",
"Given this month":"تم الصرف هذا الشهر","Stopped":"متوقف","One full month for all patients":"شهر كامل لكل المرضى","Medicine":"الدواء","Patients":"المرضى","Needed per month":"المطلوب شهرياً","To order":"للطلب",
"New chronic card":"بطاقة مزمن جديدة","Next pickup":"الاستلام القادم","This month":"هذا الشهر","Not given yet":"لم يصرف بعد","Short in stock":"ناقص في المخزون","Give this month's medicines":"اصرف أدوية هذا الشهر","Mark given (no sale)":"سجل كمصروف (بدون بيع)","Mark not given this month":"إلغاء الصرف لهذا الشهر",
"Patient name":"اسم المريض","Pickup day each month (1 to 31)":"يوم الاستلام كل شهر (1 إلى 31)","Active":"فعال","Monthly medicines":"الأدوية الشهرية","Search medicine to add":"ابحث عن دواء لإضافته","Add":"إضافة","Each month":"كل شهر","Notes (doctor, diagnosis, allergies)":"ملاحظات (الطبيب، التشخيص، الحساسية)","Save card":"حفظ البطاقة","Delete card":"حذف البطاقة",
"+ Customer":"+ زبون","Add customer":"إضافة زبون","Bought on debt":"المشتريات بالدين","Still owes":"المتبقي عليه","Customer paid":"الزبون دفع","Save customer":"حفظ الزبون","Purchases":"المشتريات","Cancel":"إلغاء",
"Cash sales":"المبيعات النقدية","Customers paid debt":"تسديد ديون الزبائن","Paid to suppliers in cash":"المدفوع للموردين نقداً","Expenses from the box":"المصاريف من الصندوق","Cash that should be in the box":"النقد المفروض في الصندوق","Sold on debt today (not in the box)":"مبيعات الدين اليوم (ليست في الصندوق)",
"Close the day":"إغلاق اليوم","Cash counted in the box (IQD)":"النقد المعدود في الصندوق (دينار)","Save day close":"حفظ إغلاق اليوم","Update day close":"تحديث إغلاق اليوم","Profit by month":"الأرباح حسب الشهر","Cost of what was sold":"كلفة المباع","Gross profit":"الربح الإجمالي","Expenses":"المصاريف",
"Expired, damaged or lost stock":"مخزون منتهي أو تالف أو مفقود","Net profit":"صافي الربح","Bought from suppliers this month":"المشتريات من الموردين هذا الشهر","+ Expense":"+ مصروف","Add expense":"إضافة مصروف","Paid from the cash box":"مدفوع من الصندوق","Save expense":"حفظ المصروف","No expenses this month.":"لا مصاريف هذا الشهر.",
"Rent":"إيجار","Salaries":"رواتب","Electricity":"كهرباء","Generator":"مولدة","Internet and phone":"إنترنت وهاتف","Transport":"نقل","Cleaning":"تنظيف",
"Pharmacy name on receipts":"اسم الصيدلية على الوصل","Phone on receipts":"الهاتف على الوصل","Warn about chronic pickups this many days ahead":"التنبيه عن استلام المزمنين قبل كم يوم","Save settings":"حفظ الإعدادات","Where your data is":"أين بياناتك","Cloud sync":"المزامنة السحابية","Not connected":"غير متصل",
"Changes waiting to upload":"تغييرات بانتظار الرفع","Sync now":"زامن الآن","Sign out of sync":"خروج من المزامنة","Project URL":"رابط المشروع","Public (anon) key":"المفتاح العام","Email":"البريد","Password":"كلمة المرور","Connect":"اتصال","Backup":"نسخة احتياطية",
"Download full backup":"تنزيل نسخة كاملة","Download Excel":"تنزيل إكسل","Restore from a backup file":"استرجاع من ملف نسخة","Install on phone or computer":"التثبيت على الهاتف أو الحاسوب","Print receipt":"طباعة الوصل","Cancel sale (stock goes back)":"إلغاء البيعة (يرجع المخزون)","Batches used":"الوجبات المستخدمة",
"Cancelled":"ملغاة","Sale saved.":"تم حفظ البيعة.","Item saved.":"تم حفظ المادة.","Stock updated.":"تم تحديث المخزون.","Card saved.":"تم حفظ البطاقة.","Customer saved.":"تم حفظ الزبون.","Expense saved.":"تم حفظ المصروف.","Day closed.":"تم إغلاق اليوم.","Settings saved.":"تم حفظ الإعدادات.","Backup saved.":"تم حفظ النسخة.",
"Screens this person can use":"الشاشات المسموحة لهذا الشخص","Add yourself as the owner first, so you keep every screen. Choose Role: Owner.":"أضف نفسك كمالك أولاً حتى تبقى كل الشاشات لك. اختر الدور: مالك.","There is no owner yet, so everyone sees every screen. Add yourself as the owner (Role: Owner) to protect the owner screens.":"لا يوجد مالك بعد، لذلك يرى الجميع كل الشاشات. أضف نفسك كمالك (الدور: مالك) لحماية شاشات المالك.","New purchase invoice":"فاتورة شراء جديدة","Staff is for the owner only.":"شاشة الموظفين للمالك فقط.","The owner has not given you this screen.":"المالك لم يسمح لك بهذه الشاشة.","The owner has not given you any screens yet. Ask the owner to tick your screens under Staff.":"المالك لم يعطك أي شاشة بعد. اطلب منه تحديد شاشاتك في الموظفين.","A markup must be above −100%.":"النسبة يجب أن تكون أكبر من −100%.","No invoice cost yet":"لا توجد كلفة من فاتورة بعد","Markup % = (Selling price − Cost) ÷ Cost × 100":"نسبة الإضافة % = (سعر البيع − الكلفة) ÷ الكلفة × 100","Selling price = Cost × (1 + Markup)":"سعر البيع = الكلفة × (1 + النسبة)","Margin % = (Selling price − Cost) ÷ Selling price × 100":"هامش الربح % = (سعر البيع − الكلفة) ÷ سعر البيع × 100","Selling price = Cost ÷ (1 − Margin)":"سعر البيع = الكلفة ÷ (1 − الهامش)","Approved":"معتمدة","No opening balance":"لا يوجد رصيد افتتاحي","Data source: this app only. MyPharma is not connected; an invoice shows “In MyPharma” only after you record its MyPharma number.":"مصدر البيانات: هذا التطبيق فقط. MyPharma غير مربوط؛ تظهر الفاتورة «في MyPharma» فقط بعد تسجيل رقمها في MyPharma.",
"Sales ·":"المبيعات ·","sold":"مباعة","prices changed":"أسعار تغيّرت","chronic card":"بطاقة مزمن","not from cash box":"ليس من الصندوق",
"Stock comes from your purchase invoices (paid + bonus, or what you counted in Receiving), minus returns to suppliers, sales and write-offs. Expired batches are not sold.":"المخزون يأتي من فواتير الشراء (المدفوع + البونص، أو ما عددته عند الاستلام)، ناقص المرتجعات للموردين والمبيعات والإتلاف. الوجبات المنتهية لا تُباع.",
"Hours run from login to \"End shift\". Salary: per hour = rate × hours; per day = rate × days worked; monthly = fixed, or shared by hours worked if you tick that option.":"الساعات تُحسب من الدخول حتى «إنهاء الدوام». الراتب: بالساعة = الأجر × الساعات؛ باليوم = الأجر × أيام العمل؛ شهري = ثابت، أو حسب الساعات إذا اخترت ذلك.",
"You are using the claude.ai version. Data is saved online in your Claude account and shared on every device where you open this link. It needs internet. Photo scan works here.":"أنت تستخدم نسخة claude.ai. البيانات محفوظة على الإنترنت في حسابك وتظهر على كل جهاز تفتح فيه هذا الرابط. تحتاج إنترنت. مسح صورة الفاتورة يعمل هنا.",
"Full backup of everything (invoices, payments, stock changes, sales, customers, chronic cards, expenses) as one file. Keep it on another device or in Google Drive.":"نسخة احتياطية كاملة لكل شيء (الفواتير، المدفوعات، تغييرات المخزون، المبيعات، الزبائن، بطاقات المزمنين، المصاريف) في ملف واحد. احفظه على جهاز آخر أو في Google Drive.",
"iPhone:":"آيفون:","Android:":"أندرويد:","Computer:":"الحاسوب:","open the app link in Safari, tap Share, then Add to Home Screen.":"افتح رابط التطبيق في Safari، اضغط مشاركة، ثم إضافة إلى الشاشة الرئيسية.","open the link in Chrome, tap the menu, then Install app.":"افتح الرابط في Chrome، اضغط القائمة، ثم تثبيت التطبيق.","open the link in Chrome or Edge and click the install icon in the address bar.":"افتح الرابط في Chrome أو Edge واضغط أيقونة التثبيت في شريط العنوان.",
"Receipt":"وصل","Markup on cost":"نسبة على الكلفة","Margin: profit as a % of the sell price. Sell = cost ÷ (1 − margin). Example: cost 10,000 with 20% margin sells at 12,500.":"الهامش: الربح كنسبة من سعر البيع. البيع = الكلفة ÷ (1 − الهامش). مثال: كلفة 10,000 بهامش 20% تباع بـ 12,500.","Markup: profit as a % of the cost. Sell = cost × (1 + markup). Example: cost 10,000 with 20% markup sells at 12,000.":"النسبة على الكلفة: الربح كنسبة من الكلفة. البيع = الكلفة × (1 + النسبة). مثال: كلفة 10,000 بنسبة 20% تباع بـ 12,000.","This only fills in the prices below so you can check them. Nothing is saved until you tap Save. Cost is the newest invoice's cost per box after every discount and the bonus.":"هذا يملأ الأسعار أدناه فقط لتراجعها. لا يُحفظ شيء حتى تضغط حفظ. الكلفة هي كلفة العلبة من أحدث فاتورة بعد كل الخصومات والبونص.","Profit margin on sell price":"هامش ربح من سعر البيع","Markup (%)":"النسبة على الكلفة (%)","Profit margin (%)":"هامش الربح (%)","Profit per box":"الربح للعلبة","Markup under 10%":"نسبة أقل من 10%","Margin under 10%":"هامش أقل من 10%","Type the % first.":"اكتب النسبة أولاً.","A profit margin must be under 100%.":"هامش الربح يجب أن يكون أقل من 100%.","Extra stock found at counts":"مخزون زائد وجد بالجرد","Expired, damaged or lost stock (less any found)":"مخزون منتهي أو تالف أو مفقود (ناقص الزائد)","Some sales or stock changes have no cost because the item has no purchase invoice yet, so profit may be a little off.":"بعض المبيعات أو تغييرات المخزون بلا كلفة لأن المادة ليس لها فاتورة شراء بعد، لذلك قد يكون الربح غير دقيق قليلاً.",
"Items":"الأصناف","Expired":"منتهي","Damaged":"تالف","Lost or missing":"مفقود","Count correction (less found)":"تصحيح جرد (وجد أقل)","Count correction (more found)":"تصحيح جرد (وجد أكثر)","Used in pharmacy":"استخدام داخلي","No batch":"بدون وجبة","Scan barcode":"مسح الباركود","Stocktaking":"الجرد","Boxes counted":"العلب المعدودة","Difference":"الفرق","Items counted":"المواد المعدودة","Save count and fix stock":"حفظ الجرد وتصحيح المخزون","Throw away this count":"إلغاء هذا الجرد","Past stocktakes":"الجرود السابقة","Matches ✓":"مطابق ✓","+ Customer":"+ زبون","empty":"فارغة","This week":"هذا الأسبوع","Today":"اليوم","Sold today":"مبيعات اليوم","Sold this week":"مبيعات الأسبوع","Sold this month":"مبيعات الشهر","On debt":"دين","Profit (after cost)":"الربح (بعد الكلفة)","Discounts given":"الخصومات الممنوحة","Top items":"الأكثر مبيعاً","Busy hours":"أوقات الذروة","By day":"حسب اليوم","Receipts":"الوصولات","No receipts yet.":"لا وصولات بعد.","Cash received (IQD)":"المبلغ المستلم (دينار)","Change to give back":"الباقي للزبون","Quick button on Sell":"زر سريع في البيع","Tap a quick button, scan, or search an item to start this sale.":"اضغط زر سريع أو امسح أو ابحث لبدء البيع.","Tap again to close":"اضغط مرة أخرى للإغلاق","Sales":"المبيعات","Menu":"القائمة","Screens":"الشاشات","Scan invoice":"مسح فاتورة","Packaging and prices":"التعبئة والأسعار","Box price (IQD)":"سعر العلبة (دينار)","Middle unit":"الوحدة الوسطى","Price per middle unit (IQD)":"سعر الوحدة الوسطى (دينار)","Smallest unit":"أصغر وحدة","Price per smallest unit (IQD)":"سعر أصغر وحدة (دينار)","None":"لا يوجد","How many in one box":"كم في العلبة","How many in one middle unit":"كم في الوحدة الوسطى","Sell per middle unit":"بيع الوحدة الوسطى","Sell per smallest unit":"بيع أصغر وحدة","Box only":"علبة فقط","Set by you.":"من إعدادك.","Middle unit (strip) price column":"عمود سعر الشريط","Smallest unit price column":"عمود سعر أصغر وحدة","tablet":"حبة","capsule":"كبسولة","strip":"شريط","blister":"شريط","bottle":"قنينة","tube":"أنبوب","ampoule":"أمبولة","vial":"فيال","pen":"قلم","syringe":"سرنجة","suppository":"تحميلة","pessary":"تحميلة مهبلية","sachet":"كيس","needle":"إبرة","piece":"قطعة","Staff":"الموظفين","Live":"مباشر","Pick dates and times":"اختر التاريخ والوقت","From":"من","To":"إلى","Pharmacist":"الصيدلاني","Everyone":"الجميع","Sold in this time":"المبيعات في هذه الفترة","By pharmacist":"حسب الصيدلاني","No login":"بدون تسجيل دخول","Who is working now?":"من يعمل الآن؟","Choose another name":"اختر اسماً آخر","OK":"موافق","Owner":"المالك","Cashier":"كاشير","Lock":"قفل","End shift":"إنهاء الدوام","Tap again to end shift":"اضغط مرة أخرى لإنهاء الدوام","+ Staff":"+ موظف","Add staff":"إضافة موظف","On shift now":"في الدوام الآن","Hours worked":"ساعات العمل","Days worked":"أيام العمل","Sales made":"المبيعات","Salary":"الراتب","Role":"الدور","Owner (sees everything)":"المالك (يرى كل شيء)","PIN (4 to 6 digits)":"الرمز (4 إلى 6 أرقام)","New PIN (leave empty to keep)":"رمز جديد (اتركه فارغاً للإبقاء)","Paid":"الدفع","Per hour":"بالساعة","Per day worked":"باليوم","Monthly salary":"راتب شهري","Rate (IQD)":"المبلغ (دينار)","Expected hours per month (monthly only)":"الساعات المتوقعة شهرياً (للشهري فقط)","Pay monthly salary by hours worked":"احسب الراتب الشهري حسب الساعات","Can log in":"يستطيع الدخول","No shifts this month.":"لا دوام هذا الشهر.","End":"النهاية","+ Add the owner (you)":"+ أضف المالك (أنت)","Staff and shifts":"الموظفين والدوام","Screen locked.":"تم قفل الشاشة.","Wrong PIN. Try again.":"رمز خاطئ. حاول مرة أخرى.","per hour":"بالساعة","per day":"باليوم","monthly":"شهري","Shift end saved.":"تم حفظ نهاية الدوام.","Pricing":"التسعير","Items with a sell price":"مواد لها سعر بيع","Selling below cost":"بيع أقل من الكلفة","Import price file":"استيراد ملف أسعار","Below cost":"أقل من الكلفة","Profit under 10%":"ربح أقل من 10%","Changed, not saved":"معدلة، غير محفوظة","Change many at once":"تعديل عدة مواد معاً","Profit on cost (%)":"الربح على الكلفة (%)","Round to":"التقريب إلى","No rounding":"بدون تقريب","Tick all shown":"تحديد الكل","Untick all":"إلغاء التحديد","Item":"المادة","Cost per box":"كلفة العلبة","Sell per box":"بيع العلبة","Profit":"الربح","Sell per small unit":"بيع الوحدة الصغيرة","box only":"علبة فقط","Undo changes":"تراجع","Import prices":"استيراد الأسعار","Item name column":"عمود اسم المادة","Barcode column":"عمود الباركود","Sell price per box column":"عمود سعر بيع العلبة","Small unit price column":"عمود سعر الوحدة الصغيرة","Not in file":"غير موجود","Matched by barcode":"مطابق بالباركود","Matched by name":"مطابق بالاسم","Close match, please check":"تطابق تقريبي، راجعه","Not in your stock":"غير موجود في مخزونك","Save":"حفظ","In the file":"في الملف","Your item":"مادتك","Now":"الحالي","From file":"من الملف","Not in stock · skip":"غير موجود · تخطي","Check":"راجع","Also save the barcode from the file when the item has none":"احفظ الباركود من الملف إذا لم يكن للمادة باركود","Price history":"سجل الأسعار","Type to search your stock, then tap a medicine":"اكتب للبحث في المخزون ثم اضغط على الدواء","No medicine in stock matches. Add new items under Stock first.":"لا يوجد دواء مطابق. أضف المادة في المخزون أولاً."
});
// these run before the first app's own patterns, which leave part of these lines in English
const arUnit = (n, w) => unitW(w.replace(/s$/, "") + (+n === 1 ? "" : "s"));
AR_RX.unshift([/^Last backup: today by (.+)\.$/, "آخر نسخة احتياطية: اليوم بواسطة $1."], [/^Last backup: (\S+) by (.+)\.$/, "آخر نسخة احتياطية: $1 بواسطة $2."]);
AR_RX.push([/^(.+): receiving not confirmed\.$/, "$1: الاستلام غير مؤكد."], [/^includes (.+) not approved yet$/, "يشمل $1 غير معتمدة بعد"],
  [/^1 box = (\d+) (\w+) × (\d+) (\w+)$/, (m, a, w1, b, w2) => `علبة = ${a} ${arUnit(a, w1)} × ${b} ${arUnit(b, w2)}`], [/^1 box = (\d+) (\w+)$/, (m, a, w) => `علبة = ${a} ${arUnit(a, w)}`],
  [/^Closed by (.+): difference$/, "أُغلق بواسطة $1: الفرق"], [/^Sales \((\d+)\)$/, "المبيعات ($1)"], [/^([A-Z][A-Za-z ]+):$/, (m, k) => AR[k] ? AR[k] + ":" : m],
  [/^(\d+)h (\d+)m$/, "$1 س $2 د"], [/^(\d+) days?$/, "$1 يوم"], [/^(\d+) sales (.+)$/, "$1 مبيعات $2"]);
AR_RX.push([/^Markup (-?[\d.]+%)$/, "نسبة $1"], [/^Margin (-?[\d.]+%|—)$/, "هامش $1"], [/^Example: cost ([\d,]+) and markup (.+): (.+)$/, "مثال: كلفة $1 ونسبة $2: $3"], [/^Example: cost ([\d,]+) and margin (.+): (.+)$/, "مثال: كلفة $1 وهامش $2: $3"], [/^Cost per box ([\d,]+)$/, "كلفة العلبة $1"], [/^(\d+) sales today · (.+)$/, "$1 بيعة اليوم · $2"], [/^Due in (\d+) days$/, "مستحق خلال $1 أيام"], [/^In (\d+) days$/, "بعد $1 أيام"], [/^(\d+) days late$/, "متأخر $1 أيام"], [/^(\d+) short$/, "$1 ناقص"], [/^(\d+) receipts · tap to sell$/, "$1 وصل · اضغط للبيع"],
  [/^Chronic pickups in (\d+) days$/, "استلام المزمنين خلال $1 أيام"], [/^(\d+) medicines short$/, "$1 أدوية ناقصة"], [/^Save sale · (.+)$/, "حفظ البيعة · $1"], [/^Every month on day (\d+) · (\d+) medicines(.*)$/, "كل شهر يوم $1 · $2 أدوية$3"], [/^Cash box today · (.+)$/, "الصندوق اليوم · $1"], [/^Receipt (.+)$/, "وصل $1"], [/^Stocktaking saved\. (\d+) items corrected\.$/, "تم حفظ الجرد. تم تصحيح $1 مادة."], [/^Loose (.+)s$/, "$1 مفردة"], [/^System: (.*)$/, "النظام: $1"], [/^Customer (\d+)$/, "زبون $1"], [/^On shift since$/, "في الدوام منذ"], [/^Hello (.+)\. Enter your PIN to start your shift\.$/, "مرحباً $1. أدخل رمزك لبدء الدوام."], [/^Salaries for (.+)$/, "الرواتب لشهر $1"], [/^(.+) worked$/, "$1 عمل"], [/^Shifts in (.+)$/, "الدوام في $1"], [/^Shift started at (\S+)\. Welcome (.+)\.$/, "بدأ الدوام الساعة $1. أهلاً $2."], [/^Shift ended for (.+)\.$/, "انتهى دوام $1."], [/^(.*) · on shift since (\S+)$/, "$1 · في الدوام منذ $2"], [/^Apply to ticked \((\d+)\)$/, "تطبيق على المحدد ($1)"], [/^Apply to all shown \((\d+)\)$/, "تطبيق على الكل ($1)"], [/^Save (\d+) prices$/, "حفظ $1 سعر"], [/^Save (\d+) prices from the file$/, "حفظ $1 سعر من الملف"], [/^(\d+) prices changed$/, "$1 أسعار معدلة"], [/^No price · (\d+)$/, "بدون سعر · $1"], [/^Below cost · (\d+)$/, "أقل من الكلفة · $1"], [/^Profit under 10% · (\d+)$/, "ربح أقل من 10% · $1"], [/^Changed, not saved · (\d+)$/, "معدلة · $1"], [/^(\d+) prices saved\.$/, "تم حفظ $1 سعر."], [/^(\d+) receipts · average (.+)$/, "$1 وصل · المعدل $2"], [/^(\d+) sold$/, "$1 مباع"], [/^(\d+)% of sales$/, "$1% من المبيعات"], [/^(\d+) cancelled$/, "$1 ملغاة"], [/^No sales (today|this week|this month) yet\.$/, "لا مبيعات بعد."], [/^(\S+) to (\S+)$/, "$1 إلى $2"],
  [/^(\S+) (\S*) · (\d+) items · (Cash|On debt)$/, (m, d, t, n, w) => `${d} ${t} · ${n} مواد · ${w === "Cash" ? "نقد" : "دين"}`], [/^Expiring 3 months · (\d+)$/, "تنتهي خلال 3 أشهر · $1"], [/^Low · (\d+)$/, "قليل · $1"], [/^Refrigerated · (\d+)$/, "براد · $1"], [/^No sell price · (\d+)$/, "بدون سعر · $1"],
  [/^· next expiry (.+)$/, "· أقرب انتهاء $1"], [/^(.*) · next expiry (\S+)(.*)$/, "$1 · أقرب انتهاء $2$3"], [/^(.*) in stock · exp (\S+)$/, "$1 في المخزون · ينتهي $2"], [/^(.*) in stock$/, "$1 في المخزون"]);
AR_RX.push([/^This line can't be removed because it has (sales|stock changes|a return to the supplier)\. Cancel those first, or correct the line instead\.$/, (m, w) => `لا يمكن حذف هذا السطر لأن عليه ${w === "sales" ? "مبيعات" : w === "stock changes" ? "تغييرات مخزون" : "إرجاع للمورد"}. ألغها أولاً أو صحح السطر بدلاً من ذلك.`]);
Object.assign(AR, {"Owner approval needed":"تحتاج موافقة المالك","Not saved: this needs the owner's approval.":"لم يُحفظ: يحتاج موافقة المالك.","Confirm cancel":"تأكيد الإلغاء","Reason for cancelling":"سبب الإلغاء","Write the reason for cancelling.":"اكتب سبب الإلغاء.","Tap again to cancel":"اضغط مرة أخرى للإلغاء","Only the owner can do this.":"هذا للمالك فقط.","PIN is 4 to 6 digits.":"الرمز من 4 إلى 6 أرقام.","Discount staff may give without your PIN (% of the receipt)":"الخصم المسموح للموظف بدون رمزك (% من الوصل)","Staff also need your PIN to sell below the set price, sell more than the stock shows, cancel a sale or payment or expense, write off or add stock, and save a stocktake.":"يحتاج الموظف رمزك أيضاً للبيع بأقل من السعر المحدد، والبيع أكثر من المخزون، وإلغاء بيعة أو دفعة أو مصروف، وشطب أو إضافة مخزون، وحفظ الجرد."});
AR_RX.push([/^Wrong PIN\. (\d+) tries left\.$/, "رمز خاطئ. بقيت $1 محاولات."], [/^Too many wrong PINs\. Try again in (\d+) seconds\.$/, "محاولات خاطئة كثيرة. حاول بعد $1 ثانية."], [/^(.+), enter your PIN to allow this\.$/, "$1، أدخل رمزك للسماح بهذا."], [/^Cancelled: (.+)$/, "ملغاة: $1"]);
Object.assign(AR, {"Restore backup":"استرجاع نسخة","Backup made":"تاريخ النسخة","Missing here, will be added":"غير موجودة هنا، ستُضاف","Newer in the file, will replace":"أحدث في الملف، ستُستبدل","Changed or cancelled here after the backup, kept":"تغيرت أو أُلغيت هنا بعد النسخة، تبقى كما هي","Already the same":"متطابقة","Nothing is deleted. Records you changed or cancelled after this backup stay as they are.":"لا يُحذف شيء. السجلات التي غيرتها أو ألغيتها بعد هذه النسخة تبقى كما هي.","You see what will change before anything is saved. Nothing is deleted, and nothing you changed or cancelled after the backup is undone.":"ترى ما سيتغير قبل الحفظ. لا يُحذف شيء، ولا يُلغى ما غيرته أو ألغيته بعد النسخة."});
AR_RX.push([/^Restore (\d+) records$/, "استرجاع $1 سجل"], [/^Restored (\d+) records\.$/, "تم استرجاع $1 سجل."]);
Object.assign(AR, {"Changes after closing (new sales, payments, cancels)":"تغييرات بعد الإغلاق (مبيعات ودفعات وإلغاءات جديدة)","Change today's day close":"تعديل إغلاق اليوم","That day is already closed. Use today's date.":"هذا اليوم مغلق. استخدم تاريخ اليوم.","Only the owner can approve invoices.":"اعتماد الفواتير للمالك فقط."});
AR_RX.push([/^This is more than the customer owes \((.+)\)\. Tap Save payment again to keep the extra as the customer's credit\.$/, "هذا أكثر مما على الزبون ($1). اضغط حفظ الدفعة مرة أخرى لإبقاء الزيادة رصيداً للزبون."], [/^This invoice can't be put on hold because a line it has (sales|stock changes|a return to the supplier)\.$/, (m, w) => `لا يمكن إيقاف هذه الفاتورة لأن أحد سطورها عليه ${w === "sales" ? "مبيعات" : w === "stock changes" ? "تغييرات مخزون" : "إرجاع للمورد"}.`]);
Object.assign(AR, {"Name, dose, barcode":"الاسم، الجرعة، الباركود","Scan into this box":"امسح الباركود هنا","Enter price":"أدخل السعر","Customers":"الزبائن","Prefilled syringe":"سرنجة جاهزة","Pen":"قلم","Tablet":"حبوب","Ampoule":"أمبولة","Vial":"فيال","Suppository":"تحاميل","Pessary":"تحاميل مهبلية","Eye drops":"قطرة عين","Eye gel":"جل عين","Needle":"إبر","Vaginal capsule":"كبسول مهبلي"});
Object.assign(AR, {"Fill lines from Excel or CSV":"تعبئة الأسطر من ملف إكسل أو CSV","Fill from Excel or CSV":"تعبئة من ملف إكسل أو CSV","Check invoice from file":"راجع الفاتورة من الملف","Please check":"يرجى المراجعة","Flagged when filled from the file":"ملاحظات عند التعبئة من الملف",
  "Fill invoice from a file":"تعبئة الفاتورة من ملف","Fill count from a file":"تعبئة الجرد من ملف","Bonus qty column":"عمود كمية البونص","Discount % column":"عمود نسبة الخصم","Discount (IQD) column":"عمود الخصم (دينار)","Expiry column":"عمود الانتهاء","Batch column":"عمود الوجبة","Refrigerated column":"عمود البراد",
  "Line value column":"عمود قيمة السطر","Unit price column":"عمود سعر الوحدة","Paid qty column":"عمود الكمية المدفوعة","Product column":"عمود المادة","Count column":"عمود العدد","Loose small units column":"عمود الوحدات الصغيرة المفردة","Invoice lines":"أسطر الفاتورة",
  "Bonus rows joined to the line above":"أسطر بونص أضيفت للسطر الذي فوقها","Empty or total rows left out":"أسطر فارغة أو مجاميع تُركت","Lines with no price":"أسطر بدون سعر","Lines with no batch":"أسطر بدون وجبة","Lines with no expiry":"أسطر بدون تاريخ انتهاء","Qty":"الكمية","Value":"القيمة",
  "Back to the invoice":"رجوع إلى الفاتورة","Back to the count":"رجوع إلى الجرد","The count column is in":"عمود العدد بوحدة","Boxes":"علب","Smallest units (tablets, pieces)":"أصغر وحدة (حبة، قطعة)","Use":"استخدام","System":"النظام","Counted":"المعدود","No count in the row":"لا يوجد عدد في السطر",
  "No lines found. Check the Product and Paid qty columns.":"لم توجد أسطر. راجع عمود المادة وعمود الكمية.","Showing the first 60 lines. All of them go into the invoice.":"تظهر أول 60 سطراً. كلها تدخل في الفاتورة.",
  "Showing the first 400 rows. All ticked rows are still used.":"تظهر أول 400 سطر. كل الأسطر المحددة تُستخدم.","No value in the file; no matching priced line above":"لا قيمة في الملف؛ ولا يوجد سطر مسعّر مطابق فوقه"});
const arRow = t => t.replace(/^Row (\d+): qty ([\d.]+) with no value = bonus$/, "السطر $1: كمية $2 بدون قيمة = بونص").replace(/^Row (\d+): no product name\.$/, "السطر $1: لا يوجد اسم مادة.").replace(/^Row (\d+): expiry "(.*)" not understood, left blank\.$/, "السطر $1: تاريخ الانتهاء «$2» غير مفهوم، تُرك فارغاً.");
// a "• " list item is translated like the same text without the dot
AR_RX.unshift([/^• (.+)$/, (m, t) => { const x = trOne(t); return x === null ? m : "• " + x; }], [/^Row \d+: .+$/, t => { const x = t.split(" · ").map(arRow).join(" · "); return x === t ? t : x; }],
  [/^(.+) · (\d+) rows\. Check which column is which\. Nothing is saved now: the lines go into the invoice form, where you check them against the paper and tap Save\.$/, "$1 · $2 سطر. تأكد من كل عمود. لا يُحفظ شيء الآن: الأسطر تدخل في نموذج الفاتورة، حيث تراجعها مع الورقة ثم تضغط حفظ."],
  [/^(.+) · (\d+) rows\. Check which column is which, then check the matches\. Ticked rows go into the count; you still check them and the owner saves the count\.$/, "$1 · $2 سطر. تأكد من كل عمود ثم راجع المطابقات. الأسطر المحددة تدخل في الجرد؛ تراجعها ثم يحفظ المالك الجرد."],
  [/^Filled from the file (.*)\. Check every line against the paper invoice before saving\. Blank prices, batches and expiry dates stay blank until you type them\. Nothing is saved until you tap Save\.$/, "عُبئت من الملف $1. راجع كل سطر مع الفاتورة الورقية قبل الحفظ. الأسعار والوجبات وتواريخ الانتهاء الفارغة تبقى فارغة حتى تكتبها. لا يُحفظ شيء حتى تضغط حفظ."],
  [/^Put (\d+) lines into the invoice$/, "إدخال $1 سطر في الفاتورة"], [/^Put (\d+) items into the count$/, "إدخال $1 مادة في الجرد"],
  [/^(\d+) lines filled in from the file\. Check them, then tap Save invoice\.$/, "عُبئ $1 سطر من الملف. راجعها ثم اضغط حفظ الفاتورة."], [/^(\d+) items filled in from the file\. Check them, then save the count\.$/, "عُبئت $1 مادة من الملف. راجعها ثم احفظ الجرد."]);
Object.assign(AR, {"Allow selling on debt (دين)":"السماح بالبيع بالدين","Return items":"إرجاع مواد","Returns":"المرتجعات","Save return":"حفظ الإرجاع","What happens to the items":"ماذا يحصل للمواد","Back on the shelf (stock goes back)":"تعود للرف (يرجع المخزون)","Damaged or opened (stock stays out)":"تالفة أو مفتوحة (لا يرجع المخزون)","Reason":"السبب","Customer return":"إرجاع من زبون","Customer return (damaged)":"إرجاع من زبون (تالف)","The refund comes off the customer's debt.":"المبلغ المرجع يُخصم من دين الزبون.","The refund is paid from the cash box.":"المبلغ المرجع يُدفع من الصندوق.","Needs the owner's PIN.":"يحتاج رمز المالك.","Enter how many come back.":"أدخل الكمية المرجعة.","Write the reason for the return.":"اكتب سبب الإرجاع.","Items from this receipt were already returned. Return the rest instead of cancelling.":"أُرجعت مواد من هذا الوصل. أرجع الباقي بدلاً من الإلغاء.","Customer (optional)":"الزبون (اختياري)","No customer":"بدون زبون","Cash":"نقد","Change":"الباقي","No expiry date":"بدون تاريخ انتهاء","Keys: F2 search · ↑ ↓ results · F4 unit · + − quantity · F9 save · F10 print":"المفاتيح: F2 بحث · ↑ ↓ النتائج · F4 الوحدة · + − الكمية · F9 حفظ · F10 طباعة","Today's cash box is already closed. Sales saved now show under \"Changes after closing\" in Money.":"صندوق اليوم مغلق. المبيعات التي تُحفظ الآن تظهر تحت \"تغييرات بعد الإغلاق\" في الحسابات."});
AR_RX.push([/^(.+): the quantity must be a whole number\. To sell part of a box, choose the strip or tablet unit\.$/, "$1: الكمية يجب أن تكون عدداً صحيحاً. لبيع جزء من العلبة اختر الشريط أو الحبة."], [/^Cash received \(([\d,]+) IQD\) is less than the total \(([\d,]+) IQD\)\. Take the rest, or choose "On debt"\.$/, "النقد المستلم ($1 دينار) أقل من المجموع ($2 دينار). استلم الباقي أو اختر \"دين\"."], [/^Return saved\. Refund (.+)\.$/, "حُفظ الإرجاع. المبلغ المرجع $1."], [/^Returns −(.+)$/, "مرتجعات −$1"], [/^(.+) has no set price \(sold at ([\d,]+) IQD\)$/, "$1 بدون سعر محدد (بيع بـ $2 دينار)"], [/^sold$/, "مباع"], [/^can still come back$/, "يمكن إرجاعها"]);
Object.assign(AR, {"Owner: sell anyway (owner PIN)":"المالك: بِع على أي حال (رمز المالك)","Out of stock":"نافد","Stock history":"حركة المخزون","Came in":"وارد","Sold":"مباع","Sold, then cancelled":"مباع ثم أُلغي","Returned to supplier":"مرتجع للمورد","Stocktake":"جرد",
  "Stock alerts":"تنبيهات المخزون","Stock below zero":"مخزون تحت الصفر","Low stock":"مخزون قليل","Expired stock":"مخزون منتهي","Expiring in 3 months":"ينتهي خلال 3 أشهر","Sales blocked":"مبيعات مُنعت","Sold past the stock":"بيع أكثر من المخزون","Stocktake differences":"فروقات الجرد",
  "Possible duplicate items":"مواد قد تكون مكررة","Stock changes without approval":"تغييرات مخزون بدون موافقة","Cloud sync failed":"فشلت المزامنة السحابية","Sale blocked":"بيع مُنع","Stocktake difference":"فرق جرد","Stock change without approval":"تغيير مخزون بدون موافقة",
  "Do a stocktake for this item.":"اعمل جرداً لهذه المادة.","Restock it, or remove it from open sales.":"أعد تزويدها، أو احذفها من المبيعات المفتوحة.","Order more.":"اطلب كمية أكثر.","Write it off or return it to the supplier.":"أتلفها أو أرجعها للمورد.","Sell it first or return it to the supplier.":"بِعها أولاً أو أرجعها للمورد.","Restock it.":"أعد تزويدها.",
  "Check why: a sale not entered, a loss, or a counting mistake.":"تحقق من السبب: بيع لم يُسجل، أو فقدان، أو خطأ في العد.","Open each item and check the pack size; if they are the same, use one name on new invoices.":"افتح كل مادة وتحقق من حجم العبوة؛ إذا كانت نفسها فاستخدم اسماً واحداً في الفواتير الجديدة.",
  "Check this change with the person who made it.":"راجع هذا التغيير مع الشخص الذي قام به.","Open Settings and tap Sync now.":"افتح الإعدادات واضغط مزامنة الآن.","Stock alerts on Home":"تنبيهات المخزون في الرئيسية","Low stock uses \"Alert when below\" on each item.":"المخزون القليل يعتمد على «نبّه عندما يقل عن» في كل مادة.",
  "No alerts.":"لا توجد تنبيهات.","Showing the first 300.":"تظهر أول 300.","Showing the newest 60. The Excel download has all of them.":"تظهر أحدث 60. ملف الإكسل فيه الكل.","Is this an item you already have?":"هل هذه مادة موجودة عندك؟","Choose…":"اختر…","A new item":"مادة جديدة",
  "Choose for each line, then tap Save again.":"اختر لكل سطر ثم اضغط حفظ مرة أخرى.","past the stock, owner approved":"أكثر من المخزون، بموافقة المالك","not confirmed yet":"غير مؤكد بعد","approved":"بموافقة",
  "Staff also need your PIN to sell below the set price, cancel a sale or payment or expense, write off or add stock, and save a stocktake. Nobody can sell more than the stock shows; only the owner can, with the owner PIN.":"يحتاج الموظفون رمزك للبيع بأقل من السعر المحدد، وإلغاء بيعة أو دفعة أو مصروف، وإتلاف أو إضافة مخزون، وحفظ الجرد. لا أحد يستطيع البيع أكثر من المخزون؛ المالك فقط برمز المالك."});
const arShort = (n, a, tail) => `${n}: ${a}. لا يمكن إكمال هذا البيع. ${tail}`;
AR_RX.unshift([/^(.+): OUT OF STOCK — Available quantity: 0\. This sale cannot be completed\. Restock the item or remove it from the invoice\.$/, (m, n) => arShort(n, "نفد من المخزون — الكمية المتوفرة: 0", "أعد تزويد المادة أو احذفها من الفاتورة.")],
  [/^(.+): NOT ENOUGH STOCK — Available quantity: (.+)\. This sale cannot be completed\. Lower the quantity or remove the item from the invoice\.$/, (m, n, q) => arShort(n, `المخزون غير كافٍ — الكمية المتوفرة: ${q}`, "قلّل الكمية أو احذف المادة من الفاتورة.")],
  [/^Only (.+) left in this batch\. Stock can't go below zero\.$/, "بقي $1 فقط في هذه الوجبة. لا يمكن أن ينزل المخزون تحت الصفر."], [/^Only (.+) left in stock\. Stock can't go below zero\.$/, "بقي $1 فقط في المخزون. لا يمكن أن ينزل المخزون تحت الصفر."],
  [/^Line (\d+) \((.*)\): (.+) already sold, written off or returned\. Paid \+ bonus can't be less than that\. Cancel those first\.$/, "السطر $1 ($2): تم بيع أو إتلاف أو إرجاع $3. لا يمكن أن يكون المدفوع + البونص أقل من ذلك. ألغها أولاً."],
  [/^(.+): (.+) already sold or written off\. The usable received quantity can't be less than that\.$/, "$1: تم بيع أو إتلاف $2. لا يمكن أن تكون الكمية المستلمة الصالحة أقل من ذلك."],
  [/^(.+): only (\d+) left from this invoice line \(the rest was sold or written off\)\. Stock can't go below zero\.$/, "$1: بقي $2 فقط من هذا السطر (الباقي بيع أو أُتلف). لا يمكن أن ينزل المخزون تحت الصفر."],
  [/^Same item as (.+)$/, "نفس المادة: $1"], [/^Line (\d+): (.+)$/, "السطر $1: $2"], [/^See all (\d+)$/, "عرض الكل $1"], [/^last bought (.+)$/, "آخر شراء $1"], [/^alert below (\d+) boxes$/, "تنبيه تحت $1 علب"], [/^batch (.+)$/, "وجبة $1"],
  [/^· (You have never downloaded a backup\.|Last backup (\d+) days ago\.) Download the Excel file weekly( \(today is Friday\))?\.$/, (m, a, d, f) => `· ${d ? `آخر نسخة احتياطية قبل ${d} يوم.` : "لم تحفظ نسخة احتياطية بعد."} حمّل ملف الإكسل كل أسبوع${f ? " (اليوم الجمعة)" : ""}.`],
  [/^receipt (.+)$/, "وصل $1"], [/^approved by (.+)$/, "بموافقة $1"], [/^([^·]+) wanted$/, "المطلوب $1"], [/^([^·]+) available$/, "المتوفر $1"], [/^(\d+) items$/, "$1 مواد"], [/^counted (.+), system (.+)$/, "المعدود $1، النظام $2"]);
window.addEventListener("online", () => $("#netDot")?.classList.remove("off")); window.addEventListener("offline", () => $("#netDot")?.classList.add("off"));
// every record written while someone is signed in carries their name and the time
const baseWrite = write;
write = async function(path, data, merge){ clearMemo(); if (data && typeof data === "object" && S.staff) data = {...data, staffBy:S.staff.id, staffByName:S.staff.name, staffAt:nowIso()}; try { return await baseWrite(path, data, merge); } finally { clearMemo(); } };
// pages scroll inside the middle area now, so "go to top" scrolls that area
window.scrollTo = function(){ const v = document.getElementById("view"); if (v) v.scrollTop = 0; };
let lastTabERP = null;
const baseRenderERP = render;
render = window.render = function(){
  clearMemo();
  const navBtns = [...document.querySelectorAll("nav.tabs [data-tab]")];
  navBtns.forEach(b => { b.hidden = !canUse(b.dataset.tab); });
  if (!canUse(S.tab)){ S.tab = navBtns.find(b => !b.hidden)?.dataset.tab || "none"; }
  document.body.classList.toggle("no-newinv", !canUse("newinv"));
  const tb = document.querySelector(`nav.tabs [data-tab="${S.tab}"]`), st = $("#scrTitle"); if (st && tb && st.textContent !== tb.textContent) st.textContent = tb.textContent;
  $("#netDot")?.classList.toggle("off", !navigator.onLine);
  let bar = $("#staffBar"); if (!bar){ bar = document.createElement("div"); bar.id = "staffBar"; $("header.top").appendChild(bar); }
  const sh = S.session && E.shifts.find(x => x.id === S.session.shiftId);
  bar.innerHTML = S.staff ? `<div class="in2"><span class="who"><span class="av" aria-hidden="true">${esc(S.staff.name.trim().split(/\s+/).map(w => w[0]).join("").slice(0,2).toUpperCase())}</span><b>${esc(S.staff.name)}</b><span class="t">On shift since <span class="num">${esc(hm(sh?.start))}</span></span></span><span class="clock num" id="topClock">${esc(localDT(nowIso()).replace("T", " "))}</span><span class="actions">${sh && !isNum(sh.openCount) ? `<button type="button" class="primary" data-xcountopen="1">Count cash</button>` : ""}<button type="button" data-xlock="1">Lock</button><button type="button" class="danger" data-xendshift="1">End shift</button></span></div>` : "";
  if (S.lang === "ar") translate(bar);
  const r = baseRenderERP.apply(this, arguments); drawLock();
  if (S.tab !== lastTabERP){ lastTabERP = S.tab; window.scrollTo(0, 0); document.querySelector(`nav.tabs [data-tab="${S.tab}"]`)?.scrollIntoView({block:"nearest", inline:"nearest"}); }
  return r;
};

/* ---------- live data for the new modules ---------- */
/* pop-up windows stay still: when one is already open and its content changes (a choice, a save, a list update),
   only the inside is replaced, at the same scroll place, with no slide or fade again */
const rawOpenSheet = openSheet;
const stillSheets = () => { const animatedOpen = openSheet;
  window.openSheet = openSheet = function(title, html){ const sh = $("#sheet"), panel = sh?.querySelector(".panel");
    if (!sh || sh.hidden) { sh?.classList.remove("stay"); return animatedOpen.apply(this, arguments); }
    const top = panel ? panel.scrollTop : 0; sh.classList.add("stay"); const r = rawOpenSheet.apply(this, arguments); if (panel) panel.scrollTop = top; return r; };
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", stillSheets); else setTimeout(stillSheets, 0); // after the motion script has wrapped openSheet
// changes that arrive together are drawn once, on the next frame, so the screen does not flicker
let renderQueued = false;
const queueRender = () => { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); };
(function start(){
  const map = {staff:"staff", shifts:"shifts", counts:"counts", products:"prods", sales:"sales", moves:"moves", customers:"customers", custpays:"custpays", chronic:"chronic", expenses:"expenses", closes:"closes", events:"events"};
  const total = Object.keys(map).length, got = new Set();
  const progress = () => { const B = window.BOOT; if (!B || B.done) return; B.set(15 + (S.ready ? 35 : 0) + 50 * got.size / total);
    if (S.ready && (got.size === total || !S.db)){ staffAfterData(); render(); B.finish(); } };
  if (!S.db){ if (S.ready && window.BOOT && !BOOT.done && BOOT.ms() > 1500) progress(); else window.BOOT?.set(15 + (S.ready ? 35 : 0)); if ((window.ERP_WAIT = (window.ERP_WAIT || 0) + 1) < 400) setTimeout(start, 25); return; }
  for (const [coll, key] of Object.entries(map)) S.db.collection(coll).onSnapshot(s => { E[key] = s.docs.map(d => ({id:d.id, ...d.data()})); clearMemo(); if (coll === "staff" || coll === "shifts") staffAfterData();
    if (!got.has(coll)){ got.add(coll); progress(); } else queueRender(); }, () => { got.add(coll); progress(); });
  const waitBase = () => { if (!window.BOOT || BOOT.done) return; progress(); if (!S.ready) setTimeout(waitBase, 50); }; waitBase();
  S.db.collection("meta").onSnapshot(s => { const d = s.docs.find(x => x.id === "erp"); E.cfg = d ? d.data() : {}; }, () => {});
})();
Object.assign(AR, {"Count the cash: start of shift":"عدّ النقد: بداية الدوام","Count the cash: end of shift":"عدّ النقد: نهاية الدوام","Counted at the start":"المعدود في البداية","Not counted":"لم يُعدّ","Cash sales":"مبيعات نقدية","Customer payments":"دفعات الزبائن","Cash given back for returns":"نقد مُرجع للزبائن","Expenses paid from the drawer":"مصاريف من الصندوق","Supplier payments in cash":"دفعات نقدية للموردين","Should be in the drawer":"المفروض في الصندوق","Not known yet":"غير معروف بعد","Cash you counted (IQD)":"النقد الذي عددته (دينار)","Count every note in the drawer. The owner sees any difference.":"عدّ كل الأوراق في الصندوق. المالك يرى أي فرق.","Count the drawer before you sell. The owner sees any difference.":"عدّ الصندوق قبل البيع. المالك يرى أي فرق.","Save count and end shift":"حفظ العد وإنهاء الدوام","Save count":"حفظ العد","Count cash":"عدّ النقد","Type the cash you counted.":"اكتب النقد الذي عددته.","Cash count saved.":"تم حفظ عد النقد."});
AR_RX.push([/^Short by (.+)$/, "ناقص $1"], [/^Extra (.+)$/, "زيادة $1"], [/^Cash count saved\. Short by (.+)\.$/, "تم حفظ العد. ناقص $1."], [/^Cash count saved\. Extra (.+)\.$/, "تم حفظ العد. زيادة $1."], [/^Cash at start: (.+?)( · .+)?$/, (m, a, b) => "النقد في البداية: " + a + (b ? " · " + (trOne(b.slice(3)) ?? b.slice(3)) : "")], [/^Cash at end: (.+?)( · .+)?$/, (m, a, b) => "النقد في النهاية: " + a + (b ? " · " + (trOne(b.slice(3)) ?? b.slice(3)) : "")], [/^(\d+) cash counts? did not match this month\. Open the person below to see each shift\.$/, "$1 عدّ نقد غير مطابق هذا الشهر. افتح اسم الموظف أدناه لرؤية كل دوام."]);
