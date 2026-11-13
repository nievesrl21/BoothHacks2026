# Booth Hacks — setup guide

Two websites, one shared database:

| Folder | What it is | Who gets the link |
|---|---|---|
| `student-site/` | Teams **register** (team name + 1–5 members, and get their team code), then **submit** their project (link, prizes, description) | Students |
| `judges-site/` | Judges sign in, filter by prize and score. Organizers also get the Organizer console (results, CSV downloads, editing) | Judges and admins |
| `supabase/schema.sql` | The database: tables, security rules, sample teams/prizes/criteria | Run once in Supabase |
| `supabase/02-team-registration.sql` | Adds team registration | Run once, after schema.sql |
| `supabase/03-gallery-confidential.sql` | Adds the project gallery and the confidential option | Run once, after 02 |
| `supabase/04-scoring-rubric.sql` | The 1-3 scoring rubric, the 7 prizes, Prize Fit and judge-to-prize assignments | Run once, after 03 |

Submissions appear on the judges site **instantly**; there's no copying between sites.

Total setup time: about 30–45 minutes. Everything below is free.

---

## Step 1 — Create the database (Supabase)

1. Go to **supabase.com**, sign up, and click **New project**. Name it `booth-hacks`, choose a database password (save it somewhere), pick the region closest to Chicago (e.g. *East US*), and create it. Wait ~2 minutes until it's ready.
2. In the left menu, open **SQL Editor** → **New query**.
3. Open `supabase/schema.sql` from this folder, copy everything, paste it into the editor, and click **Run**. You should see "Success. No rows returned."
4. Click **New query** again, paste everything from `supabase/02-team-registration.sql`, and click **Run**. This adds team registration.
5. Same again with `supabase/03-gallery-confidential.sql`. This adds the project gallery and the confidential option.
6. Same again with `supabase/04-scoring-rubric.sql`. This loads the scoring rubric (1-3 ratings, every prize out of 300), the 7 prizes and their Prize Fit rubrics. Afterwards, assign judges to prizes in the judges site (Organizer console → Prizes). The first time it runs it clears any scores saved on the old 1-5 scale.

## Step 2 — Lock down sign-ups

Only people you create should be able to log in.

1. Left menu → **Authentication** → **Sign In / Providers** (on some versions: **Authentication → Settings**).
2. Turn **off** "Allow new users to sign up". Save.

(Even if someone did sign up, they'd see nothing: only people on the judges list can read submissions or score.)

## Step 3 — Create your own organizer login

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email and a password. Tick **Auto Confirm User**. Create.
3. Go back to **SQL Editor** → **New query**, paste this (with your name and the same email), and **Run**:

```sql
insert into public.judges (user_id, name, email, is_admin)
select id, 'Your Name', email, true from auth.users where email = 'your-email@chicagobooth.edu';
```

You're now an organizer. Other admins and judges are added later from the website itself (Step 6).

## Step 4 — Connect the two sites to the database

1. In Supabase, open **Project Settings** → **API** (sometimes called **Data API** / **API Keys**).
2. Copy the **Project URL** and the **anon public** key. ⚠️ Never use the `service_role` key.
3. Open `student-site/config.js` and `judges-site/config.js` in any text editor (TextEdit works: Format → Make Plain Text) and replace the two placeholder values in **both** files:

```js
window.BOOTH_HACKS = {
  supabaseUrl: "https://abcdefghijk.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...",
};
```

The anon key is meant to be public. The database's security rules are what protect the data.

## Step 5 — Put the sites online (Netlify, drag and drop)

1. Go to **app.netlify.com** and sign up (free).
2. Go to **Sites** → **Add new site** → **Deploy manually** (or open **app.netlify.com/drop**).
3. Drag the whole **`student-site`** folder onto the page. In a few seconds you get a link like `random-name-123.netlify.app`.
4. Repeat with the **`judges-site`** folder. That's your second link.
5. Optional: in each site's **Site configuration → Change site name**, rename them, e.g. `boothhacks-submit` and `boothhacks-judging`.

**Changing a file later** (e.g. config.js): open the site in Netlify → **Deploys** → drag the updated folder onto the deploy area again. Same link, new version.

## Step 6 — Set up the event (from the judges site)

Sign in to the judges site with your organizer login. Scroll to **Organizer console**:

- **Teams & codes**: students register their own teams on the student site and get a code automatically. Here you see every team, its code and its members, can **open or close registration**, download the team list as CSV, and still add, rename or remove teams yourself. Remove the 3 sample teams before the event.
- **Prizes**: replace the 3 sample prizes. They appear as checkboxes for students and filters for judges.
- **Criteria**: the 5 core criteria are pre-loaded with two weights each (Best Overall 25/20/25/20/10, category prizes 15/10/20/15/10) and their Strong / Adequate / Weak text. Edit any of it here.
- **Prizes → Who judges each prize**: tick the judges for each category prize and pick a lead. Only those judges rate Prize Fit, and only their scores count for that prize. Best Overall always uses every judge.
- **Judges**: for each judge or co-organizer:
  1. In Supabase → **Authentication → Users → Add user**: their email + a password, tick **Auto Confirm User**.
  2. On the judges site → **Judges** tab: their name + the same email → **Add judge**. Tick "Also an organizer" for co-admins.

## Step 7 — Share

| Who | Send them |
|---|---|
| **Students** | The student site link. One person per team registers the team and gets the team code on screen, to share with teammates. If you add a team yourself, send that team its code. |
| **Judges** | The judges site link + their email and password |
| **Other admins** | The judges site link + their login (added with "Also an organizer" ticked) |

Students don't need any account. Judges' scores are private to them; only organizers see everyone's scores.

## During and after the event

- **Results** tab: live leaderboard per prize, how many judges scored each project, per-criterion averages, and every individual score with comments.
- **Download leaderboard (CSV)** / **Download all scores (CSV)**: open in Excel or Google Sheets.
- A team can update its submission any time with its code; judges see the new version immediately.
- The student site has a **Project gallery** showing every submitted project except the ones a team marked **confidential**. Judges and organizers always see confidential projects, labelled "Confidential". Hide or show the gallery with the switch in the Teams & codes tab.
- When teams are set, close registration (Teams & codes tab). The student site then shows only project submission.
- A team that lost its code: look it up in Teams & codes and send it to them.
- Forgotten judge password: Supabase → Authentication → Users → click the user → reset/set a new password.

## Before the real event: do a dry run

Submit one test project from the student site, score it from a judge login, check the Results tab, then delete the test submission in the **Submissions** tab.
