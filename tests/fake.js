// fake claude runtime: in-memory db with live snapshots, user, downloads, sample, assets
(() => {
  const store = {suppliers:{}, invoices:{}, payments:{}, credits:{}, meta:{}};
  const subs = {};
  window.__store = store; window.__saved = []; window.__writes = 0;
  const snap = c => ({docs:Object.entries(store[c]||{}).map(([id,d]) => ({id, data:() => structuredClone(d)}))});
  const notify = c => setTimeout(() => (subs[c]||[]).forEach(f => f(snap(c))), 5);
  const db = {
    collection: c => ({onSnapshot(cb){ (subs[c] = subs[c] || []).push(cb); setTimeout(() => cb(snap(c)), 5); return () => {}; }}),
    doc: path => { const [c, id] = path.split("/"); return {
      async set(d){ if (window.__readonly) throw {code:"invalid_argument"}; window.__writes++; store[c] = store[c] || {}; store[c][id] = structuredClone(d); notify(c); },
      async update(d){ if (window.__readonly) throw {code:"invalid_argument"}; window.__writes++; if (!store[c]?.[id]) throw {code:"not_found"}; store[c][id] = {...store[c][id], ...structuredClone(d)}; notify(c); } }; }
  };
  window.__seed = (c, docs) => { for (const d of docs) store[c][d.id] = structuredClone(d); notify(c); };
  window.__extraction = null;
  const caps = {
    db,
    user: {async can(){ return !window.__readonly; }, async me(){ return {id:"u_test", name:"Owner"}; }, async profiles(ids){ return Object.fromEntries(ids.map(i => [i, {name: i === "u_test" ? "Owner" : "Staff"}])); }},
    downloads: {async save(o){ window.__saved.push({name:o.filename, size:o.data.size, blob:o.data}); return {ok:true}; }},
    sample: {async limits(){ return {images:true}; }, async json(){ return window.__extraction; }},
    assets: {async upload(){ return {id:"0123456789abcdef0123456789abcdef"}; }},
  };
  window.claude = {use: async n => caps[n] || null};
})();
