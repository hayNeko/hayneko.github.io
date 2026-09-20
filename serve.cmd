@echo off
setlocal
cd /d "%~dp0"
set "PORT=8123"
set "PY="

echo.
echo   Hayneko - local preview
echo   URL   : http://127.0.0.1:%PORT%/
echo   Root  : %~dp0
echo   Stop  : Ctrl+C, or just close this window
echo.

where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py -3" )
if not defined PY (
  echo   [ERROR] python not found.
  echo   Install Python, or use any static server pointing at this folder,
  echo   for example:  npx serve .
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo   [NOTE] Port %PORT% is already in use - a server may already be running.
  echo          Just open http://127.0.0.1:%PORT%/ instead.
  echo.
)

start "" "http://127.0.0.1:%PORT%/"
%PY% -m http.server %PORT% --bind 127.0.0.1 --directory "%~dp0"

echo.
echo   Server stopped.
pause
