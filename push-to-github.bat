@echo off
title Push Loyalty Card to GitHub Pages
cd /d "%~dp0"
echo ========================================================
echo   LOYALTY CARD - PUSH ALL FOLDERS TO GITHUB (24/7 CLOUD)
echo ========================================================
echo.
echo Target Repository: https://github.com/sughan21/New-loyal-cards.git
echo.
echo Uploading css, js, assets, and all project folders...
echo (If prompted, sign in via your browser)
echo.

set "PATH=%~dp0bin\git\cmd;%~dp0bin\git\mingw64\bin;%PATH%"
set GIT_CMD="%~dp0bin\git\cmd\git.exe"
if not exist %GIT_CMD% set GIT_CMD=git

%GIT_CMD% remote set-url origin https://github.com/sughan21/New-loyal-cards.git 2>nul
%GIT_CMD% push -u origin main --force

echo.
echo ========================================================
echo   PUSH COMPLETE!
echo   All folders (css, js, assets) are now live on GitHub!
echo   Visit: https://sughan21.github.io/New-loyal-cards/
echo ========================================================
pause

