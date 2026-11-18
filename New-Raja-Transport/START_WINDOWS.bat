@echo off
setlocal
cd /d "%~dp0"
title New Raja Transport - Management Software
echo.
echo  =====================================================
echo           NEW RAJA TRANSPORT - SERVER
echo  =====================================================
echo.
where node >nul 2>&1
if errorlevel 1 (
    echo  Node.js was not found on your computer.
    echo  Install Node.js 22.13 or newer from https://nodejs.org/
    echo  Then double-click this file again.
    echo.
    pause
    exit /b 1
)
echo  Open on this PC: http://localhost:3000
echo.
echo  For phone access use http://YOUR-PC-IP:3000
 echo  Keep this window open while using the app.
echo  Press Ctrl+C to stop the software.
echo.
node server.js
if errorlevel 1 (
  echo.
  echo  Could not start the application. Check errors above.
  pause
)
