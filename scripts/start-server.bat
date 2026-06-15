@echo off
REM ==========================================================================
REM AI-AWD Arena — Server Start Script (Windows)
REM ==========================================================================
REM Usage:
REM   scripts\start-server.bat                          (default 0.0.0.0:9000)
REM   scripts\start-server.bat --port 9999              (custom port)
REM   scripts\start-server.bat --advertise-host 1.2.3.4 (force LAN IP for clients)
REM ==========================================================================

setlocal enabledelayedexpansion

set HOST=0.0.0.0
set PORT=9000
set HTTP_PORT=9001
set ADVERTISE_HOST=

:parse_args
if "%~1"=="" goto :run
if "%~1"=="--port" (
    set PORT=%~2
    shift
    shift
    goto :parse_args
)
if "%~1"=="-p" (
    set PORT=%~2
    shift
    shift
    goto :parse_args
)
if "%~1"=="--http-port" (
    set HTTP_PORT=%~2
    shift
    shift
    goto :parse_args
)
if "%~1"=="--host" (
    set HOST=%~2
    shift
    shift
    goto :parse_args
)
if "%~1"=="--advertise-host" (
    set ADVERTISE_HOST=%~2
    shift
    shift
    goto :parse_args
)
echo Unknown option: %~1
echo Usage: scripts\start-server.bat [--port PORT] [--http-port PORT] [--host HOST] [--advertise-host IP]
exit /b 1

:run
echo ========================================
echo   AI-AWD Arena Server
echo ========================================
echo.
echo TCP:  %HOST%:%PORT%
echo HTTP: http://%HOST%:%HTTP_PORT%
echo.

REM Auto-detect LAN IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LAN_IP=%%a
    set LAN_IP=!LAN_IP: =!
    if not "!LAN_IP!"=="127.0.0.1" (
        echo LAN IP: !LAN_IP!  (clients use this)
    )
)
echo.

set PYTHONPATH=server
if not "%ADVERTISE_HOST%"=="" (
    python -m aiawd_server.main --host %HOST% --port %PORT% --http-port %HTTP_PORT% --advertise-host %ADVERTISE_HOST%
) else (
    python -m aiawd_server.main --host %HOST% --port %PORT% --http-port %HTTP_PORT%
)

endlocal
