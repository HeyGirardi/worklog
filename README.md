# Worklog

Local-first work dashboard for [Claude Code](https://claude.com/claude-code) users: a searchable archive of every work item (`PROJ-123`-style Jira keys, or `LOCAL-n` for non-ticketed chores), a live open-items dashboard, and a Teams @mentions inbox. Runs permanently at **http://localhost:43210** (bound to 127.0.0.1 only — nothing leaves your machine).

- **Dashboard** (`#/`): open items grouped by stage — KPI tiles, pipeline strip, cards.
- **Archive** (`#/archive`): every item, searchable and filterable. Typing `142` finds PROJ-142; `proj-142`, `PROJ-142`, or `142` all work; free text searches titles, bodies, and tags. Enter jumps straight to a single ID match. `/` focuses the search box.
- **Item detail** (`#/item/PROJ-142`): rendered notes, links, related items, artifacts, and related **Claude sessions**.
- **Mentions** (`#/mentions`): Teams messages that directly @mention you, with per-message mark-complete.

Data gets in through two Claude Code skills (both in `skill\`, installed as junctions by `scripts\install-skill.cmd`):

- **`/archive <KEY>`** — files a work item at the end of a session: verifies against Jira/GitHub where connectors are available, writes `items\<KEY>.md`, files artifacts, commits.
- **`/mentions`** — pulls Teams chat messages that directly @mention you (via the Microsoft 365 connector), classifies them action/question/FYI, and merges them into the inbox.

New machine? Follow **TEAM-SETUP.md** (about 5 minutes).

## Configuration

Copy `config.example.json` to `config.json` (gitignored) and edit. All fields optional:

| Field | Purpose | Default |
|---|---|---|
| `port` | server port | `43210` |
| `projectKeys` | your Jira project prefixes, e.g. `["PROJ", "OPS", "LOCAL"]` — narrows session scanning | any `KEY-123` pattern |
| `jiraBaseUrl` | used by the `/archive` skill for issue links | — |
| `githubOwner` | used by the `/archive` skill for `gh pr view` checks | — |

## Claude sessions

The item detail view auto-discovers related Claude Code sessions by scanning `~\.claude\projects\*\*.jsonl` for key mentions, worktree paths, and branch names (incremental index, cached in `.cache\session-index.json`). Sessions are ranked: worktree/branch matches first, then by mention count.

Each collapsible card shows the date range, first prompt, and message count; expanded it gives:
- a **copyable resume command**: `cd "<original cwd>"; claude --resume <session-id>`
- a **Generate recap** button — runs `claude -p --resume <id> --fork-session --no-session-persistence "/recap"` (read-only fork, the original session is never modified). This is a real API call (~30–90 s, normal token cost). Results are cached in `.cache\recaps\<id>.md`.

API: `GET /api/sessions/<KEY>` · `POST /api/sessions/<id>/recap`.

## Teams mentions

`#/mentions` (a SPA route like the rest; the old `/mentions` path 302-redirects) is an inbox of Teams chat messages that directly @mention you. Data lives in `mentions\mentions.json` and gets there via the **`/mentions` skill**, which searches Teams through the Microsoft 365 MCP connector, keeps only messages whose `mentions[]` include your AAD id, classifies each as action/question/FYI, and merges without ever touching completed state. "Mark complete" / "Reopen" on the page hit `POST /api/mentions/<id>/complete|reopen`. Coverage caveat: the Graph search path used with date filters only scans 1:1/group/meeting chats — Teams **channel** messages never appear.

API: `GET /api/mentions` · `POST /api/mentions/<id>/complete` · `POST /api/mentions/<id>/reopen`.

## Layout

```
server.js            zero-dependency node:http server
config.json          your deployment values (gitignored; see config.example.json)
public\              SPA: index.html, app.js, styles.css,
                     vendor\ (minisearch 7.2.0, marked 18.0.7, dompurify 3.4.12, fonts\)
items\<KEY>.md       one file per work item
artifacts\<KEY>\     files belonging to an item (auto-scanned, no manifest)
artifacts\_reports\  cross-item snapshots
mentions\            mentions.json — Teams @mention inbox data
skill\archive\       the /archive skill (junctioned to ~\.claude\skills\archive)
skill\mentions\      the /mentions skill (junctioned to ~\.claude\skills\mentions)
scripts\             install-task.ps1, install-skill.cmd, restart-server.ps1, package-team.ps1
server.log           request log (gitignored)
```

## Item file format

```markdown
---
key: PROJ-142
title: "Add filtered index for the slow dashboard query"
project: PROJ                     # the key's prefix; LOCAL for non-ticketed chores
status: deployment                # todo | in-progress | deployment | verification | done | dropped
stage: "Awaiting deployment QA"   # optional freeform label shown on the status chip
attention: "DB change not yet applied"   # optional, renders the amber warning chip
ready: "Ready for review"                # optional, renders the green check chip
created: 2026-06-17
updated: 2026-07-23
resolved: 2026-07-25              # only when done/dropped
tags: [dashboard, sql, index]
links:
  - label: Jira
    url: https://your-org.atlassian.net/browse/PROJ-142
repos: [your-repo]
related: [PROJ-140, PROJ-141]
aliases: []
---
## Now
Current state (or, for resolved items, the final outcome/resolution).

## Next
The single next action. Remove for resolved items.

## Detail
- Bullets: sub-tasks, caveats, acceptance criteria

## History
- 2026-07-23: append-only dated log lines.
```

**Quoting rules (the parser is a strict, constrained YAML subset):**
- `title`/`stage`/`attention`/`ready` are double-quoted JSON strings; everything else bare.
- `tags`/`repos`/`related`/`aliases` are inline arrays `[a, b]`.
- `links` is the only block list: `- label:` / `url:` pairs, Jira first.
- Dates are bare `YYYY-MM-DD`. Omit optional fields rather than leaving them empty.
- A malformed file appears in a warning banner in the UI (and in `errors[]` of `/api/items`), it never breaks the rest.

The dashboard extracts `## Now`, `## Next`, and the first three `## Detail` bullets for the cards. Numeric lookup (`142`) is derived from `key`; `aliases` is only for extra search terms.

## Operations

| What | How |
|---|---|
| Status | `Get-ScheduledTaskInfo WorklogServer` (LastTaskResult 267009 = running) |
| Restart (e.g. after editing server.js) | `powershell -ExecutionPolicy Bypass -File scripts\restart-server.ps1` — plain `Stop-ScheduledTask` can leave the node process holding the port |
| Run in foreground (debugging) | stop the task, then `node server.js` in this folder |
| Reinstall the task | `powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1` |
| Reinstall the skill junctions | `scripts\install-skill.cmd` (installs every `skill\*`) |
| Change port | set `port` in `config.json`, restart the task |
| Package for a teammate without GitHub access | `powershell -ExecutionPolicy Bypass -File scripts\package-team.ps1` — zips the tooling without personal data |
| Request log | `server.log` in this folder |

The task runs at logon with `S4U` (no console window), `ExecutionTimeLimit` disabled (default would kill it after 72 h), and restarts up to 3 times a minute apart on failure.

## Escape hatches / notes

- **Parser**: hand-rolled for the fixed subset above. If items ever need freeform YAML, swap `parseFrontmatter` in `server.js` for `gray-matter` (~20-line change).
- **Sanitization**: item bodies are rendered with `marked` without DOMPurify — everything there is self-authored on localhost. Mention bodies ARE sanitized (DOMPurify) because Teams message HTML is authored by other people.
- **Vendored libs**: `public\vendor\` — minisearch 7.2.0 (`dist/umd/index.js`), marked 18.0.7 (`lib/marked.umd.js`), dompurify 3.4.12 (`dist/purify.min.js`); versions noted in each file's header comment. No CDN at runtime.

## License

MIT — see `LICENSE`.
