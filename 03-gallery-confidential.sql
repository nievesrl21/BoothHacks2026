-- =====================================================================
-- Booth Hacks: project gallery + confidential projects (run AFTER 02-team-registration.sql)
-- SQL Editor -> New query -> paste this whole file -> Run. Safe to run twice.
-- =====================================================================

-- A team can keep its project out of the gallery. Judges and organizers still see it.
alter table public.submissions add column if not exists confidential boolean not null default false;

-- Organizers can show or hide the gallery for everyone.
alter table public.event_settings add column if not exists gallery_open boolean not null default true;

-- submit_project gains a "confidential" choice (replaces the earlier version).
drop function if exists public.submit_project(uuid, text, text, text, text, uuid[]);
create or replace function public.submit_project(
  p_team_id uuid, p_code text, p_project_name text, p_url text, p_description text, p_prize_ids uuid[],
  p_confidential boolean default false
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

  insert into public.submissions (team_id, project_name, url, description, prize_ids, confidential)
  values (p_team_id, trim(p_project_name), trim(p_url), trim(p_description), p_prize_ids, coalesce(p_confidential, false))
  on conflict (team_id) do update
    set project_name = excluded.project_name,
        url          = excluded.url,
        description  = excluded.description,
        prize_ids    = excluded.prize_ids,
        confidential = excluded.confidential,
        updated_at   = now()
  returning * into r;
  return r;
end $$;

revoke all on function public.submit_project(uuid, text, text, text, text, uuid[], boolean) from public;
grant execute on function public.submit_project(uuid, text, text, text, text, uuid[], boolean) to anon, authenticated;

-- What students see in the gallery: only non-confidential projects, and only while the gallery is open.
create or replace function public.gallery()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when not coalesce((select gallery_open from public.event_settings where id = 1), false)
      then jsonb_build_object('open', false, 'projects', '[]'::jsonb, 'confidential', 0)
    else jsonb_build_object(
      'open', true,
      'projects', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'team', t.name, 'project', s.project_name, 'url', s.url,
                 'description', s.description, 'prize_ids', s.prize_ids, 'updated_at', s.updated_at)
               order by t.name)
        from public.submissions s join public.teams t on t.id = s.team_id
        where not s.confidential), '[]'::jsonb),
      'confidential', (select count(*) from public.submissions where confidential))
  end;
$$;

revoke all on function public.gallery() from public;
grant execute on function public.gallery() to anon, authenticated;
