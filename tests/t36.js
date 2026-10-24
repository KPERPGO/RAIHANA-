// The morning notification function (src/supabase-push-function.ts) with Supabase and web-push replaced by stand-ins:
// keys made once, sending needs the token, a test goes to one phone, owners get the shortage list and cashiers only
// the sell-first list, removed phones are switched off, and one send a day
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const dir = path.join(__dirname, 'push-fn'), fn = path.join(dir, 'fn.ts');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'supabase-push-function.ts'), 'utf8')
  .replace(/npm:@supabase\/supabase-js@[\d.]+/, './sb.mjs').replace(/npm:web-push@[\d.]+/, './wp.mjs');
fs.writeFileSync(fn, src);
let out = '';
try { out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(dir, 'run.mjs'), fn], { encoding: 'utf8' }); }
catch (e) { out = (e.stdout || '') + (e.stderr || '') + '\nFAIL the function test crashed'; }
finally { fs.rmSync(fn, { force: true }); }
console.log(out.trim());
const bad = /FAIL/.test(out) || (out.match(/^ok /gm) || []).length < 8;
console.log(bad ? 'SOME FAILED' : 'PASS all push function checks'); process.exit(bad ? 1 : 0);
