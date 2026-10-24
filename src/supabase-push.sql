-- Raihana ERP: the morning phone notification, 24 Oct 2026. Run once in Supabase, before deploying the function
-- "daily-stock-push" (src/supabase-push-function.ts). SQL Editor > New query > paste all of this > Run.
-- It changes no pharmacy data and can be run again safely.

-- the notification keys and the send token. Made by the function itself; no app user can read this table
create table if not exists public.erp_push_keys (
  id int primary key,
  public_key text not null,
  private_key text not null,
  token text not null,
  url text,
  last_sent timestamptz
);
alter table public.erp_push_keys enable row level security; -- no policies: only the server function reads it
revoke all on public.erp_push_keys from anon, authenticated;

-- every morning at 8:00 Baghdad time (05:00 UTC) the database asks the function to send the list
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'raihana-daily-push';
select cron.schedule('raihana-daily-push', '0 5 * * *', $job$
  select net.http_post(
    url := (select url from public.erp_push_keys where id = 1) || '/functions/v1/daily-stock-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('token', (select token from public.erp_push_keys where id = 1)))
  where exists (select 1 from public.erp_push_keys where id = 1);
$job$);
