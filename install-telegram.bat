@echo off
echo ===================================
echo Installing Telegram Library
echo ===================================
echo.

cd /d "%~dp0"

echo Current directory: %CD%
echo.

echo Installing telegram package...
npm install telegram@latest --save

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===================================
    echo Installation completed successfully!
    echo ===================================
    echo.
    echo Running verification...
    node scripts\check-telegram.js
) else (
    echo.
    echo ===================================
    echo Installation failed!
    echo ===================================
    echo Please check your internet connection and try again.
)

echo.
pause
