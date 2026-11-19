-- Apply only after a tested replacement is live and verified. Existing rows stay intact.
-- Verify other consumers of this table before applying; rollback is to restore the original grant/policy.
-- Order: 202611170001_analytics.sql, 202611190001_lead_abuse_guard.sql,
--        deploy the two functions, confirm one real lead saves through lead-capture,
--        then apply this file last.
drop policy if exists public_can_insert_orders on public.orders;
revoke insert on public.orders from anon, authenticated;
