-- =====================================================================
-- Booth Hacks: team registration (run AFTER schema.sql)
-- SQL Editor -> New query -> paste this whole file -> Run. Run it once.
-- Lets students register a team with 1-5 members from the student site.
-- =====================================================================

-- Teams created by students are stamped; teams you add in the console stay null.
alter table public.teams add column if not exists registered_at timestamptz;

create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  email       text not null default '',
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

-- One row of event-wide switches.
create table if not exists public.event_settings (
  id                 int primary key default 1 check (id = 1),
  registration_open  boolean not null default true
);
insert into public.event_settings (id) values (1) on conflict (id) do nothing;

alter table public.team_members   enable row level security;
alter table public.event_settings enable row level security;

-- Member names and emails: organizers only.
drop policy if exists "admins manage team members" on public.team_members;
create policy "admins manage team members" on public.team_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Everyone can see whether registration is open; only organizers change it.
drop policy if exists "anyone reads event settings" on public.event_settings;
drop policy if exists "admins change event settings" on public.event_settings;
create policy "anyone reads event settings"  on public.event_settings for select using (true);
create policy "admins change event settings" on public.event_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.team_members to authenticated;
revoke all on public.team_members from anon;
grant select on public.event_settings to anon, authenticated;
grant update on public.event_settings to authenticated;

-- ---------- Student action: register a team ----------------------------
-- p_members is a JSON list like [{"name":"Ana Ruiz","email":"ana@chicagobooth.edu"}, ...]
create or replace function public.register_team(p_team_name text, p_members jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := regexp_replace(trim(coalesce(p_team_name, '')), '\s+', ' ', 'g');
  v_id    uuid;
  v_code  text;
  v_email text;
  m       jsonb;
  i       int := 0;
begin
  if not coalesce((select registration_open from public.event_settings where id = 1), false) then
    raise exception 'registration_closed';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'bad_team_name';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array'
     or jsonb_array_length(p_members) < 1 or jsonb_array_length(p_members) > 5 then
    raise exception 'bad_member_count';
  end if;
  for m in select value from jsonb_array_elements(p_members) loop
    if length(trim(coalesce(m->>'name', ''))) = 0 or length(m->>'name') > 80 then
      raise exception 'bad_member_name';
    end if;
    v_email := lower(trim(coalesce(m->>'email', '')));
    if v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'bad_member_email';
    end if;
    if v_email <> '' and exists (select 1 from public.team_members where email = v_email) then
      raise exception 'member_already_registered:%', v_email;
    end if;
  end loop;
  if exists (select 1 from public.teams where lower(name) = lower(v_name)) then
    raise exception 'team_name_taken';
  end if;
  if (select count(*) from public.teams) >= 300 then
    raise exception 'too_many_teams';
  end if;

  insert into public.teams (name, sort, registered_at)
  values (v_name, (select coalesce(max(sort), 0) + 1 from public.teams), now())
  returning id into v_id;

  v_code := upper(left(regexp_replace(v_name, '[^A-Za-z]', '', 'g') || 'TEAM', 6))
            || '-' || (1000 + floor(random() * 9000))::int::text;
  insert into public.team_codes (team_id, code) values (v_id, v_code);

  for m in select value from jsonb_array_elements(p_members) loop
    i := i + 1;
    insert into public.team_members (team_id, name, email, sort)
    values (v_id, trim(m->>'name'), lower(trim(coalesce(m->>'email', ''))), i);
  end loop;

  return jsonb_build_object('team_id', v_id, 'team_name', v_name, 'code', v_code);
end $$;

revoke all on function public.register_team(text, jsonb) from public;
grant execute on function public.register_team(text, jsonb) to anon, authenticated;

-- New registrations show up live in the Organizer console.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'teams') then
      alter publication supabase_realtime add table public.teams;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'team_members') then
      alter publication supabase_realtime add table public.team_members;
    end if;
  end if;
end $$;
