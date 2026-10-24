#!/bin/sh
# Checks src/supabase-setup.sql in a real Postgres (stand-in for Supabase's auth schema): finished records can only
# gain a cancel mark, other records still change normally, and the 23 Oct update script matches the setup file.
# Usage: PGHOST=... PGPORT=... sh tests/sql-lock.sh   (needs psql and a throwaway database server)
export PGOPTIONS="-c client_min_messages=warning"
ROOT=$(cd "$(dirname "$0")/.." && pwd); DB=erp_lock_test
psql -q -U postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null || exit 1
run(){ psql -q -X -U postgres -d $DB -v ON_ERROR_STOP=1 "$@"; }
run <<'SQL' >/dev/null || exit 1
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $f$ select jsonb_build_object('email', current_setting('test.email', true)) $f$;
create function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
SQL
sed "s/PUT-YOUR-EMAIL-HERE/owner@example.com/" "$ROOT/src/supabase-setup.sql" | run >/dev/null || exit 1
run -f "$ROOT/src/supabase-update-2026-10-23.sql" >/dev/null || { echo "FAIL - update script does not run"; exit 1; }
out=$(run -At <<'SQL'
set test.email = 'owner@example.com';
select 'new sale saved: ' || (erp_push('[{"path":"sales/S1","data":{"id":"S1","total":5000,"lines":[1]},"base":0}]')->0->>'ok');
select 'changed total refused: ' || (erp_push(jsonb_build_array(jsonb_build_object('path','sales/S1','data','{"id":"S1","total":1,"lines":[1]}'::jsonb,'base',(select ver from erp_docs where path='sales/S1'))))->0->>'ok');
select 'total still 5000: ' || (select data->>'total' from erp_docs where path='sales/S1');
select 'refusal kept: ' || (select count(*) from erp_conflicts where reason = 'finished record');
select 'delete refused: ' || (erp_push(jsonb_build_array(jsonb_build_object('path','sales/S1','data','{"__deleted":true}'::jsonb,'base',(select ver from erp_docs where path='sales/S1'))))->0->>'ok');
select 'cancel allowed: ' || (erp_push(jsonb_build_array(jsonb_build_object('path','sales/S1','data','{"id":"S1","total":5000,"lines":[1],"voided":true,"voidReason":"x","staffAt":"t","__rev":9}'::jsonb,'base',(select ver from erp_docs where path='sales/S1'))))->0->>'ok');
select 'un-cancel refused: ' || (erp_push(jsonb_build_array(jsonb_build_object('path','sales/S1','data','{"id":"S1","total":5000,"lines":[1],"voided":false}'::jsonb,'base',(select ver from erp_docs where path='sales/S1'))))->0->>'ok');
select 'same data accepted: ' || (erp_push(jsonb_build_array(jsonb_build_object('path','sales/S1','data',(select data from erp_docs where path='sales/S1'),'base',0)))->0->>'ok');
select 'new product saved: ' || (erp_push('[{"path":"prods/P1","data":{"a":1},"base":0}]')->0->>'ok');
select 'product edit allowed: ' || (erp_push(jsonb_build_array(jsonb_build_object('path','prods/P1','data','{"a":2}'::jsonb,'base',(select ver from erp_docs where path='prods/P1'))))->0->>'ok');
select 'stale edit still a conflict: ' || (erp_push('[{"path":"prods/P1","data":{"a":3},"base":1}]')->0->>'ok');
SQL
)
echo "$out"
exp="new sale saved: true
changed total refused: false
total still 5000: 5000
refusal kept: 1
delete refused: false
cancel allowed: true
un-cancel refused: false
same data accepted: true
new product saved: true
product edit allowed: true
stale edit still a conflict: false"
[ "$out" = "$exp" ] && echo "PASS all finished-record checks" || { echo "FAIL - results differ from expected"; exit 1; }
# the update script must carry the same lock and save function as the setup file
fn(){ sed -n "/$2/,/^\\\$\\\$;\|^end \\\$\\\$;/p" "$1"; }
for f in "create or replace function public.erp_locked_change" "create or replace function public.erp_push"; do
  [ "$(fn "$ROOT/src/supabase-setup.sql" "$f")" = "$(fn "$ROOT/src/supabase-update-2026-10-23.sql" "$f")" ] || { echo "FAIL - update script differs from setup: $f"; exit 1; }
done
echo "PASS update script matches setup"
# the morning notification script (24 Oct): runs twice without error, keeps one schedule, and the scheduled call works.
# pg_cron and pg_net are Supabase extensions, so small stand-ins take their place here
run <<'SQL' >/dev/null || exit 1
create schema cron; create schema net; create schema if not exists extensions;
create table cron.job(jobid serial, jobname text, command text);
create function cron.schedule(n text, s text, c text) returns int language sql as $f$ insert into cron.job(jobname, command) values (n, c) returning jobid $f$;
create function cron.unschedule(id int) returns boolean language sql as $f$ delete from cron.job where jobid = id; select true $f$;
create table net.calls(url text, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $f$ insert into net.calls values (url, body); select 1::bigint $f$;
SQL
for i in 1 2; do sed '/create extension/d' "$ROOT/src/supabase-push.sql" | run >/dev/null || { echo "FAIL - push script does not run (time $i)"; exit 1; }; done
out=$(run -At 2>/dev/null <<'SQL'
insert into erp_push_keys values (1, 'pub', 'priv', 'tok', 'https://ref.supabase.co', null);
do $d$ begin execute (select command from cron.job where jobname = 'raihana-daily-push'); end $d$;
select (select count(*) from cron.job) || ' ' || url || ' ' || (body->>'token') from net.calls;
set role authenticated; select count(*) from erp_push_keys; -- must be refused: app users never see the keys
SQL
)
[ "$(echo "$out" | head -1)" = "1 https://ref.supabase.co/functions/v1/daily-stock-push tok" ] && ! echo "$out" | grep -q '^0$\|^1$' && echo "PASS push schedule checks" || { echo "FAIL - push schedule: $out"; exit 1; }
psql -q -U postgres -c "drop database $DB" >/dev/null
