#!/bin/sh
# Phase 1 change history (db/phase1-change-history.sql), tested in a real Postgres on a made-up but realistic pharmacy.
# Proves: the same work gives the same records with and without history; every change is recorded with before/after;
# a broken history never stops a save and leaves a visible gap; tampering is detected; rollback keeps the history.
# Usage: PGHOST=... PGPORT=... sh tests/sql-history.sh   (needs psql, python3 and a throwaway database server)
export PGOPTIONS="-c client_min_messages=error"
ROOT=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d)
q(){ psql -q -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
v(){ q -d "$1" -At -c "$2"; }
ok=0; bad=0; t(){ if [ "$2" = "$3" ]; then echo "PASS $1"; ok=$((ok+1)); else echo "FAIL $1: got [$2] want [$3]"; bad=$((bad+1)); fi; }
fresh(){ q -c "drop database if exists $1" -c "create database $1" >/dev/null
q -d $1 >/dev/null <<'SQL'
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $f$;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(auth.jwt() ->> 'sub', '')::uuid $f$;
SQL
sed "s/PUT-YOUR-EMAIL-HERE/owner@example.com/" "$ROOT/src/supabase-setup.sql" | q -d $1 >/dev/null
q -d $1 -f "$ROOT/src/supabase-update-2026-10-23.sql" >/dev/null
# Supabase gives its service role full rights on public tables; the stand-in does the same for what the Edge Function uses
q -d $1 -c "grant select, update on public.erp_docs to service_role; grant usage on sequence public.erp_ver_seq to service_role" >/dev/null; }
dump(){ v $1 "select md5(string_agg(path || data::text || ver || coalesce(device,'') || coalesce(updated_by::text,''), '|' order by path)) from erp_docs"
        v $1 "select md5(coalesce(string_agg(path || coalesce(mine::text,'') || coalesce(theirs::text,'') || coalesce(reason,''), '|' order by id), '')) from erp_conflicts"; }
python3 "$ROOT/tests/sql-history-data.py" 7 base "$ROOT/tests/fixtures/invoices/PI-2026-0001.json" > $T/base.sql || exit 1
python3 "$ROOT/tests/sql-history-data.py" 7 work > $T/work.sql || exit 1

echo "== a realistic pharmacy, without and with the change history"
fresh hist_a; q -d hist_a -f $T/base.sql >/dev/null || exit 1
fresh hist_b; q -d hist_b -f $T/base.sql >/dev/null || exit 1
N=$(v hist_b "select count(*) from erp_docs"); echo "records: $N ($(v hist_b "select string_agg(k || ' ' || n, ', ' order by n desc) from (select split_part(path,'/',1) k, count(*) n from erp_docs group by 1) s"))"
t "both copies start the same" "$(dump hist_a)" "$(dump hist_b)"
q -d hist_b -f "$ROOT/db/phase1-change-history.sql" >/dev/null || { echo "FAIL phase1 file errors"; exit 1; }
q -d hist_b -f "$ROOT/db/phase1-change-history.sql" >/dev/null || { echo "FAIL phase1 file errors on a second run"; exit 1; }
t "running Phase 1 changed no record and no conflict" "$(dump hist_a)" "$(dump hist_b)"
t "baseline copies every record once, plus the member email (also after a second run)" "$(v hist_b "select count(*) from erp_audit.erp_history where op='BASELINE'")" "$((N + 1))"
t "status COMPLETE after setup" "$(v hist_b "select status from erp_audit.audit_status")" "COMPLETE"
q -d hist_a -f $T/work.sql >/dev/null || exit 1; q -d hist_b -f $T/work.sql >/dev/null || exit 1
t "a day of work gives identical records, versions and conflicts with and without history" "$(dump hist_a)" "$(dump hist_b)"
t "status COMPLETE after a day of work" "$(v hist_b "select status from erp_audit.audit_status")" "COMPLETE"

echo "== what is recorded"
h(){ v hist_b "$1"; }
t "300 new sales recorded as INSERT" "$(h "select count(*) from erp_audit.erp_history where op='INSERT' and record_key like 'sales/SL-WORK%'")" "300"
t "new sale: account, session, device and employee (unverified)" "$(h "select account_email||' '||account_role||' '||account_session||' '||device_unverified||' '||staff_id_unverified||' '||staff_name_unverified from erp_audit.erp_history where record_key='sales/SL-WORK00000'")" "owner@example.com authenticated 8d1c2b3a-0000-4000-8000-000000000002 Dphone ST-MW1ALI Ali ahmed"
t "5 cancels recorded with before (not cancelled) and after (cancelled)" "$(h "select count(*) from erp_audit.erp_history where op='UPDATE' and record_key like 'sales/%' and (old_row->'data'->>'voided') is null and new_row->'data'->>'voided'='true'")" "5"
t "refused change to a finished sale is not in the history" "$(h "select count(*) from erp_audit.erp_history where new_row->'data'->>'total'='1'")" "0"
t "every price change keeps old and new price" "$(h "select count(*) from erp_audit.erp_history where op='UPDATE' and record_key like 'products/%' and (new_row->'data'->>'sellBox')::int = (old_row->'data'->>'sellBox')::int + 250")" "$(h "select least(20, count(*)) from erp_docs where path like 'products/%'")"
t "stale edit from the other device (conflict) is not in the history" "$(h "select count(*) from erp_audit.erp_history where record_key like 'products/%' and new_row->'data'->>'sellBox'='1'")" "0"
t "staff permission change recorded" "$(h "select new_row->'data'->'perms' from erp_audit.erp_history where record_key='staff/ST-MW1ALI' and op='UPDATE'")" '["sell", "newinv", "stock"]'
t "settings change (PIN switch) recorded once; an unchanged save adds nothing" "$(h "select count(*) from erp_audit.erp_history where record_key='meta/erp' and op='UPDATE'")" "1"
t "Edge Function change recorded as service_role" "$(h "select account_role from erp_audit.erp_history where record_key='meta/pushsub-Dphone' and op='UPDATE'")" "service_role"
t "history version equals the record's version" "$(h "select count(*) from erp_docs d where d.ver::text <> (select new_row->>'ver' from erp_audit.erp_history x where x.record_key=d.path order by id desc limit 1)")" "0"
t "time comes from the database, not the device" "$(h "select count(*) from erp_audit.erp_history where at > now() + interval '1 minute' or at < now() - interval '1 hour'")" "0"
q -d hist_b -c "insert into erp_members values ('second@example.com')" -c "delete from erp_members where email='second@example.com'" >/dev/null
t "sign-in email added and removed: both recorded, made in the SQL Editor (postgres)" "$(h "select string_agg(op||':'||db_user||':'||coalesce(account_role,'none'), ',' order by id) from erp_audit.erp_history where record_key='second@example.com'")" "INSERT:postgres:none,DELETE:postgres:none"
q -d hist_b -c "insert into erp_docs(path,data) values ('tmp/x','{\"a\":1}')" -c "delete from erp_docs where path='tmp/x'" >/dev/null
t "a DELETE keeps the whole row before" "$(h "select old_row->'data'->>'a' from erp_audit.erp_history where record_key='tmp/x' and op='DELETE'")" "1"

pushone(){ q -d hist_b -At -c "select set_config('request.jwt.claims','{\"email\":\"owner@example.com\",\"role\":\"authenticated\",\"session_id\":\"s1\"}',false)" -c "set role authenticated" \
  -c "select erp_push('[{\"path\":\"sales/$1\",\"data\":{\"id\":\"$1\",\"total\":9000,\"staffBy\":\"ST-MW1ALI\"},\"base\":0,\"device\":\"Dphone\"}]')->0->>'ok'" | tail -1; }
echo "== protection"
deny(){ q -d hist_b -At -c "set role $1; $2" 2>&1 | grep -c "permission denied"; }
t "app account can't read history" "$(deny authenticated 'select 1 from erp_audit.erp_history limit 1')" "1"
t "app account can't write history" "$(deny authenticated "insert into erp_audit.erp_history(at,tx_id,table_name,op,record_key,db_user,prev_hash,row_hash) values (now(),1,'x','INSERT','x','x','','')")" "1"
t "app account can't read gaps" "$(deny authenticated 'select 1 from erp_audit.erp_audit_gaps')" "1"
t "app account can't run reconcile" "$(deny authenticated "select erp_audit.reconcile('x')")" "1"
t "app account can't write a fake history row" "$(deny authenticated "select erp_audit.append('erp_docs','INSERT','x',null,null)")" "1"
t "public key can't read history" "$(deny anon 'select 1 from erp_audit.erp_history')" "1"
t "Edge Function role can't read history" "$(deny service_role 'select 1 from erp_audit.erp_history')" "1"
grow(){ q -d hist_b -At -c "$1" 2>&1 | grep -c "can only grow"; }
t "owner can't edit history" "$(grow 'update erp_audit.erp_history set op=op')" "1"
t "owner can't delete history" "$(grow 'delete from erp_audit.erp_history')" "1"
hn=$(v hist_b "select count(*) from erp_audit.erp_history"); q -d hist_b -c "truncate erp_audit.erp_history" >/dev/null 2>&1
t "owner can't empty history (refused, every row still there)" "$(v hist_b "select count(*) from erp_audit.erp_history")" "$hn"

echo "== tampering is detected (on a copy)"
pushone SL-TAIL >/dev/null; SEAL=$(v hist_b "select last_seal from erp_audit.audit_status")
q -c "drop database if exists hist_c" -c "create database hist_c template hist_b" >/dev/null
q -d hist_c -c "alter table erp_audit.erp_history disable trigger no_change" -c "update erp_audit.erp_history set new_row = jsonb_set(new_row, '{data,total}', '1') where id = 500" >/dev/null
t "an edited history row breaks the seal" "$(v hist_c "select status||' '||(broken_seals>0) from erp_audit.audit_status")" "INCOMPLETE true"
q -c "drop database if exists hist_c" -c "create database hist_c template hist_b" >/dev/null
q -d hist_c -c "alter table erp_audit.erp_history disable trigger no_change" -c "delete from erp_audit.erp_history where id = 500" >/dev/null
t "a removed history row breaks the seal" "$(v hist_c "select status||' '||(broken_seals>0) from erp_audit.audit_status")" "INCOMPLETE true"
q -c "drop database if exists hist_c" -c "create database hist_c template hist_b" >/dev/null
q -d hist_c -c "alter table erp_audit.erp_history disable trigger no_change" -c "delete from erp_audit.erp_history where id = (select max(id) from erp_audit.erp_history)" >/dev/null
t "cutting off the newest row is found (a record without history)" "$(v hist_c "select status||' '||records_without_history from erp_audit.audit_status")" "INCOMPLETE 1"
t "and the saved seal (anchor) is no longer found" "$(v hist_c "select count(*) from erp_audit.erp_history where row_hash = '$SEAL'")" "0"
q -c "drop database hist_c" >/dev/null

echo "== the history fails: the save still happens and the gap is visible"
q -d hist_b -c "alter table erp_audit.erp_history add constraint test_break check (false) not valid" >/dev/null
t "sale saved although the history failed" "$(pushone SL-GAP1)" "true"
t "the sale is in erp_docs" "$(v hist_b "select data->>'total' from erp_docs where path='sales/SL-GAP1'")" "9000"
t "a gap row keeps the missed values, device and employee (unverified)" "$(v hist_b "select op||' '||(new_row->'data'->>'total')||' '||device_unverified||' '||staff_id_unverified||' '||(error is not null) from erp_audit.erp_audit_gaps where record_key='sales/SL-GAP1'")" "INSERT 9000 Dphone ST-MW1ALI true"
t "status says INCOMPLETE with 1 open gap" "$(v hist_b "select status||' '||open_gaps from erp_audit.audit_status")" "INCOMPLETE 1"
q -d hist_b -c "alter table erp_audit.erp_history drop constraint test_break" >/dev/null
t "still INCOMPLETE after the history works again, until reconciled" "$(v hist_b "select status from erp_audit.audit_status")" "INCOMPLETE"
t "reconcile copies the record and closes the gap" "$(v hist_b "select resynced||' '||gaps_closed from erp_audit.reconcile('test')")" "1 1"
t "status COMPLETE after reconcile" "$(v hist_b "select status from erp_audit.audit_status")" "COMPLETE"
t "the gap row is kept after closing" "$(v hist_b "select count(*) from erp_audit.erp_audit_gaps")" "1"
t "owner can't delete a gap record" "$(grow 'delete from erp_audit.erp_audit_gaps')" "1"
t "owner can't delete a gap closure" "$(grow 'delete from erp_audit.erp_audit_gap_closures')" "1"
echo "== both the history and the gap table fail"
q -d hist_b -c "alter table erp_audit.erp_history add constraint test_break check (false) not valid" -c "alter table erp_audit.erp_audit_gaps add constraint test_break check (false) not valid" >/dev/null
t "sale still saved" "$(pushone SL-GAP2)" "true"
t "no gap row could be written" "$(v hist_b "select count(*) from erp_audit.erp_audit_gaps where record_key='sales/SL-GAP2'")" "0"
q -d hist_b -c "alter table erp_audit.erp_history drop constraint test_break" -c "alter table erp_audit.erp_audit_gaps drop constraint test_break" >/dev/null
t "status still finds it: INCOMPLETE, 1 record without history" "$(v hist_b "select status||' '||records_without_history from erp_audit.audit_status")" "INCOMPLETE 1"
t "reconcile closes it" "$(v hist_b "select resynced from erp_audit.reconcile('test 2')")" "1"
t "status COMPLETE" "$(v hist_b "select status from erp_audit.audit_status")" "COMPLETE"

echo "== two devices saving at the same time"
for d in P1 P2; do ( for i in $(seq 1 40); do pushone "SL-$d-$i" >/dev/null; done ) & done; wait
t "all 80 saved" "$(v hist_b "select count(*) from erp_docs where path ~ '^sales/SL-P[12]-'")" "80"
t "all 80 in history, seal chain intact, COMPLETE" "$(v hist_b "select (select count(*) from erp_audit.erp_history where record_key ~ '^sales/SL-P[12]-')||' '||broken_seals||' '||status from erp_audit.audit_status")" "80 0 COMPLETE"

echo "== check file, rollback, turning it on again"
q -d hist_b -f "$ROOT/db/phase1-check.sql" >/dev/null; t "check file runs" "$?" "0"
n0=$(v hist_b "select count(*) from erp_audit.erp_history")
q -d hist_b -f "$ROOT/db/phase1-rollback.sql" >/dev/null; t "rollback file runs" "$?" "0"
t "rollback adds only the PAUSED note and deletes no history" "$(v hist_b "select count(*) from erp_audit.erp_history")" "$((n0 + 1))"
t "after rollback the app still saves" "$(pushone SL-OFF1)" "true"
t "status says recording is off: INCOMPLETE" "$(v hist_b "select status||' '||recorder_on from erp_audit.audit_status")" "INCOMPLETE false"
q -d hist_b -f "$ROOT/db/phase1-change-history.sql" >/dev/null; t "turning it on again works" "$?" "0"
t "RESUMED note, and the sale made while off is copied (RESYNC)" "$(v hist_b "select string_agg(op||':'||record_key, ',' order by id) from erp_audit.erp_history where op in ('RESUMED','RESYNC') and id > $n0")" "RESUMED:recording,RESYNC:sales/SL-OFF1"
t "status COMPLETE, no second baseline" "$(v hist_b "select status||' '||(select count(*) from erp_audit.erp_history where op='BASELINE') from erp_audit.audit_status")" "COMPLETE $((N + 1))"

echo "== speed"
ms(){ q -d $1 -At -c "select set_config('request.jwt.claims','{\"email\":\"owner@example.com\"}',false)" -c "\\timing on" \
  -c "select jsonb_array_length(erp_push((select jsonb_agg(jsonb_build_object('path','sales/SPEED'||g,'data',jsonb_build_object('id','SPEED'||g,'total',g,'lines',jsonb_build_array(1,2,3)),'base',0)) from generate_series(1,100) g)))" | grep Time | sed 's/Time: //'; }
echo "saving 100 sales in one sync: without history $(ms hist_a), with history $(ms hist_b)"
echo "history size: $(v hist_b "select pg_size_pretty(pg_total_relation_size('erp_audit.erp_history'))") for $(v hist_b "select count(*) from erp_audit.erp_history") rows; records table: $(v hist_b "select pg_size_pretty(pg_total_relation_size('public.erp_docs'))")"
rm -rf $T
echo "$ok passed, $bad failed"; [ $bad = 0 ]
