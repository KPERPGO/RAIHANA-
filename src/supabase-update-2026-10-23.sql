-- Raihana ERP cloud update, 23 Oct 2026: finished records can't be changed from any device.
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run. It changes no data and can be run again safely.
-- Same statements as in supabase-setup.sql (a test checks they match).

-- Finished records stay as they were saved. A sale, expense, customer payment, stock change, stocktake, journal entry,
-- dose record or event may only gain a cancel mark (and who approved it); its amounts, lines and dates never change,
-- it is never deleted, and once cancelled it is never changed again. Any other change is refused and kept in erp_conflicts.
alter table public.erp_conflicts add column if not exists reason text;
create or replace function public.erp_locked_change(p text, old jsonb, new jsonb) returns boolean
language sql immutable set search_path = public as $$
  select split_part(p, '/', 1) in ('sales', 'expenses', 'custpays', 'moves', 'counts', 'journal', 'doselog', 'events')
    and (coalesce(old ->> 'voided', 'false') = 'true'
      or new ? '__deleted'
      or (old - array['voided','voidedAt','voidReason','voidedBy','approvedBy','staffBy','staffByName','staffAt','__rev'])
         is distinct from (new - array['voided','voidedAt','voidReason','voidedBy','approvedBy','staffBy','staffByName','staffAt','__rev']))
$$;

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
    elsif public.erp_locked_change(p, cur.data, r -> 'data') then
      insert into public.erp_conflicts (path, mine, theirs, device, created_by, reason) values (p, r -> 'data', cur.data, r ->> 'device', auth.uid(), 'finished record');
      res := res || jsonb_build_object('path', p, 'ok', false, 'ver', cur.ver, 'data', cur.data);
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

revoke all on function public.erp_locked_change(text, jsonb, jsonb) from public, anon;
revoke all on function public.erp_push(jsonb) from public, anon;
grant execute on function public.erp_push(jsonb) to authenticated;
