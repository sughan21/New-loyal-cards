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

bin\git\cmd\git.exe remote set-url origin https://github.com/sughan21/New-loyal-cards.git 2>nul
bin\git\cmd\git.exe push -u origin main --force

echo.
echo ========================================================
echo   PUSH COMPLETE!
echo   All folders (css, js, assets) are now live on GitHub!
echo   Visit: https://sughan21.github.io/New-loyal-cards/
echo ========================================================
pause

