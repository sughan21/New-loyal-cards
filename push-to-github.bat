@echo off
title Push Loyalty Card to GitHub Pages
cd /d "%~dp0"
echo ========================================================
echo   LOYALTY CARD - PUSH ALL FOLDERS TO GITHUB (24/7 CLOUD)
echo ========================================================
echo.
echo Target Repository: https://github.com/sughan21/New-loyal-cards.git
echo.

set "PATH=%~dp0bin\git\cmd;%~dp0bin\git\mingw64\bin;%PATH%"
set GIT_CMD="%~dp0bin\git\cmd\git.exe"
if not exist %GIT_CMD% set GIT_CMD=git

%GIT_CMD% remote set-url origin https://github.com/sughan21/New-loyal-cards.git 2>nul

echo Uploading all folders, APKs, and cloud sync to GitHub...
echo (If a browser window appears, click "Sign in with your browser")
echo.

%GIT_CMD% add -A
%GIT_CMD% commit -m "Update app build and project files" 2>nul
%GIT_CMD% push -u origin main --force
if %ERRORLEVEL% EQU 0 goto success

echo.
echo ========================================================
echo   Browser sign-in did not complete or was cancelled.
echo ========================================================
echo If you have a GitHub Personal Access Token, paste it below.
echo (Or press Enter to exit and sign in via browser next time):
set /p GITHUB_TOKEN="Enter GitHub Token (or press Enter to cancel): "

if "%GITHUB_TOKEN%"=="" goto end

echo.
echo Pushing with your token...
%GIT_CMD% push -u https://%GITHUB_TOKEN%@github.com/sughan21/New-loyal-cards.git main --force
if %ERRORLEVEL% EQU 0 goto success

echo.
echo Push failed. Please verify token permissions (needs 'repo' scope).
pause
goto end

:success
echo.
echo ========================================================
echo   PUSH COMPLETE!
echo   All files and APKs are now live on GitHub!
echo   Visit: https://sughan21.github.io/New-loyal-cards/
echo ========================================================
pause

:end
