<#
.SYNOPSIS
  Registers the BookMyShow capture as a Windows scheduled task.

.DESCRIPTION
  Creates a task that runs scripts/bms-capture.mjs at fixed times each day. Run once; after
  that the capture is unattended for as long as this machine is on and logged in.

  Deliberately a small number of runs per day. The justification for collecting this way at
  all is that it stays at the volume of a person checking a few pages — the server enforces
  its own daily cap (BOOKMYSHOW_CAPTURE_MAX_PER_DAY) so a mistake here cannot turn into a
  flood.

  The task runs INTERACTIVELY (-Interactive), not as a background service. That is required,
  not incidental: the capture drives a real Chrome window, and Chrome needs a desktop
  session. It also means you will see the window appear, which is a feature — collection
  that happens visibly is collection you can notice going wrong.

.PARAMETER CampaignId
  The theater campaign to capture. Find it in the campaign page URL.

.PARAMETER Times
  Times of day to run, 24h. Default 09:00, 14:00, 19:00.

.PARAMETER Cities
  Optional comma-separated region codes. Defaults to the campaign's configured cities.

.EXAMPLE
  .\scripts\install-bms-capture-task.ps1 -CampaignId 6f1e... -Times '09:00','19:00'

.EXAMPLE
  # Remove it again
  Unregister-ScheduledTask -TaskName 'StarAnalytics BMS Capture' -Confirm:$false
#>
param(
  [Parameter(Mandatory = $true)][string]$CampaignId,
  [string[]]$Times = @('09:00', '14:00', '19:00'),
  [string]$Cities,
  [string]$TaskName = 'StarAnalytics BMS Capture'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectRoot 'scripts\bms-capture.mjs'

if (-not (Test-Path $scriptPath)) {
  throw "Could not find $scriptPath"
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw 'node was not found on PATH. Install Node.js or run this from a shell where node resolves.'
}

$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path $envFile)) {
  Write-Warning "No .env.local at $envFile — the capture needs BOOKMYSHOW_CAPTURE_SECRET and STARANALYTICS_URL there."
}

$argList = "`"$scriptPath`" --campaign $CampaignId"
if ($Cities) { $argList += " --cities $Cities" }

$action = New-ScheduledTaskAction -Execute $node -Argument $argList -WorkingDirectory $projectRoot

$triggers = foreach ($t in $Times) { New-ScheduledTaskTrigger -Daily -At $t }

# StartWhenAvailable catches up a run missed because the machine was asleep, rather than
# silently skipping the day. ExecutionTimeLimit is a backstop against a hung browser
# holding the task open forever.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "Replacing existing task '$TaskName'."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description 'Captures BookMyShow showtime availability for a StarAnalytics theater campaign, using a real Chrome window on this machine.' | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName'" -ForegroundColor Green
Write-Host "  runs at : $($Times -join ', ')"
Write-Host "  campaign: $CampaignId"
Write-Host "  command : $node $argList"
Write-Host ''
Write-Host 'Test it now with:'
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ''
Write-Host 'Log output goes to bms-capture.log in the project root.'
Write-Host 'Remove it with:'
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
