# Worklog — setup

A personal, local work dashboard for Claude Code users:

- **`/archive`** — archive Jira work items with notes, artifacts, and related Claude sessions; browsable dashboard + searchable history at http://localhost:43210
- **`/mentions`** — inbox of Teams chat messages that directly @mention you, with per-message mark-complete, at http://localhost:43210/#/mentions

Everything runs on your machine, bound to 127.0.0.1 only. Your items and mentions are yours; nothing is shared.

## Prerequisites

1. Windows with **Node.js 18+** on PATH
2. **Claude Code** installed
3. For `/mentions`: the **Microsoft 365 connector** enabled in Claude Code (claude.ai connectors, signed in with your work account)
4. Optional, improves `/archive`: Atlassian connector (Jira verification) and `gh` CLI (PR state checks)

## Install (5 minutes)

1. `git clone https://github.com/HeyGirardi/worklog` anywhere you like (or unzip the team package)
2. Copy `config.example.json` to `config.json`; set your Jira project keys, Jira base URL, and GitHub org
3. `powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1` — registers the WorklogServer scheduled task (starts at logon, runs now)
4. `scripts\install-skill.cmd` — junctions the `/archive` and `/mentions` skills into `%USERPROFILE%\.claude\skills`
5. Open http://localhost:43210 — empty dashboard is correct on first run
6. In any Claude Code session, run `/mentions` — first run stores your identity (via the Microsoft 365 connector) and pulls the last 7 days of Teams mentions; then `/archive <KEY>` at the end of a piece of work

Recommended: keep your clone's git history for your own data (the skills commit automatically when git is present). Don't push your data anywhere shared — `items\`, `artifacts\`, and `mentions\` are personal.

## Notes and limits

- **Port**: 43210 by default; change `port` in `config.json` and rerun `scripts\restart-server.ps1`.
- **Mentions coverage**: Microsoft Graph date-filtered search reaches 1:1, group, and meeting chats only — Teams **channel** messages never appear.
- **Data freshness**: the mentions page updates when `/mentions` runs in Claude Code; the server cannot reach Teams by itself.
- **Restart / status**: `scripts\restart-server.ps1` · `Get-ScheduledTaskInfo WorklogServer`
- Full docs: `README.md`
