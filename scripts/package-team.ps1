# Builds worklog-team-<date>.zip next to the repo root: tooling only, no
# personal data (items, artifacts, mentions data, caches, logs, git history).
$ErrorActionPreference = 'Stop'

$repo  = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP ("worklog-team-" + [guid]::NewGuid())
$zip   = Join-Path $repo ("worklog-team-" + (Get-Date -Format 'yyyy-MM-dd') + ".zip")

$include = @('server.js', 'package.json', 'README.md', 'TEAM-SETUP.md', 'LICENSE', 'config.example.json', '.gitignore', 'public', 'skill', 'scripts')

New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($p in $include) {
  $src = Join-Path $repo $p
  if (Test-Path $src) { Copy-Item $src -Destination $stage -Recurse }
}

if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item $stage -Recurse -Force

Write-Host "Packaged -> $zip"
Write-Host "Contains: $($include -join ', ')"
Write-Host "Excludes: items\, artifacts\, mentions\, .cache\, .git\, server.log"
