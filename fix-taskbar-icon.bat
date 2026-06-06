@echo off
echo ============================================
echo  MS-ALL Taskbar Icon Fix
echo ============================================
echo.

cd /d "%~dp0"

echo [1] Generating fresh icons...
node scripts\create-icon.js
if errorlevel 1 (
  echo ERROR: Failed to generate icons
  pause
  exit /b 1
)

echo.
echo [2] Patching electron.exe with custom icon...
node scripts\patch-electron-icon.js
if errorlevel 1 (
  echo ERROR: Failed to patch electron.exe
  pause
  exit /b 1
)

echo.
echo [3] Clearing Windows icon cache...
if exist "%LOCALAPPDATA%\IconCache.db" del /f /q "%LOCALAPPDATA%\IconCache.db"
for %%F in ("%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*.db") do del /f /q "%%F" 2>nul
ie4uinit.exe -show >nul 2>&1
echo Icon cache cleared.

echo.
echo ============================================
echo  Done! Now run: npm start
echo  The taskbar icon should show the red
 echo  MS-ALL icon instead of Electron.
echo ============================================
echo.
pause
