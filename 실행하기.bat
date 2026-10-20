@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
set OPEN_BROWSER=1
node server.js
pause
exit /b 0
:nonode
echo Node.js가 설치되어 있지 않아요. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.
pause
exit /b 1
