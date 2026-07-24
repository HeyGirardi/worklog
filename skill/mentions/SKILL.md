---
name: mentions
description: Sync Teams messages that directly @mention the user into the worklog mentions inbox (http://localhost:43210/#/mentions). Use when the user says /mentions, "check my mentions", "refresh mentions", "who mentioned me", or asks to mark a mention complete from chat. Args: optional "since <date>" to widen the search window.
---

# Sync Teams mentions

Paths - `WORKLOG` = the worklog repo root. Resolve it from the skill junction: `powershell -c "(Get-Item $env:USERPROFILE\.claude\skills\mentions).Target"` and strip the trailing `\skill\mentions`.
- Data: `<WORKLOG>\mentions\mentions.json`
- UI: `http://localhost:43210/#/mentions` (port configurable in `<WORKLOG>\config.json`)
- API: `GET /api/mentions` · `POST /api/mentions/<id>/complete` · `POST /api/mentions/<id>/reopen`

Required MCP tools (claude.ai Microsoft 365 connector; load via ToolSearch if deferred):
`mcp__claude_ai_Microsoft_365__chat_message_search`, `mcp__claude_ai_Microsoft_365__read_resource`, `mcp__claude_ai_Microsoft_365__get_me`.
If the connector is unavailable (headless run, not signed in), STOP and tell the user - never fabricate messages.

## 1. Identity and window

- Read `mentions.json`. Use `user.id` from it; if the file or field is missing, call `get_me` and store `{id, displayName}`.
- Search window start = `lastSync` minus 48 hours (overlap catches edits and rate-limited gaps). No `lastSync` and no "since" arg → 7 days back. A "since <date>" arg overrides.

## 2. Search

- `chat_message_search` with `query` = the user's surname (on the date-filtered path the query is a literal substring match; surname catches "First Last" and "Last, First" renderings), `afterDateTime` = window start. Start `offset: 0`, follow `nextOffset` until exhausted.
- If the response is prefixed with a partial-results note (rate limit), wait ~30 s and rerun once. Still partial → continue, but report partial coverage to the user at the end.

## 3. Fetch and filter

For each result id not already in `messages` (or already present but with a newer `lastModifiedDateTime`):
- `read_resource` the message URI.
- Keep only messages where `mentions[]` contains an entry with `mentioned.id == user.id` - that is the definition of "mentions me directly". Skip messages sent by the user (`from.id == user.id`) and deleted messages (`deletedDateTime` set).

## 4. Classify

Set `kind`:
- `action` - asks the user to do something (review, test, take a look, "leave that for you", "can you <verb>", work assigned).
- `question` - asks the user for information or confirmation.
- `fyi` - everything else (announcements, process notes, status).
When both action and question apply, prefer `action`.

## 5. Merge and write

Message shape (all fields required, `completed` is `null` or an ISO timestamp):

```json
{
  "id": "1784816721754",
  "chatId": "19:...@thread.v2",
  "chatName": "PR Requests and discussions",
  "from": "Alex Smith",
  "created": "2026-07-23T14:25:21.754Z",
  "edited": false,
  "kind": "question",
  "bodyHtml": "<p>...</p>",
  "teamsUrl": "https://teams.microsoft.com/l/message/<chatId>/<id>?context=%7B%22contextType%22%3A%22chat%22%7D",
  "completed": null
}
```

- `chatName`: the chat `topic` (from `teams_list_chats` if needed, cached knowledge is fine); for 1:1 chats use `"<Other person> (1:1)"`.
- `edited`: true when `lastEditedDateTime` is set.
- `teamsUrl`: `https://teams.microsoft.com/l/message/<chatId>/<id>?context=%7B%22contextType%22%3A%22chat%22%7D` (chatId unencoded, context URL-encoded).
- Merge rules: NEVER change `completed` on an existing message during sync; for edited messages update `bodyHtml`/`edited` only; never delete messages. New messages get `completed: null`. Sort `messages` by `created` descending. Set `lastSync` to now (UTC ISO). Write pretty-printed (2-space) JSON.

## 6. Validate and report

1. `curl -s http://127.0.0.1:43210/api/mentions` - parses, and new ids appear. Server down → files are still valid; skip silently.
2. `git -C <WORKLOG> add mentions && git -C <WORKLOG> commit -m "mentions: sync <YYYY-MM-DD> - <N> new"` (skip commit when nothing changed, or when the repo has no git history).
3. Tell the user: `<N> new, <open> open → http://localhost:43210/#/mentions`, plus the standing caveat that channel messages are not covered (only 1:1/group/meeting chats).

## Completing from chat

When the user says a mention is handled ("mark the PROJ-142 one done"): find its id in `mentions.json`, then
`curl -s -X POST http://127.0.0.1:43210/api/mentions/<id>/complete` (or `/reopen` to undo). Do not edit `completed` in the file by hand while the server is running - the endpoint avoids write races.

## Rules

- Only ever write `mentions\mentions.json`. Never touch `server.js`, `public\`, or `scripts\`.
- Sync is additive: no deletions, no completed-state changes.
- Report real coverage: if the search was partial or the window was narrowed, say so.
