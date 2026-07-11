# FlightLevel local dev launcher
# Hardened version: kills stale listeners on BOTH ports (8888 + 5173),
# retries the kill, then verifies the guide function actually responds
# before declaring dev ready. See .kiro/steering/flightlevel-dev-workflow.md.

$ErrorActionPreference = 'Continue'

# --- Load API keys from .env.local (overrides remote Netlify config) ---
$k = (Get-Content .env.local | Where-Object { $_ -match '^ANTHROPIC' }) -replace 'ANTHROPIC_API_KEY=', ''
$env:ANTHROPIC_API_KEY = $k.Trim()

$a = (Get-Content .env.local | Where-Object { $_ -match '^AERODATABOX' }) -replace 'AERODATABOX_API_KEY=', ''
$env:AERODATABOX_API_KEY = $a.Trim()

# --- Kill anything listening on 8888 (Netlify) or 5173 (Vite), with retry ---
function Clear-Port($port) {
    for ($i = 0; $i -lt 3; $i++) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $conns) { return }
        foreach ($c in $conns) {
            Write-Host "Killing stale process on port $port (PID $($c.OwningProcess))"
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 800
    }
    $stillThere = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($stillThere) {
        Write-Host "WARNING: port $port still occupied after 3 kill attempts (PID $($stillThere.OwningProcess))" -ForegroundColor Yellow
    }
}

Clear-Port 8888
Clear-Port 5173

# --- Start netlify dev in the background so we can verify it, not just trust the banner ---
Write-Host "Starting netlify dev --offline ..."
$job = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    $env:ANTHROPIC_API_KEY = $using:env:ANTHROPIC_API_KEY
    $env:AERODATABOX_API_KEY = $using:env:AERODATABOX_API_KEY
    netlify dev --offline 2>&1
}

# --- Poll the actual guide function until it responds or we time out ---
$maxWaitSeconds = 45
$elapsed = 0
$ready = $false

while ($elapsed -lt $maxWaitSeconds) {
    Start-Sleep -Seconds 2
    $elapsed += 2
    try {
        $resp = Invoke-WebRequest -Uri 'http://localhost:8888/.netlify/functions/guide' `
            -Method Post -Body '{"messages":[{"role":"user","content":"ping"}]}' `
            -ContentType 'application/json' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        # Netlify may return non-200 (e.g. 500 if key missing) — that still proves
        # the server is UP and routing, which is what we actually care about here.
        if ($_.Exception.Response) { $ready = $true; break }
    }
}

if ($ready) {
    Write-Host "`n✅ Dev server confirmed responding at http://localhost:8888" -ForegroundColor Green
    Write-Host "   Frontend: http://localhost:5173`n" -ForegroundColor Green
} else {
    Write-Host "`n❌ Dev server did NOT respond within $maxWaitSeconds seconds." -ForegroundColor Red
    Write-Host "   Check the job output below for errors.`n" -ForegroundColor Red
}

# --- Stream live output from the background job so it behaves like the old foreground script ---
try {
    while ($job.State -eq 'Running') {
        Receive-Job -Job $job
        Start-Sleep -Milliseconds 500
    }
} finally {
    Receive-Job -Job $job
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
}
