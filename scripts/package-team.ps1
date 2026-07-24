# Builds a shareable zip of the worklog tooling next to the repo root.
#   default:    worklog-team-<date>.zip          - public-safe: config.example.json only
#   -Internal:  worklog-team-internal-<date>.zip - adds the real config.json and a
#               tailored START-HERE.md; for sharing inside the team only
# Personal data (items, artifacts, mentions data, caches, logs, git history) is
# never included in either variant.
param([switch]$Internal)
$ErrorActionPreference = 'Stop'

$repo  = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP ("worklog-team-" + [guid]::NewGuid())
$name  = if ($Internal) { 'worklog-team-internal-' } else { 'worklog-team-' }
$zip   = Join-Path $repo ($name + (Get-Date -Format 'yyyy-MM-dd') + '.zip')

$include = @('server.js', 'package.json', 'README.md', 'TEAM-SETUP.md', 'LICENSE',
             'config.example.json', '.gitignore', 'public', 'skill', 'scripts', 'design-system')
if ($Internal) { $include += 'config.json' }

New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($p in $include) {
  $src = Join-Path $repo $p
  if (Test-Path $src) { Copy-Item $src -Destination $stage -Recurse }
}

if ($Internal) {
  @'
# Worklog - start here (internal package)

Local work dashboard + two Claude Code skills. Runs entirely on your machine
(bound to 127.0.0.1); your data never leaves it.

- Dashboard / archive of your work items: http://localhost:43210
- Teams mentions inbox with mark-complete: http://localhost:43210/#/mentions

## Setup (5 minutes)

1. Unzip this folder anywhere you like (e.g. `C:\src\worklog`)
2. `powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1`
   (registers the WorklogServer scheduled task: starts at logon, starts now)
3. `scripts\install-skill.cmd`
   (installs the `/archive` and `/mentions` skills into Claude Code, user-level)
4. Open http://localhost:43210 - an empty dashboard is correct on first run
5. In any Claude Code session run `/mentions` - the first run stores your
   identity and pulls your last 7 days of Teams mentions
6. At the end of a piece of work run `/archive <KEY>`

## Configuration - already done

`config.json` ships pre-filled for our team: the Jira base URL, our project
keys, and the GitHub org used by `/archive` for PR checks. You do not need to
edit anything (the port, 43210, lives there too if you ever need to change it).

Teams needs NO config file: `/mentions` authenticates through YOUR Microsoft
365 connector in Claude Code - enable it under claude.ai connectors and sign
in with your work account before the first run. Jira verification works the
same way through the Atlassian connector (optional), and PR checks use the
`gh` CLI if you have it (optional).

## Updating

Unzip a newer package over this folder, keeping `config.json` and your data
folders (`items\`, `artifacts\`, `mentions\`), then:
`powershell -ExecutionPolicy Bypass -File scripts\restart-server.ps1`

Full docs: `README.md`. (`TEAM-SETUP.md` is the generic GitHub-clone variant of
this guide - this file supersedes it for zip installs.)
'@ | Set-Content (Join-Path $stage 'START-HERE.md') -Encoding UTF8
}

# Windows viewers default to ANSI when a file has no BOM, which turns UTF-8
# punctuation into mojibake; stamp a UTF-8 BOM on every shipped markdown file.
$utf8Bom = New-Object System.Text.UTF8Encoding $true
Get-ChildItem $stage -Recurse -Filter *.md | ForEach-Object {
  [IO.File]::WriteAllText($_.FullName, [IO.File]::ReadAllText($_.FullName), $utf8Bom)
}

if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item $stage -Recurse -Force

Write-Host "Packaged -> $zip"
Write-Host "Variant:  $(if ($Internal) { 'INTERNAL (includes config.json + START-HERE.md)' } else { 'public-safe (config.example.json only)' })"
Write-Host 'Excludes: items\, artifacts\, mentions\, .cache\, .git\, server.log'
