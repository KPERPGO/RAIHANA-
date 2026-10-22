-- Raihana ERP cloud sync. Run once in Supabase: SQL Editor > New query > paste > Run.
-- BEFORE you press Run: replace PUT-YOUR-EMAIL-HERE on the last line with the email you use to sign in to the app.
--
-- How it keeps the pharmacy safe:
--  * Only people listed in erp_members can read the data. Nobody else, even if they sign up.
--  * The app writes through erp_push(), never straight into the table, and nothing can be deleted.
--  * Every record has a version number counted by the server (not by a phone clock).
--    If two devices change the same record, the first one wins, and the other change is
--    kept in erp_conflicts so nothing is lost and the owner can look at it.

create sequence if not exists public.erp_ver_seq;

create table if not exists public.erp_docs (
  path text primary key,
  data jsonb not null,
  ver bigint not null default 0,
  device text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.erp_docs add column if not exists ver bigint not null default 0;
create index if not exists erp_docs_ver on public.erp_docs (ver);

create table if not exists public.erp_conflicts (
  id bigint generated always as identity primary key,
  path text not null,
  mine jsonb,
  theirs jsonb,
  device text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.erp_members (email text primary key);

-- who may use the data: the emails listed in erp_members
create or replace function public.erp_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.erp_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

-- the server gives every saved change the next version number
create or replace function public.erp_touch() returns trigger language plpgsql as $$
begin
  new.ver := nextval('public.erp_ver_seq'); new.updated_at := clock_timestamp(); new.updated_by := auth.uid(); return new;
end $$;
drop trigger if exists erp_touch on public.erp_docs;
create trigger erp_touch before insert or update on public.erp_docs for each row execute function public.erp_touch();

-- save a batch of changes. Each row says which server version it was based on (base).
-- Same version: saved. Someone else got there first: not saved, the row goes to erp_conflicts.
create or replace function public.erp_push(rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; cur public.erp_docs; v bigint; res jsonb := '[]'::jsonb; p text;
begin
  if not public.erp_is_member() then raise exception 'Not a pharmacy member' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    p := r ->> 'path';
    select * into cur from public.erp_docs where path = p for update;
    if not found then
      insert into public.erp_docs (path, data, device) values (p, r -> 'data', r ->> 'device')
        on conflict (path) do nothing returning ver into v;
      if v is not null then res := res || jsonb_build_object('path', p, 'ok', true, 'ver', v); continue; end if;
      select * into cur from public.erp_docs where path = p;
    end if;
    if cur.data = r -> 'data' then
      res := res || jsonb_build_object('path', p, 'ok', true, 'ver', cur.ver);
    elsif cur.ver = coalesce((r ->> 'base')::bigint, 0) then
      update public.erp_docs set data = r -> 'data', device = r ->> 'device' where path = p returning ver into v;
      res := res || jsonb_build_object('path', p, 'ok', true, 'ver', v);
    else
      insert into public.erp_conflicts (path, mine, theirs, device, created_by) values (p, r -> 'data', cur.data, r ->> 'device', auth.uid());
      res := res || jsonb_build_object('path', p, 'ok', false, 'ver', cur.ver, 'data', cur.data);
    end if;
  end loop;
  return res;
end $$;

alter table public.erp_docs enable row level security;
alter table public.erp_conflicts enable row level security;
alter table public.erp_members enable row level security;
drop policy if exists "staff read" on public.erp_docs;
drop policy if exists "staff write" on public.erp_docs;
drop policy if exists "staff update" on public.erp_docs;
drop policy if exists "members read" on public.erp_docs;
drop policy if exists "members read conflicts" on public.erp_conflicts;
create policy "members read" on public.erp_docs for select to authenticated using (public.erp_is_member());
create policy "members read conflicts" on public.erp_conflicts for select to authenticated using (public.erp_is_member());
-- no insert, update or delete policies: the app can only change data through erp_push()

revoke all on public.erp_docs, public.erp_conflicts, public.erp_members from anon, authenticated;
grant select on public.erp_docs, public.erp_conflicts to authenticated;
revoke all on function public.erp_push(jsonb) from public, anon;
revoke all on function public.erp_is_member() from public, anon;
grant execute on function public.erp_push(jsonb) to authenticated;
grant execute on function public.erp_is_member() to authenticated;

-- Add every person who may use the app (one line each). Then create their login in Authentication > Users > Add user.
-- Also turn off public sign-ups: Authentication > Sign In / Providers > Email > "Allow new users to sign up" OFF.
insert into public.erp_members (email) values ('PUT-YOUR-EMAIL-HERE') on conflict do nothing;
