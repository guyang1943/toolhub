@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   ToolHub 一键部署到 Cloudflare
echo ============================================
echo.
set NODE="C:\Users\huwei\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
set WRANGLER="C:\Users\huwei\.workbuddy\binaries\node\workspace\node_modules\wrangler\bin\wrangler.js"
set CLOUDFLARE_ACCOUNT_ID=14de3bc0539c3b72a5ee6a6db19f820f

echo [1/3] 重新生成静态页...
%NODE% scripts\build-pages.mjs
if errorlevel 1 goto fail

echo.
echo [2/3] 全量校验...
%NODE% scripts\verify.mjs
if errorlevel 1 goto fail

echo.
echo [3/3] 部署到 Cloudflare...
%NODE% %WRANGLER% deploy --config wrangler.toml
if errorlevel 1 goto fail

echo.
echo ✅ 部署完成：https://toolhub.guyang1966.workers.dev
echo.
pause
exit /b 0

:fail
echo.
echo ❌ 步骤失败，已中止部署（未推送任何东西）
pause
exit /b 1
