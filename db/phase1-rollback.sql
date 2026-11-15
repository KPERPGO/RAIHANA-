-- Raihana ERP · Phase 1 rollback: stop recording. ALL collected history is kept.
-- Run only if you decide to undo Phase 1. SQL Editor > New query > paste > Run.
-- It removes only the two recorder triggers that Phase 1 added. It deletes nothing: erp_docs, erp_members, erp_push,
-- every pharmacy record, the history, the gaps and their closures all stay exactly as they are.
-- To turn recording on again later, run phase1-change-history.sql again: it notes RESUMED and copies (RESYNC) every
-- record that changed while recording was off, so the pause is visible in the history and no record is left uncovered.

begin;
-- a note in the history that recording was turned off on purpose, and when
select erp_audit.append('erp_audit', 'PAUSED', 'recording', null, null, 'recording turned off by phase1-rollback.sql');
drop trigger if exists zz_erp_history on public.erp_docs;
drop trigger if exists zz_erp_history on public.erp_members;
commit;

-- Check: expect no rows (no recorder left on the app's tables), and status INCOMPLETE with recorder_on = false
select event_object_table, trigger_name from information_schema.triggers where trigger_name = 'zz_erp_history';
select status, recorder_on, history_rows from erp_audit.audit_status;
