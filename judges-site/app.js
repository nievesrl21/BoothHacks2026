// Booth Hacks: judging site.
// Judges sign in with an email + password created in Supabase. Organizers (is_admin) also get the console.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = iso => { try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
const randomCode = () => Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + String(1000 + Math.floor(Math.random() * 9000));
const S = {
  sb: null, uid: null, me: null, admin: false,
  criteria: [], prizes: [], teams: [], codes: {}, subs: [], scores: [], judges: [], pj: [], members: [], regOpen: null, galleryOpen: null,
  filter: "all", open: null, drafts: {}, sig: "", pending: false, armed: null, ed: {},
};

function note(el, kind, msg) { el.className = "notice" + (kind ? " " + kind : ""); el.textContent = msg || ""; el.hidden = !msg; }
function errText(error) {
  const m = (error && error.message) || "";
  if (m.includes("no_account")) return "There's no login with that email yet. Create it first in Supabase → Authentication → Users → Add user.";
  if (m.includes("not_admin")) return "Only organizers can do that.";
  if (/duplicate key|unique/i.test(m)) return "Two items have the same name. Rename one of them.";
  if (/row-level security|permission/i.test(m)) return "You don't have permission to do that.";
  return "Couldn't save: " + (m || "check your connection and try again.");
}
const prizeName = id => (S.prizes.find(p => p.id === id) || {}).name;
const teamName = id => (S.teams.find(t => t.id === id) || {}).name || "Removed team";
const judgeName = id => (S.judges.find(j => j.user_id === id) || {}).name || "Removed judge";
const overall = () => S.prizes.find(p => p.is_overall);
// Every team competes for the overall prize, whether or not they ticked it.
const projects = () => S.subs.map(s => {
  const o = overall(), entered = (s.prize_ids || []).filter(prizeName);
  return { id: s.team_id, teamName: teamName(s.team_id), projectName: s.project_name, url: s.url, description: s.description,
    prizeIds: o ? [o.id, ...entered.filter(id => id !== o.id)] : entered, updatedAt: s.updated_at, confidential: !!s.confidential };
});

/* ---------- Scoring: 1-3 ratings, every total out of 300 ---------- */
const r1 = x => Math.round(x * 10) / 10;
const mean = vs => { vs = vs.filter(v => v != null); return vs.length ? r1(vs.reduce((a, b) => a + b, 0) / vs.length) : null; };
const fitKey = pid => "fit:" + pid;
const RATINGS = [[3, "Strong", "strong"], [2, "Adequate", "adequate"], [1, "Weak", "weak"]];
const assigned = pid => S.pj.filter(x => x.prize_id === pid);
// A prize with nobody assigned is open to every judge.
const scoresFit = (pid, uid) => { const a = assigned(pid); return !a.length || a.some(x => x.judge_id === uid); };
const catPrizes = p => p.prizeIds.map(id => S.prizes.find(x => x.id === id)).filter(x => x && !x.is_overall);
const fitPrizesFor = (p, uid) => catPrizes(p).filter(pr => +pr.fit_weight > 0 && scoresFit(pr.id, uid));
const myPrizes = () => S.pj.filter(x => x.judge_id === S.uid).map(x => ({ prize: S.prizes.find(p => p.id === x.prize_id), lead: x.is_lead })).filter(x => x.prize);

/* one scoresheet's points for one prize: { core, fit, total } out of 300, or null if a rating it needs is missing */
function points(sc, prize) {
  if (!sc || !prize) return null;
  const cat = !prize.is_overall;
  let got = 0, w = 0, fit = 0;
  for (const c of S.criteria) {
    const v = sc[c.id], wt = +(cat ? c.weight_category : c.weight) || 0;
    if (v == null) return null;
    got += v * wt; w += wt;
  }
  if (cat) {
    const wt = +prize.fit_weight || 0;
    if (wt) { const v = sc[fitKey(prize.id)]; if (v == null) return null; fit = v * wt; w += wt; }
  }
  if (!w) return null;
  const k = 100 / w;
  return { core: got * k, fit: fit * k, total: (got + fit) * k };
}
function maxes(prize) {
  const cat = prize && !prize.is_overall, wc = S.criteria.reduce((a, c) => a + (+(cat ? c.weight_category : c.weight) || 0), 0);
  const wf = cat ? +prize.fit_weight || 0 : 0, w = wc + wf || 1;
  return { core: Math.round(300 * wc / w), fit: Math.round(300 * wf / w) };
}
const myScore = tid => S.scores.find(s => s.judge_id === S.uid && s.team_id === tid);
// Saved, and nothing this judge owes is missing (e.g. they were assigned to a prize after saving).
const complete = (p, s) => !!s && S.criteria.every(c => s.scores[c.id] != null) && fitPrizesFor(p, s.judge_id).every(pr => s.scores[fitKey(pr.id)] != null);

/* ---------- Auth ---------- */
$("#signin-form").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("#signin-msg"), btn = $("#signin-btn");
  const email = $("#email").value.trim(), password = $("#password").value;
  if (!email || !password) return note(msg, "err", "Enter your email and password.");
  btn.disabled = true; note(msg, "", "Signing in…");
  const { error } = await S.sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) {
    const m = error.message || "";
    if (/invalid login credentials/i.test(m)) return note(msg, "err", "That email and password don't match. Check them or ask the organizer to reset your password.");
    if (/email not confirmed/i.test(m)) return note(msg, "err", "This login hasn't been confirmed yet. The organizer needs to confirm it in Supabase (Authentication → Users).");
    return note(msg, "err", "Couldn't sign in: " + (m || "the site can't reach the database. Check the address in config.js."));
  }
  note(msg, "", ""); $("#password").value = "";
});
$("#signout").addEventListener("click", () => S.sb.auth.signOut());

async function onSession(session) {
  S.uid = session ? session.user.id : null;
  S.open = null; S.drafts = {};
  if (!S.uid) {
    S.me = null; S.admin = false;
    $("#signin").hidden = false; $("#judge-bar").hidden = $("#judge-panel").hidden = $("#admin").hidden = true;
    $("#gate").hidden = true;
    return;
  }
  $("#signin").hidden = true;
  const { data } = await S.sb.from("judges").select("*").eq("user_id", S.uid).maybeSingle();
  S.me = data; S.admin = !!(data && data.is_admin);
  $("#judge-bar").hidden = false;
  if (!data) {
    $("#judge-name").textContent = session.user.email;
    note($("#gate"), "warn", "You're signed in, but your account isn't on the judges list yet. Ask the organizer to add you, then reload this page.");
    $("#judge-panel").hidden = $("#admin").hidden = true;
    return;
  }
  $("#gate").hidden = true;
  $("#judge-name").textContent = data.name;
  $("#admin-pill").hidden = !S.admin;
  $("#judge-panel").hidden = false;
  $("#admin").hidden = !S.admin;
  await loadAll(true);
  subscribe();
}

/* ---------- Data ---------- */
async function loadAll(force) {
  const q = [
    S.sb.from("criteria").select("*").order("sort").order("name"),
    S.sb.from("prizes").select("*").order("sort").order("name"),
    S.sb.from("teams").select("*").order("sort").order("name"),
    S.sb.from("submissions").select("*"),
    S.sb.from("scores").select("*"),
    S.sb.from("judges").select("*").order("name"),
    S.sb.from("prize_judges").select("*"),
  ];
  if (S.admin) q.push(S.sb.from("team_codes").select("*"));
  const r = await Promise.all(q);
  const failed = r.slice(0, 6).find(x => x.error) || (S.admin && r[7].error);
  if (failed) { $("#live-state").textContent = "Couldn't refresh. Retrying soon."; return; }
  [S.criteria, S.prizes, S.teams, S.subs, S.scores, S.judges] = r.slice(0, 6).map(x => x.data);
  S.pj = r[6].error ? [] : r[6].data; // needs 04-scoring-rubric.sql
  if (S.admin) {
    S.codes = {}; r[7].data.forEach(c => { S.codes[c.team_id] = c.code; });
    // Needs 02-team-registration.sql; the console still works without it.
    const [m, ev] = await Promise.all([
      S.sb.from("team_members").select("*").order("sort"),
      S.sb.from("event_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    S.members = m.error ? [] : m.data;
    S.regOpen = ev.error || !ev.data ? null : ev.data.registration_open;
    S.galleryOpen = ev.error || !ev.data || ev.data.gallery_open === undefined ? null : ev.data.gallery_open;
  }
  $("#live-state").textContent = "Live · updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sig = JSON.stringify([S.criteria, S.prizes, S.subs, S.pj, S.scores.filter(s => s.judge_id === S.uid).map(s => [s.team_id, s.updated_at])]);
  if (force || sig !== S.sig) {
    S.sig = sig;
    if (S.open) S.pending = true; else renderJudging();
  }
  renderAdmin();
}

let reloadTimer = null, channel = null, pollTimer = null;
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadAll(false), 400); };
function subscribe() {
  if (channel) S.sb.removeChannel(channel);
  channel = S.sb.channel("booth-hacks-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "submissions" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "prize_judges" }, scheduleReload)
    .subscribe();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (S.uid && S.me) loadAll(false); }, 60000); // safety net if live updates drop
}

/* ---------- Judging view ---------- */
function visible() {
  const mine = myPrizes().map(x => x.prize.id);
  return projects().filter(p => S.filter === "all" || (S.filter === "mine" ? p.prizeIds.some(id => mine.includes(id)) : p.prizeIds.includes(S.filter)))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}
function renderFilters() {
  const all = projects(), mine = myPrizes().map(x => x.prize.id);
  if (!["all", "mine"].includes(S.filter) && !S.prizes.some(p => p.id === S.filter)) S.filter = "all";
  if (S.filter === "mine" && !mine.length) S.filter = "all";
  const opts = [{ id: "all", name: "All projects" }, ...(mine.length ? [{ id: "mine", name: "My prizes" }] : []), ...S.prizes];
  $("#filters").innerHTML = opts.map(p => {
    const n = all.filter(x => p.id === "all" || (p.id === "mine" ? x.prizeIds.some(id => mine.includes(id)) : x.prizeIds.includes(p.id))).length;
    return `<button class="chip" type="button" data-filter="${esc(p.id)}" aria-pressed="${S.filter === p.id}">${esc(p.name)}<span class="n">${n}</span></button>`;
  }).join("");
  const mp = myPrizes();
  $("#my-prizes").innerHTML = mp.length
    ? `You also rate <b>Prize Fit</b> for: ${mp.map(x => esc(x.prize.name) + (x.lead ? ' <span class="pill lead">Lead</span>' : "")).join(", ")}.`
    : "You rate the five core criteria for every team.";
}
$("#filters").addEventListener("click", e => { const b = e.target.closest("[data-filter]"); if (b) { S.filter = b.dataset.filter; renderJudging(); } });

function renderJudging() {
  S.pending = false;
  if (!S.me) return;
  renderFilters();
  const list = visible(), done = list.filter(p => complete(p, myScore(p.id))).length;
  const where = S.filter === "all" ? "" : S.filter === "mine" ? " in your prizes" : " in " + esc(prizeName(S.filter));
  $("#progress-text").innerHTML = list.length ? `You've scored <b>${done}</b> of <b>${list.length}</b> project${list.length === 1 ? "" : "s"}${where}.` : "";
  $("#progress-bar").style.width = list.length ? (done / list.length * 100) + "%" : "0%";
  $("#projects").innerHTML = list.length ? list.map(card).join("")
    : `<div class="empty">${S.subs.length ? "No projects are competing for this prize yet." : "Projects appear here the moment teams submit them."}</div>`;
  if (S.open) updateTotal(S.open);
}

function card(p) {
  const mine = myScore(p.id), isOpen = S.open === p.id, o = overall(), pts = mine && points(mine.scores, o);
  const status = !mine ? '<span class="pill todo">Not scored</span>'
    : !complete(p, mine) ? '<span class="pill todo">Prize Fit missing</span>'
    : `<span class="pill ok">Scored${pts ? `&nbsp;·&nbsp;${Math.round(pts.total)}&nbsp;/&nbsp;300` : ""}</span>`;
  const myIds = fitPrizesFor(p, S.uid).map(x => x.id);
  return `<article class="proj${isOpen ? " open" : ""}" id="proj-${esc(p.id)}">
    <div class="proj-head">
      <div><span class="team">${esc(p.teamName)}</span><h3>${esc(p.projectName)}</h3></div>
      <div class="actions">${p.confidential ? '<span class="pill secret" title="The team asked to keep this project private. Please don\'t share it.">Confidential</span>' : ""}${mine && mine.demo_ok === false ? '<span class="pill danger">No working demo</span>' : ""}${status}</div>
    </div>
    <p class="desc">${esc(p.description)}</p>
    <div class="proj-foot">
      <div class="pills">${p.prizeIds.map(id => `<span class="pill${myIds.includes(id) ? " mine" : ""}">${esc(prizeName(id))}</span>`).join("")}</div>
      <div class="actions">
        <a class="btn ghost sm" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open website ↗</a>
        ${isOpen ? "" : `<button class="btn sm" type="button" data-open="${esc(p.id)}">${mine ? "Edit score" : "Score"}</button>`}
      </div>
    </div>
    ${isOpen ? sheet(p) : ""}
  </article>`;
}

function rate(name, label, texts, value) {
  return `<div class="rate" role="radiogroup" aria-label="${esc(label)}">${RATINGS.map(([n, word, k]) =>
    `<label><input type="radio" name="${esc(name)}" value="${n}" ${value === n ? "checked" : ""}><span><b>${n} · ${word}</b>${esc(texts[k] || "")}</span></label>`).join("")}</div>`;
}
function sheet(p) {
  const d = S.drafts[p.id] || { scores: {}, comments: "", demo: null };
  const wo = S.criteria.reduce((a, c) => a + (+c.weight || 0), 0) || 1;
  const cat = S.prizes.find(x => !x.is_overall), wc = S.criteria.reduce((a, c) => a + (+c.weight_category || 0), 0) + (cat ? +cat.fit_weight || 0 : 0) || 1;
  const fits = fitPrizesFor(p, S.uid), others = catPrizes(p).filter(pr => !fits.includes(pr));
  return `<form class="sheet" data-pid="${esc(p.id)}" novalidate>
    <div class="crit">
      <div class="crit-head"><div><strong>Table stakes: is there a working demo?</strong><span class="hint">A working Lovable demo, even if unsophisticated, is needed to be considered for any prize.</span></div></div>
      <div class="yesno" role="radiogroup" aria-label="Working demo">
        <label><input type="radio" name="demo" value="yes" ${d.demo === true ? "checked" : ""}><span>Yes, it works</span></label>
        <label><input type="radio" name="demo" value="no" ${d.demo === false ? "checked" : ""}><span>No working demo</span></label>
      </div>
      <span class="hint demo-note" ${d.demo === false ? "" : "hidden"}>The organizers will see this flagged and decide in person. Please still rate the project.</span>
    </div>
    ${S.criteria.map((c, i) => `<div class="crit">
      <div class="crit-head"><div><strong>${i + 1}. ${esc(c.name)}</strong><span class="hint">${esc(c.description)}</span></div>
        <span class="weight">${Math.round((+c.weight || 0) / wo * 100)}% overall · ${Math.round((+c.weight_category || 0) / wc * 100)}% category</span></div>
      ${rate(c.id, c.name, c, d.scores[c.id])}
    </div>`).join("")}
    ${fits.length || others.length ? `<div class="fit-note"><strong>Prize Fit</strong><span class="hint">${fits.length ? "Rate how well the project fits each prize below. You're a judge for these." : ""}${others.length ? ` ${others.map(x => esc(x.name)).join(", ")} ${others.length === 1 ? "is" : "are"} rated by ${others.length === 1 ? "its" : "their"} own judges.` : ""}</span></div>` : ""}
    ${fits.map(pr => `<div class="crit">
      <div class="crit-head"><div><strong>Prize Fit: ${esc(pr.name)}</strong></div><span class="weight">${Math.round((+pr.fit_weight || 0) / wc * 100)}% of this prize</span></div>
      ${rate(fitKey(pr.id), "Prize Fit: " + pr.name, { strong: pr.fit_strong, adequate: pr.fit_adequate, weak: pr.fit_weak }, d.scores[fitKey(pr.id)])}
    </div>`).join("")}
    <div class="crit"><label class="crit-head" for="cm-${esc(p.id)}"><strong>Comments for the organizers</strong><span class="hint">Optional</span></label>
      <textarea id="cm-${esc(p.id)}" data-comments="1" maxlength="2000" placeholder="Strengths, concerns, anything that should break a tie">${esc(d.comments)}</textarea></div>
    <div class="totals" data-totals></div>
    <div class="notice" data-msg hidden></div>
    <div class="proj-foot">
      <span class="hint" data-left></span>
      <div class="actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn" type="submit">Save score</button></div>
    </div>
  </form>`;
}
function updateTotal(pid) {
  const f = document.querySelector(`.sheet[data-pid="${CSS.escape(pid)}"]`), p = projects().find(x => x.id === pid);
  if (!f || !p) return;
  const d = S.drafts[pid] || { scores: {} }, prizes = [overall(), ...fitPrizesFor(p, S.uid)].filter(Boolean);
  f.querySelector("[data-totals]").innerHTML = prizes.map(pr => { const t = points(d.scores, pr);
    return `<div class="tcard"><span>${esc(pr.name)}</span><b>${t ? Math.round(t.total) : "–"}</b><span>/ 300</span></div>`; }).join("");
  const left = S.criteria.filter(c => d.scores[c.id] == null).length + fitPrizesFor(p, S.uid).filter(pr => d.scores[fitKey(pr.id)] == null).length + (d.demo == null ? 1 : 0);
  f.querySelector("[data-left]").textContent = left ? `${left} answer${left === 1 ? "" : "s"} left` : "Everything rated";
}
function closeSheet() { S.open = null; renderJudging(); }

$("#projects").addEventListener("click", e => {
  const o = e.target.closest("[data-open]");
  if (o) {
    const pid = o.dataset.open, mine = myScore(pid);
    S.drafts[pid] = { scores: { ...(mine ? mine.scores : {}) }, comments: mine ? mine.comments : "", demo: mine && mine.demo_ok != null ? mine.demo_ok : null };
    S.open = pid; renderJudging();
    const c = document.getElementById("proj-" + pid); if (c) c.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (e.target.closest("[data-cancel]")) { delete S.drafts[S.open]; closeSheet(); }
});
$("#projects").addEventListener("change", e => {
  const f = e.target.closest(".sheet"); if (!f || e.target.type !== "radio") return;
  const d = S.drafts[f.dataset.pid];
  if (e.target.name === "demo") { d.demo = e.target.value === "yes"; f.querySelector(".demo-note").hidden = d.demo; }
  else d.scores[e.target.name] = +e.target.value;
  updateTotal(f.dataset.pid);
});
$("#projects").addEventListener("input", e => { if (e.target.dataset.comments) S.drafts[e.target.closest(".sheet").dataset.pid].comments = e.target.value; });
$("#projects").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, pid = f.dataset.pid, d = S.drafts[pid], msg = f.querySelector("[data-msg]"), p = projects().find(x => x.id === pid);
  const fits = fitPrizesFor(p, S.uid);
  const missing = [...(d.demo == null ? ["working demo"] : []), ...S.criteria.filter(c => d.scores[c.id] == null).map(c => c.name),
    ...fits.filter(pr => d.scores[fitKey(pr.id)] == null).map(pr => "Prize Fit: " + pr.name)];
  if (missing.length) return note(msg, "err", "Answer everything before saving. Missing: " + missing.join(", ") + ".");
  // Keep only ratings for criteria and prizes that still exist.
  const scores = {};
  S.criteria.forEach(c => { scores[c.id] = d.scores[c.id]; });
  S.prizes.forEach(pr => { const v = d.scores[fitKey(pr.id)]; if (v != null) scores[fitKey(pr.id)] = v; });
  const btn = f.querySelector("button[type=submit]"); btn.disabled = true; note(msg, "", "Saving…");
  const { error } = await S.sb.from("scores").upsert({ judge_id: S.uid, team_id: pid, scores, demo_ok: d.demo, comments: (d.comments || "").trim(), updated_at: new Date().toISOString() }, { onConflict: "judge_id,team_id" });
  if (error) { btn.disabled = false; return note(msg, "err", errText(error)); }
  delete S.drafts[pid]; S.open = null;
  await loadAll(true);
});

/* ---------- Organizer console ---------- */
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(x => x.setAttribute("aria-selected", String(x === t)));
  $$("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== t.dataset.tab; });
}));

function leaderboard(prizeId) {
  const prize = S.prizes.find(p => p.id === prizeId); if (!prize) return [];
  const cat = !prize.is_overall;
  return projects().filter(p => p.prizeIds.includes(prizeId)).map(p => {
    // Overall uses every judge; a category prize uses its assigned judges (everyone if none assigned).
    const ss = S.scores.filter(s => s.team_id === p.id && (!cat || scoresFit(prize.id, s.judge_id)));
    const pts = ss.map(s => points(s.scores, prize)).filter(Boolean);
    const avg = k => pts.length ? r1(pts.reduce((a, x) => a + x[k], 0) / pts.length) : null;
    const per = {}; S.criteria.forEach(c => { per[c.id] = mean(ss.map(s => s.scores[c.id])); });
    const noDemo = S.scores.filter(s => s.team_id === p.id && s.demo_ok === false).map(s => judgeName(s.judge_id));
    return { p, n: pts.length, of: cat ? (assigned(prize.id).length || S.judges.length) : S.judges.length,
      avg: avg("total"), core: avg("core"), fitPts: avg("fit"), fit: cat ? mean(ss.map(s => s.scores[fitKey(prize.id)])) : null,
      per, noDemo, judges: ss.map(s => judgeName(s.judge_id)).join(", ") };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
}
function withRanks(rows) { let rank = 0, last; return rows.map((r, i) => { if (r.avg !== last) { rank = i + 1; last = r.avg; } return { ...r, rank: r.avg == null ? null : rank }; }); }
const demoFlag = r => r.noDemo.length ? ` <span class="pill danger" title="Flagged by ${esc(r.noDemo.join(", "))}">No working demo · ${r.noDemo.length}</span>` : "";

function renderResults() {
  const sel = $("#res-prize"), prev = sel.value || (overall() || S.prizes[0] || {}).id;
  sel.innerHTML = S.prizes.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  const prize = S.prizes.find(p => p.id === sel.value), cat = prize && !prize.is_overall, mx = maxes(prize);
  const cs = S.criteria, rows = withRanks(leaderboard(sel.value));
  const lead = cat ? assigned(prize.id).map(x => judgeName(x.judge_id) + (x.is_lead ? " (lead)" : "")).join(", ") : "";
  $("#res-judges").textContent = !prize ? "" : !cat ? "Scored by every judge on the five core criteria. Every team is included."
    : `Scored by ${lead || "every judge (no judges assigned yet, set them in the Prizes tab)"}.`;
  $("#board-head").innerHTML = `<tr><th>Rank</th><th>Project</th>${cat ? `<th>Core (/${mx.core})</th><th>Prize Fit (/${mx.fit})</th>` : ""}<th>Total (/300)</th><th>Judges</th>${cs.map(c => `<th>${esc(c.name)}</th>`).join("")}${cat ? "<th>Prize Fit avg</th>" : ""}</tr>`;
  const ncol = 4 + cs.length + (cat ? 3 : 0);
  $("#board-body").innerHTML = rows.length ? rows.map(r => `<tr${r.noDemo.length ? ' class="flagged"' : ""}><td class="rank">${r.rank ?? "–"}</td>
      <td><strong>${esc(r.p.projectName)}</strong>${demoFlag(r)}<br><span class="hint">${esc(r.p.teamName)}</span></td>
      ${cat ? `<td class="num">${r.core ?? "–"}</td><td class="num">${r.fitPts ?? "–"}</td>` : ""}
      <td class="num"><b>${r.avg ?? "–"}</b></td><td class="num" title="${esc(r.judges)}">${r.n} of ${r.of}</td>
      ${cs.map(c => `<td class="num">${r.per[c.id] ?? "–"}</td>`).join("")}${cat ? `<td class="num">${r.fit ?? "–"}</td>` : ""}</tr>`).join("")
    : `<tr><td colspan="${ncol}" class="empty">No projects in this view yet.</td></tr>`;
  const raw = [...S.scores].sort((a, b) => teamName(a.team_id).localeCompare(teamName(b.team_id)) || judgeName(a.judge_id).localeCompare(judgeName(b.judge_id)));
  const nj = new Set(raw.map(s => s.judge_id)).size, o = overall();
  $("#raw-count").textContent = `${raw.length} score${raw.length === 1 ? "" : "s"} from ${nj} judge${nj === 1 ? "" : "s"}`;
  $("#raw-head").innerHTML = `<tr><th>Judge</th><th>Team</th><th>Demo</th>${cs.map(c => `<th>${esc(c.name)}</th>`).join("")}<th>Prize Fit</th><th>Overall (/300)</th><th>Comments</th><th>Saved</th></tr>`;
  $("#raw-body").innerHTML = raw.length ? raw.map(s => { const t = points(s.scores, o);
    const fits = S.prizes.filter(pr => s.scores[fitKey(pr.id)] != null).map(pr => `${esc(pr.name)}: ${s.scores[fitKey(pr.id)]}`).join("<br>");
    return `<tr><td>${esc(judgeName(s.judge_id))}</td><td>${esc(teamName(s.team_id))}</td>
      <td>${s.demo_ok === false ? '<span class="pill danger">No</span>' : s.demo_ok ? "Yes" : "–"}</td>
      ${cs.map(c => `<td class="num">${s.scores[c.id] ?? "–"}</td>`).join("")}<td class="small">${fits || "–"}</td><td class="num"><b>${t ? r1(t.total) : "–"}</b></td>
      <td class="wide">${esc(s.comments)}</td><td class="num">${esc(fmt(s.updated_at))}</td></tr>`; }).join("")
    : `<tr><td colspan="${7 + cs.length}" class="empty">Scores appear here the moment a judge saves one.</td></tr>`;
}
$("#res-prize").addEventListener("change", renderResults);

function csvCell(v) { v = String(v ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function download(filename, rows) {
  const blob = new Blob(["﻿" + rows.map(r => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("#dl-board").addEventListener("click", () => {
  const sel = $("#res-prize").value, prize = S.prizes.find(p => p.id === sel); if (!prize) return;
  const cs = S.criteria, cat = !prize.is_overall, mx = maxes(prize);
  download(`booth-hacks-leaderboard-${prize.name.toLowerCase().replace(/\W+/g, "-")}.csv`, [
    ["Prize", "Rank", "Team", "Product", "Website", "Confidential", "No working demo (flagged by)", ...(cat ? [`Core (/${mx.core})`, `Prize Fit (/${mx.fit})`] : []), "Total (/300)", "Judges scored", "Judges", ...cs.map(c => c.name + " avg (1-3)"), ...(cat ? ["Prize Fit avg (1-3)"] : [])],
    ...withRanks(leaderboard(sel)).map(r => [prize.name, r.rank ?? "", r.p.teamName, r.p.projectName, r.p.url, r.p.confidential ? "yes" : "no", r.noDemo.join("; "),
      ...(cat ? [r.core ?? "", r.fitPts ?? ""] : []), r.avg ?? "", r.n, r.judges, ...cs.map(c => r.per[c.id] ?? ""), ...(cat ? [r.fit ?? ""] : [])]),
  ]);
});
$("#dl-scores").addEventListener("click", () => {
  const cs = S.criteria, o = overall(), cats = S.prizes.filter(p => !p.is_overall);
  download("booth-hacks-all-scores.csv", [
    ["Judge", "Team", "Product", "Prizes entered", "Working demo", ...cs.map(c => `${c.name} (1-3)`), ...cats.map(p => `Prize Fit: ${p.name} (1-3)`), "Best Overall (/300)", ...cats.map(p => `${p.name} (/300)`), "Comments", "First saved", "Last saved"],
    ...S.scores.map(s => { const p = projects().find(x => x.id === s.team_id) || { prizeIds: [] }; const t = pr => { const x = points(s.scores, pr); return x ? r1(x.total) : ""; };
      return [judgeName(s.judge_id), teamName(s.team_id), p.projectName || "", p.prizeIds.map(prizeName).join("; "), s.demo_ok == null ? "" : s.demo_ok ? "yes" : "no",
        ...cs.map(c => s.scores[c.id] ?? ""), ...cats.map(pr => s.scores[fitKey(pr.id)] ?? ""), o ? t(o) : "",
        ...cats.map(pr => p.prizeIds.includes(pr.id) && scoresFit(pr.id, s.judge_id) ? t(pr) : ""), s.comments, s.created_at, s.updated_at]; }),
  ]);
});

/* submissions tab */
function renderSubsAdmin() {
  const list = projects().sort((a, b) => a.teamName.localeCompare(b.teamName));
  $("#subs-body").innerHTML = list.length ? list.map(p => `<tr>
      <td><strong>${esc(p.teamName)}</strong>${p.confidential ? ' <span class="pill secret">Confidential</span>' : ""}</td>
      <td>${esc(p.projectName)}<br><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a></td>
      <td>${p.prizeIds.map(id => `<span class="pill">${esc(prizeName(id))}</span>`).join(" ")}</td>
      <td class="num">${S.scores.filter(s => s.team_id === p.id).length}</td>
      <td class="num">${esc(fmt(p.updatedAt))}</td>
      <td><button class="btn danger sm${S.armed === "sub:" + p.id ? " armed" : ""}" type="button" data-delsub="${esc(p.id)}">${S.armed === "sub:" + p.id ? "Confirm remove" : "Remove"}</button></td></tr>`).join("")
    : '<tr><td colspan="6" class="empty">No submissions yet. Share the student site with teams.</td></tr>';
}
$("#subs-body").addEventListener("click", async e => {
  const b = e.target.closest("[data-delsub]"); if (!b) return;
  const key = "sub:" + b.dataset.delsub;
  if (S.armed !== key) { S.armed = key; return renderSubsAdmin(); }
  S.armed = null;
  const { error } = await S.sb.from("submissions").delete().eq("team_id", b.dataset.delsub);
  note($("#subs-msg"), error ? "err" : "ok", error ? errText(error) : "Submission removed.");
  loadAll(true);
});

/* editable lists: teams, prizes, criteria */
const EDITORS = {
  teams: {
    fields: [{ k: "name", ph: "Team name" }, { k: "code", ph: "Team code", cls: "code-input" }],
    rows: () => S.teams.map(t => ({ id: t.id, name: t.name, code: S.codes[t.id] || "" })),
    blank: () => ({ id: crypto.randomUUID(), name: "", code: randomCode() }),
    check: rows => rows.some(r => r.code.trim().length < 4) ? "Every team needs a code of at least 4 characters." : null,
    warn: removed => { const n = removed.filter(id => S.subs.some(s => s.team_id === id)).length; return n ? `You're removing ${n} team${n === 1 ? "" : "s"} that already submitted. Their submissions and scores will be deleted. Click Save again to confirm.` : null; },
    async save(rows, removed) {
      if (removed.length) { const r = await S.sb.from("teams").delete().in("id", removed); if (r.error) return r.error; }
      let r = await S.sb.from("teams").upsert(rows.map((x, i) => ({ id: x.id, name: x.name.trim(), sort: i + 1 })));
      if (r.error) return r.error;
      r = await S.sb.from("team_codes").upsert(rows.map(x => ({ team_id: x.id, code: x.code.trim().toUpperCase() })));
      return r.error;
    },
  },
  prizes: {
    layout: "card",
    fields: [{ k: "name", ph: "Prize name", label: "Prize" }, { k: "description", ph: "Shown to students", label: "Short description", span: 2 },
      { k: "fit_strong", ph: "What a 3 looks like", label: "Prize Fit · 3 Strong" }, { k: "fit_adequate", ph: "What a 2 looks like", label: "Prize Fit · 2 Adequate" }, { k: "fit_weak", ph: "What a 1 looks like", label: "Prize Fit · 1 Weak" },
      { k: "fit_weight", ph: "30", label: "Prize Fit weight", type: "number" }, { k: "is_overall", label: "Overall prize: every team, every judge, no Prize Fit", type: "checkbox", span: 2 }],
    rows: () => S.prizes.map(p => ({ id: p.id, name: p.name, description: p.description, fit_strong: p.fit_strong || "", fit_adequate: p.fit_adequate || "", fit_weak: p.fit_weak || "", fit_weight: p.fit_weight ?? 30, is_overall: !!p.is_overall })),
    blank: () => ({ id: crypto.randomUUID(), name: "", description: "", fit_strong: "", fit_adequate: "", fit_weak: "", fit_weight: 30, is_overall: false }),
    check: rows => rows.filter(r => r.is_overall).length > 1 ? "Only one prize can be the overall prize."
      : rows.some(r => !(+r.fit_weight >= 0)) ? "Prize Fit weights must be 0 or more." : null,
    async save(rows, removed) {
      if (removed.length) { const r = await S.sb.from("prizes").delete().in("id", removed); if (r.error) return r.error; }
      return (await S.sb.from("prizes").upsert(rows.map((x, i) => ({ id: x.id, name: x.name.trim(), description: (x.description || "").trim(), is_overall: !!x.is_overall,
        fit_weight: x.is_overall ? 0 : +x.fit_weight, fit_strong: (x.fit_strong || "").trim(), fit_adequate: (x.fit_adequate || "").trim(), fit_weak: (x.fit_weak || "").trim(), sort: i + 1 })))).error;
    },
  },
  criteria: {
    layout: "card",
    fields: [{ k: "name", ph: "Criterion", label: "Criterion" }, { k: "weight", ph: "25", label: "Best Overall weight", type: "number" }, { k: "weight_category", ph: "15", label: "Category prize weight", type: "number" },
      { k: "description", ph: "The question judges should ask", label: "Guiding question", span: 3 },
      { k: "strong", ph: "What a 3 looks like", label: "3 Strong" }, { k: "adequate", ph: "What a 2 looks like", label: "2 Adequate" }, { k: "weak", ph: "What a 1 looks like", label: "1 Weak" }],
    rows: () => S.criteria.map(c => ({ id: c.id, name: c.name, description: c.description, weight: c.weight, weight_category: c.weight_category ?? 0, strong: c.strong || "", adequate: c.adequate || "", weak: c.weak || "" })),
    blank: () => ({ id: crypto.randomUUID(), name: "", description: "", weight: 10, weight_category: 10, strong: "", adequate: "", weak: "" }),
    check: rows => rows.some(r => !(+r.weight >= 0) || !(+r.weight_category >= 0)) || !rows.some(r => +r.weight > 0) ? "Weights must be 0 or more, and at least one Best Overall weight must be above 0." : null,
    async save(rows, removed) {
      if (removed.length) { const r = await S.sb.from("criteria").delete().in("id", removed); if (r.error) return r.error; }
      return (await S.sb.from("criteria").upsert(rows.map((x, i) => ({ id: x.id, name: x.name.trim(), description: (x.description || "").trim(), weight: +x.weight, weight_category: +x.weight_category,
        strong: (x.strong || "").trim(), adequate: (x.adequate || "").trim(), weak: (x.weak || "").trim(), sort: i + 1 })))).error;
    },
  },
};

function edStart(key) { const rows = EDITORS[key].rows(); S.ed[key] = { rows: rows.map(r => ({ ...r })), orig: rows.map(r => r.id), dirty: false, armed: false }; }
function edRender(key) {
  const E = EDITORS[key], st = S.ed[key], box = $("#ed-" + key);
  const msgPrev = box.querySelector(".notice");
  const keepMsg = msgPrev && !msgPrev.hidden ? { cls: msgPrev.className, text: msgPrev.textContent } : null;
  const input = (f, r, i) => f.type === "checkbox"
    ? `<label class="check"${f.span ? ` style="grid-column:span ${f.span}"` : ""}><input type="checkbox" data-ed="${key}" data-i="${i}" data-k="${f.k}" ${r[f.k] ? "checked" : ""}> ${esc(f.label)}</label>`
    : `<input type="${f.type || "text"}" class="${f.cls || ""}" id="ed-${key}-${esc(r.id)}-${f.k}" data-ed="${key}" data-i="${i}" data-k="${f.k}" value="${esc(r[f.k])}" placeholder="${esc(f.ph)}" aria-label="${esc(f.label || f.ph)}"${f.type === "number" ? ' min="0" step="1"' : ""}>`;
  const cell = (f, r, i) => !E.layout || f.type === "checkbox" ? input(f, r, i)
    : `<label class="mini"${f.span ? ` style="grid-column:span ${f.span}"` : ""}><span>${esc(f.label)}</span>${input(f, r, i)}</label>`;
  box.innerHTML = `<div class="rows">${st.rows.map((r, i) => `<div class="row${E.layout ? " card" : ""}" style="--cols:${E.fields.length}">
      ${E.fields.map(f => cell(f, r, i)).join("")}
      <button class="btn danger sm" type="button" data-ed="${key}" data-del="${i}">Remove</button></div>`).join("") || '<p class="hint">Nothing here yet.</p>'}</div>
    <div><button class="btn ghost sm" type="button" data-ed="${key}" data-add="1">Add</button></div>
    <div class="notice" hidden></div>
    <div class="actions"><button class="btn" type="button" data-ed="${key}" data-save="1">Save changes</button><button class="btn ghost" type="button" data-ed="${key}" data-reset="1">Discard changes</button></div>`;
  if (keepMsg) { const m = box.querySelector(".notice"); m.className = keepMsg.cls; m.textContent = keepMsg.text; m.hidden = false; }
}
function edInput(e) {
  const el = e.target, key = el.dataset.ed; if (!key || el.dataset.k == null) return;
  S.ed[key].rows[+el.dataset.i][el.dataset.k] = el.type === "checkbox" ? el.checked : el.value; S.ed[key].dirty = true; S.ed[key].armed = false;
}
$("#admin").addEventListener("input", edInput);
$("#admin").addEventListener("change", edInput);
$("#admin").addEventListener("click", async e => {
  const b = e.target.closest("button[data-ed]"); if (!b) return;
  const key = b.dataset.ed, E = EDITORS[key], st = S.ed[key], msg = () => $("#ed-" + key + " .notice");
  if (b.dataset.del != null) { st.rows.splice(+b.dataset.del, 1); st.dirty = true; st.armed = false; return edRender(key); }
  if (b.dataset.add) { st.rows.push(E.blank()); st.dirty = true; edRender(key); return $(`#ed-${key} .row:last-child input`).focus(); }
  if (b.dataset.reset) { edStart(key); edRender(key); return note(msg(), "", ""); }
  if (b.dataset.save) {
    const rows = st.rows.filter(r => String(r.name).trim());
    if (!rows.length) return note(msg(), "err", "Keep at least one item with a name.");
    const names = rows.map(r => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return note(msg(), "err", "Two items have the same name. Rename one of them.");
    const problem = E.check && E.check(rows); if (problem) return note(msg(), "err", problem);
    const removed = st.orig.filter(id => !rows.some(r => r.id === id));
    const w = E.warn && E.warn(removed);
    if (w && !st.armed) { st.armed = true; return note(msg(), "warn", w); }
    b.disabled = true; note(msg(), "", "Saving…");
    const error = await E.save(rows, removed);
    b.disabled = false;
    if (error) return note(msg(), "err", errText(error));
    st.dirty = false; st.armed = false;
    await loadAll(true);
    note($("#ed-" + key + " .notice"), "ok", "Saved. Both sites now use this list.");
  }
});

/* who judges each prize */
function renderPrizeJudges() {
  const cats = S.prizes.filter(p => !p.is_overall);
  $("#pj-list").innerHTML = !S.judges.length ? '<p class="hint">Add judges in the Judges tab first.</p>'
    : cats.map(pr => { const a = assigned(pr.id), lead = (a.find(x => x.is_lead) || {}).judge_id || "";
      return `<div class="pj">
        <div class="pj-head"><strong>${esc(pr.name)}</strong>
          <label class="small">Lead <select data-pjlead="${esc(pr.id)}" style="width:auto;display:inline-block;margin-left:6px"${a.length ? "" : " disabled"}>
            <option value="">None</option>${a.map(x => `<option value="${esc(x.judge_id)}" ${x.judge_id === lead ? "selected" : ""}>${esc(judgeName(x.judge_id))}</option>`).join("")}</select></label></div>
        <div class="pj-judges">${S.judges.map(j => `<label class="check"><input type="checkbox" data-pj="${esc(pr.id)}" value="${esc(j.user_id)}" ${a.some(x => x.judge_id === j.user_id) ? "checked" : ""}> ${esc(j.name)}</label>`).join("")}</div>
        ${a.length ? "" : '<span class="hint">Nobody ticked: every judge rates Prize Fit for this prize.</span>'}
      </div>`; }).join("") || '<p class="hint">Add a category prize above first.</p>';
}
$("#pj-list").addEventListener("change", async e => {
  const msg = $("#pj-msg"), el = e.target;
  let error;
  if (el.dataset.pj) {
    const row = { prize_id: el.dataset.pj, judge_id: el.value };
    ({ error } = el.checked ? await S.sb.from("prize_judges").upsert({ ...row, is_lead: false }, { onConflict: "prize_id,judge_id" })
      : await S.sb.from("prize_judges").delete().eq("prize_id", row.prize_id).eq("judge_id", row.judge_id));
  } else if (el.dataset.pjlead) {
    const pid = el.dataset.pjlead;
    ({ error } = await S.sb.from("prize_judges").update({ is_lead: false }).eq("prize_id", pid));
    if (!error && el.value) ({ error } = await S.sb.from("prize_judges").update({ is_lead: true }).eq("prize_id", pid).eq("judge_id", el.value));
  } else return;
  note(msg, error ? "err" : "ok", error ? (/prize_judges/.test(error.message || "") ? "Run 04-scoring-rubric.sql in Supabase first." : errText(error)) : "Saved. Judges see the change right away.");
  loadAll(true);
});

/* judges tab */
function renderJudgesAdmin() {
  $("#judges-body").innerHTML = S.judges.map(j => {
    const self = j.user_id === S.uid, n = S.scores.filter(s => s.judge_id === j.user_id).length, armed = S.armed === "judge:" + j.user_id;
    return `<tr><td><strong>${esc(j.name)}</strong>${self ? ' <span class="hint">(you)</span>' : ""}</td><td>${esc(j.email)}</td>
      <td>${j.is_admin ? '<span class="pill">Organizer</span>' : "Judge"}</td>
      <td class="small">${S.pj.filter(x => x.judge_id === j.user_id).map(x => esc(prizeName(x.prize_id)) + (x.is_lead ? " (lead)" : "")).join("<br>") || '<span class="hint">Best Overall only</span>'}</td><td class="num">${n}</td>
      <td><div class="actions">${self ? "" : `<button class="btn ghost sm" type="button" data-role="${esc(j.user_id)}">${j.is_admin ? "Make judge only" : "Make organizer"}</button>
        <button class="btn danger sm${armed ? " armed" : ""}" type="button" data-deljudge="${esc(j.user_id)}">${armed ? `Confirm: delete ${n} score${n === 1 ? "" : "s"} too` : "Remove"}</button>`}</div></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">No judges yet.</td></tr>';
}
$("#judges-body").addEventListener("click", async e => {
  const msg = $("#judges-msg");
  const r = e.target.closest("[data-role]");
  if (r) {
    const j = S.judges.find(x => x.user_id === r.dataset.role);
    const { error } = await S.sb.from("judges").update({ is_admin: !j.is_admin }).eq("user_id", j.user_id);
    note(msg, error ? "err" : "ok", error ? errText(error) : `${j.name} is now ${j.is_admin ? "a judge only" : "an organizer"}.`);
    return loadAll(true);
  }
  const d = e.target.closest("[data-deljudge]");
  if (d) {
    const key = "judge:" + d.dataset.deljudge;
    if (S.armed !== key) { S.armed = key; return renderJudgesAdmin(); }
    S.armed = null;
    const { error } = await S.sb.from("judges").delete().eq("user_id", d.dataset.deljudge);
    note(msg, error ? "err" : "ok", error ? errText(error) : "Judge removed. Their login still exists in Supabase; delete it there if you want.");
    loadAll(true);
  }
});
$("#add-judge").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("#judges-msg"), name = $("#nj-name").value.trim(), email = $("#nj-email").value.trim();
  if (!name || !email) return note(msg, "err", "Add the judge's name and the email of their login.");
  const { error } = await S.sb.rpc("add_judge", { p_email: email, p_name: name, p_is_admin: $("#nj-admin").checked });
  if (error) return note(msg, "err", errText(error));
  $("#nj-name").value = $("#nj-email").value = ""; $("#nj-admin").checked = false;
  note(msg, "ok", `${name} can now sign in and judge.`);
  loadAll(true);
});

/* registered teams + registration switch */
function renderMembersAdmin() {
  $("#reg-switch").hidden = S.regOpen === null;
  if (S.regOpen !== null) {
    $("#reg-state").textContent = S.regOpen ? "Open: students can register new teams on the student site." : "Closed: the student site only accepts project submissions.";
    $("#reg-toggle").textContent = S.regOpen ? "Close registration" : "Open registration";
    $("#reg-toggle").className = "btn sm" + (S.regOpen ? " ghost" : "");
  }
  $("#gallery-switch").hidden = S.galleryOpen === null;
  if (S.galleryOpen !== null) {
    const secret = S.subs.filter(s => s.confidential).length;
    $("#gallery-state").textContent = (S.galleryOpen ? "Open: students can browse submitted projects." : "Hidden: students can't see other teams' projects.")
      + (secret ? ` ${secret} confidential project${secret === 1 ? " is" : "s are"} never shown.` : " Confidential projects are never shown.");
    $("#gallery-toggle").textContent = S.galleryOpen ? "Hide gallery" : "Show gallery";
    $("#gallery-toggle").className = "btn sm" + (S.galleryOpen ? " ghost" : "");
  }
  const people = S.members.length;
  $("#members-count").textContent = `${S.teams.length} team${S.teams.length === 1 ? "" : "s"} · ${people} ${people === 1 ? "person" : "people"}`;
  $("#members-body").innerHTML = S.teams.length ? S.teams.map(t => {
    const ms = S.members.filter(m => m.team_id === t.id);
    return `<tr><td><strong>${esc(t.name)}</strong></td><td class="num">${esc(S.codes[t.id] || "–")}</td>
      <td>${ms.length ? ms.map(m => `${esc(m.name)}${m.email ? ` <span class="hint">${esc(m.email)}</span>` : ""}`).join("<br>") : '<span class="hint">Added by an organizer</span>'}</td>
      <td class="num">${t.registered_at ? esc(fmt(t.registered_at)) : "–"}</td>
      <td>${S.subs.some(s => s.team_id === t.id) ? '<span class="pill ok">Yes</span>' : '<span class="pill todo">Not yet</span>'}</td></tr>`;
  }).join("") : '<tr><td colspan="5" class="empty">No teams yet. Share the student site so teams can register.</td></tr>';
}
$("#gallery-toggle").addEventListener("click", async () => {
  const next = !S.galleryOpen;
  const { error } = await S.sb.from("event_settings").update({ gallery_open: next }).eq("id", 1);
  note($("#reg-msg"), error ? "err" : "ok", error ? errText(error) : (next ? "The gallery is open to students." : "The gallery is hidden from students."));
  loadAll(true);
});
$("#reg-toggle").addEventListener("click", async () => {
  const next = !S.regOpen;
  const { error } = await S.sb.from("event_settings").update({ registration_open: next }).eq("id", 1);
  note($("#reg-msg"), error ? "err" : "ok", error ? errText(error) : (next ? "Registration is open." : "Registration is closed. Teams can still submit projects."));
  loadAll(true);
});
$("#dl-teams").addEventListener("click", () => {
  const rows = [["Team", "Code", "Member", "Email", "Registered", "Submitted project"]];
  for (const t of S.teams) {
    const ms = S.members.filter(m => m.team_id === t.id);
    const sub = S.subs.find(s => s.team_id === t.id);
    for (const m of (ms.length ? ms : [{ name: "", email: "" }])) rows.push([t.name, S.codes[t.id] || "", m.name, m.email, t.registered_at || "", sub ? sub.project_name : ""]);
  }
  download("booth-hacks-teams.csv", rows);
});

function renderAdmin() {
  if (!S.admin) return;
  renderResults(); renderSubsAdmin(); renderJudgesAdmin(); renderMembersAdmin(); renderPrizeJudges();
  for (const key of Object.keys(EDITORS)) if (!S.ed[key] || !S.ed[key].dirty) { edStart(key); edRender(key); }
}

/* ---------- Boot ---------- */
async function boot() {
  const cfg = window.BOOTH_HACKS || {};
  if (!window.supabase || !cfg.supabaseUrl || cfg.supabaseUrl.includes("YOUR-")) {
    return note($("#gate"), "warn", "This site isn't connected to its database yet. Fill in config.js with your Supabase URL and anon key.");
  }
  // Accept the project URL even if "/rest/v1" or a trailing slash was pasted with it.
  const baseUrl = String(cfg.supabaseUrl).trim().replace(/\/(rest|auth)\/v1.*$/, "").replace(/\/+$/, "");
  S.sb = window.supabase.createClient(baseUrl, String(cfg.supabaseAnonKey).trim());
  const { data } = await S.sb.auth.getSession();
  await onSession(data.session);
  S.sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session && session.user.id === S.uid) return; // token refresh / tab focus
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => onSession(session), 0);
  });
}
boot();
