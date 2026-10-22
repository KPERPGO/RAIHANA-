#!/bin/sh
# Full check of the built app. Run after `python3 src/build.py` and before every publish.
# Exits non-zero if any test reports FAIL, a page error, a crash or an audit DEFECT.
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT/tests"
APP=$ROOT/dist/app
if [ ! -d "$ROOT/node_modules/xlsx" ] && [ ! -d "$ROOT/tests/node_modules/xlsx" ]; then
  echo "Run 'npm install' in $ROOT first (the tests need the xlsx and playwright packages)."; exit 1
fi
# claude.ai adds <meta charset> around the artifact; do the same so file:// loads never guess the encoding
{ echo '<meta charset="utf-8">'; cat "$ROOT/dist/erp-artifact.html"; } > erp-artifact-test.html
cp frame.html "$APP/frame-test.html"
# the installed-app tests need the app served on port 8765
if ! curl -s -o /dev/null http://localhost:8765/index.html; then
  python3 -m http.server 8765 -d "$APP" >/dev/null 2>&1 & SERVER=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://localhost:8765/index.html && break; sleep 0.5; done
fi
trap 'rm -f "$APP/frame-test.html" erp-artifact-test.html; [ -n "$SERVER" ] && kill $SERVER' EXIT
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
bad=0
for t in t.js t2.js t3.js t4.js t7.js t9.js t10.js t11.js t12.js t13.js t14.js t15.js t16.js t17.js t18.js t19.js t20.js run.js audit-probe.js; do
  out=$(timeout 600 node "$t" 2>&1); code=$?
  if [ $code -ne 0 ] || echo "$out" | grep -qE '(^|[^A-Za-z_])FAIL([^A-Za-z]|$)|PAGEERR|CRASH|DEFECT|TimeoutError'; then
    bad=1; echo "== $t: FAILED"; echo "$out" | grep -E 'FAIL|PAGEERR|CRASH|DEFECT|Error' | head -20
  else
    echo "== $t: ok $(echo "$out" | grep -E 'passed|PASS all' | tail -1)"
  fi
done
[ $bad -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $bad
