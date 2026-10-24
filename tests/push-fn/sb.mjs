// stand-in for the Supabase client: tables in memory
export const T = {erp_push_keys: [], erp_docs: []};
export function createClient(){ return {from(t){ let rows = () => T[t], f = [];
  const q = {select(){ return q; }, eq(k, v){ f.push(r => r[k] === v); return q; }, like(k, v){ const re = new RegExp('^' + v.replace('%', '.*') + '$'); f.push(r => re.test(r[k])); return q; },
    get _r(){ return rows().filter(r => f.every(g => g(r))); },
    async maybeSingle(){ return {data: q._r[0] || null, error: null}; }, async single(){ return {data: q._r[0], error: null}; },
    then(res){ return res({data: q._r, error: null}); },
    insert(o){ T[t].push(o); return q; },
    update(o){ return {eq(k, v){ T[t].filter(r => r[k] === v).forEach(r => Object.assign(r, o)); return Promise.resolve({}); }}; } };
  return q; }}; }
