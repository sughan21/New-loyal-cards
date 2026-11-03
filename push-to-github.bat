@echo off
title Push Loyalty Card to GitHub Pages
cd /d "%~dp0"
echo ========================================================
echo   LOYALTY CARD - PUSH TO GITHUB PAGES
echo ========================================================
echo.
set /p REPO_URL="Enter your GitHub Repository URL (e.g. https://github.com/username/repository.git): "

if "%REPO_URL%"=="" (
    echo Error: No repository URL entered.
    pause
    exit /b
)

echo.
echo Configuring remote repository...
bin\git\cmd\git.exe remote remove origin 2>nul
bin\git\cmd\git.exe remote add origin %REPO_URL%
bin\git\cmd\git.exe branch -M main

echo.
echo Pushing project to GitHub...
echo (If prompted, sign in via your browser or personal access token)
bin\git\cmd\git.exe push -u origin main

echo.
echo ========================================================
echo   PUSH COMPLETE! 
echo   Your repository is now online on GitHub!
echo ========================================================
pause

