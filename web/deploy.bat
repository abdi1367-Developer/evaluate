@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Deploy to Vercel (production) ===
echo.
echo NOTE: before deploying, set these Environment Variables in Vercel:
echo   DEEPSEEK_API_KEY      (required)
echo   APP_PASSWORD          (recommended - protects your API credit)
echo   DEEPSEEK_BASE_URL     (optional)
echo   DEEPSEEK_MODEL        (optional)
echo.
echo The first run opens the browser and asks you to log in to Vercel.
echo.
call npx --yes vercel --prod
pause
