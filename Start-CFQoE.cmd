@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Download it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "xray\xray.exe" (
  echo Xray not found. Downloading the official build into .\xray ...
  node scripts\install-xray.mjs
  if errorlevel 1 (
    echo Failed to install Xray automatically.
    pause
    exit /b 1
  )
)

node bin\cfqoe.js %*
if errorlevel 1 pause
endlocal
