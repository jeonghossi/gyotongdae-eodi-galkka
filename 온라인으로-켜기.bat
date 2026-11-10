@echo off
cd /d "%~dp0"
title 교통대 어디 갈까 (온라인)
where node >nul 2>nul
if errorlevel 1 goto nonode
where cloudflared >nul 2>nul
if errorlevel 1 goto nocf
echo  내 PC 서버를 켜고 인터넷(GitHub 주소)에 연결합니다.
echo  GitHub 주소에서 실시간 수다와 AI 도우미를 쓸 수 있게 됩니다.
node toolsonline.js
pause
exit /b 0
:nonode
echo Node.js가 설치되어 있지 않아요. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.
pause
exit /b 1
:nocf
echo cloudflared가 설치되어 있지 않아요. 검은 창에서 winget install Cloudflare.cloudflared 로 설치해 주세요.
pause
exit /b 1
