---
name: archive
description: Archive or update a work item in the local worklog. Use when the user says /archive, "archive this ticket", "file <KEY>", "mark <KEY> resolved", or at the end of a work session on a Jira card. Args: optional item key(s) and/or a status hint like "resolved".
---

# Archive a work item

Paths - `WORKLOG` = the worklog repo root. Resolve it from the skill junction: `powershell -c "(Get-Item $env:USERPROFILE\.claude\skills\archive).Target"` and strip the trailing `\skill\archive`.
- Items: `<WORKLOG>\items\<KEY>.md`
- Artifacts: `<WORKLOG>\artifacts\<KEY>\`
- Config: `<WORKLOG>\config.json` - `jiraBaseUrl`, `githubOwner`, `port` (default 43210)
- UI: `http://localhost:<port>` (`#/item/<KEY>` for a single item)

## 1. Resolve the key

- Key in args (`PROJ-142`, `OPS-7`): normalize to `UPPER-dash` form (`proj142` → `PROJ-142`).
- Bare number in args (`142`): expand using existing item files and session context; confirm the expansion with the user if ambiguous.
- No key given: infer from the session - branch names (`PROJ-142`), worktree folder names (`*-PROJ-142`), keys discussed in conversation. Confirm with the user before writing.
- Work with no Jira card (local chores, tooling): use a `LOCAL-n` key. Next n = max over existing `items\LOCAL-*.md` + 1 (unpadded, e.g. `LOCAL-3`). Ask before creating a LOCAL item if a Jira key seems plausible.
- Multiple keys in args: process each one through the full flow.

## 2. Create vs update

- If `items\<KEY>.md` exists, READ it first. Then:
  - Preserve `created`.
  - Union-merge `tags`, `links`, `repos`, `related` (never drop existing entries).
  - `## History` is append-only - add a dated line, never rewrite old lines.
  - Update `status`, `stage`, `attention`, `ready`, `updated`, and the `## Now` / `## Next` / `## Detail` sections to reflect the current state.
  - A "resolved"/"done" hint in args or context → `status: done`, `resolved: <today>`, remove `attention`, set `stage: "Done"` (or a more specific label like `"Shipped in <release>"`).
- Otherwise create a new file from the template in section 4.

## 3. Verify against sources (best effort, never block)

- **Jira**: if an Atlassian MCP tool is available (`getJiraIssue` or similar), fetch the issue for the real title, current status, and last-updated date. Map Jira status → enum:
  - In Progress → `in-progress` · Peer review → `in-progress` with `stage: "Peer review"` · Deployment → `deployment` · Awaiting Verification / Verification → `verification` · Done / Closed → `done` · To Do / Open / Backlog → `todo`.
- **GitHub**: for PRs mentioned in the session or in `repos`, confirm state before asserting it (owner = `githubOwner` from config):
  `gh pr view <n> --repo <githubOwner>/<repo> --json state,title,url,mergedAt`
- If neither source is reachable: write from session context only and append to History:
  `- <date>: archived from session context; Jira not verified.`
- Never invent Jira statuses or PR states. Only state what a source or the session actually showed.

## 4. Write `items\<KEY>.md`

Frontmatter uses a constrained YAML subset the server parses (quoting rules matter):
- `title`, `stage`, `attention`, `ready` - always double-quoted JSON strings.
- `tags`, `repos`, `related`, `aliases` - inline arrays `[a, b]` of bare scalars.
- `links` - block list of `label` + `url` pairs; Jira link first (`<jiraBaseUrl>/browse/<KEY>`).
- Dates - bare `YYYY-MM-DD`.
- Omit optional fields entirely rather than leaving them empty.

```markdown
---
key: PROJ-142
title: "Add filtered index for the slow dashboard query"
project: PROJ
status: deployment
stage: "Awaiting deployment QA"
attention: "DB change not yet applied"
created: 2026-07-16
updated: 2026-07-23
tags: [dashboard, sql, index]
links:
  - label: Jira
    url: https://your-org.atlassian.net/browse/PROJ-142
repos: [your-repo]
related: [PROJ-140, PROJ-141]
---
## Now
One-paragraph current state / what is done.

## Next
The single next action.

## Detail
- Bullet points: remaining sub-tasks, caveats, acceptance criteria

## History
- 2026-07-23: archived; in Deployment since 16 Jul.
```

Field reference: `key` (required) · `title` (required) · `project` = the key's prefix, `LOCAL` for non-ticketed chores (required) · `status` = `todo` | `in-progress` | `deployment` | `verification` | `done` | `dropped` (required) · `stage` freeform label · `attention` renders a ⚠ chip · `ready` renders a ✓ chip · `created`/`updated` required · `resolved` only when done/dropped · `tags`, `links`, `repos`, `related`, `aliases` optional.

Body sections (the dashboard consumes them): `## Now` (current state), `## Next` (next action), `## Detail` (bullets), `## History` (append-only dated log). For resolved items, `## Now` becomes the final outcome/resolution summary and `## Next` is removed.

## 5. File artifacts

- New artifacts produced during a session (summaries, dashboards, load-test results, runbooks, plans) are written DIRECTLY into `artifacts\<KEY>\` - never into a repo or project root.
- Copy session-relevant files with descriptive kebab-case names (e.g. `loadtest-results.md`, `index-runbook.md`).
- An artifact covering several keys: file it under the lowest-numbered key; add the other keys to `related` and mention the artifact in their `## Detail` sections.
- Cross-item status snapshots (whole-board reports) go to `artifacts\_reports\`, not to any single item.

## 6. Validate and commit

1. `curl -s http://127.0.0.1:43210/api/items` - confirm the key appears and `errors` is `[]`. If the server is down, skip silently (files are still valid).
2. Cross-check the mentions inbox: `curl -s http://127.0.0.1:43210/api/mentions` - if any OPEN message's `bodyHtml` references <KEY>, tell the user and offer to mark it complete (`curl -s -X POST http://127.0.0.1:43210/api/mentions/<id>/complete`). Only complete with the user's go-ahead; skip silently when there are no matches or no mentions data.
3. `git -C <WORKLOG> add -A && git -C <WORKLOG> commit -m "archive: <KEY> - <short action>"`
4. Tell the user: `Archived → http://localhost:43210/#/item/<KEY>`

## Rules

- Only ever write under `items\` and `artifacts\`. Never touch `server.js`, `public\`, or `scripts\`.
- Never delete an item file; `status: dropped` is how work gets retired.
- Keep `## History` truthful and dated; it is the audit trail.
