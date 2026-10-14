@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Deploy to Vercel (production) ===
echo.
echo NOTE: set these Environment Variables in Vercel:
echo   DEEPSEEK_API_KEY      (optional - you can also enter it in the app Panel)
echo   APP_USERNAME          (optional - initial username, default: admin)
echo   APP_MOBILE            (optional - initial mobile number, default: 09120000000)
echo   APP_PASSWORD          (optional - initial password, default: admin1234)
echo   KV_REST_API_URL       (recommended - for saving Panel changes permanently)
echo   KV_REST_API_TOKEN     (recommended - from Vercel KV / Upstash Redis)
echo   DEEPSEEK_BASE_URL     (optional)
echo   DEEPSEEK_MODEL        (optional)
echo.
echo TIP: you may also enter the DeepSeek key and change user/pass inside the app Panel
echo      (Panel menu) - but on Vercel that needs Vercel KV to be permanent.
echo.
echo The first run opens the browser and asks you to log in to Vercel.
echo.
call npx --yes vercel --prod
pause
