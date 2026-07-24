# Reliable restart: Stop-ScheduledTask can leave the node process alive, so also
# kill whatever holds the port before starting the task again.
$ErrorActionPreference = 'SilentlyContinue'
$port = 43210
$cfg = Join-Path (Split-Path -Parent $PSScriptRoot) 'config.json'
if (Test-Path $cfg) {
  try { $j = Get-Content $cfg -Raw | ConvertFrom-Json; if ($j.port) { $port = [int]$j.port } } catch {}
}
Stop-ScheduledTask -TaskName 'WorklogServer'
Start-Sleep -Seconds 1
$conn = Get-NetTCPConnection -LocalPort $port -State Listen
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; Start-Sleep -Seconds 1 }
Start-ScheduledTask -TaskName 'WorklogServer'
Start-Sleep -Seconds 2
$state = (Get-ScheduledTask -TaskName 'WorklogServer').State
$up = try { (Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { 'DOWN' }
Write-Host "Task: $state | HTTP: $up | http://localhost:$port"
