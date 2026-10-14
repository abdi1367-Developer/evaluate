@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Paper Evaluator (Web / Next.js) ===
echo.
if not exist node_modules (
  echo [1/2] Installing packages... this may take a few minutes.
  call npm install
  if errorlevel 1 goto :fail
) else (
  echo [1/2] Packages already installed.
)
echo.
echo [2/2] Starting dev server at http://127.0.0.1:3000
echo Press Ctrl+C to stop.
echo.
call npm run dev
goto :end

:fail
echo.
echo Install failed. Make sure Node.js 20+ is installed: https://nodejs.org
pause
exit /b 1

:end
pause
