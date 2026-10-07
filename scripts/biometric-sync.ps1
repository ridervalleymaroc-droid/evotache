<#
.SYNOPSIS
  Pushes new fingerprint attendance punches from a local ZKBio Time server
  to EvoTasks' Biométrie page.

.DESCRIPTION
  Runs on a machine that IS on the same local network as the biometric
  device (EvoTasks itself runs on Hostinger and can't reach a private LAN
  address like 192.168.1.137). Logs into ZKBio Time, fetches punches since
  the last successful run, and POSTs the raw rows to EvoTasks' ingest
  endpoint — EvoTasks does all the parsing/normalization server-side, so
  this script stays intentionally dumb and rarely needs updating.

    Pass -ReplayStart and -ReplayEnd (yyyy-MM-dd HH:mm:ss) to re-fetch a
    bounded historical window without changing the normal sync checkpoint.

  Meant to be run on a schedule (Task Scheduler, every 10-15 min) — see
  the setup notes at the bottom of this file.

.NOTES
  Fill in the 5 values below before running. Nothing here needs to be
  secret from EvoTasks' own codebase, but the *values* you fill in
  (password, ingest token) ARE secrets — don't commit this file with them
  filled in to a public place; keep your copy local to the PC that runs it.
#>

# ---- Fill these in ----
param(
    [string]$ReplayStart,
    [string]$ReplayEnd
)

$PointeuseUrl   = "http://192.168.1.137:8080"        # ZKBio Time base URL (local)
$PointeuseUser  = "admin"                             # ZKBio Time username
$PointeusePass  = "REPLACE_ME"                        # ZKBio Time password REPLACE_ME
$EvoTasksUrl    = "https://evotasks.app/api/biometric/ingest"
$IngestToken    = "REPLACE_ME"                        # must match BIOMETRIC_INGEST_TOKEN on Hostinger REPLACE_ME
# ------------------------

$StateFile = Join-Path $PSScriptRoot "biometric-sync-state.txt"
$LogFile   = Join-Path $PSScriptRoot "biometric-sync.log"

function Write-Log($message) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

try {
    # 1. Log into ZKBio Time to get a fresh token (no documented refresh
    #    flow, so this script just logs in fresh on every run instead).
    Write-Log "Connexion à la pointeuse ($PointeuseUrl)..."
    $loginBody = @{ username = $PointeuseUser; password = $PointeusePass } | ConvertTo-Json
    try {
        $loginResponse = Invoke-RestMethod -Uri "$PointeuseUrl/api-token-auth/" -Method Post -Body $loginBody -ContentType "application/json"
    } catch {
        throw "Échec de connexion à la POINTEUSE (identifiants $PointeuseUser incorrects ?) : $($_.Exception.Message)"
    }
    $token = $loginResponse.token
    if (-not $token) { throw "Pas de token dans la réponse de la pointeuse." }
    Write-Log "Connexion pointeuse OK."

    # 2. Time window: since the last successful run, or the last 24h on
    #    first run. ZKBio Time expects naive "YYYY-MM-DD HH:mm:ss" — its own
    #    local wall-clock, no timezone conversion needed on this end.
    #
    #    Re-queries the last $OverlapMinutes minutes on every run (not just
    #    "since the last checkpoint") — confirmed live that a punch can miss
    #    a cycle entirely if it lands right on the boundary between two
    #    back-to-back windows (clock drift between this PC and the pointeuse,
    #    or a moment's delay before the punch becomes queryable there), and a
    #    non-overlapping window then never revisits that moment again. Safe
    #    to re-fetch the same punches repeatedly: EvoTasks' ingest endpoint
    #    upserts by the pointeuse's own transaction id, so re-sending
    #    something already synced is a harmless no-op.
    $endTime = Get-Date
    $replayMode = [bool]($ReplayStart -or $ReplayEnd)
    if ($replayMode) {
        if (-not $ReplayStart -or -not $ReplayEnd) { throw "ReplayStart et ReplayEnd doivent être fournis ensemble (format yyyy-MM-dd HH:mm:ss)." }
        $culture = [Globalization.CultureInfo]::InvariantCulture
        $replayStartTime = [datetime]::ParseExact($ReplayStart, "yyyy-MM-dd HH:mm:ss", $culture)
        $replayEndTime = [datetime]::ParseExact($ReplayEnd, "yyyy-MM-dd HH:mm:ss", $culture)
        if ($replayStartTime -ge $replayEndTime) { throw "ReplayStart doit précéder ReplayEnd." }
        $startStr = $ReplayStart
        $endStr = $ReplayEnd
    } else {
        $OverlapMinutes = 30
        $lastCheckpoint = if (Test-Path $StateFile) { [datetime](Get-Content $StateFile -Raw) } else { $endTime.AddHours(-24) }
        $startTime = $lastCheckpoint.AddMinutes(-$OverlapMinutes)
        $startStr = $startTime.ToString("yyyy-MM-dd HH:mm:ss")
        $endStr = $endTime.ToString("yyyy-MM-dd HH:mm:ss")
    }

    # 3. Fetch every page of transactions in that window. ZKBio Time's own
    #    docs are ambiguous about whether a token from /api-token-auth/ is
    #    used as "Token <t>" or "JWT <t>" — try "Token" first (it matches
    #    this endpoint's response shape better) and fall back to "JWT" on a
    #    401, so this self-corrects instead of guessing wrong forever.
    $authScheme = "Token"
    function Invoke-PointeuseGet($url) {
        try {
            return Invoke-RestMethod -Uri $url -Headers @{ Authorization = "$script:authScheme $token" }
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            if ($status -eq 401 -and $script:authScheme -eq "Token") {
                Write-Log "Le format 'Token' a été refusé, on essaie 'JWT'..."
                $script:authScheme = "JWT"
                return Invoke-RestMethod -Uri $url -Headers @{ Authorization = "$script:authScheme $token" }
            }
            throw
        }
    }

    $allTransactions = @()
    $page = 1
    try {
        do {
            $url = "$PointeuseUrl/iclock/api/transactions/?start_time=$([uri]::EscapeDataString($startStr))&end_time=$([uri]::EscapeDataString($endStr))&page=$page&page_size=500"
            $response = Invoke-PointeuseGet $url
            $rows = @($response.data)
            $allTransactions += $rows
            $page++
        } while ($rows.Count -eq 500)
    } catch {
        throw "Échec de récupération des données sur la POINTEUSE : $($_.Exception.Message)"
    }

    Write-Log "Fetched $($allTransactions.Count) transaction(s) for $startStr .. $endStr (format d'autorisation utilisé : $authScheme)."

    # 4. Push to EvoTasks (skip the call entirely if there's nothing new).
    if ($allTransactions.Count -gt 0) {
        Write-Log "Envoi de $($allTransactions.Count) transaction(s) vers EvoTasks..."
        $body = @{ transactions = $allTransactions } | ConvertTo-Json -Depth 10
        try {
            $ingestResponse = Invoke-RestMethod -Uri $EvoTasksUrl -Method Post -Body $body -ContentType "application/json" -Headers @{ Authorization = "Bearer $IngestToken" }
        } catch {
            throw "Échec d'envoi vers EVOTASKS (le token ne correspond pas à BIOMETRIC_INGEST_TOKEN sur Hostinger ?) : $($_.Exception.Message)"
        }
        Write-Log "Ingested: $($ingestResponse.synced) synced, $($ingestResponse.checkIns) check-in(s), $($ingestResponse.checkOuts) check-out(s)."
    }

    # 5. Only advance the checkpoint after a successful push, so a failed
    #    run retries the same window next time instead of losing data.
    if (-not $replayMode) {
        $endTime.ToString("o") | Set-Content -Path $StateFile
    } else {
        Write-Log "Rejeu terminé ; le checkpoint normal n'a pas été modifié."
    }
    Write-Log "Done."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}

<#
.SETUP (one-time, on the Windows PC on the same network as the pointeuse)

1. Fill in the 5 values at the top of this file (password + ingest token).
2. On Hostinger, set the environment variable BIOMETRIC_INGEST_TOKEN to the
   exact same value you used for $IngestToken above.
3. Test it once by hand:
     powershell -File biometric-sync.ps1
   Check biometric-sync.log for errors, and check /biometrie in EvoTasks
   for the new punches.
4. Schedule it to run every 10-15 minutes:
   - Open Task Scheduler -> Create Task
   - Trigger: Daily, repeat every 15 minutes, for a duration of 1 day (so
     it keeps repeating indefinitely)
   - Action: Start a program
       Program: powershell.exe
       Arguments: -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\biometric-sync.ps1"
   - Under Settings, check "Run task as soon as possible after a scheduled
     start is missed" so a reboot doesn't lose a cycle.
#>
