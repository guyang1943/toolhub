@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   ToolHub 一键发布
echo ============================================
echo.
"C:\Users\huwei\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" scripts\release.mjs %*
echo.
pause
