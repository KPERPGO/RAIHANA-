// Local stand-ins for RxNorm, RxClass and openFDA, answering in their documented formats. Every medicine and number here is made up
// (testamycin, testalanate, ...) so no real dose is ever used or checked. mode.down = true answers 500, mode.slow = true never answers.
const http = require('http');
const IN = { '900001': 'testamycin', '900002': 'testalanate', '900030': 'testamycine' };
const C = {
  '900001': { name: 'testamycin', tty: 'IN', rel: { IN: ['900001'], BN: [['900050', 'Testabrand']] } },
  '900030': { name: 'testamycine', tty: 'IN', rel: { IN: ['900030'] } },
  '900010': { name: 'testamycin 50 MG/ML Oral Suspension', tty: 'SCD', rel: { IN: ['900001'], SCDC: [['900060', 'testamycin 50 MG/ML']], DF: [['1', 'Oral Suspension']] } },
  '900011': { name: 'testamycin 50 MG/ML Oral Suspension [Testabrand]', tty: 'SBD', rel: { IN: ['900001'], SCDC: [['900060', 'testamycin 50 MG/ML']], DF: [['1', 'Oral Suspension']], BN: [['900050', 'Testabrand']] } },
  '900012': { name: 'testamycin 500 MG Oral Tablet', tty: 'SCD', rel: { IN: ['900001'], SCDC: [['900061', 'testamycin 500 MG']], DF: [['2', 'Oral Tablet']] } },
  '900013': { name: 'testamycin 500 MG Extended Release Oral Tablet', tty: 'SCD', rel: { IN: ['900001'], SCDC: [['900061', 'testamycin 500 MG']], DF: [['3', 'Extended Release Oral Tablet']] } },
  '900021': { name: 'testamycin 80 MG/ML / testalanate 11.4 MG/ML Oral Suspension', tty: 'SCD', rel: { IN: ['900001', '900002'], SCDC: [['900062', 'testamycin 80 MG/ML'], ['900063', 'testalanate 11.4 MG/ML']], DF: [['1', 'Oral Suspension']] } }
};
const byName = { testamycin: ['900010', '900011', '900012', '900013'], testabrand: ['900011'], 'testamycin + testalanate': ['900021'], testamycine: [] };
const approx = { testamycin: ['900001', '900030'], testamicin: ['900001'], testabrand: ['900011'], testamycine: ['900030', '900001'], 'testamycin + testalanate': ['900021'] };
const label = (generic, pharm, dosing, date) => ({ set_id: 'set-' + generic, effective_time: date || '20240101', openfda: { generic_name: [generic.toUpperCase()], brand_name: ['Brand' + generic], pharm_class_epc: [pharm] }, dosage_and_administration: [dosing], contraindications: ['Test contra for ' + generic + '.'], boxed_warning: ['Test boxed warning.'], pregnancy: ['Test pregnancy text.'], pediatric_use: ['Test children text.'], geriatric_use: ['Test elderly text.'] });
const LABELS = { testamycin: label('testamycin', 'Imaginary Class [EPC]', 'Adults: 500 mg every 8 hours. Children: 25 to 45 mg/kg/day in divided doses every 12 hours. Infants: 10 mg/kg every 6 hours.') };
function start(port, mode = {}) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json');
    const u = new URL(req.url, 'http://x'), p = u.pathname, q = (k) => (u.searchParams.get(k) || '').toLowerCase(); hits.push(p + u.search);
    if (mode.slow) return; if (mode.down) { res.statusCode = 500; return res.end('{}'); }
    const send = (j) => res.end(JSON.stringify(j));
    if (p === '/REST/approximateTerm.json') return send({ approximateGroup: { inputTerm: null, candidate: (approx[q('term')] || []).map((id, i) => ({ rxcui: id, rxaui: '1', score: String(10 - i), rank: String(i + 1), name: C[id].name, source: 'RXNORM' })) } });
    if (p === '/REST/drugs.json') { const ids = byName[q('name')] || []; const g = {}; ids.forEach((id) => { (g[C[id].tty] = g[C[id].tty] || []).push({ rxcui: id, name: C[id].name, tty: C[id].tty }); });
      return send({ drugGroup: { name: null, conceptGroup: Object.entries(g).map(([tty, cp]) => ({ tty, conceptProperties: cp })) } }); }
    if (p === '/REST/spellingsuggestions.json') return send({ suggestionGroup: { name: q('name'), suggestionList: q('name') === 'tstamycin' ? { suggestion: ['testamycin'] } : null } });
    let m;
    if ((m = p.match(/^\/REST\/rxcui\/(\d+)\/properties\.json$/))) return send(C[m[1]] ? { properties: { rxcui: m[1], name: C[m[1]].name, tty: C[m[1]].tty } } : {});
    if ((m = p.match(/^\/REST\/rxcui\/(\d+)\/allrelated\.json$/))) { const c = C[m[1]]; if (!c) return send({ allRelatedGroup: { rxcui: m[1], conceptGroup: [] } });
      const grp = Object.entries(c.rel).map(([tty, list]) => ({ tty, conceptProperties: list.map((x) => Array.isArray(x) ? { rxcui: x[0], name: x[1], tty } : { rxcui: x, name: IN[x], tty }) }));
      return send({ allRelatedGroup: { rxcui: m[1], conceptGroup: grp } }); }
    if (p === '/REST/rxclass/class/byRxcui.json') return send(u.searchParams.get('rxcui') === '900001' ? { rxclassDrugInfoList: { rxclassDrugInfo: [{ minConcept: { rxcui: '900001', name: 'testamycin', tty: 'IN' }, rxclassMinConceptItem: { classId: 'X01', className: 'IMAGINARY AGENTS', classType: 'ATC1-4' }, rela: '', relaSource: 'ATC' }] } } : {});
    if (p === '/drug/label.json') { const s = decodeURIComponent(u.search).toLowerCase(); const k = Object.keys(LABELS).find((n) => s.includes('"' + n + '"')); if (k) return send({ results: [LABELS[k]] }); res.statusCode = 404; return res.end('{}'); }
    res.statusCode = 404; res.end('{}');
  }).listen(port);
  return { srv, hits, mode, LABELS, label, close: () => srv.close() };
}
module.exports = { start };
