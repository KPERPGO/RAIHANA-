// Shared test setup: Playwright, the Chromium to use, and the Excel library file the pages load.
// Works here (preinstalled tools in /opt) and on GitHub Actions (npm install + npx playwright install chromium).
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); } catch { pw = require('./pw'); }
const exe = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const xlsxFile = [path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js')].find(f => fs.existsSync(f));
// the app starts in Arabic on a new device; the tests were written in English, so every page starts with English chosen (tests click the language button to check Arabic)
const english = `try { if (!localStorage.getItem('rp.lang')) localStorage.setItem('rp.lang', '"en"'); } catch (e) {}`;
async function launch(o = {}){
  const b = await pw.chromium.launch({ executablePath: exe, ...o });
  const newContext = b.newContext.bind(b), newPage = b.newPage.bind(b);
  b.newContext = async (opt) => { const c = await newContext(opt); await c.addInitScript(english); return c; };
  b.newPage = async (opt) => { const p = await newPage(opt); await p.context().addInitScript(english); return p; };
  return b;
}
module.exports = { devices: pw.devices, chromium: { launch }, XLSX_FILE: xlsxFile };
