# Registers the WorklogServer scheduled task: starts node server.js at logon,
# no console window (S4U), no 72-hour execution kill, auto-restart on failure.
# Run: powershell -ExecutionPolicy Bypass -File <repo>\scripts\install-task.ps1
$ErrorActionPreference = 'Stop'

$node = (Get-Command node.exe).Source
$repo = Split-Path -Parent $PSScriptRoot
Write-Host "Using node: $node"
Write-Host "Repo root:  $repo"

$action    = New-ScheduledTaskAction -Execute $node -Argument 'server.js' -WorkingDirectory $repo
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$settings.ExecutionTimeLimit = 'PT0S'   # disable the default 72-hour kill

Register-ScheduledTask -TaskName 'WorklogServer' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
Start-ScheduledTask -TaskName 'WorklogServer'
Start-Sleep -Seconds 2
Get-ScheduledTask -TaskName 'WorklogServer' | Select-Object TaskName, State
Write-Host "Worklog: http://localhost:43210"
