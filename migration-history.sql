-- =========================================================
-- WORK ORDER — migration: task reassignment history
-- Run this ONCE in Supabase SQL Editor. Safe to run alongside
-- your existing data — it only adds a new table.
-- =========================================================

create table if not exists task_events (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references tasks(id) on delete cascade,
  event_type text not null check (event_type in ('assigned','reassigned')),
  from_employee uuid references profiles(id),
  to_employee uuid references profiles(id),
  actor uuid references profiles(id),
  created_at timestamptz default now()
);

alter table task_events enable row level security;

drop policy if exists "task history is viewable by any logged in user" on task_events;
create policy "task history is viewable by any logged in user"
on task_events for select
to authenticated
using (true);

drop policy if exists "a user can log an event as themselves" on task_events;
create policy "a user can log an event as themselves"
on task_events for insert
to authenticated
with check (actor = auth.uid());
