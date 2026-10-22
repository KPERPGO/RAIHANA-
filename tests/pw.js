// Shared test setup: Playwright, the Chromium to use, and the Excel library file the pages load.
// Works here (preinstalled tools in /opt) and on GitHub Actions (npm install + npx playwright install chromium).
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); } catch { pw = require('./pw'); }
const exe = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const xlsxFile = [path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js')].find(f => fs.existsSync(f));
module.exports = { devices: pw.devices, chromium: { launch: (o = {}) => pw.chromium.launch({ executablePath: exe, ...o }) }, XLSX_FILE: xlsxFile };
