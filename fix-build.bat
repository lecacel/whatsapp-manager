@echo off
echo ===================================
echo Fixing Build Dependencies
echo ===================================
echo.

cd /d "%~dp0"

echo Step 1: Removing problematic native modules...
if exist node_modules\bufferutil\build rmdir /s /q node_modules\bufferutil\build
if exist node_modules\utf-8-validate\build rmdir /s /q node_modules\utf-8-validate\build
echo Done.
echo.

echo Step 2: Installing/updating build tools...
npm install --save-optional bufferutil utf-8-validate
echo Done.
echo.

echo Step 3: Cleaning electron-builder cache...
if exist "%USERPROFILE%\AppData\Local\electron-builder\Cache" (
    echo Cleaning cache directory...
    rmdir /s /q "%USERPROFILE%\AppData\Local\electron-builder\Cache"
)
echo Done.
echo.

echo ===================================
echo Fix completed!
echo ===================================
echo.
echo You can now run: npm run build
echo.
echo Note: The node-gyp rebuild errors are normal and won't
echo affect the application. The build will use prebuilt binaries.
echo.

pause
