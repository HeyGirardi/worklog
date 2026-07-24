// Worklog SPA — vanilla JS, no build step.
// Routes: #/ (open-items dashboard) · #/archive?q=&project=&status=&year=&tag= · #/item/<KEY>
'use strict';

/* ---------------------------------------------------------------- state */

const state = {
  items: [],
  byKey: new Map(),
  errors: [],
  generatedAt: null,
  mini: null,
};

const STATUS = {
  'todo':         { label: 'Queued',       dot: 'var(--stage-2)' },
  'in-progress':  { label: 'In Progress',  dot: 'var(--stage-1)' },
  'deployment':   { label: 'Deployment',   dot: 'var(--stage-3)' },
  'verification': { label: 'Verification', dot: 'var(--stage-4)' },
  'done':         { label: 'Done',         dot: 'var(--status-good)' },
  'dropped':      { label: 'Dropped',      dot: 'var(--text-muted)' },
};
const OPEN = i => i.status !== 'done' && i.status !== 'dropped';

// Dashboard partition, first-match-wins; seg maps to the stage color scale.
const BUCKETS = [
  { title: 'Do now',                 seg: 1, match: i => i.status === 'in-progress' && i.project !== 'LOCAL' },
  { title: 'Queued',                 seg: 2, match: i => i.status === 'todo' && i.project !== 'LOCAL' },
  { title: 'Awaiting deployment QA', seg: 3, match: i => i.status === 'deployment' },
  { title: 'Waiting on others',      seg: 4, match: i => i.status === 'verification' },
  { title: 'Local housekeeping',     seg: 5, match: i => i.project === 'LOCAL' },
];

/* ---------------------------------------------------------------- utils */

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function inlineMd(s) {
  return marked.parseInline(String(s ?? ''));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Split a body into its ## sections, keyed by lowercased heading.
function sections(body) {
  const out = {};
  for (const part of ('\n' + (body || '')).split(/\n(?=## )/)) {
    const m = part.match(/^## (.+?)\r?\n([\s\S]*)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

function statusChip(item) {
  const meta = STATUS[item.status] || { label: item.status, dot: 'var(--text-muted)' };
  const label = item.stage && item.stage !== meta.label ? esc(item.stage) : meta.label;
  return `<span class="chip"><span class="dot" style="background:${meta.dot}"></span>${label}</span>`;
}

// Inline SVG chip icons (Lucide check / triangle-alert) — no emoji glyphs.
const ICON_CHECK = '<svg class="ico" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_WARN = '<svg class="ico" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

function flagChips(item) {
  let h = '';
  if (item.ready) h += `<span class="chip ready">${ICON_CHECK}${esc(item.ready)}</span>`;
  if (item.attention) h += `<span class="chip attn">${ICON_WARN}${esc(item.attention)}</span>`;
  return h;
}

function keyChip(key) {
  return `<a class="chip key" href="#/item/${encodeURIComponent(key)}">${esc(key)}</a>`;
}

function jiraLink(item) {
  const l = (item.links || []).find(l => /atlassian\.net\/browse\//.test(l.url));
  return l ? l.url : null;
}

/* ---------------------------------------------------------------- data */

async function refresh() {
  try {
    const res = await fetch('/api/items', { cache: 'no-store' });
    const data = await res.json();
    state.items = data.items;
    state.errors = data.errors;
    state.generatedAt = data.generatedAt;
    state.byKey = new Map(data.items.map(i => [i.key, i]));
    buildIndex();
    renderBanner();
    render();
  } catch (err) {
    $('#banner').innerHTML =
      `<div class="banner-warn"><strong>Cannot reach the server.</strong> ${esc(err.message)}</div>`;
  }
  refreshMentionsBadge();
}

// Open-mentions count in the nav; absence of data just hides the badge.
async function refreshMentionsBadge() {
  const badge = $('#mentionsCount');
  if (!badge) return;
  try {
    const data = await (await fetch('/api/mentions', { cache: 'no-store' })).json();
    const open = (data.messages || []).filter(m => !m.completed).length;
    badge.textContent = open;
    badge.hidden = open === 0;
  } catch {
    badge.hidden = true;
  }
}

function buildIndex() {
  state.mini = new MiniSearch({
    idField: 'key',
    fields: ['key', 'keyflat', 'numstr', 'title', 'body', 'tags', 'stage', 'aliases'],
    searchOptions: {
      boost: { key: 8, keyflat: 8, numstr: 8, title: 3, tags: 2 },
      prefix: true,
      fuzzy: 0.15,
    },
  });
  state.mini.addAll(state.items.map(i => ({
    key: i.key,
    keyflat: i.key.replace(/-/g, ''),
    numstr: i.num == null ? '' : String(i.num),
    title: i.title,
    body: i.body,
    tags: (i.tags || []).join(' '),
    stage: i.stage || '',
    aliases: (i.aliases || []).join(' '),
  })));
}

// Exact-ID lookup: "PROJ-142", "proj142", "PROJ 142" → key match; "142" → num match.
function idCandidates(q) {
  const s = q.trim().toUpperCase().replace(/\s+/g, '');
  let m = s.match(/^([A-Z]+)-?(\d+)$/);
  if (m) return state.items.filter(i => i.key === `${m[1]}-${m[2]}`);
  if (/^\d+$/.test(s)) return state.items.filter(i => i.num === Number(s));
  return [];
}

function searchItems(q) {
  const ids = idCandidates(q);
  const hits = state.mini ? state.mini.search(q).map(r => state.byKey.get(r.id)).filter(Boolean) : [];
  const seen = new Set(ids.map(i => i.key));
  return ids.concat(hits.filter(i => !seen.has(i.key) && seen.add(i.key)));
}

/* ---------------------------------------------------------------- routing */

function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = h.split('?');
  if (pathPart === '/archive') return { view: 'archive', params: new URLSearchParams(queryPart || '') };
  if (pathPart === '/mentions') return { view: 'mentions' };
  const m = pathPart.match(/^\/item\/(.+)$/);
  if (m) return { view: 'item', key: decodeURIComponent(m[1]) };
  return { view: 'dash' };
}

function archiveHash(params) {
  const qs = new URLSearchParams();
  for (const k of ['q', 'project', 'status', 'year', 'tag']) {
    const v = params.get(k);
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return '#/archive' + (s ? '?' + s : '');
}

function render() {
  const route = parseHash();
  for (const a of document.querySelectorAll('.topnav .navlink')) {
    a.toggleAttribute('aria-current', false);
    a.removeAttribute('aria-current');
  }
  if (route.view === 'dash') {
    document.querySelector('[data-nav="dash"]').setAttribute('aria-current', 'page');
    renderDashboard();
  } else if (route.view === 'archive') {
    document.querySelector('[data-nav="archive"]').setAttribute('aria-current', 'page');
    const q = route.params.get('q') || '';
    if ($('#search').value !== q) $('#search').value = q;
    renderArchive(route.params);
  } else if (route.view === 'mentions') {
    document.querySelector('[data-nav="mentions"]').setAttribute('aria-current', 'page');
    renderMentions();
  } else {
    renderDetail(route.key);
  }
  renderFooter(route.view);
}

function renderBanner() {
  $('#banner').innerHTML = state.errors.length
    ? `<div class="banner-warn"><strong>${state.errors.length} item file(s) failed to parse:</strong> ` +
      state.errors.map(e => `<code>${esc(e.file)}</code> — ${esc(e.message)}`).join(' · ') + '</div>'
    : '';
}

function renderFooter(view) {
  if (view === 'mentions') {
    const d = mentionsState.data;
    const open = d ? (d.messages || []).filter(m => !m.completed).length : null;
    $('#foot').innerHTML =
      `${open == null ? '' : `${open} open mention${open === 1 ? '' : 's'} · `}` +
      `data read live from <code>mentions\\mentions.json</code> · ` +
      `refresh via <code>/mentions</code> in Claude Code`;
    return;
  }
  const open = state.items.filter(OPEN).length;
  $('#foot').innerHTML =
    `${state.items.length} items (${open} open) · data read live from <code>items\\</code> · ` +
    `fetched ${state.generatedAt ? new Date(state.generatedAt).toLocaleTimeString() : '—'} · ` +
    `add or update via <code>/archive &lt;KEY&gt;</code> in Claude Code`;
}

/* ---------------------------------------------------------------- dashboard */

// Cards are standardized: collapsed shows chips, a 2-line-clamped title, a
// 1-line Next, and meta; Now + all Detail bullets live behind the disclosure.
const openCards = new Set();

function dashboardCard(item) {
  const sec = sections(item.body);
  const jira = jiraLink(item);
  const title = jira
    ? `<a href="${esc(jira)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
    : `<a href="#/item/${encodeURIComponent(item.key)}">${esc(item.title)}</a>`;
  const bullets = (sec.detail || '').split(/\r?\n/)
    .filter(l => l.trim().startsWith('- '))
    .map(l => `<li>${inlineMd(l.trim().slice(2))}</li>`)
    .join('');
  const arts = item.artifacts.length
    ? ` · ${item.artifacts.length} artifact${item.artifacts.length > 1 ? 's' : ''}` : '';
  const head = `
    <div class="chips">${keyChip(item.key)}${statusChip(item)}${flagChips(item)}</div>
    <h3>${title}</h3>
    ${sec.next ? `<p class="next"><strong>Next:</strong> ${inlineMd(sec.next)}</p>`
                : '<p class="next nonext">No next action recorded</p>'}
    <p class="meta">Updated ${fmtDate(item.updated)}${arts}</p>`;
  const more = (sec.now || bullets)
    ? `<div class="cardbody">
        ${sec.now ? `<p class="done"><strong class="ok">Now:</strong> ${inlineMd(sec.now)}</p>` : ''}
        ${bullets ? `<ul>${bullets}</ul>` : ''}
      </div>` : '';
  if (!more) return `<div class="card">${head}</div>`;
  return `<details class="card" data-key="${esc(item.key)}"${openCards.has(item.key) ? ' open' : ''}>
    <summary>${head}</summary>
    ${more}
  </details>`;
}

function renderDashboard() {
  const open = state.items.filter(OPEN);
  const assigned = new Set();
  const buckets = BUCKETS.map(b => {
    const items = open.filter(i => !assigned.has(i.key) && b.match(i));
    items.forEach(i => assigned.add(i.key));
    return { ...b, items };
  }).filter(b => b.items.length);

  const ready = open.filter(i => i.ready).length;
  const attn = open.filter(i => i.attention).length;
  const waiting = open.filter(i => i.status === 'verification').length;

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const strip = buckets.map(b =>
    `<div class="seg seg-${b.seg}" style="flex:${b.items.length}" title="${esc(b.title)}: ${esc(b.items.map(i => i.key).join(', '))}"></div>`
  ).join('');
  const labels = buckets.map(b =>
    `<div class="lab" style="flex:${b.items.length}"><span class="swatch" style="background:var(--stage-${b.seg})"></span><span><strong>${b.items.length}</strong> ${esc(b.title)}</span></div>`
  ).join('');

  $('#view').innerHTML = `
    <header class="pagehead">
      <h1>Outstanding work</h1>
      <p class="asof">As of ${today} · ${open.length} open item${open.length === 1 ? '' : 's'} · resolved items live in the <a href="#/archive">archive</a></p>
    </header>
    <div class="tiles">
      <div class="tile"><div class="value">${open.length}</div><div class="label">Open items</div></div>
      <div class="tile"><div class="value">${ready}</div><div class="label">Flagged ready (&#10003;)</div></div>
      <div class="tile"><div class="value">${attn}</div><div class="label">Need attention (&#9888;)</div></div>
      <div class="tile"><div class="value">${waiting}</div><div class="label">Waiting on others</div></div>
    </div>
    ${open.length ? `<div class="pipeline">
      <h2>Where things sit</h2>
      <div class="strip" role="img" aria-label="Pipeline: ${esc(buckets.map(b => `${b.items.length} ${b.title}`).join(', '))}">${strip}</div>
      <div class="strip-labels">${labels}</div>
    </div>` : '<p class="empty">Nothing open. Search the archive above.</p>'}
    ${buckets.map(b => `<section>
      <h2>${esc(b.title)} <span class="count">— ${b.items.length} item${b.items.length === 1 ? '' : 's'}</span></h2>
      <div class="cards">${b.items.map(i => dashboardCard(i)).join('')}</div>
    </section>`).join('')}
  `;

  // Remember expansion across re-renders (window-focus refresh re-paints).
  for (const det of document.querySelectorAll('details.card')) {
    det.addEventListener('toggle', () => {
      if (det.open) openCards.add(det.dataset.key); else openCards.delete(det.dataset.key);
    });
  }
  // Links inside the summary navigate without toggling the disclosure.
  for (const a of document.querySelectorAll('.card summary a')) {
    a.addEventListener('click', e => e.stopPropagation());
  }
}

/* ---------------------------------------------------------------- archive */

function filterChip(dim, value, current, label) {
  const on = current === value;
  return `<button class="chip" aria-pressed="${on}" data-dim="${dim}" data-val="${esc(value)}">${esc(label || value)}</button>`;
}

function renderArchive(params) {
  const q = params.get('q') || '';
  const fProject = params.get('project') || '';
  const fStatus = params.get('status') || '';
  const fYear = params.get('year') || '';
  const fTag = params.get('tag') || '';

  let list = q ? searchItems(q) : [...state.items].sort((a, b) =>
    (b.updated || '').localeCompare(a.updated || '') || (b.num || 0) - (a.num || 0));

  if (fProject) list = list.filter(i => i.project === fProject);
  if (fStatus) list = list.filter(i => i.status === fStatus);
  if (fYear) list = list.filter(i => (i.created || '').startsWith(fYear));
  if (fTag) list = list.filter(i => (i.tags || []).includes(fTag));

  const projects = [...new Set(state.items.map(i => i.project))].sort();
  const statuses = Object.keys(STATUS).filter(s => state.items.some(i => i.status === s));
  const years = [...new Set(state.items.map(i => (i.created || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const tagCounts = new Map();
  for (const i of state.items) for (const t of i.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e[0]);

  const rows = list.map(i => `<div class="row">
    ${keyChip(i.key)}
    ${statusChip(i)}
    <a class="title" href="#/item/${encodeURIComponent(i.key)}">${esc(i.title)}</a>
    ${(i.tags || []).length ? `<span class="tagtxt">${esc(i.tags.join(' · '))}</span>` : ''}
    <span class="date">${i.resolved ? 'resolved ' + fmtDate(i.resolved) : 'updated ' + fmtDate(i.updated)}</span>
  </div>`).join('');

  $('#view').innerHTML = `
    <div class="filters">
      <span class="flabel">Project</span>${projects.map(p => filterChip('project', p, fProject)).join('')}
      <span class="flabel">Status</span>${statuses.map(s => filterChip('status', s, fStatus, STATUS[s].label)).join('')}
      <span class="flabel">Year</span>${years.map(y => filterChip('year', y, fYear)).join('')}
      ${tags.length ? `<span class="flabel">Tag</span>${tags.map(t => filterChip('tag', t, fTag)).join('')}` : ''}
    </div>
    <p class="resultmeta">${list.length} item${list.length === 1 ? '' : 's'}${q ? ` for “${esc(q)}”` : ''}</p>
    ${list.length ? `<div class="rowlist">${rows}</div>` : `<p class="empty">No items match.</p>`}
  `;

  for (const btn of document.querySelectorAll('.filters button.chip')) {
    btn.addEventListener('click', () => {
      const p = new URLSearchParams(params);
      const dim = btn.dataset.dim, val = btn.dataset.val;
      if (p.get(dim) === val) p.delete(dim); else p.set(dim, val);
      location.hash = archiveHash(p);
    });
  }
}

/* ---------------------------------------------------------------- detail */

function renderDetail(key) {
  const item = state.byKey.get(key);
  if (!item) {
    $('#view').innerHTML = `<p class="empty">No item <strong>${esc(key)}</strong>.
      <a href="#/archive?q=${encodeURIComponent(key)}">Search the archive</a>.</p>`;
    return;
  }
  const jira = jiraLink(item);
  const title = jira
    ? `<a href="${esc(jira)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
    : esc(item.title);
  const meta = [
    `Created ${fmtDate(item.created)}`,
    `Updated ${fmtDate(item.updated)}`,
    item.resolved ? `Resolved ${fmtDate(item.resolved)}` : null,
  ].filter(Boolean).join(' · ');

  const links = (item.links || []).map(l =>
    `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>
     <span class="tagtxt">${esc(l.url.replace(/^https?:\/\//, ''))}</span></li>`).join('');
  const related = (item.related || []).map(keyChip).join(' ');
  const arts = (item.artifacts || []).map(a =>
    `<li><a href="${esc(a.path)}" target="_blank" rel="noopener">${esc(a.name)}</a>
     <span class="sz">${fmtSize(a.size)} · ${fmtDate(a.mtime.slice(0, 10))}</span></li>`).join('');

  $('#view').innerHTML = `
    <div class="detail-head">
      <div class="chips">${keyChip(item.key)}${statusChip(item)}${flagChips(item)}</div>
      <h1>${title}</h1>
      <p class="meta">${meta}${(item.tags || []).length ? ' · ' + esc(item.tags.join(' · ')) : ''}</p>
    </div>
    <div class="detail-grid">
      <article class="panel md">${item.body ? marked.parse(item.body) : '<p>No notes.</p>'}</article>
      <div>
        <div class="panel"><h2>Links</h2>${links ? `<ul class="linklist">${links}</ul>` : '<p class="tagtxt">None</p>'}</div>
        <div class="panel"><h2>Artifacts</h2>${arts ? `<ul class="artlist">${arts}</ul>` : '<p class="tagtxt">None</p>'}</div>
        ${related ? `<div class="panel"><h2>Related</h2><div class="chips">${related}</div></div>` : ''}
      </div>
    </div>
    <div class="panel sessions-panel">
      <h2>Claude sessions</h2>
      <div id="sessions"><p class="tagtxt">Scanning session history…</p></div>
    </div>
  `;
  loadSessions(item.key);
}

/* ---------------------------------------------------------------- sessions */

function fmtTsRange(a, b) {
  const f = t => (t ? fmtDate(String(t).slice(0, 10)) : '?');
  const d1 = f(a), d2 = f(b);
  return d1 === d2 ? d1 : `${d1} → ${d2}`;
}

function resumeCommand(s) {
  return s.cwd ? `cd "${s.cwd}"; claude --resume ${s.id}` : `claude --resume ${s.id}`;
}

function sessionCard(s, key) {
  const title = s.firstPrompt || '(no prompt captured)';
  const matchChips =
    (s.matchedBranch ? `<span class="chip ready">${ICON_CHECK}branch ${esc(s.matchedBranch)}</span>` :
     s.strong ? `<span class="chip ready">${ICON_CHECK}worktree for ${esc(key)}</span>` : '') +
    (s.mentions ? `<span class="chip">${esc(key)} mentioned ${s.mentions}&times;</span>` : '');
  const cmd = resumeCommand(s);
  return `<details class="session">
    <summary>
      <span class="sdates">${fmtTsRange(s.firstTs, s.lastTs)}</span>
      <span class="stitle" title="${esc(title)}">${esc(title.slice(0, 120))}</span>
      <span class="smeta">${s.msgs} msgs · ${fmtSize(s.sizeKB * 1024)}${s.recap ? ' · recap &#10003;' : ''}</span>
    </summary>
    <div class="sbody">
      <p class="smeta">id <code>${esc(s.id)}</code> · project ${esc(s.project)}${s.cwd ? ` · cwd <code>${esc(s.cwd)}</code>` : ''}</p>
      <div class="chips">${matchChips}</div>
      <div class="resume"><code>${esc(cmd)}</code><button class="chip" data-copy="${esc(cmd)}">Copy</button></div>
      <div class="recap" data-id="${esc(s.id)}">
        ${s.recap ? `<div class="md">${marked.parse(s.recap)}</div>`
                  : `<button class="chip" data-recap="${esc(s.id)}">Generate recap (~30&ndash;90 s, real API call)</button>`}
      </div>
    </div>
  </details>`;
}

async function loadSessions(key) {
  const el = $('#sessions');
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const route = parseHash();
    if (route.view !== 'item' || route.key !== key || !document.contains(el)) return;
    el.innerHTML = data.sessions.length
      ? data.sessions.map(s => sessionCard(s, key)).join('')
      : '<p class="tagtxt">No related sessions found.</p>';
    wireSessionEvents(el);
  } catch (err) {
    if (document.contains(el)) el.innerHTML = `<p class="tagtxt">Session scan failed: ${esc(err.message)}</p>`;
  }
}

function wireSessionEvents(el) {
  el.addEventListener('click', async e => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.copy);
        const old = copyBtn.textContent;
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = old; }, 1500);
      } catch { copyBtn.textContent = 'Copy failed'; }
      return;
    }
    const recapBtn = e.target.closest('[data-recap]');
    if (recapBtn) {
      const id = recapBtn.dataset.recap;
      const box = recapBtn.closest('.recap');
      recapBtn.disabled = true;
      recapBtn.textContent = 'Generating recap… (forks the session read-only, ~30–90 s)';
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/recap`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        box.innerHTML = `<div class="md">${marked.parse(data.recap)}</div>`;
      } catch (err) {
        box.innerHTML = `<p class="tagtxt">Recap failed: ${esc(err.message)}</p>` +
          `<button class="chip" data-recap="${esc(id)}">Retry</button>`;
      }
    }
  });
}

/* ---------------------------------------------------------------- mentions */

const mentionsState = { data: null, kind: null };
const KIND_LABEL = { action: 'Action', question: 'Question', fyi: 'FYI' };

const mDayKey = iso => new Date(iso).toDateString();

function mDayLabel(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  const base = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  return diff === 0 ? base + ' — today' : diff === 1 ? base + ' — yesterday' : base;
}

const mTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function mAge(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return days <= 0 ? '' : days === 1 ? '1 day open' : days + ' days open';
}

async function renderMentions() {
  if (!mentionsState.data) $('#view').innerHTML = '<p class="empty">Loading mentions…</p>';
  try {
    const data = await (await fetch('/api/mentions', { cache: 'no-store' })).json();
    if (parseHash().view !== 'mentions') return;   // navigated away mid-fetch
    mentionsState.data = data;
  } catch (err) {
    if (parseHash().view === 'mentions') {
      $('#view').innerHTML = `<p class="empty">Failed to load mentions: ${esc(err.message)}</p>`;
    }
    return;
  }
  paintMentions();
}

function mentionCard(m) {
  const el = document.createElement('article');
  el.className = 'mention' + (m.completed ? ' done' : '');

  const kind = KIND_LABEL[m.kind] ? m.kind : 'fyi';
  const meta = document.createElement('div');
  meta.className = 'm-meta';
  meta.innerHTML =
    '<span class="m-from"></span><span class="m-chat"></span>' +
    `<span class="kind kind-${kind}">${KIND_LABEL[kind]}</span><span class="m-time"></span>`;
  meta.querySelector('.m-from').textContent = m.from || 'Unknown';
  meta.querySelector('.m-chat').textContent = m.chatName || '';
  meta.querySelector('.m-time').textContent =
    mTime(m.created) + (m.edited ? ' · edited' : '') +
    (!m.completed && mAge(m.created) ? ' · ' + mAge(m.created) : '');
  el.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'm-body';
  // Message HTML is authored by other people (via Teams/Graph) — sanitize it.
  body.innerHTML = DOMPurify.sanitize(m.bodyHtml || '', { FORBID_TAGS: ['style'] });
  body.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  el.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'm-foot';
  if (m.teamsUrl && /^https:\/\/teams\.microsoft\.com\//.test(m.teamsUrl)) {
    const a = document.createElement('a');
    a.href = m.teamsUrl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Open in Teams';
    foot.appendChild(a);
  }
  const btn = document.createElement('button');
  btn.className = 'btn' + (m.completed ? ' reopen' : '');
  btn.textContent = m.completed ? 'Reopen' : 'Mark complete';
  btn.addEventListener('click', () => flipMention(m, btn));
  foot.appendChild(btn);
  el.appendChild(foot);
  return el;
}

async function flipMention(m, btn) {
  btn.disabled = true;
  const action = m.completed ? 'reopen' : 'complete';
  try {
    const res = await fetch(`/api/mentions/${encodeURIComponent(m.id)}/${action}`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    m.completed = (await res.json()).completed;
    paintMentions();
    refreshMentionsBadge();
  } catch {
    btn.disabled = false;
    btn.textContent = 'Failed — retry';
  }
}

function paintMentions() {
  if (parseHash().view !== 'mentions') return;
  const d = mentionsState.data;
  const msgs = (d.messages || []).slice()
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const open = msgs.filter(m => !m.completed);
  const done = msgs.filter(m => m.completed);
  const oldest = open.length ? open[open.length - 1] : null;

  const asof = (d.lastSync
    ? 'Last synced ' + new Date(d.lastSync).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      + (d.user && d.user.displayName ? ' · mentions of ' + esc(d.user.displayName) : '')
    : 'Never synced — run <code>/mentions</code> in Claude Code to pull Teams data.')
    + (oldest && mAge(oldest.created) ? ' · oldest open: ' + mAge(oldest.created) : '');

  const tile = (v, l) => `<div class="tile"><div class="value">${v}</div><div class="label">${l}</div></div>`;
  const kindBtn = k =>
    `<button class="chip" data-kind="${k}" aria-pressed="${mentionsState.kind === k}">${KIND_LABEL[k]}</button>`;

  $('#view').innerHTML = `
    <header class="pagehead">
      <h1>Teams mentions</h1>
      <p class="asof">${asof}</p>
    </header>
    <div class="tiles">
      ${tile(open.length, `open mention${open.length === 1 ? '' : 's'}`)}
      ${tile(open.filter(m => m.kind === 'action').length, 'need action')}
      ${tile(open.filter(m => m.kind === 'question').length, 'questions')}
      ${tile(done.length, 'completed')}
    </div>
    ${msgs.length ? `<div class="filters"><span class="flabel">Kind</span>${['action', 'question', 'fyi'].map(kindBtn).join('')}</div>` : ''}
    <div id="mlist"></div>
    <p class="cover">Covers 1:1, group, and meeting chats only — Teams channel messages are not searched.
    Data refreshes when <code>/mentions</code> runs in Claude Code; completing items here is instant.</p>
  `;

  for (const btn of document.querySelectorAll('.filters button[data-kind]')) {
    btn.addEventListener('click', () => {
      mentionsState.kind = mentionsState.kind === btn.dataset.kind ? null : btn.dataset.kind;
      paintMentions();
    });
  }

  const list = $('#mlist');
  const shown = mentionsState.kind ? open.filter(m => m.kind === mentionsState.kind) : open;
  if (!shown.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.innerHTML = open.length
      ? 'No open mentions of this kind.'
      : 'No open mentions — inbox clear.<br>New ones appear after <code>/mentions</code> runs in Claude Code.';
    list.appendChild(p);
  } else {
    let lastDay = null;
    for (const m of shown) {
      if (mDayKey(m.created) !== lastDay) {
        lastDay = mDayKey(m.created);
        const h = document.createElement('h2');
        h.className = 'day-head';
        h.textContent = mDayLabel(m.created);
        list.appendChild(h);
      }
      list.appendChild(mentionCard(m));
    }
  }
  if (done.length) {
    const det = document.createElement('details');
    det.className = 'completed';
    det.innerHTML = `<summary>Completed (${done.length})</summary>`;
    for (const m of done) det.appendChild(mentionCard(m));
    list.appendChild(det);
  }
  renderFooter('mentions');
}

/* ---------------------------------------------------------------- theme */

function initTheme() {
  const btn = $('#themeToggle');
  const current = () => localStorage.getItem('worklogTheme') || 'auto';
  const apply = mode => {
    if (mode === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    btn.textContent = `Theme: ${mode}`;
  };
  apply(current());
  btn.addEventListener('click', () => {
    const next = { auto: 'light', light: 'dark', dark: 'auto' }[current()];
    if (next === 'auto') localStorage.removeItem('worklogTheme');
    else localStorage.setItem('worklogTheme', next);
    apply(next);
  });
}

/* ---------------------------------------------------------------- search box */

function initSearch() {
  const box = $('#search');
  let timer;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const route = parseHash();
      const p = route.view === 'archive' ? new URLSearchParams(route.params) : new URLSearchParams();
      if (box.value) p.set('q', box.value); else p.delete('q');
      const h = archiveHash(p);
      if (location.hash !== h) {
        history.replaceState(null, '', h);
        render();
      }
    }, 150);
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const ids = idCandidates(box.value);
      if (ids.length === 1) {
        clearTimeout(timer);  // cancel any pending archive navigation from the debounce
        location.hash = `#/item/${encodeURIComponent(ids[0].key)}`;
      }
    }
    if (e.key === 'Escape') { box.value = ''; box.blur(); }
  });
  // "/" focuses search from anywhere
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== box) { e.preventDefault(); box.focus(); }
  });
}

/* ---------------------------------------------------------------- boot */

window.addEventListener('hashchange', render);
window.addEventListener('focus', refresh);
initTheme();
initSearch();
refresh();
