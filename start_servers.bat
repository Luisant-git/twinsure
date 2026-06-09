@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Reading .env configuration...
set "ENV_FILE=backend\.env"

if not exist "%ENV_FILE%" (
    echo .env file not found at %ENV_FILE%
    pause
    exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "key=%%A"
    set "val=%%B"
    if not "!key:~0,1!"=="#" if not "!key!"=="" (
        set "!key!=!val!"
    )
)

if "%HOST%"=="" set HOST=127.0.0.1
if "%BACKEND_PORT%"=="" set BACKEND_PORT=8000
if "%FRONTEND_PORT%"=="" set FRONTEND_PORT=3000
if "%API_BASE_URL%"=="" set API_BASE_URL=http://%HOST%:%BACKEND_PORT%

echo Generating frontend config.js...
if not exist "public\js" mkdir "public\js"
echo const isDev = window.location.hostname === '127.0.0.1' ^|^| window.location.hostname === 'localhost'; > public\js\config.js
echo window.API_BASE_URL = isDev ? '%API_BASE_URL%' : '/backend/api'; >> public\js\config.js

echo.
echo ========================================================
echo Starting Twinsure Services...
echo Backend API : http://%HOST%:%BACKEND_PORT%
echo Frontend UI : http://%HOST%:%FRONTEND_PORT%
echo Database    : %MONGODB_DATABASE%
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed or not on PATH.
    pause
    exit /b 1
)

echo Starting Backend Server in a new terminal...
start "Twinsure Backend (Node)" cmd /k "title Backend API && cd /d %~dp0 && node src\server.js"

echo Starting Frontend Server in a new terminal...
start "Twinsure Frontend (Node)" cmd /k "title Frontend UI && cd /d %~dp0 && npx http-server public -p %FRONTEND_PORT% -c-1"

echo Both servers have been launched in separate command windows.
echo Close the respective windows to stop the servers.
pause
