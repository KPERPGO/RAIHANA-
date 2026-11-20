-- Raihana ERP · Phase 1 checks (revision 3). These only READ, except Check 6, which you run only to close gaps.
-- Run each block on its own in the SQL Editor.

-- Check 1: the overall status.
--   COMPLETE   everything accounted for, nothing ever recovered or reconstructed
--   RECOVERED  everything accounted for; some events were put back from gaps or reconstructed (see Check 8)
--   INCOMPLETE something is missing or a seal is broken: look at the columns, then Checks 3 to 5
--   PAUSED     recording was turned off on purpose with the rollback file
-- Write down last_id and last_seal once a week, outside Supabase (for example in a note on your phone).
select * from erp_audit.audit_status;

-- Check 2: app users can't open, read or change the history (expect false in every column)
select has_schema_privilege('authenticated', 'erp_audit', 'usage') as app_can_open_folder,
       has_table_privilege('authenticated', 'erp_audit.erp_history', 'select') as app_can_read,
       has_table_privilege('authenticated', 'erp_audit.erp_history', 'update') as app_can_change,
       has_table_privilege('anon', 'erp_audit.erp_history', 'select') as public_can_read,
       has_table_privilege('service_role', 'erp_audit.erp_history', 'select') as edge_function_can_read;

-- Check 3: open gaps, with what is needed to investigate them (expect no rows)
select g.id, g.at, g.op, g.record_key, g.ver, g.device_unverified, g.staff_id_unverified, g.error,
       g.old_row -> 'data' as missed_before, g.new_row -> 'data' as missed_after
from erp_audit.erp_audit_gaps g
where not exists (select 1 from erp_audit.erp_audit_gap_closures c where c.gap_id = g.id) order by g.id;

-- Check 4: every place the history doesn't account for the records (expect no rows)
--   break = changes missed between two recorded events; not_current = changes missed before the current state;
--   missing_delete = a record deleted without a history entry
select kind, table_name, record_key, prev_id, event_id, known_before ->> 'ver' as ver_before, known_after ->> 'ver' as ver_after
from erp_audit.findings() order by table_name, record_key;

-- Check 5: the seal you wrote down is still in the history. Replace the text in quotes with your saved last_seal.
select id, recorded_at from erp_audit.erp_history where row_hash = 'PASTE-YOUR-SAVED-last_seal-HERE';

-- Check 6 (only when Check 1 says INCOMPLETE because of gaps or findings, and the cause is fixed):
-- puts missed events back from gaps, reconstructs what can't be recovered, closes the gaps. It changes no pharmacy record.
-- Remove the two dashes to run it.
-- select * from erp_audit.reconcile('closed after checking on ' || current_date);

-- Check 7: the latest 20 events, newest first
select recorded_at, op, record_key, account_email, device_unverified, staff_name_unverified, new_row ->> 'ver' as ver
from erp_audit.erp_history order by id desc limit 20;

-- Check 8: every recovered or reconstructed event, and why
select id, op, record_key, event_at, recorded_at, recovered_gap_id, note
from erp_audit.erp_history where recovered_gap_id is not null or op = 'RECONSTRUCTED' order by id;

-- Check 9: every version of one record, in its own order. Replace meta/erp with any path from Check 7.
select ord as version, op, event_at, account_email, staff_name_unverified, old_row -> 'data' as before, new_row -> 'data' as after
from erp_audit.erp_history where table_name = 'erp_docs' and record_key = 'meta/erp' order by ord, id;

-- Check 10: when recording was turned off and on
select recorded_at, op, note from erp_audit.erp_history where op in ('PAUSED', 'RESUMED') order by id;
