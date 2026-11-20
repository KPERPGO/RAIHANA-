-- Raihana ERP · Phase 1 rollback (revision 3): stop recording. ALL collected history is kept.
-- Run only if you decide to undo Phase 1. SQL Editor > New query > paste > Run.
-- It removes only the two recorder triggers that Phase 1 added. It deletes nothing: erp_docs, erp_members, erp_push,
-- every pharmacy record, the history, the gaps and their closures all stay exactly as they are.
-- While recording is off, the status says PAUSED. To turn recording on again, run phase1-change-history.sql again:
-- it writes RESUMED and runs reconcile, which adds a RECONSTRUCTED event for every record changed, added or deleted
-- while recording was off. (A record that was both added and deleted while off leaves no trace; see the review page.)

begin;
set local lock_timeout = '20s';
lock table public.erp_docs, public.erp_members in share row exclusive mode;   -- saves wait a moment, then go through
select erp_audit.append('erp_audit', 'PAUSED', 'recording', null, null, 'recording turned off by phase1-rollback.sql');
drop trigger if exists zz_erp_history on public.erp_docs;
drop trigger if exists zz_erp_history on public.erp_members;
commit;

-- Check: expect no rows (no recorder left on the app's tables), then status PAUSED and recording PAUSED
select tgrelid::regclass as watched_table, tgname from pg_trigger where tgname = 'zz_erp_history';
select status, recording, history_rows from erp_audit.audit_status;
