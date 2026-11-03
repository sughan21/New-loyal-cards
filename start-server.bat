@echo off
title Golden Perks - Loyalty Card Server
cd /d "%~dp0"
echo ========================================================
echo   Starting Loyalty Card Local Server...
echo   Open in browser: http://localhost:8085/download.html
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8085
pause
