@echo off
rem Installs every worklog skill (skill\<name>) user-level via a directory
rem junction, so they are available in every Claude Code session regardless
rem of cwd. Idempotent, no admin needed, works from any repo location.
pushd "%~dp0.."
set "REPO=%CD%"
popd
if not exist "%USERPROFILE%\.claude\skills" mkdir "%USERPROFILE%\.claude\skills"
for /d %%S in ("%REPO%\skill\*") do (
  if exist "%USERPROFILE%\.claude\skills\%%~nxS" (
    echo Already installed: %%~nxS
  ) else (
    mklink /J "%USERPROFILE%\.claude\skills\%%~nxS" "%%S"
  )
)
