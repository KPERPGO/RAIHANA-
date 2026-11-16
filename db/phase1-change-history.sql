-- Raihana ERP · Phase 1: change history · revision 3 (16 Nov 2026), for review. NOT yet run anywhere but test servers.
-- Run once in Supabase: SQL Editor > New query > paste ALL of this > Run. Safe to run again.
--
-- What it does
--   * Keeps a permanent event history of every change to public.erp_docs (the app's records) and public.erp_members
--     (who may sign in): whole row before, whole row after, database times, operation, record key, and who sent it.
--   * Saves one BASELINE copy of every record that exists now. Both tables are locked against writes while the copy is
--     made and the recorder is attached, so no save can fall between the two (saves wait, then go through).
--   * Pharmacy saves always go through (owner's decision 1). If a history row can't be written, a GAP row keeps the missed
--     values. erp_audit.reconcile() later puts the missed event itself back into the history (marked as recovered, with
--     its original time) or, where the values are lost, adds a clearly marked RECONSTRUCTED event.
--   * erp_audit.audit_status checks the history event by event, by version number: COMPLETE, RECOVERED, INCOMPLETE or PAUSED.
--   * Seals every history row to the one before (SHA-256 over a canonical JSON form). This makes changes to the history
--     EVIDENT; it can't PREVENT them by someone with owner access to the database (see the review page).
-- What it never does
--   * It does not change, move or delete any existing record, table, function or rule of the app.
--   * It does not change how the app saves, syncs or works out stock, batches, product IDs, sales, prices or profit.
-- Identity (owner's decision 2): the Supabase account and session come from the signed sign-in token. Device and employee
-- come from the app and are kept in columns ending in _unverified. They are not proof of who acted.

begin;
set local lock_timeout = '20s';  -- if the tables are busy for longer than this, the whole file stops and changes nothing

-- 0. No save may happen while the starting copy is made and the recorder is attached. SHARE ROW EXCLUSIVE lets devices
--    read but makes every write wait until this file commits (normally under a few seconds).
lock table public.erp_docs, public.erp_members in share row exclusive mode;

-- 1. A private folder (schema). The app's cloud API serves only the "public" folder, so no device can reach this one.
create schema if not exists erp_audit;
revoke all on schema erp_audit from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on schema erp_audit from %I', r); end if;
  end loop;
end $$;

-- 2. The event history: one row per event, never updated or deleted.
create table if not exists erp_audit.erp_history (
  id                    bigint generated always as identity primary key,
  recorded_at           timestamptz not null,   -- database time this history row was written
  event_at              timestamptz not null,   -- database time of the change itself (earlier for recovered events)
  tx_id                 bigint      not null,   -- records saved together share this number
  table_name            text        not null,   -- erp_docs, erp_members, or erp_audit (PAUSED / RESUMED notes)
  op                    text        not null check (op in ('BASELINE','INSERT','UPDATE','DELETE','RECONSTRUCTED','PAUSED','RESUMED')),
  record_key            text        not null,   -- erp_docs: path (sales/SL-...); erp_members: email
  ord                   numeric,                -- position in the record's own timeline: its version number (ver) in erp_docs
  old_row               jsonb,                  -- whole row before (null for INSERT and BASELINE)
  new_row               jsonb,                  -- whole row after (null for DELETE)
  recovered_gap_id      bigint,                 -- set when this event was put back from a gap row by reconcile()
  account_uid           uuid,                   -- Supabase account, from the signed token (the shared login for now)
  account_email         text,                   -- its email, from the signed token
  account_session       text,                   -- the sign-in session (one per device sign-in), from the signed token
  account_role          text,                   -- authenticated = app, service_role = Edge Function, null = SQL Editor
  db_user               text        not null,   -- database login (postgres in the SQL Editor)
  device_unverified     text,                   -- device ID sent by the app. UNVERIFIED
  staff_id_unverified   text,                   -- employee signed in at the till (staffBy). UNVERIFIED
  staff_name_unverified text,                   -- their name (staffByName). UNVERIFIED
  note                  text,
  prev_hash             text        not null,   -- seal of the row before ('' for the first row)
  row_hash              text        not null    -- SHA-256 of the canonical form of prev_hash + this row
);
create index if not exists erp_history_key_idx on erp_audit.erp_history (table_name, record_key, ord, id);
create index if not exists erp_history_at_idx  on erp_audit.erp_history (event_at);

-- 3. Gaps: a change that was saved but whose history row could not be written, with what is needed to recover it.
create table if not exists erp_audit.erp_audit_gaps (
  id                    bigint generated always as identity primary key,
  at                    timestamptz not null default clock_timestamp(),  -- database time of the missed change
  tx_id                 bigint      not null default txid_current(),
  table_name            text,
  op                    text,
  record_key            text,
  ver                   bigint,
  old_row               jsonb,                  -- the missed values (both null if even these couldn't be kept)
  new_row               jsonb,
  account_email         text,
  account_session       text,
  device_unverified     text,
  staff_id_unverified   text,
  error                 text,
  sqlstate              text
);
-- 4. A gap is closed by a separate row, only after its recovery or documentation is written (gaps are never changed).
create table if not exists erp_audit.erp_audit_gap_closures (
  id         bigint generated always as identity primary key,
  gap_id     bigint not null references erp_audit.erp_audit_gaps (id),
  at         timestamptz not null default clock_timestamp(),
  history_id bigint references erp_audit.erp_history (id),   -- the recovered or reconstructed event
  how        text not null check (how in ('recovered', 'reconstructed', 'documented')),
  note       text
);

-- 5. App users get no access, not even reading.
do $$ declare r text; t text; begin
  foreach t in array array['erp_history', 'erp_audit_gaps', 'erp_audit_gap_closures'] loop
    execute format('alter table erp_audit.%I enable row level security', t);       -- and no policies
    execute format('revoke all on erp_audit.%I from public', t);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on erp_audit.%I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

-- 6. The seal of one row: SHA-256 of one JSON array in a fixed order. JSON gives every value an unambiguous form:
--    text is quoted and escaped, null is null (never confused with a text value), numbers and nested JSON have
--    PostgreSQL's single jsonb text form, and times are written in UTC with microseconds, whatever the session time zone.
create or replace function erp_audit.utc(t timestamptz) returns text
language sql stable set search_path = '' as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
create or replace function erp_audit.seal(h erp_audit.erp_history) returns text
language sql stable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_array('raihana-audit-seal-v1', h.prev_hash, erp_audit.utc(h.recorded_at),
    erp_audit.utc(h.event_at), h.tx_id, h.table_name, h.op, h.record_key, h.ord, h.old_row, h.new_row, h.recovered_gap_id,
    h.account_uid, h.account_email, h.account_session, h.account_role, h.db_user, h.device_unverified,
    h.staff_id_unverified, h.staff_name_unverified, h.note)::text, 'UTF8')), 'hex')
$$;

-- 7. Sign-in details that Supabase attaches to each request (empty in the SQL Editor).
create or replace function erp_audit.claims() returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  return coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
exception when others then return '{}'::jsonb;
end $$;

-- 8. Add one event to the history, one at a time (a short lock), so the seal chain has no forks. Returns the new id.
--    ord, the position in the record's timeline: erp_docs uses the version number (a DELETE sits just after the version
--    it removed); erp_members has no version, so it uses the event time.
create or replace function erp_audit.append(tbl text, op text, k text, o jsonb, n jsonb, note text default null,
  ev_at timestamptz default null, gap bigint default null, pos numeric default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare c jsonb := erp_audit.claims(); d jsonb := coalesce(n, o); h erp_audit.erp_history; new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('erp_audit.erp_history'));
  h.recorded_at := clock_timestamp(); h.event_at := coalesce(ev_at, h.recorded_at); h.tx_id := txid_current();
  h.table_name := tbl; h.op := op; h.record_key := k; h.old_row := o; h.new_row := n; h.note := note;
  h.recovered_gap_id := gap; h.db_user := session_user;
  h.ord := coalesce(pos, case when tbl = 'erp_docs' then coalesce((n ->> 'ver')::numeric, (o ->> 'ver')::numeric + 0.5)
                              when tbl = 'erp_members' then extract(epoch from h.event_at) end);
  begin h.account_uid := nullif(c ->> 'sub', '')::uuid; exception when others then h.account_uid := null; end;
  h.account_email := c ->> 'email'; h.account_session := c ->> 'session_id'; h.account_role := c ->> 'role';
  h.device_unverified := d ->> 'device'; h.staff_id_unverified := d -> 'data' ->> 'staffBy'; h.staff_name_unverified := d -> 'data' ->> 'staffByName';
  select x.row_hash into h.prev_hash from erp_audit.erp_history x order by x.id desc limit 1;
  h.prev_hash := coalesce(h.prev_hash, '');
  h.row_hash := erp_audit.seal(h);
  insert into erp_audit.erp_history (recorded_at, event_at, tx_id, table_name, op, record_key, ord, old_row, new_row,
    recovered_gap_id, account_uid, account_email, account_session, account_role, db_user, device_unverified,
    staff_id_unverified, staff_name_unverified, note, prev_hash, row_hash)
  values (h.recorded_at, h.event_at, h.tx_id, h.table_name, h.op, h.record_key, h.ord, h.old_row, h.new_row,
    h.recovered_gap_id, h.account_uid, h.account_email, h.account_session, h.account_role, h.db_user, h.device_unverified,
    h.staff_id_unverified, h.staff_name_unverified, h.note, h.prev_hash, h.row_hash)
  returning id into new_id;
  return new_id;
end $$;

-- 9. The recorder: runs after every insert, update or delete, inside the same save. Three levels, so the save never fails:
--    (a) history row; if that fails (b) a gap row with the missed values; if that fails (c) a gap row with only the key
--    and the error; if even that fails (d) a warning in the Supabase database log. A level (b) gap can be fully recovered.
--    Levels (c) and (d) lose the values; the status still finds the break by version number (see the review page).
create or replace function erp_audit.record_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  k text := coalesce(n ->> tg_argv[0], o ->> tg_argv[0]); c jsonb; msg text; st text;
begin
  begin
    perform erp_audit.append(tg_table_name, tg_op, k, o, n);
  exception when others then
    get stacked diagnostics msg = message_text, st = returned_sqlstate;
    begin
      c := erp_audit.claims();
      insert into erp_audit.erp_audit_gaps (table_name, op, record_key, ver, old_row, new_row, account_email, account_session,
        device_unverified, staff_id_unverified, error, sqlstate)
      values (tg_table_name, tg_op, k, coalesce(n ->> 'ver', o ->> 'ver')::bigint, o, n, c ->> 'email', c ->> 'session_id',
        coalesce(n, o) ->> 'device', coalesce(n, o) -> 'data' ->> 'staffBy', msg, st);
    exception when others then
      begin
        insert into erp_audit.erp_audit_gaps (table_name, op, record_key, error, sqlstate) values (tg_table_name, tg_op, k, msg, st);
      exception when others then
        raise warning 'erp_audit: change history NOT written for % % (%): %', tg_table_name, k, tg_op, msg;
      end;
    end;
  end;
  return null; -- AFTER trigger: the saved row is not changed
end $$;

-- 10. The guard: history, gaps and closures can't be changed, deleted or emptied, even from the SQL Editor.
create or replace function erp_audit.refuse_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The change history can only grow. Rows can''t be changed or deleted.' using errcode = '42501';
end $$;
do $$ declare t text; begin
  foreach t in array array['erp_history', 'erp_audit_gaps', 'erp_audit_gap_closures'] loop
    execute format('drop trigger if exists no_change on erp_audit.%I', t);
    execute format('create trigger no_change before update or delete on erp_audit.%I for each row execute function erp_audit.refuse_change()', t);
    execute format('drop trigger if exists no_truncate on erp_audit.%I', t);
    execute format('create trigger no_truncate before truncate on erp_audit.%I for each statement execute function erp_audit.refuse_change()', t);
  end loop;
end $$;

-- 11. Findings: every place where the history does not account for the records, one row each.
--     Each record's events are put in timeline order (ord). Then:
--       break          an UPDATE, DELETE or RECONSTRUCTED whose "before" is not exactly the previous event's "after"
--                      (one or more changes were missed in between: this is what catches a value changed and changed back,
--                      because the version number in the row is different), or an INSERT/BASELINE that follows a record
--                      that was never seen deleted
--       not_current    a record whose current row (with its version) is not exactly the "after" of its latest event
--       missing_delete a record whose latest event says it exists, but it is gone from the table
create or replace function erp_audit.findings() returns table (kind text, table_name text, record_key text, event_id bigint,
  prev_id bigint, prev_ord numeric, this_ord numeric, known_before jsonb, known_after jsonb)
language sql stable security definer set search_path = '' as $$
  with ev as (
    select h.id, h.table_name, h.record_key, h.op, h.ord, h.old_row, h.new_row,
           lag(h.id) over w as p_id, lag(h.new_row) over w as p_new, lag(h.ord) over w as p_ord,
           row_number() over (partition by h.table_name, h.record_key order by h.ord desc, h.id desc) as from_end
    from erp_audit.erp_history h where h.table_name in ('erp_docs', 'erp_members')
    window w as (partition by h.table_name, h.record_key order by h.ord, h.id)),
  latest as (select * from ev where from_end = 1),
  cur as (select 'erp_docs'::text as t, d.path as k, to_jsonb(d) as r from public.erp_docs d
          union all select 'erp_members', m.email, to_jsonb(m) from public.erp_members m)
  select 'break', e.table_name, e.record_key, e.id, e.p_id, e.p_ord, e.ord, e.p_new,
         case when e.op in ('INSERT', 'BASELINE') then null else e.old_row end
  from ev e
  where (e.op in ('UPDATE', 'DELETE', 'RECONSTRUCTED') and e.p_new is distinct from e.old_row)
     or (e.op in ('INSERT', 'BASELINE') and e.p_new is not null)
  union all
  select 'not_current', c.t, c.k, null, l.id, l.ord, null, l.new_row, c.r
  from cur c left join latest l on l.table_name = c.t and l.record_key = c.k
  where l.new_row is distinct from c.r
  union all
  select 'missing_delete', l.table_name, l.record_key, null, l.id, l.ord, null, l.new_row, null
  from latest l
  where l.new_row is not null and not exists (select 1 from cur c where c.t = l.table_name and c.k = l.record_key)
$$;

-- 12. The status. Read it with:  select * from erp_audit.audit_status;
--       COMPLETE    recorder on, seals intact, no open gap, no finding, and no event was ever recovered or reconstructed
--       RECOVERED   as COMPLETE, but some events were put back from gaps or reconstructed; they are marked as such
--       INCOMPLETE  a seal is broken, a gap is open, a finding exists, or the recorder is off without a PAUSED note
--       PAUSED      recording was turned off on purpose (rollback); changes made now are found later, when it is turned on again
create or replace view erp_audit.audit_status as
with
  trg as (select count(*) filter (where t.tgenabled <> 'D') as on_n from pg_trigger t
          where t.tgname = 'zz_erp_history' and t.tgrelid in ('public.erp_docs'::regclass, 'public.erp_members'::regclass)),
  ctl as (select op from erp_audit.erp_history where op in ('PAUSED', 'RESUMED') order by id desc limit 1),
  gaps as (select count(*) filter (where not exists (select 1 from erp_audit.erp_audit_gap_closures c where c.gap_id = g.id)) as open_n,
                  count(*) filter (where g.at > now() - interval '7 days') as week_n, max(g.at) as last_at
           from erp_audit.erp_audit_gaps g),
  f as (select count(*) filter (where kind = 'break') as breaks, count(*) filter (where kind = 'not_current') as not_current,
               count(*) filter (where kind = 'missing_delete') as missing from erp_audit.findings()),
  marks as (select count(*) filter (where recovered_gap_id is not null) as recovered, count(*) filter (where op = 'RECONSTRUCTED') as rebuilt
            from erp_audit.erp_history),
  chain as (select count(*) filter (where s.prev_hash <> coalesce(s.prev, '') or s.row_hash <> s.recomputed) as broken, count(*) as rows
            from (select h.prev_hash, h.row_hash, lag(h.row_hash) over (order by h.id) as prev, erp_audit.seal(h) as recomputed
                  from erp_audit.erp_history h) s),
  last as (select id, row_hash from erp_audit.erp_history order by id desc limit 1)
select
  case when chain.broken > 0 then 'INCOMPLETE'
       when trg.on_n < 2 and (select op from ctl) = 'PAUSED' then 'PAUSED'
       when trg.on_n < 2 or gaps.open_n > 0 or f.breaks + f.not_current + f.missing > 0 then 'INCOMPLETE'
       when marks.recovered + marks.rebuilt > 0 then 'RECOVERED'
       else 'COMPLETE' end as status,
  case when trg.on_n = 2 then 'ON' when (select op from ctl) = 'PAUSED' then 'PAUSED' else 'OFF' end as recording,
  chain.broken = 0 as seals_intact,
  gaps.open_n as open_gaps,
  f.breaks as missed_event_breaks,
  f.not_current as records_not_matching_history,
  f.missing as deletes_not_in_history,
  marks.recovered as recovered_events,
  marks.rebuilt as reconstructed_events,
  gaps.week_n as gaps_last_7_days,
  gaps.last_at as last_gap_at,
  chain.rows as history_rows,
  (select id from last) as last_id,
  (select row_hash from last) as last_seal,
  now() as checked_at
from trg, gaps, f, marks, chain;
revoke all on erp_audit.audit_status from public;

-- 13. Reconcile: account for every gap and every finding, without touching any pharmacy record.
--     Step 1: each gap that kept its values becomes the missed event itself: original operation and values, its original
--             time in event_at, linked by recovered_gap_id; then the gap is closed ('recovered').
--     Step 2: each remaining finding gets a RECONSTRUCTED event that bridges exactly the known before and after.
--             Its note says that one or more changes in between were missed and their in-between values are unknown.
--     Step 3: gaps that kept no values are closed ('reconstructed' with the bridging event, or 'documented').
--     Run by the owner only:  select * from erp_audit.reconcile('why');
create or replace function erp_audit.reconcile(why text default null) returns table (recovered int, reconstructed int, gaps_closed int)
language plpgsql security definer set search_path = '' as $$
declare g record; x record; hid bigint; r int := 0; b int := 0; c int := 0; pos numeric;
begin
  -- saves wait while reconcile runs (normally well under a second), so nothing changes under it
  lock table public.erp_docs, public.erp_members in share row exclusive mode;
  for g in select y.* from erp_audit.erp_audit_gaps y
           where not exists (select 1 from erp_audit.erp_audit_gap_closures z where z.gap_id = y.id)
             and (y.old_row is not null or y.new_row is not null) order by y.id loop
    hid := erp_audit.append(g.table_name, g.op, g.record_key, g.old_row, g.new_row,
      concat_ws(' · ', 'recovered from gap ' || g.id, 'original error: ' || g.error, why), g.at, g.id);
    insert into erp_audit.erp_audit_gap_closures (gap_id, history_id, how, note) values (g.id, hid, 'recovered', why);
    r := r + 1; c := c + 1;
  end loop;
  for x in select * from erp_audit.findings() order by table_name, record_key, prev_ord nulls first loop
    pos := case when x.kind = 'break' then (coalesce(x.prev_ord, x.this_ord - 1) + x.this_ord) / 2
                when x.kind = 'not_current' and x.table_name = 'erp_docs' then (x.known_after ->> 'ver')::numeric
                when x.kind = 'missing_delete' and x.table_name = 'erp_docs' then x.prev_ord + 0.75
                else extract(epoch from clock_timestamp()) end;
    perform erp_audit.append(x.table_name, 'RECONSTRUCTED', x.record_key, x.known_before, x.known_after,
      concat_ws(' · ', case x.kind when 'break' then 'one or more changes were missed between these two known states'
                               when 'not_current' then 'one or more changes were missed before the current state'
                               else 'the record was deleted without a history entry' end,
                'in-between values unknown; real time unknown', why), clock_timestamp(), null, pos);
    b := b + 1;
  end loop;
  for g in select y.* from erp_audit.erp_audit_gaps y
           where not exists (select 1 from erp_audit.erp_audit_gap_closures z where z.gap_id = y.id) order by y.id loop
    select h.id into hid from erp_audit.erp_history h
      where h.table_name = g.table_name and h.record_key = g.record_key and h.op = 'RECONSTRUCTED' order by h.id desc limit 1;
    insert into erp_audit.erp_audit_gap_closures (gap_id, history_id, how, note)
    values (g.id, hid, case when hid is null then 'documented' else 'reconstructed' end,
            concat_ws(' · ', 'values were not kept', case when hid is null then 'no break found for this record' end, why));
    c := c + 1;
  end loop;
  return query select r, b, c;
end $$;

revoke all on function erp_audit.utc(timestamptz), erp_audit.seal(erp_audit.erp_history), erp_audit.claims(),
  erp_audit.append(text, text, text, jsonb, jsonb, text, timestamptz, bigint, numeric), erp_audit.record_change(),
  erp_audit.refuse_change(), erp_audit.findings(), erp_audit.reconcile(text) from public;

-- 14. Start or restart, still under the lock from step 0.
--     First run: a BASELINE copy of every record. Run again after the rollback: a RESUMED note, then reconcile, which
--     accounts for everything changed while recording was off. Run again while recording is on: nothing here.
do $$
declare d record; was_on boolean := (select count(*) from pg_trigger where tgname = 'zz_erp_history' and tgenabled <> 'D'
  and tgrelid in ('public.erp_docs'::regclass, 'public.erp_members'::regclass)) = 2;
begin
  if not exists (select 1 from erp_audit.erp_history) then
    for d in select * from public.erp_docs order by path loop perform erp_audit.append('erp_docs', 'BASELINE', d.path, null, to_jsonb(d)); end loop;
    for d in select * from public.erp_members order by email loop perform erp_audit.append('erp_members', 'BASELINE', d.email, null, to_jsonb(d)); end loop;
  elsif not was_on then
    perform erp_audit.append('erp_audit', 'RESUMED', 'recording', null, null, 'recording turned on again');
    perform erp_audit.reconcile('changes made while recording was off');
  end if;
end $$;

-- 15. Attach the recorder. The name starts with "zz_" so it runs after any other trigger and sees the final version number.
drop trigger if exists zz_erp_history on public.erp_docs;
create trigger zz_erp_history after insert or update or delete on public.erp_docs
  for each row execute function erp_audit.record_change('path');
drop trigger if exists zz_erp_history on public.erp_members;
create trigger zz_erp_history after insert or update or delete on public.erp_members
  for each row execute function erp_audit.record_change('email');

commit;

-- Result: what the history holds now, then the status (expect COMPLETE on a first run).
select table_name, op, count(*) as rows from erp_audit.erp_history group by 1, 2 order by 1, 2;
select status, recording, seals_intact, open_gaps, missed_event_breaks, records_not_matching_history, deletes_not_in_history,
       history_rows, last_seal from erp_audit.audit_status;
