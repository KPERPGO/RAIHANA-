#!/bin/sh
# Phase 1 change history (db/phase1-change-history.sql, revision 3), tested in a real Postgres on a made-up but
# realistic pharmacy. Proves: the same work gives the same records with and without history; every change is recorded
# with before/after; a broken recorder never stops a save; every missed event is found by version number (also a value
# changed and changed back, several missed updates, missed deletes); reconcile recovers or reconstructs it; setup can't
# miss a save made at the same moment; tampering is evident; rollback keeps the history and resume accounts for the pause.
# Usage: PGHOST=... PGPORT=... sh tests/sql-history.sh   (needs psql, python3 and a throwaway database server)
export PGOPTIONS="-c client_min_messages=error"
ROOT=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d); SQL="$ROOT/db/phase1-change-history.sql"
q(){ psql -q -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
v(){ q -d "$1" -At -c "$2"; }
ok=0; bad=0; t(){ if [ "$2" = "$3" ]; then echo "PASS $1"; ok=$((ok+1)); else echo "FAIL $1: got [$2] want [$3]"; bad=$((bad+1)); fi; }
fresh(){ q -c "drop database if exists $1" -c "create database $1" >/dev/null
q -d $1 >/dev/null <<'EOSQL'
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $f$;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(auth.jwt() ->> 'sub', '')::uuid $f$;
EOSQL
sed "s/PUT-YOUR-EMAIL-HERE/owner@example.com/" "$ROOT/src/supabase-setup.sql" | q -d $1 >/dev/null
q -d $1 -f "$ROOT/src/supabase-update-2026-10-23.sql" >/dev/null
# Supabase gives its service role full rights on public tables; the stand-in does the same for what the Edge Function uses
q -d $1 -c "grant select, update on public.erp_docs to service_role; grant usage on sequence public.erp_ver_seq to service_role" >/dev/null; }
dump(){ v $1 "select md5(string_agg(path || data::text || ver || coalesce(device,'') || coalesce(updated_by::text,''), '|' order by path)) from erp_docs"
        v $1 "select md5(coalesce(string_agg(path || coalesce(mine::text,'') || coalesce(theirs::text,'') || coalesce(reason,''), '|' order by id), '')) from erp_conflicts"; }
CL='{"email":"owner@example.com","role":"authenticated","session_id":"s1"}'
# one app save through erp_push, as a signed-in device does it: push DB PATH JSON  (base = the record's current version)
push(){ q -d $1 -At -c "select set_config('request.jwt.claims','$CL',false)" -c "set role authenticated" \
  -c "select erp_push(jsonb_build_array(jsonb_build_object('path','$2','data','$3'::jsonb,'base',coalesce((select ver from erp_docs where path='$2'),0),'device','Dphone')))->0->>'ok'" | tail -1; }
st(){ v $1 "select $2 from erp_audit.audit_status"; }
python3 "$ROOT/tests/sql-history-data.py" 7 base "$ROOT/tests/fixtures/invoices/PI-2026-0001.json" > $T/base.sql || exit 1
python3 "$ROOT/tests/sql-history-data.py" 7 work > $T/work.sql || exit 1

echo "== a realistic pharmacy, without and with the change history"
fresh hist_a; q -d hist_a -f $T/base.sql >/dev/null || exit 1
fresh hist_b; q -d hist_b -f $T/base.sql >/dev/null || exit 1
N=$(v hist_b "select count(*) from erp_docs"); echo "records: $N ($(v hist_b "select string_agg(k || ' ' || n, ', ' order by n desc) from (select split_part(path,'/',1) k, count(*) n from erp_docs group by 1) s"))"
t "both copies start the same" "$(dump hist_a)" "$(dump hist_b)"
q -d hist_b -f "$SQL" >/dev/null || { echo "FAIL phase1 file errors"; exit 1; }
q -d hist_b -f "$SQL" >/dev/null || { echo "FAIL phase1 file errors on a second run"; exit 1; }
t "running Phase 1 (twice) changed no record and no conflict" "$(dump hist_a)" "$(dump hist_b)"
t "baseline copies every record once, plus the member email" "$(v hist_b "select count(*) from erp_audit.erp_history where op='BASELINE'")" "$((N + 1))"
t "status COMPLETE after setup, recording ON" "$(st hist_b "status||' '||recording")" "COMPLETE ON"
q -d hist_a -f $T/work.sql >/dev/null || exit 1; q -d hist_b -f $T/work.sql >/dev/null || exit 1
t "a day of work gives identical records, versions and conflicts with and without history" "$(dump hist_a)" "$(dump hist_b)"
t "status COMPLETE after a day of work, no findings" "$(st hist_b "status")|$(v hist_b "select count(*) from erp_audit.findings()")" "COMPLETE|0"

echo "== what is recorded"
h(){ v hist_b "$1"; }
t "300 new sales recorded as INSERT" "$(h "select count(*) from erp_audit.erp_history where op='INSERT' and record_key like 'sales/SL-WORK%'")" "300"
t "new sale: account, session, device and employee (unverified)" "$(h "select account_email||' '||account_role||' '||account_session||' '||device_unverified||' '||staff_id_unverified||' '||staff_name_unverified from erp_audit.erp_history where record_key='sales/SL-WORK00000'")" "owner@example.com authenticated 8d1c2b3a-0000-4000-8000-000000000002 Dphone ST-MW1ALI Ali ahmed"
t "5 cancels recorded with before (not cancelled) and after (cancelled)" "$(h "select count(*) from erp_audit.erp_history where op='UPDATE' and record_key like 'sales/%' and (old_row->'data'->>'voided') is null and new_row->'data'->>'voided'='true'")" "5"
t "refused change to a finished sale is not in the history" "$(h "select count(*) from erp_audit.erp_history where new_row->'data'->>'total'='1'")" "0"
t "every price change keeps old and new price" "$(h "select count(*) from erp_audit.erp_history where op='UPDATE' and record_key like 'products/%' and (new_row->'data'->>'sellBox')::int = (old_row->'data'->>'sellBox')::int + 250")" "$(h "select least(20, count(*)) from erp_docs where path like 'products/%'")"
t "stale edit from the other device (conflict) is not in the history" "$(h "select count(*) from erp_audit.erp_history where record_key like 'products/%' and new_row->'data'->>'sellBox'='1'")" "0"
t "staff permission change recorded" "$(h "select new_row->'data'->'perms' from erp_audit.erp_history where record_key='staff/ST-MW1ALI' and op='UPDATE'")" '["sell", "newinv", "stock"]'
t "settings change recorded once; an unchanged save adds nothing" "$(h "select count(*) from erp_audit.erp_history where record_key='meta/erp' and op='UPDATE'")" "1"
t "Edge Function change recorded as service_role" "$(h "select account_role from erp_audit.erp_history where record_key='meta/pushsub-Dphone' and op='UPDATE'")" "service_role"
t "each event's position is the record's version" "$(h "select count(*) from erp_docs d where d.ver <> (select ord from erp_audit.erp_history x where x.table_name='erp_docs' and x.record_key=d.path order by ord desc, id desc limit 1)")" "0"
t "event time comes from the database, not the device" "$(h "select count(*) from erp_audit.erp_history where event_at > now() + interval '1 minute' or event_at < now() - interval '1 hour'")" "0"
q -d hist_b -c "insert into erp_members values ('second@example.com')" -c "delete from erp_members where email='second@example.com'" >/dev/null
t "sign-in email added and removed: both recorded, made in the SQL Editor (postgres)" "$(h "select string_agg(op||':'||db_user||':'||coalesce(account_role,'none'), ',' order by id) from erp_audit.erp_history where record_key='second@example.com'")" "INSERT:postgres:none,DELETE:postgres:none"
q -d hist_b -c "insert into erp_docs(path,data) values ('tmp/x','{\"a\":1}')" -c "delete from erp_docs where path='tmp/x'" >/dev/null
t "a DELETE keeps the whole row before" "$(h "select old_row->'data'->>'a' from erp_audit.erp_history where record_key='tmp/x' and op='DELETE'")" "1"
t "still COMPLETE" "$(st hist_b status)" "COMPLETE"

echo "== protection"
deny(){ q -d hist_b -At -c "set role $1; $2" 2>&1 | grep -c "permission denied"; }
t "app account can't read history" "$(deny authenticated 'select 1 from erp_audit.erp_history limit 1')" "1"
t "app account can't write history" "$(deny authenticated "insert into erp_audit.erp_history(recorded_at,event_at,tx_id,table_name,op,record_key,db_user,prev_hash,row_hash) values (now(),now(),1,'x','INSERT','x','x','','')")" "1"
t "app account can't read gaps" "$(deny authenticated 'select 1 from erp_audit.erp_audit_gaps')" "1"
t "app account can't read the status" "$(deny authenticated 'select 1 from erp_audit.audit_status')" "1"
t "app account can't run reconcile" "$(deny authenticated "select erp_audit.reconcile('x')")" "1"
t "app account can't write a fake history row" "$(deny authenticated "select erp_audit.append('erp_docs','INSERT','x',null,null)")" "1"
t "public key can't read history" "$(deny anon 'select 1 from erp_audit.erp_history')" "1"
t "Edge Function role can't read history" "$(deny service_role 'select 1 from erp_audit.erp_history')" "1"
grow(){ q -d hist_b -At -c "$1" 2>&1 | grep -c "can only grow"; }
t "owner can't edit history" "$(grow 'update erp_audit.erp_history set op=op')" "1"
t "owner can't delete history" "$(grow 'delete from erp_audit.erp_history')" "1"
hn=$(v hist_b "select count(*) from erp_audit.erp_history"); q -d hist_b -c "truncate erp_audit.erp_history" >/dev/null 2>&1
q -d hist_b -c "truncate erp_audit.erp_history cascade" >/dev/null 2>&1
t "owner can't empty history, also with CASCADE (every row still there)" "$(v hist_b "select count(*) from erp_audit.erp_history")" "$hn"

echo "== seal format (canonical JSON)"
q -d hist_b >/dev/null <<'EOSQL'
select set_config('request.jwt.claims', '', false);
insert into erp_docs(path, data, device) values ('tmp/edge1', jsonb_build_object('txt', 'a' || chr(31) || 'b~|"q"' || chr(10) || 'صيدلية', 'n', 1.50, 'z', null), 'D~' || chr(31));
EOSQL
t "odd characters (separator, ~, quotes, new line, Arabic) are recorded and sealed" "$(st hist_b "seals_intact")" "t"
seal(){ v hist_b "do \$\$ declare h erp_audit.erp_history; a text; b text; begin select * into h from erp_audit.erp_history where record_key='tmp/edge1'; $1 if a = b then raise exception 'same'; end if; end \$\$" 2>&1 | grep -c same; }
t "null and the text '~' give different seals" "$(seal "h.staff_name_unverified := null; a := erp_audit.seal(h); h.staff_name_unverified := '~'; b := erp_audit.seal(h);")" "0"
t "a separator inside a value can't imitate two values" "$(seal "h.device_unverified := 'a' || chr(31) || 'b'; h.staff_id_unverified := null; a := erp_audit.seal(h); h.device_unverified := 'a'; h.staff_id_unverified := 'b'; b := erp_audit.seal(h);")" "0"
t "moving text between two fields changes the seal" "$(seal "h.device_unverified := 'ab'; h.staff_id_unverified := ''; a := erp_audit.seal(h); h.device_unverified := 'a'; h.staff_id_unverified := 'b'; b := erp_audit.seal(h);")" "0"
t "empty text and null give different seals" "$(seal "h.note := ''; a := erp_audit.seal(h); h.note := null; b := erp_audit.seal(h);")" "0"
t "seals don't depend on the session time zone" "$(q -d hist_b -At -c "set timezone to 'Asia/Baghdad'" -c "select seals_intact from erp_audit.audit_status")|$(q -d hist_b -At -c "set timezone to 'America/Los_Angeles'" -c "select seals_intact from erp_audit.audit_status")" "t|t"

echo "== tampering is evident (on copies)"
push hist_b sales/SL-TAIL '{"id":"SL-TAIL","total":9000}' >/dev/null; SEAL=$(st hist_b last_seal)
cp_db(){ q -c "drop database if exists hist_c" -c "create database hist_c template hist_b" >/dev/null; }
cp_db; q -d hist_c -c "alter table erp_audit.erp_history disable trigger no_change" -c "update erp_audit.erp_history set new_row = jsonb_set(new_row, '{data,total}', '1') where id = 500" >/dev/null
t "an edited history row breaks the seal" "$(v hist_c "select status||' '||seals_intact from erp_audit.audit_status")" "INCOMPLETE false"
cp_db; q -d hist_c -c "alter table erp_audit.erp_history disable trigger no_change" -c "delete from erp_audit.erp_history where id = 500" >/dev/null
t "a removed history row breaks the seal" "$(v hist_c "select status||' '||seals_intact from erp_audit.audit_status")" "INCOMPLETE false"
cp_db; q -d hist_c -c "alter table erp_audit.erp_history disable trigger no_change" -c "delete from erp_audit.erp_history where id = (select max(id) from erp_audit.erp_history)" >/dev/null
t "cutting off the newest row is found (a record not matching its history)" "$(v hist_c "select status||' '||records_not_matching_history from erp_audit.audit_status")" "INCOMPLETE 1"
t "and the seal written down outside is no longer found" "$(v hist_c "select count(*) from erp_audit.erp_history where row_hash = '$SEAL'")" "0"
cp_db; q -d hist_c -c "alter table erp_docs disable trigger zz_erp_history" >/dev/null
t "a recorder switched off by hand (not paused) shows INCOMPLETE, recording OFF" "$(v hist_c "select status||' '||recording from erp_audit.audit_status")" "INCOMPLETE OFF"
q -c "drop database hist_c" >/dev/null

echo "== gaps: one missed sale (the history fails, the gap keeps the values)"
brk(){ q -d hist_b -c "alter table erp_audit.$1 add constraint test_break check ($2) not valid" >/dev/null; }
fix(){ q -d hist_b -c "alter table erp_audit.$1 drop constraint test_break" >/dev/null; }
brk erp_history false
t "sale saved although the history failed" "$(push hist_b sales/SL-GAP1 '{"id":"SL-GAP1","total":9000,"staffBy":"ST-MW1ALI"}')" "true"
t "the sale is in erp_docs" "$(v hist_b "select data->>'total' from erp_docs where path='sales/SL-GAP1'")" "9000"
t "the gap keeps op, values, device and employee (unverified)" "$(v hist_b "select op||' '||(new_row->'data'->>'total')||' '||device_unverified||' '||staff_id_unverified||' '||(error is not null) from erp_audit.erp_audit_gaps where record_key='sales/SL-GAP1'")" "INSERT 9000 Dphone ST-MW1ALI true"
t "status INCOMPLETE with 1 open gap" "$(st hist_b "status||' '||open_gaps")" "INCOMPLETE 1"
fix erp_history
t "still INCOMPLETE after the history works again, until reconciled" "$(st hist_b status)" "INCOMPLETE"
t "reconcile recovers 1 event and closes 1 gap" "$(v hist_b "select recovered||' '||reconstructed||' '||gaps_closed from erp_audit.reconcile('test')")" "1 0 1"
t "the recovered event is the original INSERT, linked to its gap, with its original time before the recovery time" "$(v hist_b "select h.op||' '||(h.recovered_gap_id = g.id)||' '||(h.event_at = g.at)||' '||(h.event_at < h.recorded_at) from erp_audit.erp_history h join erp_audit.erp_audit_gaps g on g.record_key = h.record_key where h.record_key='sales/SL-GAP1'")" "INSERT true true true"
t "the gap is closed as recovered and kept" "$(v hist_b "select c.how from erp_audit.erp_audit_gap_closures c join erp_audit.erp_audit_gaps g on g.id=c.gap_id where g.record_key='sales/SL-GAP1'")" "recovered"
t "status RECOVERED (not COMPLETE) after a recovery" "$(st hist_b "status||' '||recovered_events")" "RECOVERED 1"
t "owner can't delete a gap or a closure" "$(grow 'delete from erp_audit.erp_audit_gaps')$(grow 'delete from erp_audit.erp_audit_gap_closures')" "11"

echo "== gaps: three missed updates to the same product"
P=$(v hist_b "select path from erp_docs where path like 'products/%' order by path limit 1")
brk erp_history false
for p in 7000 7500 8000; do push hist_b $P "{\"id\":\"x\",\"sellBox\":$p}" >/dev/null; done
fix erp_history
t "3 open gaps, status INCOMPLETE" "$(st hist_b "status||' '||open_gaps")" "INCOMPLETE 3"
t "reconcile recovers all 3" "$(v hist_b "select recovered||' '||reconstructed from erp_audit.reconcile('test')")" "3 0"
t "the 3 recovered prices are in their real order" "$(v hist_b "select string_agg(new_row->'data'->>'sellBox', ',' order by ord) from erp_audit.erp_history where record_key='$P' and recovered_gap_id is not null")" "7000,7500,8000"
t "no break left in that product's timeline; RECOVERED" "$(st hist_b "status||' '||missed_event_breaks||' '||records_not_matching_history")" "RECOVERED 0 0"

echo "== both the history and the gap table fail: a price changed, then changed back"
push hist_b $P '{"id":"x","sellBox":10000}' >/dev/null
t "price 10000 recorded" "$(v hist_b "select new_row->'data'->>'sellBox' from erp_audit.erp_history where record_key='$P' order by id desc limit 1")" "10000"
brk erp_history false; brk erp_audit_gaps false
t "change to 12000 still saved" "$(push hist_b $P '{"id":"x","sellBox":12000}')" "true"
t "no history row and no gap row could be written" "$(v hist_b "select count(*) from erp_audit.erp_history where record_key='$P' and new_row->'data'->>'sellBox'='12000'")$(v hist_b "select count(*) from erp_audit.erp_audit_gaps where record_key='$P' and new_row->'data'->>'sellBox'='12000'")" "00"
fix erp_history; fix erp_audit_gaps
push hist_b $P '{"id":"x","sellBox":10000}' >/dev/null
t "current row has the same price as the recorded state" "$(v hist_b "select data->>'sellBox' from erp_docs where path='$P'")" "10000"
t "status is NOT COMPLETE: INCOMPLETE with 1 missed-event break (found by version)" "$(st hist_b "status||' '||missed_event_breaks")" "INCOMPLETE 1"
t "the finding names the record and the two known versions" "$(v hist_b "select kind||' '||record_key||' '||((known_after->>'ver')::bigint > (known_before->>'ver')::bigint) from erp_audit.findings()")" "break $P true"
t "reconcile adds 1 reconstructed event" "$(v hist_b "select recovered||' '||reconstructed from erp_audit.reconcile('test')")" "0 1"
t "it bridges 10000 to 12000 and says the in-between is unknown" "$(v hist_b "select (old_row->'data'->>'sellBox')||'>'||(new_row->'data'->>'sellBox')||' '||(note like '%in-between values unknown%') from erp_audit.erp_history where op='RECONSTRUCTED' and record_key='$P'")" "10000>12000 true"
t "status RECOVERED, no findings" "$(st hist_b status)|$(v hist_b "select count(*) from erp_audit.findings()")" "RECOVERED|0"

echo "== partial failures"
brk erp_history false; brk erp_audit_gaps "old_row is null and new_row is null"
t "history fails and the gap can't keep values: save still works" "$(push hist_b customers/CU-PART '{"id":"CU-PART","name":"x"}')" "true"
t "a short gap (key and error, no values) was written" "$(v hist_b "select op||' '||(new_row is null)||' '||(error is not null) from erp_audit.erp_audit_gaps where record_key='customers/CU-PART'")" "INSERT true true"
fix erp_history; fix erp_audit_gaps
t "status INCOMPLETE: open gap and a record not matching history" "$(st hist_b "status||' '||open_gaps||' '||records_not_matching_history")" "INCOMPLETE 1 1"
t "reconcile reconstructs it and closes the gap as reconstructed" "$(v hist_b "select reconstructed||' '||gaps_closed from erp_audit.reconcile('test')")|$(v hist_b "select c.how from erp_audit.erp_audit_gap_closures c join erp_audit.erp_audit_gaps g on g.id=c.gap_id where g.record_key='customers/CU-PART'")" "1 1|reconstructed"
q -d hist_b -c "alter table erp_members disable trigger zz_erp_history" >/dev/null
t "recorder off on one table only: INCOMPLETE, recording OFF" "$(st hist_b "status||' '||recording")" "INCOMPLETE OFF"
t "the other table is still recorded" "$(push hist_b sales/SL-HALF '{"id":"SL-HALF"}')|$(v hist_b "select count(*) from erp_audit.erp_history where record_key='sales/SL-HALF'")" "true|1"
q -d hist_b -c "alter table erp_members enable trigger zz_erp_history" >/dev/null
t "back on: RECOVERED" "$(st hist_b "status||' '||recording")" "RECOVERED ON"

echo "== deleted records"
q -d hist_b -c "insert into erp_docs(path,data) values ('tmp/del1','{\"a\":1}'), ('tmp/del2','{\"a\":2}')" >/dev/null
brk erp_history false
q -d hist_b -c "delete from erp_docs where path='tmp/del1'" >/dev/null
fix erp_history
t "a delete with a gap: INCOMPLETE, then recovered as DELETE with the row before" "$(st hist_b status)|$(v hist_b "select recovered from erp_audit.reconcile('test')")|$(v hist_b "select op||' '||(old_row->'data'->>'a') from erp_audit.erp_history where record_key='tmp/del1' and recovered_gap_id is not null")" "INCOMPLETE|1|DELETE 1"
brk erp_history false; brk erp_audit_gaps false
q -d hist_b -c "delete from erp_docs where path='tmp/del2'" >/dev/null
fix erp_history; fix erp_audit_gaps
t "a delete with no trace at all is still found (deletes_not_in_history)" "$(st hist_b "status||' '||deletes_not_in_history")" "INCOMPLETE 1"
t "reconcile records it as a reconstructed delete" "$(v hist_b "select reconstructed from erp_audit.reconcile('test')")|$(v hist_b "select (new_row is null)||' '||(old_row->'data'->>'a') from erp_audit.erp_history where record_key='tmp/del2' and op='RECONSTRUCTED'")" "1|true 2"
t "status RECOVERED" "$(st hist_b status)" "RECOVERED"

echo "== two devices saving at the same time"
for d in P1 P2; do ( for i in $(seq 1 40); do push hist_b "sales/SL-$d-$i" '{"id":"c"}' >/dev/null; done ) & done; wait
t "all 80 saved and in history, seals intact, no findings" "$(v hist_b "select count(*) from erp_docs where path ~ '^sales/SL-P[12]-'")|$(v hist_b "select count(*) from erp_audit.erp_history where record_key ~ '^sales/SL-P[12]-'")|$(st hist_b seals_intact)|$(v hist_b "select count(*) from erp_audit.findings()")" "80|80|t|0"

echo "== rollback, saves while paused, and resume"
q -d hist_b -f "$ROOT/db/phase1-check.sql" >/dev/null; t "check file runs" "$?" "0"
n0=$(v hist_b "select count(*) from erp_audit.erp_history")
q -d hist_b -f "$ROOT/db/phase1-rollback.sql" >/dev/null; t "rollback file runs" "$?" "0"
t "rollback adds only the PAUSED note and deletes no history" "$(v hist_b "select count(*) from erp_audit.erp_history")" "$((n0 + 1))"
t "status PAUSED, recording PAUSED" "$(st hist_b "status||' '||recording")" "PAUSED PAUSED"
t "while paused the app still saves (insert, price change)" "$(push hist_b sales/SL-OFF1 '{"id":"SL-OFF1"}')$(push hist_b $P '{"id":"x","sellBox":15000}')" "truetrue"
q -d hist_b -c "delete from erp_docs where path='sales/SL-TAIL'" >/dev/null
t "nothing is recorded while paused" "$(v hist_b "select count(*) from erp_audit.erp_history")" "$((n0 + 1))"
q -d hist_b -f "$SQL" >/dev/null; t "turning it on again works" "$?" "0"
t "RESUMED, then 3 reconstructed events: the new sale, the price change, the delete" "$(v hist_b "select string_agg(op||':'||record_key, ',' order by record_key) from erp_audit.erp_history where id > $n0 + 1 and op in ('RESUMED','RECONSTRUCTED')")" "RECONSTRUCTED:$P,RESUMED:recording,RECONSTRUCTED:sales/SL-OFF1,RECONSTRUCTED:sales/SL-TAIL"
t "status RECOVERED, recording ON, no findings, no second baseline" "$(st hist_b "status||' '||recording")|$(v hist_b "select count(*) from erp_audit.findings()")|$(v hist_b "select count(*) from erp_audit.erp_history where op='BASELINE'")" "RECOVERED ON|0|$((N + 1))"

echo "== first setup while devices keep saving (inserts, updates, deletes)"
race(){ # $1 db, $2 = sed script applied to a copy of the SQL file (to add a pause, or remove the lock for the control test)
  fresh $1; q -d $1 -f $T/base.sql >/dev/null
  q -d $1 -c "insert into erp_docs(path,data) select 'tmp/r' || g, '{}'::jsonb from generate_series(1,300) g" >/dev/null
  sed "$2" "$SQL" > $T/race.sql
  ( i=0; end=$(( $(date +%s) + 6 )); while [ $(date +%s) -lt $end ]; do i=$((i+1))
      push $1 "sales/SL-R$i" '{"id":"r"}' >/dev/null 2>&1
      push $1 "products/P-RACE" "{\"id\":\"P-RACE\",\"sellBox\":$i}" >/dev/null 2>&1
      q -d $1 -c "delete from erp_docs where path='tmp/r$i'" >/dev/null 2>&1; done; echo $i > $T/race.n ) &
  sleep 1; q -d $1 -f $T/race.sql >/dev/null 2>&1; wait; }
PAUSE='s/^-- 15\. Attach the recorder.*/select pg_sleep(3);/'
race hist_r "$PAUSE"
echo "writes tried while setting up (with a 3-second pause added between the copy and attaching the recorder): $(cat $T/race.n) rounds of insert, update and delete"
t "with the lock: every committed save is accounted for; status COMPLETE, no findings" "$(st hist_r "status")|$(v hist_r "select count(*) from erp_audit.findings()")" "COMPLETE|0"
t "every deleted record has its DELETE or never existed in the history" "$(v hist_r "select count(*) from erp_audit.erp_history h where record_key like 'tmp/r%' and op='BASELINE' and not exists (select 1 from erp_docs d where d.path=h.record_key) and not exists (select 1 from erp_audit.erp_history x where x.record_key=h.record_key and x.op='DELETE')")" "0"
race hist_n "$PAUSE; s/^lock table public.erp_docs, public.erp_members in share row exclusive mode;//"
t "control test without the lock: saves slip through and the status finds them (not COMPLETE)" "$(st hist_n "status")|$(test "$(v hist_n "select count(*) from erp_audit.findings()")" -gt 0 && echo found)" "INCOMPLETE|found"
q -c "drop database hist_r" -c "drop database hist_n" >/dev/null

echo "== speed"
ms(){ q -d $1 -At -c "select set_config('request.jwt.claims','{\"email\":\"owner@example.com\"}',false)" -c "\\timing on" \
  -c "select jsonb_array_length(erp_push((select jsonb_agg(jsonb_build_object('path','sales/SPEED'||g,'data',jsonb_build_object('id','SPEED'||g,'total',g,'lines',jsonb_build_array(1,2,3)),'base',0)) from generate_series(1,100) g)))" | grep Time | sed 's/Time: //'; }
echo "saving 100 sales in one sync: without history $(ms hist_a), with history $(ms hist_b)"
echo "status check time: $(q -d hist_b -At -c '\timing on' -c 'select status from erp_audit.audit_status' | grep Time | sed 's/Time: //') for $(v hist_b "select count(*) from erp_audit.erp_history") history rows"
echo "history size: $(v hist_b "select pg_size_pretty(pg_total_relation_size('erp_audit.erp_history'))"); records table: $(v hist_b "select pg_size_pretty(pg_total_relation_size('public.erp_docs'))")"
rm -rf $T
echo "$ok passed, $bad failed"; [ $bad = 0 ]
