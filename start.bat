@echo off
title CowNotes Sync Server
cd /d "%~dp0"

echo ========================================================
echo        CowNotes PC ^& Phone Live Sync Server
echo ========================================================
echo.
echo Starting server...
start "" http://localhost:3000
node server.js
pause
