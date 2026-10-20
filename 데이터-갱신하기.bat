@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
if exist "tools\node_modules\exceljs" goto ready
echo 처음 한 번만 엑셀 읽기 도구를 설치해요. 인터넷이 필요해요...
call npm install exceljs --prefix tools --no-audit --no-fund
:ready
set "XLSX=%~1"
if "%XLSX%"=="" set /p XLSX=엑셀 파일을 이 창에 끌어다 놓고 Enter를 누르세요: 
set "XLSX=%XLSX:"=%"
node tools\update-data.js "%XLSX%"
pause
exit /b 0
:nonode
echo Node.js가 설치되어 있지 않아요. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.
pause
exit /b 1
