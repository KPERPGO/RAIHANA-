-- Raihana ERP · Phase 1: change history (final version for review, 15 Nov 2026). NOT yet run.
-- Run once in Supabase: SQL Editor > New query > paste ALL of this > Run. Safe to run again.
--
-- What it does
--   * Keeps a permanent copy of every change to public.erp_docs (the app's records) and public.erp_members
--     (who may sign in): whole row before, whole row after, database time, operation, record path, and who sent it.
--   * Saves one BASELINE copy of every record that exists now, so the history starts complete.
--   * Seals every history row to the one before it (SHA-256 chain), so an edited or removed history row is detected.
--   * Pharmacy saves always go through (owner's decision 1). If a history row can't be written, the save still
--     happens and a GAP is written instead, with the values that were missed. erp_audit.audit_status shows
--     COMPLETE only when there are no open gaps, no record without history and the seal chain is intact.
-- What it never does
--   * It does not change, move or delete any existing record, table, function or rule.
--   * It does not change how the app saves, syncs or works out stock, batches, product IDs, sales or profit.
-- Identity (owner's decision 2): the Supabase account is checked by Supabase. Device and employee come from the app
-- and are stored in columns ending in _unverified. Individual identity comes in Phase 4.

begin;

-- 1. A private folder (schema). The app's cloud API serves only the "public" folder, so no device can reach this one.
create schema if not exists erp_audit;
revoke all on schema erp_audit from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on schema erp_audit from %I', r); end if;
  end loop;
end $$;

-- 2. The history: one row per change, never updated or deleted.
create table if not exists erp_audit.erp_history (
  id                    bigint generated always as identity primary key,
  at                    timestamptz not null,   -- database time of the change
  tx_id                 bigint      not null,   -- records saved together share this number
  table_name            text        not null,   -- erp_docs, erp_members, or erp_audit (for PAUSED / RESUMED notes)
  op                    text        not null check (op in ('BASELINE','INSERT','UPDATE','DELETE','PAUSED','RESUMED','RESYNC')),
  record_key            text        not null,   -- erp_docs: path (sales/SL-...); erp_members: email
  old_row               jsonb,                  -- whole row before (null for INSERT, BASELINE, RESYNC)
  new_row               jsonb,                  -- whole row after (null for DELETE)
  account_uid           uuid,                   -- Supabase account, checked by Supabase (the shared login for now)
  account_email         text,                   -- its email, checked by Supabase
  account_session       text,                   -- the sign-in session (one per device sign-in), checked by Supabase
  account_role          text,                   -- authenticated = app, service_role = Edge Function, null = SQL Editor
  db_user               text        not null,   -- database login (postgres in the SQL Editor)
  device_unverified     text,                   -- device ID sent by the app. UNVERIFIED
  staff_id_unverified   text,                   -- employee signed in at the till (staffBy). UNVERIFIED
  staff_name_unverified text,                   -- their name (staffByName). UNVERIFIED
  note                  text,
  prev_hash             text        not null,   -- seal of the row before ('' for the first row)
  row_hash              text        not null    -- SHA-256 of prev_hash + this row's content
);
create index if not exists erp_history_key_idx on erp_audit.erp_history (table_name, record_key, id);
create index if not exists erp_history_at_idx  on erp_audit.erp_history (at);

-- 3. Gaps: a change that was saved but whose history row could not be written. Keeps what is needed to investigate.
create table if not exists erp_audit.erp_audit_gaps (
  id                    bigint generated always as identity primary key,
  at                    timestamptz not null default clock_timestamp(),
  tx_id                 bigint      not null default txid_current(),
  table_name            text,
  op                    text,
  record_key            text,
  ver                   bigint,                 -- the version the record got in this save
  old_row               jsonb,                  -- the values the history missed (null if even these couldn't be kept)
  new_row               jsonb,
  account_email         text,
  account_session       text,
  device_unverified     text,
  staff_id_unverified   text,
  error                 text,
  sqlstate              text
);
-- 4. A gap is closed by a separate row (gaps themselves are never changed).
create table if not exists erp_audit.erp_audit_gap_closures (
  id         bigint generated always as identity primary key,
  gap_id     bigint not null references erp_audit.erp_audit_gaps (id),
  at         timestamptz not null default clock_timestamp(),
  history_id bigint references erp_audit.erp_history (id),  -- the RESYNC row that now holds the record's state
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

-- 6. The seal of one row. The same formula is used when writing and when checking.
create or replace function erp_audit.seal(h erp_audit.erp_history) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws(chr(31), h.prev_hash, (extract(epoch from h.at) * 1000000)::bigint::text, h.tx_id::text,
    h.table_name, h.op, h.record_key, coalesce(h.old_row::text, '~'), coalesce(h.new_row::text, '~'), coalesce(h.account_uid::text, '~'),
    coalesce(h.account_email, '~'), coalesce(h.account_session, '~'), coalesce(h.account_role, '~'), h.db_user,
    coalesce(h.device_unverified, '~'), coalesce(h.staff_id_unverified, '~'), coalesce(h.staff_name_unverified, '~'),
    coalesce(h.note, '~')), 'UTF8')), 'hex')
$$;

-- 7. Sign-in details that Supabase attaches to each request (empty in the SQL Editor).
create or replace function erp_audit.claims() returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  return coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
exception when others then return '{}'::jsonb;
end $$;

-- 8. Add one row to the history, one at a time (a short lock) so the seal chain has no forks. Returns the new row's id.
create or replace function erp_audit.append(tbl text, op text, k text, o jsonb, n jsonb, note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare c jsonb := erp_audit.claims(); d jsonb := coalesce(n, o); h erp_audit.erp_history; new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('erp_audit.erp_history'));
  h.at := clock_timestamp(); h.tx_id := txid_current(); h.table_name := tbl; h.op := op; h.record_key := k;
  h.old_row := o; h.new_row := n; h.note := note; h.db_user := session_user;
  begin h.account_uid := nullif(c ->> 'sub', '')::uuid; exception when others then h.account_uid := null; end;
  h.account_email := c ->> 'email'; h.account_session := c ->> 'session_id'; h.account_role := c ->> 'role';
  h.device_unverified := d ->> 'device'; h.staff_id_unverified := d -> 'data' ->> 'staffBy'; h.staff_name_unverified := d -> 'data' ->> 'staffByName';
  select x.row_hash into h.prev_hash from erp_audit.erp_history x order by x.id desc limit 1;
  h.prev_hash := coalesce(h.prev_hash, '');
  h.row_hash := erp_audit.seal(h);
  insert into erp_audit.erp_history (at, tx_id, table_name, op, record_key, old_row, new_row, account_uid, account_email, account_session,
    account_role, db_user, device_unverified, staff_id_unverified, staff_name_unverified, note, prev_hash, row_hash)
  values (h.at, h.tx_id, h.table_name, h.op, h.record_key, h.old_row, h.new_row, h.account_uid, h.account_email, h.account_session,
    h.account_role, h.db_user, h.device_unverified, h.staff_id_unverified, h.staff_name_unverified, h.note, h.prev_hash, h.row_hash)
  returning id into new_id;
  return new_id;
end $$;

-- 9. The recorder: runs after every insert, update or delete. Three levels, so the save itself never fails:
--    (a) history row; if that fails (b) a gap row with the missed values; if that fails (c) a gap row with only the
--    path and error; if even that fails (d) a warning in the Supabase database log. Level (d) is the only silent case,
--    and the status check below still finds it while the record exists (see "if both fail" on the review page).
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
      values (tg_table_name, tg_op, k, (coalesce(n, o) ->> 'ver')::bigint, o, n, c ->> 'email', c ->> 'session_id',
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

-- 11. The status: COMPLETE only when every check passes. Read it with:  select * from erp_audit.audit_status;
create or replace view erp_audit.audit_status as
with
  recorder as (select count(distinct event_object_table) as n from information_schema.triggers
               where trigger_name = 'zz_erp_history' and event_object_table in ('erp_docs', 'erp_members')),
  open_gaps as (select count(*) as n from erp_audit.erp_audit_gaps g
                where not exists (select 1 from erp_audit.erp_audit_gap_closures c where c.gap_id = g.id)),
  uncovered as (
    select (select count(*) from public.erp_docs d where not exists (
              select 1 from erp_audit.erp_history h where h.table_name = 'erp_docs' and h.record_key = d.path and h.new_row = to_jsonb(d)))
         + (select count(*) from public.erp_members m where not exists (
              select 1 from erp_audit.erp_history h where h.table_name = 'erp_members' and h.record_key = m.email and h.new_row = to_jsonb(m))) as n),
  chain as (select count(*) filter (where s.prev_hash <> coalesce(s.prev, '') or s.row_hash <> s.recomputed) as broken, count(*) as rows
            from (select h.prev_hash, h.row_hash, lag(h.row_hash) over (order by h.id) as prev, erp_audit.seal(h) as recomputed
                  from erp_audit.erp_history h) s),
  last as (select id, row_hash, at from erp_audit.erp_history order by id desc limit 1)
select
  case when recorder.n = 2 and open_gaps.n = 0 and uncovered.n = 0 and chain.broken = 0 then 'COMPLETE'
       else 'INCOMPLETE' end as status,
  recorder.n = 2 as recorder_on,
  open_gaps.n as open_gaps,
  uncovered.n as records_without_history,
  chain.broken as broken_seals,
  chain.rows as history_rows,
  (select at from last) as last_change_at,
  (select id from last) as last_id,
  (select row_hash from last) as last_seal
from recorder, open_gaps, uncovered, chain;
revoke all on erp_audit.audit_status from public;

-- 12. Close gaps: copy the current state of every record without history (RESYNC), then close each open gap.
--     The gap row keeps the values that were missed at the time. Run by the owner only:  select * from erp_audit.reconcile('why');
create or replace function erp_audit.reconcile(why text default null) returns table (resynced int, gaps_closed int)
language plpgsql security definer set search_path = '' as $$
declare d record; g record; hid bigint; r int := 0; c int := 0;
begin
  for d in select x.* from public.erp_docs x where not exists (
      select 1 from erp_audit.erp_history h where h.table_name = 'erp_docs' and h.record_key = x.path and h.new_row = to_jsonb(x)) order by x.path loop
    perform erp_audit.append('erp_docs', 'RESYNC', d.path, null, to_jsonb(d), why); r := r + 1; end loop;
  for d in select x.* from public.erp_members x where not exists (
      select 1 from erp_audit.erp_history h where h.table_name = 'erp_members' and h.record_key = x.email and h.new_row = to_jsonb(x)) order by x.email loop
    perform erp_audit.append('erp_members', 'RESYNC', d.email, null, to_jsonb(d), why); r := r + 1; end loop;
  for g in select x.* from erp_audit.erp_audit_gaps x where not exists (select 1 from erp_audit.erp_audit_gap_closures y where y.gap_id = x.id) order by x.id loop
    select h.id into hid from erp_audit.erp_history h where h.table_name = g.table_name and h.record_key = g.record_key order by h.id desc limit 1;
    insert into erp_audit.erp_audit_gap_closures (gap_id, history_id, note)
    values (g.id, hid, coalesce(why, '') || case when hid is null then ' (record no longer exists; missed values are kept in the gap row)' else '' end);
    c := c + 1; end loop;
  return query select r, c;
end $$;

revoke all on function erp_audit.seal(erp_audit.erp_history), erp_audit.claims(), erp_audit.append(text, text, text, jsonb, jsonb, text),
  erp_audit.record_change(), erp_audit.refuse_change(), erp_audit.reconcile(text) from public;

-- 13. Start or restart. First run: BASELINE copy of every record. Run again after the rollback: a RESUMED note, then
--     RESYNC copies of the records that changed while recording was off, so the pause is closed and visible.
do $$
declare d record; first boolean := not exists (select 1 from erp_audit.erp_history);
  was_off boolean := not exists (select 1 from information_schema.triggers where trigger_name = 'zz_erp_history');
begin
  if first then
    for d in select * from public.erp_docs order by path loop perform erp_audit.append('erp_docs', 'BASELINE', d.path, null, to_jsonb(d)); end loop;
    for d in select * from public.erp_members order by email loop perform erp_audit.append('erp_members', 'BASELINE', d.email, null, to_jsonb(d)); end loop;
  elsif was_off then
    perform erp_audit.append('erp_audit', 'RESUMED', 'recording', null, null, 'recording turned on again');
    perform erp_audit.reconcile('changes made while recording was off');
  end if;
end $$;

-- 14. Attach the recorder. The name starts with "zz_" so it runs after any other trigger and sees the final version number.
drop trigger if exists zz_erp_history on public.erp_docs;
create trigger zz_erp_history after insert or update or delete on public.erp_docs
  for each row execute function erp_audit.record_change('path');
drop trigger if exists zz_erp_history on public.erp_members;
create trigger zz_erp_history after insert or update or delete on public.erp_members
  for each row execute function erp_audit.record_change('email');

commit;

-- Result: what the history holds now, then the status (expect COMPLETE).
select table_name, op, count(*) as rows from erp_audit.erp_history group by 1, 2 order by 1, 2;
select status, open_gaps, records_without_history, broken_seals, history_rows, last_seal from erp_audit.audit_status;
