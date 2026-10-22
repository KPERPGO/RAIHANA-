-- Raihana ERP cloud sync. Run once in Supabase: SQL Editor > New query > paste > Run.
-- One table holds every record. Only signed-in pharmacy staff can read or write it.
create table if not exists public.erp_docs (
  path text primary key,
  data jsonb not null,
  rev bigint not null default 0,
  device text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists erp_docs_updated on public.erp_docs (updated_at);

create or replace function public.erp_touch() returns trigger language plpgsql as $$
begin
  -- keep the newer change when two devices edit the same record
  if tg_op = 'UPDATE' and new.rev < old.rev then return old; end if;
  new.updated_at := clock_timestamp(); new.updated_by := auth.uid(); return new;
end $$;
drop trigger if exists erp_touch on public.erp_docs;
create trigger erp_touch before insert or update on public.erp_docs for each row execute function public.erp_touch();

alter table public.erp_docs enable row level security;
drop policy if exists "staff read" on public.erp_docs;
drop policy if exists "staff write" on public.erp_docs;
drop policy if exists "staff update" on public.erp_docs;
create policy "staff read" on public.erp_docs for select to authenticated using (true);
create policy "staff write" on public.erp_docs for insert to authenticated with check (true);
create policy "staff update" on public.erp_docs for update to authenticated using (true);
-- Add staff in Supabase: Authentication > Users > Add user. Turn off public sign-ups in Authentication > Providers > Email.
