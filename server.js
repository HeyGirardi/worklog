// Worklog server — zero-dependency, node:http only.
// Serves the SPA from public/, artifact files from artifacts/, and GET /api/items
// which reads items/*.md live on every request (no cache, no staleness).
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = __dirname;

// Optional config.json at the repo root (structure: config.example.json).
// Deployment-specific values only; everything has a generic fallback.
let CONFIG = {};
try { CONFIG = JSON.parse(fss.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { /* defaults */ }

const PORT = Number(CONFIG.port) || 43210;   // fallback if ever blocked: 43211
const HOST = '127.0.0.1';                    // never expose beyond localhost
const ITEMS_DIR = path.join(ROOT, 'items');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOG_FILE = path.join(ROOT, 'server.log');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

// ---------------------------------------------------------------- frontmatter

// Constrained YAML subset (see README): quoted strings are JSON strings,
// [a, b] inline arrays, `links:` is a block list of label/url pairs,
// everything else is a bare scalar kept as a string (dates included).
const ARRAY_FIELDS = new Set(['tags', 'repos', 'related', 'aliases']);

function parseScalar(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) return JSON.parse(v);
  return v;
}

function parseInlineArray(raw, lineNo) {
  const v = raw.trim();
  if (v === '' || v === '[]') return [];
  if (!v.startsWith('[') || !v.endsWith(']')) {
    throw new Error(`line ${lineNo}: expected inline array [a, b]`);
  }
  return v.slice(1, -1).split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
    .map(s => (s.startsWith('"') ? JSON.parse(s) : s));
}

function parseFrontmatter(text, file) {
  if (!text.startsWith('---')) throw new Error('line 1: missing frontmatter open ---');
  const lines = text.split(/\r?\n/);
  const fm = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.trim() === '---') break;                       // frontmatter close
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    if (/^links:\s*$/.test(line)) {
      const links = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        let m;
        if ((m = next.match(/^\s*-\s+label:\s*(.+)$/))) {
          links.push({ label: parseScalar(m[1]), url: '' });
          i++;
        } else if ((m = next.match(/^\s+url:\s*(.+)$/))) {
          if (!links.length) throw new Error(`line ${i + 2}: url before label in links`);
          links[links.length - 1].url = parseScalar(m[1]);
          i++;
        } else {
          break;
        }
      }
      fm.links = links;
      continue;
    }

    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) throw new Error(`line ${lineNo}: unrecognized frontmatter syntax`);
    const [, field, rawValue] = m;
    fm[field] = ARRAY_FIELDS.has(field) ? parseInlineArray(rawValue, lineNo) : parseScalar(rawValue);
  }
  if (i >= lines.length) throw new Error('missing frontmatter close ---');

  for (const req of ['key', 'title', 'project', 'status', 'created', 'updated']) {
    if (fm[req] === undefined || fm[req] === '') {
      throw new Error(`missing required field: ${req}`);
    }
  }
  const body = lines.slice(i + 1).join('\n').trim();
  return { fm, body };
}

// ---------------------------------------------------------------- /api/items

async function scanArtifacts(key) {
  const dir = path.join(ARTIFACTS_DIR, key);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const st = await fs.stat(path.join(dir, e.name));
    out.push({
      name: e.name,
      path: `/artifacts/${encodeURIComponent(key)}/${encodeURIComponent(e.name)}`,
      size: st.size,
      mtime: st.mtime.toISOString(),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function buildItems() {
  const items = [];
  const errors = [];
  let files = [];
  try {
    files = (await fs.readdir(ITEMS_DIR)).filter(f => f.toLowerCase().endsWith('.md'));
  } catch { /* items dir missing: empty archive */ }

  for (const file of files.sort()) {
    try {
      const text = await fs.readFile(path.join(ITEMS_DIR, file), 'utf8');
      const { fm, body } = parseFrontmatter(text, file);
      const numMatch = String(fm.key).match(/-(\d+)$/);
      items.push({
        key: fm.key,
        num: numMatch ? Number(numMatch[1]) : null,
        project: fm.project,
        title: fm.title,
        status: fm.status,
        stage: fm.stage ?? null,
        attention: fm.attention ?? null,
        ready: fm.ready ?? null,
        created: fm.created,
        updated: fm.updated,
        resolved: fm.resolved ?? null,
        tags: fm.tags ?? [],
        links: fm.links ?? [],
        repos: fm.repos ?? [],
        related: fm.related ?? [],
        aliases: fm.aliases ?? [],
        body,
        artifacts: await scanArtifacts(fm.key),
      });
    } catch (err) {
      errors.push({ file: `items/${file}`, message: err.message });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
    errors,
  };
}

// ---------------------------------------------------------------- mentions

// Teams @mention inbox: data lives in mentions\mentions.json, written by the
// /mentions skill (sync). The endpoints below only flip completed state.
const MENTIONS_FILE = path.join(ROOT, 'mentions', 'mentions.json');

async function readMentions() {
  try {
    return JSON.parse(await fs.readFile(MENTIONS_FILE, 'utf8'));
  } catch {
    return { user: null, lastSync: null, messages: [] };
  }
}

async function setMentionCompleted(id, completed) {
  const data = await readMentions();
  const msg = (data.messages || []).find(m => m.id === id);
  if (!msg) return null;
  msg.completed = completed ? new Date().toISOString() : null;
  await fs.mkdir(path.dirname(MENTIONS_FILE), { recursive: true });
  await fs.writeFile(MENTIONS_FILE, JSON.stringify(data, null, 2));
  return msg;
}

// ---------------------------------------------------------------- sessions

// Claude Code session discovery: scan ~\.claude\projects\*\*.jsonl for work-item
// key mentions, worktree cwds, and branch names. Incremental — a file is only
// re-read when its size/mtime signature changes; the index persists in .cache\.
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const CACHE_DIR = path.join(ROOT, '.cache');
const SESSION_INDEX_FILE = path.join(CACHE_DIR, 'session-index.json');
const RECAPS_DIR = path.join(CACHE_DIR, 'recaps');
// Narrowed by config.projectKeys when set; otherwise any Jira-style key.
const KEY_MENTION_RE = Array.isArray(CONFIG.projectKeys) && CONFIG.projectKeys.length
  ? new RegExp(`\\b(?:${CONFIG.projectKeys.join('|')})-\\d{1,5}\\b`, 'gi')
  : /\b[A-Z][A-Z0-9]{1,9}-\d{1,5}\b/gi;
const RECAP_TIMEOUT_MS = 300_000;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

let sessionIndex = null;           // { files: { [absPath]: entry } }
const recapsInFlight = new Set();

async function loadSessionIndex() {
  if (sessionIndex) return;
  try {
    sessionIndex = JSON.parse(await fs.readFile(SESSION_INDEX_FILE, 'utf8'));
    if (!sessionIndex.files) sessionIndex = { files: {} };
  } catch {
    sessionIndex = { files: {} };
  }
}

// First real user prompt = the session's de-facto title. Skips tool results,
// sidechains, and <command>/<system-reminder>-style wrapper messages.
function firstUserPrompt(lines) {
  for (const line of lines) {
    if (!line.includes('"type":"user"')) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== 'user' || rec.isSidechain) continue;
    const c = rec.message && rec.message.content;
    let text = typeof c === 'string' ? c
      : Array.isArray(c) ? ((c.find(p => p.type === 'text') || {}).text || '') : '';
    text = text.trim();
    if (!text || text.startsWith('<') || text.startsWith('Caveat:')) continue;
    return text.replace(/\s+/g, ' ').slice(0, 240);
  }
  return '';
}

async function scanSessionFile(file, st) {
  const text = await fs.readFile(file, 'utf8');
  const entry = {
    sig: `${st.size}:${Math.round(st.mtimeMs)}`,
    id: path.basename(file, '.jsonl'),
    project: path.basename(path.dirname(file)),
    sizeKB: Math.round(st.size / 1024),
  };
  const cwdM = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  entry.cwd = cwdM ? JSON.parse(`"${cwdM[1]}"`) : null;
  const branches = new Set();
  for (const m of text.matchAll(/"gitBranch":"((?:[^"\\]|\\.)*)"/g)) {
    if (m[1] && m[1] !== 'HEAD') branches.add(m[1]);
    if (branches.size >= 5) break;
  }
  entry.branches = [...branches];
  const tsFirst = text.match(/"timestamp":"([^"]+)"/);
  entry.firstTs = tsFirst ? tsFirst[1] : null;
  const li = text.lastIndexOf('"timestamp":"');
  entry.lastTs = li >= 0 ? text.slice(li + 13, text.indexOf('"', li + 13)) : entry.firstTs;
  entry.msgs = (text.match(/"type":"(?:user|assistant)"/g) || []).length;
  const keys = {};
  for (const m of text.matchAll(KEY_MENTION_RE)) {
    const k = m[0].toUpperCase();
    keys[k] = (keys[k] || 0) + 1;
  }
  entry.keys = keys;
  entry.firstPrompt = firstUserPrompt(text.split('\n'));
  return entry;
}

async function refreshSessionIndex() {
  await loadSessionIndex();
  let dirs = [];
  try { dirs = await fs.readdir(PROJECTS_DIR, { withFileTypes: true }); } catch { return; }
  const seen = new Set();
  let changed = false;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let files = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue;
      const file = path.join(dir, f);
      let st;
      try { st = await fs.stat(file); } catch { continue; }
      if (!st.isFile() || st.size === 0) continue;
      seen.add(file);
      if (sessionIndex.files[file]?.sig === `${st.size}:${Math.round(st.mtimeMs)}`) continue;
      try {
        sessionIndex.files[file] = await scanSessionFile(file, st);
        changed = true;
      } catch { /* unreadable mid-write — retry next request */ }
    }
  }
  for (const file of Object.keys(sessionIndex.files)) {
    if (!seen.has(file)) { delete sessionIndex.files[file]; changed = true; }
  }
  if (changed) {
    await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
    fs.writeFile(SESSION_INDEX_FILE, JSON.stringify(sessionIndex)).catch(() => {});
  }
}

async function readRecap(id) {
  try { return await fs.readFile(path.join(RECAPS_DIR, `${id}.md`), 'utf8'); }
  catch { return null; }
}

async function sessionsForKey(key) {
  await refreshSessionIndex();
  const K = key.toUpperCase();
  const out = [];
  for (const e of Object.values(sessionIndex.files)) {
    const mentions = (e.keys && e.keys[K]) || 0;
    const inCwd = !!(e.cwd && e.cwd.toUpperCase().includes(K));
    const branch = (e.branches || []).find(b => b.toUpperCase().includes(K)) || null;
    if (!mentions && !inCwd && !branch) continue;
    const { keys, sig, ...pub } = e;
    out.push({ ...pub, mentions, strong: inCwd || !!branch, matchedBranch: branch, recap: await readRecap(e.id) });
  }
  out.sort((a, b) => (b.strong - a.strong) || (b.mentions - a.mentions)
    || String(b.lastTs || '').localeCompare(String(a.lastTs || '')));
  return out;
}

// Mirrors Get-ClaudeSessionRecaps.ps1: fork the session read-only and print /recap.
function handleRecap(res, id) {
  let responded = false;
  const reply = (status, obj) => {
    if (responded) return;
    responded = true;
    send(res, status, JSON_HEADERS, JSON.stringify(obj));
  };
  refreshSessionIndex().then(async () => {
    const entry = Object.values(sessionIndex.files).find(e => e.id.toLowerCase() === id.toLowerCase());
    if (!entry) return reply(404, { error: 'Unknown session id' });
    const cached = await readRecap(entry.id);
    if (cached) return reply(200, { recap: cached, cached: true });
    if (recapsInFlight.has(entry.id)) return reply(409, { error: 'A recap for this session is already running' });
    recapsInFlight.add(entry.id);

    let cwd = os.homedir();
    if (entry.cwd && fss.existsSync(entry.cwd)) cwd = entry.cwd;
    const proc = spawn('claude',
      ['-p', '--resume', entry.id, '--fork-session', '--no-session-persistence', '/recap'],
      { cwd, shell: true, windowsHide: true });
    proc.stdin.end();
    let out = '', errText = '';
    proc.stdout.on('data', c => out += c);
    proc.stderr.on('data', c => errText += c);
    const timer = setTimeout(() => {
      proc.kill();
      recapsInFlight.delete(entry.id);
      reply(504, { error: `Recap timed out after ${RECAP_TIMEOUT_MS / 1000}s` });
    }, RECAP_TIMEOUT_MS);
    proc.on('close', async code => {
      clearTimeout(timer);
      recapsInFlight.delete(entry.id);
      if (code === 0 && out.trim()) {
        await fs.mkdir(RECAPS_DIR, { recursive: true }).catch(() => {});
        await fs.writeFile(path.join(RECAPS_DIR, `${entry.id}.md`), out.trim()).catch(() => {});
        reply(200, { recap: out.trim() });
      } else {
        reply(502, { error: `claude exited ${code}: ${(errText || out || 'no output').trim().slice(0, 400)}` });
      }
    });
    proc.on('error', e => {
      clearTimeout(timer);
      recapsInFlight.delete(entry.id);
      reply(502, { error: `Failed to launch claude: ${e.message}` });
    });
  }).catch(e => reply(500, { error: e.message }));
}

// ---------------------------------------------------------------- serving

// Resolve urlPath inside root; null when it escapes (traversal) or is invalid.
function safePath(root, urlPath) {
  if (urlPath.includes('\0')) return null;
  const resolved = path.normalize(path.join(root, urlPath));
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

async function serveFile(res, filePath, cacheControl) {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  }
  if (!st.isFile()) {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  }
  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': cacheControl,
  });
  fss.createReadStream(filePath).pipe(res);
}

function logRequest(status, method, url) {
  const line = `${new Date().toISOString()} ${status} ${method} ${url}\n`;
  fs.appendFile(LOG_FILE, line).catch(() => {});
}

const server = http.createServer(async (req, res) => {
  res.on('finish', () => logRequest(res.statusCode, req.method, req.url));
  try {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
    } catch {
      return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad request');
    }

    if (req.method === 'POST') {
      // State-changing endpoints: refuse cross-origin browser requests
      // (drive-by form posts from arbitrary websites reach localhost).
      // Same-origin pages send a localhost Origin; curl sends none.
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
      }
      const m = pathname.match(/^\/api\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/recap$/i);
      if (m) return handleRecap(res, m[1]);
      const mm = pathname.match(/^\/api\/mentions\/(\d+)\/(complete|reopen)$/);
      if (mm) {
        const msg = await setMentionCompleted(mm[1], mm[2] === 'complete');
        if (!msg) return send(res, 404, JSON_HEADERS, JSON.stringify({ error: 'Unknown message id' }));
        return send(res, 200, JSON_HEADERS, JSON.stringify(msg));
      }
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD, POST' }, 'Method not allowed');
    }

    {
      const m = pathname.match(/^\/api\/sessions\/([A-Za-z]+-\d+)$/);
      if (m) {
        const sessions = await sessionsForKey(m[1]);
        return send(res, 200, JSON_HEADERS, JSON.stringify({ key: m[1].toUpperCase(), count: sessions.length, sessions }));
      }
    }

    if (pathname === '/api/items') {
      const payload = JSON.stringify(await buildItems());
      return send(res, 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      }, payload);
    }

    if (pathname === '/api/mentions') {
      return send(res, 200, JSON_HEADERS, JSON.stringify(await readMentions()));
    }

    if (pathname === '/mentions') {
      // Old standalone-page URL — mentions is a SPA route now.
      return send(res, 302, { Location: '/#/mentions' }, 'See /#/mentions');
    }

    if (pathname.startsWith('/artifacts/')) {
      const target = safePath(ARTIFACTS_DIR, pathname.slice('/artifacts/'.length));
      if (!target) return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
      return serveFile(res, target, 'no-cache');
    }

    const staticPath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = safePath(PUBLIC_DIR, staticPath);
    if (!target) return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
    return serveFile(res, target, 'no-cache');
  } catch (err) {
    logRequest(500, req.method, `${req.url} — ${err.message}`);
    return send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`worklog serving http://${HOST}:${PORT}`);
});
