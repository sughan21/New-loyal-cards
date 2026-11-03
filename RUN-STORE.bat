@echo off
title Loyalty Reward - All-in-One Store Launcher
cd /d "%~dp0"
echo ========================================================
echo   Starting Loyalty Reward Store & Live Public Scanner...
echo ========================================================
echo.

:: 1. Start Local Server if not already running
netstat -ano | findstr :8085 >nul 2>&1
if errorlevel 1 (
    echo [1/3] Starting Local Server on port 8085...
    start /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8085
    timeout /t 2 /nobreak >nul
) else (
    echo [1/3] Local Server already running on port 8085.
)

:: 2. Launch Cloudflare Tunnel
echo [2/3] Starting Cloudflare Live Public Tunnel...
start powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-tunnel.ps1"

:: 3. Open Store Owner Portal in browser
echo [3/3] Opening Store Owner Portal in your browser...
timeout /t 4 /nobreak >nul
start http://localhost:8085/owner/

echo.
echo ========================================================
echo   Store is now LIVE! Keep the tunnel window OPEN.
echo ========================================================
exit
