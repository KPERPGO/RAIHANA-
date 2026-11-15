-- Raihana ERP · Phase 1 checks. These only READ (except Check 6, which you run only to close gaps).
-- Run each block on its own in the SQL Editor.

-- Check 1: the overall status. Expect status = COMPLETE, recorder_on = true, and 0 in the next three columns.
-- Write down last_id and last_seal once a week (for example in a note on your phone). If the history were ever cut
-- short, last_id would go down or last_seal would no longer be found by Check 5.
select * from erp_audit.audit_status;

-- Check 2: the starting copy matches the records (expect the same number in both columns)
select (select count(*) from public.erp_docs) as records_now,
       (select count(distinct record_key) from erp_audit.erp_history where table_name = 'erp_docs') as records_in_history;

-- Check 3: app users can't open, read or change the history (expect false in every column)
select has_schema_privilege('authenticated', 'erp_audit', 'usage') as app_can_open_folder,
       has_table_privilege('authenticated', 'erp_audit.erp_history', 'select') as app_can_read,
       has_table_privilege('authenticated', 'erp_audit.erp_history', 'update') as app_can_change,
       has_table_privilege('anon', 'erp_audit.erp_history', 'select') as public_can_read,
       has_table_privilege('service_role', 'erp_audit.erp_history', 'select') as edge_function_can_read;

-- Check 4: open gaps, with what is needed to investigate them (expect no rows)
select g.id, g.at, g.op, g.record_key, g.ver, g.device_unverified, g.staff_id_unverified, g.error,
       g.old_row -> 'data' as missed_before, g.new_row -> 'data' as missed_after
from erp_audit.erp_audit_gaps g
where not exists (select 1 from erp_audit.erp_audit_gap_closures c where c.gap_id = g.id) order by g.id;

-- Check 5: the seal you wrote down is still in the history. Replace the text in quotes with your saved last_seal.
select id, at from erp_audit.erp_history where row_hash = 'PASTE-YOUR-SAVED-last_seal-HERE';

-- Check 6 (only when Check 1 says INCOMPLETE because of gaps or records without history):
-- copies the current state of uncovered records and closes the gaps. It changes no pharmacy record.
-- Remove the two dashes to run it.
-- select * from erp_audit.reconcile('closed after checking on ' || current_date);

-- Check 7: the latest 20 changes, newest first
select at, op, record_key, account_email, device_unverified, staff_name_unverified, new_row ->> 'ver' as ver
from erp_audit.erp_history order by id desc limit 20;

-- Check 8: every version of one record. Replace meta/erp with any path from Check 7.
select at, op, account_email, staff_name_unverified, old_row -> 'data' as before, new_row -> 'data' as after
from erp_audit.erp_history where table_name = 'erp_docs' and record_key = 'meta/erp' order by id;

-- Check 9: when recording was turned off and on
select at, op, note from erp_audit.erp_history where op in ('PAUSED', 'RESUMED') order by id;
