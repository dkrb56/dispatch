@echo off
REM ============================================================
REM  Dispatch - dev launcher
REM  Runs the app from the source via "npm run tauri dev".
REM  Keep this window OPEN while using the app.
REM  Closing this window stops the app.
REM ============================================================

cd /d "D:\dev_projects\dispatch"

echo Starting Dispatch (dev mode)...
echo Do NOT close this window while using the app.
echo The first start compiles the Rust part and takes a few minutes.
echo.

REM "call" is required because npm is npm.cmd - without it this
REM batch file would exit before dev even starts.
call npm run tauri dev

echo.
echo Dispatch (dev) has stopped.
pause
