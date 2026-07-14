-- =========================================================
-- WORK ORDER — migration: shared clipboard + "not related to me"
-- Run this ONCE in Supabase SQL Editor if you already ran the
-- original supabase-schema.sql. Safe to run — it only updates
-- policies, no data is touched.
-- =========================================================

drop policy if exists "employees can view their own tasks" on tasks;
drop policy if exists "employees can update their own tasks" on tasks;

-- Employees can see every task on the shared clipboard, not just their own
create policy "employees can view all tasks"
on tasks for select
to authenticated
using (true);

-- Employees can only modify a task that is CURRENTLY assigned to them
-- (used for "mark complete" and "not related to me" reassignment).
create policy "employees can update their own tasks"
on tasks for update
to authenticated
using (assigned_to = auth.uid())
with check (true);
