# Quick 1-command GitHub push from IDE PowerShell terminal
$git = "$PSScriptRoot\bin\git\cmd\git.exe"
if (-not (Test-Path $git)) { $git = "git" }

Write-Host "🚀 Staging all changes..." -ForegroundColor Cyan
& $git add -A

$commitMsg = if ($args.Count -gt 0) { $args -join " " } else { "Update app build and project files" }
Write-Host "💾 Committing: $commitMsg" -ForegroundColor Cyan
& $git commit -m $commitMsg 2>$null

Write-Host "☁️ Pushing to GitHub (main)..." -ForegroundColor Cyan
& $git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "✅ PUSH COMPLETE! All files are live on GitHub!" -ForegroundColor Green
    Write-Host "   Visit: https://sughan21.github.io/New-loyal-cards/" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} else {
    Write-Host "`n❌ Push failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
