// stand-ins for Supabase and web-push; run by t36.js
let handler; globalThis.Deno = {env: {get: k => k === 'SUPABASE_URL' ? 'https://ref.supabase.co' : 'x'}, serve: h => { handler = h; }};
const {T} = await import('./sb.mjs'), {sent} = await import('./wp.mjs'); await import(process.argv[2]);
const call = async (q, body) => { const r = await handler(new Request('https://f/x' + q, body ? {method: 'POST', body: JSON.stringify(body)} : {})); return [r.status, await r.json()]; };
const ok = (m, c, x) => console.log(c ? 'ok  ' : 'FAIL', m, JSON.stringify(x ?? ''));
let r = await call('?do=key'); ok('key made once and returned', r[1].publicKey === 'PUB' && T.erp_push_keys.length === 1 && T.erp_push_keys[0].url === 'https://ref.supabase.co', r);
T.erp_docs.push({path: 'meta/pushnote', data: {title: 'T', short: '2 to order', near: '1 batch to sell first', date: '2000-01-01'}},
  {path: 'meta/pushsub-A', data: {endpoint: 'A', keys: {}, stock: true}}, {path: 'meta/pushsub-B', data: {endpoint: 'B', keys: {}, stock: false}}, {path: 'meta/pushsub-G', data: {endpoint: 'gone', keys: {}, stock: true}});
r = await call('', {}); ok('no token: refused', r[0] === 403, r);
r = await call('', {test: true, endpoint: 'B'}); ok('test goes to that phone only', sent.length === 1 && sent[0][0] === 'B' && /Test/.test(sent[0][1].body), sent);
const tok = T.erp_push_keys[0].token; sent.length = 0;
r = await call('', {token: tok}); ok('daily send: owner gets both parts, cashier only sell-first, old list marked', r[1].sent === 2 && r[1].gone === 1 && /2 to order/.test(sent.find(s => s[0] === 'A')[1].body) && !/to order/.test(sent.find(s => s[0] === 'B')[1].body) && /List from 2000-01-01/.test(sent[0][1].body), {r, sent});
ok('gone phone switched off', T.erp_docs.find(d => d.path === 'meta/pushsub-G').data.off === true);
r = await call('', {token: tok}); ok('second send the same day skipped', /already/.test(r[1].skipped || ''), r);
r = await call('', {test: true, endpoint: 'nobody'}); ok('test for a phone not in the cloud: found 0', r[1].sent === 0 && r[1].found === 0, r);
T.erp_docs.push({path: 'meta/pushsub-X', data: {endpoint: 'bad', keys: {}}});
r = await call('', {test: true, endpoint: 'bad'}); ok('refused send: reason returned', r[1].sent === 0 && r[1].found === 1 && /403 BadJwtToken/.test(r[1].failed[0] || ''), r);
