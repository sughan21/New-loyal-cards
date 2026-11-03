# start-tunnel.ps1 - Automated Cloudflare Live Tunnel with Auto-QR linking
$root = $PSScriptRoot
$cloudflared = Join-Path $root "bin\cloudflared.exe"
$tunnelFile = Join-Path $root "data\tunnel_url.txt"
$logFile = Join-Path $root "data\cloudflared.log"

if (-not (Test-Path (Join-Path $root "data"))) {
    New-Item -ItemType Directory -Path (Join-Path $root "data") -Force | Out-Null
}

# Clean old tunnel records
if (Test-Path $tunnelFile) { Remove-Item $tunnelFile -Force -ErrorAction SilentlyContinue }
if (Test-Path $logFile) { Remove-Item $logFile -Force -ErrorAction SilentlyContinue }

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   LOYALTY REWARD - LIVE CLOUDFLARE PUBLIC TUNNEL" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Connecting to Cloudflare network for http://localhost:8085 ..." -ForegroundColor Yellow
Write-Host "Please wait a few seconds..." -ForegroundColor Gray

if (-not (Test-Path $cloudflared)) {
    Write-Host "ERROR: cloudflared.exe not found at $cloudflared" -ForegroundColor Red
    pause
    exit 1
}

$proc = Start-Process -FilePath $cloudflared -ArgumentList "tunnel --url http://localhost:8085 --http-host-header localhost:8085" -PassThru -NoNewWindow -RedirectStandardError $logFile

$foundUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $logFile) {
        $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        if ($content -match '(https://[a-zA-Z0-9-]+\.trycloudflare\.com)') {
            $foundUrl = $matches[1]
            Set-Content -Path $tunnelFile -Value $foundUrl -Encoding UTF8
            break
        }
    }
    if ($proc.HasExited) { break }
}

if ($foundUrl) {
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "  SUCCESS! YOUR LIVE STORE HTTPS LINK IS READY:" -ForegroundColor Green
    Write-Host "  $foundUrl" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  1. Customers on mobile (4G/5G) can now scan your QR code!" -ForegroundColor White
    Write-Host "  2. Store Owner QR code has been updated automatically!" -ForegroundColor White
    Write-Host "  3. KEEP THIS WINDOW OPEN while customers are scanning." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor Cyan
} else {
    Write-Host "Warning: Cloudflare started, but could not capture URL automatically." -ForegroundColor Yellow
    Write-Host "Check $logFile for the URL if needed." -ForegroundColor Gray
}

try {
    $proc.WaitForExit()
} finally {
    if (Test-Path $tunnelFile) { Remove-Item $tunnelFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $logFile) { Remove-Item $logFile -Force -ErrorAction SilentlyContinue }
}
