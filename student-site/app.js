// Booth Hacks: student submission site.
// Students don't log in. Each submission is checked against the team's code in the database.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = iso => { try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
const S = { sb: null, teams: [], prizes: [], regOpen: false, gallery: null, gFilter: "all", members: [{ name: "", email: "" }], lastCode: null };

const ERRORS = {
  wrong_code: "That team code doesn't match the team you picked. Check the code your organizer gave you.",
  bad_name: "Add your product's name (80 characters max).",
  bad_url: "Add a valid website link, like https://your-project.com.",
  bad_description: "Write 20 to 600 characters describing your product.",
  no_prizes: "Pick at least one prize to compete for.",
  bad_prize: "One of the prizes you picked no longer exists. Reload the page and pick again.",
  registration_closed: "Team registration is closed. Contact the organizers.",
  bad_team_name: "Give your team a name between 2 and 60 characters.",
  team_name_taken: "That team name is already taken. Pick another one.",
  bad_member_count: "Add between 1 and 5 team members.",
  bad_member_name: "Every team member needs a name.",
  bad_member_email: "One of the emails doesn't look right. Check it or leave it blank.",
  too_many_teams: "The event has reached its team limit. Contact the organizers.",
};
function errorText(err) {
  const m = (err && err.message) || "";
  const dup = m.match(/member_already_registered:(\S+)/);
  if (dup) return `${dup[1]} is already on another team. Each person can only be on one team.`;
  if (/duplicate key|unique/i.test(m)) return ERRORS.team_name_taken;
  for (const k in ERRORS) if (m.includes(k)) return ERRORS[k];
  return "Couldn't reach the database. Check your connection and try again.";
}
function note(el, kind, msg) { el.className = "notice" + (kind ? " " + kind : ""); el.textContent = msg || ""; el.hidden = !msg; }

function renderOptions() {
  const prev = $("#team").value;
  $("#team").innerHTML = S.teams.length
    ? '<option value="">Select your team</option>' + S.teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")
    : '<option value="">No teams registered yet</option>';
  if (S.teams.some(t => t.id === prev)) $("#team").value = prev;
  $("#prizes").innerHTML = S.prizes.length
    ? S.prizes.map(p => `<label class="prize"><input type="checkbox" name="prize" value="${esc(p.id)}">
        <div><strong>${esc(p.name)}</strong>${p.description ? `<span>${esc(p.description)}</span>` : ""}</div></label>`).join("")
    : '<p class="hint">The organizer hasn\'t added prizes yet.</p>';
  $("#submit-btn").disabled = !(S.teams.length && S.prizes.length);
}

function showSaved(row) {
  const team = S.teams.find(t => t.id === row.team_id);
  const box = $("#mine-status");
  box.hidden = false;
  box.innerHTML = `<b>Submitted</b><span>${esc(team ? team.name : "")} · ${esc(row.project_name)}</span><span>Last updated ${esc(fmt(row.updated_at))}</span>`;
  $("#submit-btn").textContent = "Update submission";
}

function fill(row) {
  $("#project").value = row.project_name || "";
  $("#url").value = row.url || "";
  $("#desc").value = row.description || "";
  $("#desc-count").textContent = $("#desc").value.length + " / 600";
  document.querySelectorAll("#prizes input").forEach(i => { i.checked = (row.prize_ids || []).includes(i.value); });
  $("#confidential").checked = !!row.confidential;
}

function normalizeUrl(raw) {
  let v = raw.trim(); if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try { const u = new URL(v); return u.hostname.includes(".") ? u.href : null; } catch { return null; }
}

$("#desc").addEventListener("input", e => { $("#desc-count").textContent = e.target.value.length + " / 600"; });

$("#load-btn").addEventListener("click", async () => {
  const msg = $("#form-msg");
  const teamId = $("#team").value, code = $("#code").value.trim();
  if (!teamId || !code) return note(msg, "err", "Pick your team and enter your team code first.");
  note(msg, "", "Looking up your submission…");
  const { data, error } = await S.sb.rpc("get_submission", { p_team_id: teamId, p_code: code });
  if (error) return note(msg, "err", errorText(error));
  if (!data || !data.length) return note(msg, "", "Your team hasn't submitted yet. Fill in the form below.");
  fill(data[0]); showSaved(data[0]);
  $("#form-title").textContent = "Your submission";
  note(msg, "ok", "Loaded your team's current submission. Edit anything and click Update submission.");
});

$("#form").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("#form-msg");
  const teamId = $("#team").value, code = $("#code").value.trim();
  const projectName = $("#project").value.trim();
  const url = normalizeUrl($("#url").value);
  const prizeIds = [...document.querySelectorAll("#prizes input:checked")].map(i => i.value);
  const description = $("#desc").value.trim();
  if (!teamId) return note(msg, "err", "Choose your team from the list.");
  if (!code) return note(msg, "err", "Enter your team code.");
  if (!projectName) return note(msg, "err", ERRORS.bad_name);
  if (!url) return note(msg, "err", ERRORS.bad_url);
  if (!prizeIds.length) return note(msg, "err", ERRORS.no_prizes);
  if (description.length < 20) return note(msg, "err", ERRORS.bad_description);

  const btn = $("#submit-btn"); btn.disabled = true; note(msg, "", "Saving…");
  const confidential = $("#confidential").checked;
  const args = { p_team_id: teamId, p_code: code, p_project_name: projectName, p_url: url, p_description: description, p_prize_ids: prizeIds };
  let { data, error } = await S.sb.rpc("submit_project", { ...args, p_confidential: confidential });
  // Database not updated for confidential projects yet: submit without the choice rather than fail.
  if (error && error.code === "PGRST202") ({ data, error } = await S.sb.rpc("submit_project", args));
  btn.disabled = false;
  if (error) return note(msg, "err", errorText(error));
  $("#url").value = url;
  showSaved(data);
  note(msg, "ok", "Submitted! Judges can see it now" + (data.confidential ? ". It's confidential, so it won't appear in the gallery." : " and it appears in the project gallery.") + " You can update it any time before judging starts.");
});

/* ---------- Steps ---------- */
function showStep(step) {
  for (const s of ["register", "submit", "gallery"]) {
    $("#step-" + s).setAttribute("aria-pressed", String(step === s));
    $(`#${s}-panel`).hidden = step !== s;
  }
  if (step === "gallery") loadGallery();
}

/* ---------- Project gallery ---------- */
async function loadGallery() {
  const { data, error } = await S.sb.rpc("gallery");
  if (error) { S.gallery = null; return false; }
  S.gallery = data; renderGallery(); return true;
}
function renderGallery() {
  const g = S.gallery, note2 = $("#gallery-note");
  if (!g.open) {
    $("#gallery-filters").innerHTML = "";
    $("#gallery").innerHTML = '<div class="empty">The gallery is closed for now. The organizers will open it soon.</div>';
    note2.hidden = true; return;
  }
  const used = S.prizes.filter(p => g.projects.some(x => (x.prize_ids || []).includes(p.id)));
  if (S.gFilter !== "all" && !used.some(p => p.id === S.gFilter)) S.gFilter = "all";
  $("#gallery-filters").innerHTML = [{ id: "all", name: "All projects" }, ...used].map(p => {
    const n = g.projects.filter(x => p.id === "all" || (x.prize_ids || []).includes(p.id)).length;
    return `<button class="chip" type="button" data-gfilter="${esc(p.id)}" aria-pressed="${S.gFilter === p.id}">${esc(p.name)}<span class="n">${n}</span></button>`;
  }).join("");
  const list = g.projects.filter(x => S.gFilter === "all" || (x.prize_ids || []).includes(S.gFilter));
  const prizeName = id => (S.prizes.find(p => p.id === id) || {}).name;
  $("#gallery").innerHTML = list.length ? list.map(x => `<article class="g-card">
      <div><span class="team">${esc(x.team)}</span><h3>${esc(x.project)}</h3></div>
      <p class="desc">${esc(x.description)}</p>
      <div class="pills">${(x.prize_ids || []).filter(prizeName).map(id => `<span class="pill">${esc(prizeName(id))}</span>`).join("")}</div>
      <a class="btn ghost sm" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Visit website ↗</a>
    </article>`).join("")
    : '<div class="empty">No projects to show yet. Check back once teams start submitting.</div>';
  note2.hidden = !g.confidential;
  note2.textContent = `${g.confidential} more project${g.confidential === 1 ? " is" : "s are"} confidential and only visible to the judges.`;
}
$("#gallery-filters").addEventListener("click", e => { const b = e.target.closest("[data-gfilter]"); if (b) { S.gFilter = b.dataset.gfilter; renderGallery(); } });
$("#gallery-refresh").addEventListener("click", loadGallery);
document.querySelectorAll(".step").forEach(b => b.addEventListener("click", () => showStep(b.dataset.step)));

/* ---------- Team registration ---------- */
function renderMembers() {
  $("#members").innerHTML = S.members.map((m, i) => `<div class="member-row">
      <span class="step-n" aria-hidden="true">${i + 1}</span>
      <input type="text" id="m-name-${i}" data-i="${i}" data-k="name" value="${esc(m.name)}" maxlength="80" placeholder="Full name" aria-label="Member ${i + 1} name" autocomplete="off">
      <input type="email" id="m-email-${i}" data-i="${i}" data-k="email" value="${esc(m.email)}" placeholder="Booth email (optional)" aria-label="Member ${i + 1} email" autocomplete="off">
      ${S.members.length > 1 ? `<button type="button" class="btn danger sm" data-remove="${i}" aria-label="Remove member ${i + 1}">Remove</button>` : "<span></span>"}
    </div>`).join("");
  $("#add-member").hidden = S.members.length >= 5;
  $("#member-count").textContent = `${S.members.length} of 5`;
}
$("#members").addEventListener("input", e => { const el = e.target; if (el.dataset.k) S.members[+el.dataset.i][el.dataset.k] = el.value; });
$("#members").addEventListener("click", e => { const b = e.target.closest("[data-remove]"); if (!b) return; S.members.splice(+b.dataset.remove, 1); renderMembers(); });
$("#add-member").addEventListener("click", () => {
  if (S.members.length >= 5) return;
  S.members.push({ name: "", email: "" }); renderMembers();
  $(`#m-name-${S.members.length - 1}`).focus();
});

$("#reg-form").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("#reg-msg");
  const teamName = $("#reg-team").value.trim().replace(/\s+/g, " ");
  const members = S.members.map(m => ({ name: m.name.trim(), email: m.email.trim().toLowerCase() })).filter(m => m.name || m.email);
  if (teamName.length < 2) return note(msg, "err", ERRORS.bad_team_name);
  if (S.teams.some(t => t.name.toLowerCase() === teamName.toLowerCase())) return note(msg, "err", ERRORS.team_name_taken);
  if (!members.length) return note(msg, "err", "Add at least one team member.");
  if (members.some(m => !m.name)) return note(msg, "err", ERRORS.bad_member_name);
  if (members.some(m => m.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email))) return note(msg, "err", ERRORS.bad_member_email);
  const emails = members.map(m => m.email).filter(Boolean);
  if (new Set(emails).size !== emails.length) return note(msg, "err", "The same email appears twice. Each teammate needs their own.");

  const btn = $("#reg-btn"); btn.disabled = true; note(msg, "", "Registering…");
  const { data, error } = await S.sb.rpc("register_team", { p_team_name: teamName, p_members: members });
  btn.disabled = false;
  if (error) return note(msg, "err", errorText(error));
  note(msg, "", "");
  S.lastCode = data;
  await loadTeams();
  $("#done-team").textContent = data.team_name;
  $("#done-code").textContent = data.code;
  $("#reg-form").hidden = true; $("#reg-done").hidden = false;
});

$("#copy-code").addEventListener("click", async e => {
  const code = $("#done-code").textContent;
  try { await navigator.clipboard.writeText(code); e.target.textContent = "Copied"; }
  catch { const r = document.createRange(); r.selectNodeContents($("#done-code")); getSelection().removeAllRanges(); getSelection().addRange(r); e.target.textContent = "Press Cmd+C to copy"; }
  setTimeout(() => { e.target.textContent = "Copy code"; }, 2500);
});
$("#go-submit").addEventListener("click", () => {
  if (S.lastCode) { $("#team").value = S.lastCode.team_id; $("#code").value = S.lastCode.code; }
  showStep("submit"); $("#project").focus();
});
$("#reg-another").addEventListener("click", () => {
  S.members = [{ name: "", email: "" }]; S.lastCode = null;
  $("#reg-team").value = ""; renderMembers();
  $("#reg-done").hidden = true; $("#reg-form").hidden = false; $("#reg-team").focus();
});

async function loadTeams() {
  const t = await S.sb.from("teams").select("id,name").order("sort").order("name");
  if (!t.error) { S.teams = t.data; renderOptions(); }
}

async function boot() {
  renderMembers();
  const cfg = window.BOOTH_HACKS || {};
  if (!window.supabase || !cfg.supabaseUrl || cfg.supabaseUrl.includes("YOUR-")) {
    note($("#gate"), "warn", "This site isn't connected to its database yet. The organizer needs to fill in config.js.");
    $("#team").innerHTML = '<option value="">Not connected</option>';
    $("#prizes").innerHTML = "";
    return;
  }
  // Accept the project URL even if "/rest/v1" or a trailing slash was pasted with it.
  const baseUrl = String(cfg.supabaseUrl).trim().replace(/\/(rest|auth)\/v1.*$/, "").replace(/\/+$/, "");
  S.sb = window.supabase.createClient(baseUrl, String(cfg.supabaseAnonKey).trim());
  const [t, p] = await Promise.all([
    S.sb.from("teams").select("id,name").order("sort").order("name"),
    S.sb.from("prizes").select("id,name,description").order("sort").order("name"),
  ]);
  if (t.error || p.error) {
    note($("#gate"), "warn", "Couldn't load teams and prizes. Reload the page in a moment.");
    return;
  }
  S.teams = t.data; S.prizes = p.data;
  renderOptions();

  // Registration needs 02-team-registration.sql; without it the site works as submission-only.
  // The gallery tab appears only once the database has the gallery update (03-gallery-confidential.sql).
  $("#step-gallery").hidden = !(await loadGallery());
  const ev = await S.sb.from("event_settings").select("registration_open").eq("id", 1).maybeSingle();
  if (ev.error || !ev.data) {
    $("#step-register").hidden = true; $(".steps").hidden = $("#step-gallery").hidden;
    return showStep("submit");
  }
  S.regOpen = ev.data.registration_open;
  $("#reg-closed").hidden = S.regOpen;
  $("#reg-form").hidden = !S.regOpen;
  $("#reg-btn").disabled = !S.regOpen;
  showStep(S.regOpen ? "register" : "submit");
}
boot();
