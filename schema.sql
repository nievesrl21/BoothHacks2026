-- =====================================================================
-- Booth Hacks database
-- Run this whole file once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It creates the tables, the security rules, and the sample teams,
-- prizes and judging criteria. Everything sample can be edited later
-- from the judges site's Organizer console.
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Kept apart from teams so students can list team names without seeing codes.
create table if not exists public.team_codes (
  team_id  uuid primary key references public.teams(id) on delete cascade,
  code     text not null check (length(trim(code)) >= 4)
);

create table if not exists public.prizes (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (length(trim(name)) > 0),
  description  text not null default '',
  sort         int  not null default 0
);

create table if not exists public.criteria (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  description  text not null default '',
  weight       numeric not null default 20 check (weight >= 0),
  sort         int  not null default 0
);

-- One row per person who can sign in to the judges site.
create table if not exists public.judges (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  email       text not null default '',
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- One submission per team; resubmitting replaces it.
create table if not exists public.submissions (
  team_id       uuid primary key references public.teams(id) on delete cascade,
  project_name  text not null,
  url           text not null,
  description   text not null,
  prize_ids     uuid[] not null default '{}',
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One scoresheet per judge per team. "scores" maps criterion id -> 1..5.
create table if not exists public.scores (
  judge_id    uuid not null references public.judges(user_id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  scores      jsonb not null default '{}'::jsonb,
  comments    text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (judge_id, team_id)
);

-- ---------- Who is who ------------------------------------------------

create or replace function public.is_judge() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.judges where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.judges where user_id = auth.uid() and is_admin);
$$;

-- ---------- Security rules (row level security) -----------------------

alter table public.teams       enable row level security;
alter table public.team_codes  enable row level security;
alter table public.prizes      enable row level security;
alter table public.criteria    enable row level security;
alter table public.judges      enable row level security;
alter table public.submissions enable row level security;
alter table public.scores      enable row level security;

-- Everyone (students included) can see team names and prizes.
create policy "anyone reads teams"   on public.teams  for select using (true);
create policy "anyone reads prizes"  on public.prizes for select using (true);
create policy "admins manage teams"  on public.teams  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage prizes" on public.prizes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Only organizers see or change team codes.
create policy "admins manage team codes" on public.team_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Judges see criteria, the judges list and every submission.
create policy "judges read criteria"    on public.criteria    for select to authenticated using (public.is_judge());
create policy "admins manage criteria"  on public.criteria    for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "judges read judges"      on public.judges      for select to authenticated using (public.is_judge());
create policy "admins manage judges"    on public.judges      for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "judges read submissions" on public.submissions for select to authenticated using (public.is_judge());
create policy "admins delete submissions" on public.submissions for delete to authenticated using (public.is_admin());

-- Judges see and write only their own scores; organizers see all of them.
create policy "read own scores or all as admin" on public.scores for select to authenticated
  using (judge_id = auth.uid() or public.is_admin());
create policy "judges add own scores" on public.scores for insert to authenticated
  with check (judge_id = auth.uid() and public.is_judge());
create policy "judges edit own scores" on public.scores for update to authenticated
  using (judge_id = auth.uid()) with check (judge_id = auth.uid() and public.is_judge());
create policy "admins delete scores" on public.scores for delete to authenticated using (public.is_admin());

-- Table privileges (row rules above still apply on top of these).
grant usage on schema public to anon, authenticated;
grant select on public.teams, public.prizes to anon;
grant select, insert, update, delete on public.teams, public.team_codes, public.prizes, public.criteria,
  public.judges, public.submissions, public.scores to authenticated;
revoke all on public.team_codes, public.criteria, public.judges, public.submissions, public.scores from anon;

-- ---------- Student actions (no login, checked by team code) ----------

create or replace function public.submit_project(
  p_team_id uuid, p_code text, p_project_name text, p_url text, p_description text, p_prize_ids uuid[]
) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare
  r public.submissions;
begin
  if not exists (select 1 from public.team_codes
                 where team_id = p_team_id and upper(trim(code)) = upper(trim(coalesce(p_code, '')))) then
    raise exception 'wrong_code';
  end if;
  if length(trim(coalesce(p_project_name, ''))) = 0 or length(p_project_name) > 80 then
    raise exception 'bad_name';
  end if;
  if coalesce(p_url, '') !~* '^https?://[^[:space:]]+\.[^[:space:]]+$' or length(p_url) > 500 then
    raise exception 'bad_url';
  end if;
  if length(trim(coalesce(p_description, ''))) < 20 or length(p_description) > 600 then
    raise exception 'bad_description';
  end if;
  if coalesce(array_length(p_prize_ids, 1), 0) = 0 then
    raise exception 'no_prizes';
  end if;
  if exists (select 1 from unnest(p_prize_ids) as x(id) where x.id not in (select id from public.prizes)) then
    raise exception 'bad_prize';
  end if;

  insert into public.submissions (team_id, project_name, url, description, prize_ids)
  values (p_team_id, trim(p_project_name), trim(p_url), trim(p_description), p_prize_ids)
  on conflict (team_id) do update
    set project_name = excluded.project_name,
        url          = excluded.url,
        description  = excluded.description,
        prize_ids    = excluded.prize_ids,
        updated_at   = now()
  returning * into r;
  return r;
end $$;

create or replace function public.get_submission(p_team_id uuid, p_code text)
returns setof public.submissions
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.team_codes
                 where team_id = p_team_id and upper(trim(code)) = upper(trim(coalesce(p_code, '')))) then
    raise exception 'wrong_code';
  end if;
  return query select * from public.submissions where team_id = p_team_id;
end $$;

-- ---------- Organizer action: add a judge by the email of their login ----

create or replace function public.add_judge(p_email text, p_name text, p_is_admin boolean default false)
returns public.judges
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  r public.judges;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    raise exception 'no_account';
  end if;
  insert into public.judges (user_id, name, email, is_admin)
  values (uid, trim(p_name), lower(trim(p_email)), coalesce(p_is_admin, false))
  on conflict (user_id) do update set name = excluded.name, email = excluded.email, is_admin = excluded.is_admin
  returning * into r;
  return r;
end $$;

revoke all on function public.submit_project(uuid, text, text, text, text, uuid[]) from public;
revoke all on function public.get_submission(uuid, text) from public;
revoke all on function public.add_judge(text, text, boolean) from public;
grant execute on function public.submit_project(uuid, text, text, text, text, uuid[]) to anon, authenticated;
grant execute on function public.get_submission(uuid, text) to anon, authenticated;
grant execute on function public.add_judge(text, text, boolean) to authenticated;
grant execute on function public.is_judge() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- Live updates for the judges site ---------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'submissions') then
      alter publication supabase_realtime add table public.submissions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'scores') then
      alter publication supabase_realtime add table public.scores;
    end if;
  end if;
end $$;

-- ---------- Sample data (edit or replace from the Organizer console) ----

insert into public.teams (name, sort) values
  ('Team Maroon', 1), ('Hyde Park Hackers', 2), ('Quad Squad', 3)
on conflict (name) do nothing;

insert into public.team_codes (team_id, code)
select id, case name when 'Team Maroon' then 'MAROON-4821'
                     when 'Hyde Park Hackers' then 'HYDE-7364'
                     else 'QUAD-5290' end
from public.teams where name in ('Team Maroon', 'Hyde Park Hackers', 'Quad Squad')
on conflict (team_id) do nothing;

insert into public.prizes (name, description, sort) values
  ('Best Overall',       'The strongest product across every criterion.', 1),
  ('Best Use of AI',     'AI that does real work for the user, not a bolt-on.', 2),
  ('Best Social Impact', 'Measurable good for a community or the planet.', 3)
on conflict (name) do nothing;

insert into public.criteria (name, description, weight, sort)
select * from (values
  ('Innovation & creativity',  'How original is the idea or approach? Does it tackle the problem in a new way?', 25, 1),
  ('Technical execution',      'Does it work? How complex and well-built is what the team shipped in the time available?', 25, 2),
  ('Impact & business value',  'Is the problem real and sizable? Is there a credible user, market or path to value?', 20, 3),
  ('Design & user experience', 'Is it intuitive, polished and pleasant to use?', 15, 4),
  ('Presentation',             'How clearly did the team explain the problem, demo the product and answer questions?', 15, 5)
) as v(name, description, weight, sort)
where not exists (select 1 from public.criteria);
