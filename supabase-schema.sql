-- =========================================================
-- WORK ORDER — database setup
-- Run this ONCE in Supabase: SQL Editor -> New Query -> paste -> Run
-- =========================================================

create extension if not exists pgcrypto;

-- One row per person (boss or employee), linked to their login account
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  email text,
  role text not null default 'employee' check (role in ('boss','employee')),
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "profiles are viewable by any logged in user"
on profiles for select
to authenticated
using (true);

create policy "a user can create their own profile row"
on profiles for insert
to authenticated
with check (auth.uid() = id);

-- Tasks / work orders
create table if not exists tasks (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  deadline date not null,
  status text not null default 'pending' check (status in ('pending','complete')),
  assigned_to uuid references profiles(id) on delete cascade,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  completed_at timestamptz
);

alter table tasks enable row level security;

-- Tracks the full history of who a task was given to / passed to
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

-- Everyone logged in can see task history (matches the shared clipboard's transparency)
create policy "task history is viewable by any logged in user"
on task_events for select
to authenticated
using (true);

-- Anyone logged in can log an event, but only crediting themselves as the actor
create policy "a user can log an event as themselves"
on task_events for insert
to authenticated
with check (actor = auth.uid());

-- The boss can see, create, edit, and delete every task
create policy "boss has full access to tasks"
on tasks for all
to authenticated
using (exists (select 1 from profiles where id = auth.uid() and role = 'boss'))
with check (exists (select 1 from profiles where id = auth.uid() and role = 'boss'));

-- Employees can see every task on the shared clipboard, not just their own
create policy "employees can view all tasks"
on tasks for select
to authenticated
using (true);

-- Employees can only modify a task that is CURRENTLY assigned to them
-- (used for "mark complete" and "not related to me" reassignment).
-- The "with check (true)" allows the update to change assigned_to to
-- someone else; the "using" clause is what actually restricts this to
-- rows that belonged to them before the update.
create policy "employees can update their own tasks"
on tasks for update
to authenticated
using (assigned_to = auth.uid())
with check (true);
