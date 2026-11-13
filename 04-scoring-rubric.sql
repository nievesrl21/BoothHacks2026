-- =====================================================================
-- Booth Hacks: new scoring rubric (run AFTER 03-gallery-confidential.sql)
-- SQL Editor -> New query -> paste this whole file -> Run. Safe to run twice.
--
-- What it does:
--   * Every criterion is rated 1-3 (Strong / Adequate / Weak) and has two weights:
--     one for Best Overall, one for the category prizes.
--   * Category prizes add "Prize Fit" (1-3), rated by the judges assigned to that prize.
--   * Every total is out of 300.
--   * Judges also answer "Is there a working demo?" for each team.
--   * Loads the five core criteria, the seven prizes and their Prize Fit rubrics.
--   * Judges are assigned to prizes afterwards, in the judges site's Prizes tab.
--   * The FIRST time it runs, it clears scores saved on the old 1-5 scale.
-- =====================================================================

-- ---------- New columns -------------------------------------------------

-- "weight" stays the Best Overall weight; weight_category is used by every category prize.
alter table public.criteria add column if not exists weight_category numeric not null default 0 check (weight_category >= 0);
alter table public.criteria add column if not exists strong   text not null default '';
alter table public.criteria add column if not exists adequate text not null default '';
alter table public.criteria add column if not exists weak     text not null default '';

-- The overall prize uses every judge and has no Prize Fit.
alter table public.prizes add column if not exists is_overall   boolean not null default false;
alter table public.prizes add column if not exists fit_weight   numeric not null default 30 check (fit_weight >= 0);
alter table public.prizes add column if not exists fit_strong   text not null default '';
alter table public.prizes add column if not exists fit_adequate text not null default '';
alter table public.prizes add column if not exists fit_weak     text not null default '';

-- Table stakes: did this judge see a working demo? (null = not answered)
alter table public.scores add column if not exists demo_ok boolean;

-- ---------- Which judges score which prize ------------------------------

create table if not exists public.prize_judges (
  prize_id  uuid not null references public.prizes(id) on delete cascade,
  judge_id  uuid not null references public.judges(user_id) on delete cascade,
  is_lead   boolean not null default false,
  primary key (prize_id, judge_id)
);
alter table public.prize_judges enable row level security;

drop policy if exists "judges read prize judges"   on public.prize_judges;
drop policy if exists "admins manage prize judges" on public.prize_judges;
create policy "judges read prize judges"   on public.prize_judges for select to authenticated using (public.is_judge());
create policy "admins manage prize judges" on public.prize_judges for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.prize_judges to authenticated;
revoke all on public.prize_judges from anon;

-- ---------- Switch to the new criteria (first run only) -----------------

do $$
begin
  if not exists (select 1 from public.criteria where name = 'User, Problem & Value') then
    -- Old scores were on a 1-5 scale against the old criteria; they can't be converted.
    delete from public.scores;
    delete from public.criteria;
    insert into public.criteria (name, description, weight, weight_category, strong, adequate, weak, sort) values
      ('User, Problem & Value', 'Is it a problem worth solving for a clear user, tied to the prompt?', 25, 15,
       'Real problem, clear user, ties to the prompt', 'Right problem; user or value is generic', 'Vague problem or unclear beneficiary', 1),
      ('Evidence & Opportunity', 'Does the evidence support the choice, and is the opportunity real?', 20, 10,
       'Evidence backs the choice; clear opportunity', 'Some evidence; gaps in the case', 'Little evidence; opportunity asserted', 2),
      ('Product Judgment & MVP', 'Is the product focused, valuable, and shown in a working demo?', 25, 20,
       'Focused, valuable, shown in a working demo', 'Sensible, but broad or thin demo', 'Unfocused; demo does not show the idea', 3),
      ('Positioning & Adoption', 'Does the team convey why the target user cares and the idea is valuable?', 20, 15,
       'Compelling why users care; adoption path', 'Value stated; adoption story thin', 'Unclear why users would care', 4),
      ('Measurement & Viability', 'Would the measures show real value and a sustainable path forward?', 10, 10,
       'Specific measures; sustainable path', 'Reasonable metrics; loosely tied', 'No clear measures', 5);
  end if;
end $$;

-- ---------- The seven prizes ---------------------------------------------

-- The sample prize from the first setup.
delete from public.prizes where name = 'Best Social Impact';

insert into public.prizes (name, description, is_overall, fit_weight, fit_strong, fit_adequate, fit_weak, sort) values
  ('Best Overall', 'The strongest product across the five core criteria. Every team is considered.', true, 0, '', '', '', 1),
  ('Best Use of AI', 'AI is essential to the value and used with purpose.', false, 30,
   'AI is essential to the value and used with purpose', 'AI helps, but the product works without it', 'AI is decorative or bolted on', 2),
  ('Best EdTech Product for Higher Ed', 'A clear higher-ed need; improves teaching or learning.', false, 30,
   'Clear higher-ed need; improves teaching or learning', 'Education-adjacent; need only partly clear', 'No clear teaching or learning use', 3),
  ('Most Likely to Become a Unicorn', 'Large market, differentiated, with a credible path to scale.', false, 30,
   'Large market, differentiated, credible path to scale', 'Decent market, but thin differentiation or scale path', 'Niche, with no clear path to scale', 4),
  ('Best Data Driven Product', 'Real data drives the insight, decisions, or experience.', false, 30,
   'Real data drives the insight, decisions, or experience', 'Data is used, but peripheral to the value', 'Little or no real data use', 5),
  ('Best Sustainability Product', 'Clear, credible, feasible sustainability impact.', false, 30,
   'Clear, credible, feasible sustainability impact', 'Plausible impact, thinly supported', 'Impact is tangential or unsupported', 6),
  ('Best Healthcare Product', 'A meaningful health need, met with empathy and responsible execution.', false, 30,
   'Meaningful health need, empathy, responsible execution', 'Health-adjacent; empathy or execution is thin', 'Weak link to health outcomes or access', 7)
on conflict (name) do update set
  description = excluded.description, is_overall = excluded.is_overall, fit_weight = excluded.fit_weight,
  fit_strong = excluded.fit_strong, fit_adequate = excluded.fit_adequate, fit_weak = excluded.fit_weak, sort = excluded.sort;

-- ---------- Prize judges ---------------------------------------------
-- Assign judges to prizes in the judges site -> Organizer console -> Prizes
-- ("Who judges each prize"). Judge names are kept out of this public file.

-- ---------- Live updates -------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'prize_judges') then
      alter publication supabase_realtime add table public.prize_judges;
    end if;
  end if;
end $$;
