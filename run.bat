@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo ERROR: Python not found. Please install Python 3.10+ first.
        pause
        exit /b 1
    )
)

call ".venv\Scripts\activate.bat"

echo [2/3] Installing requirements...
python -m pip install --upgrade pip >nul
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: could not install requirements.
    pause
    exit /b 1
)

if not exist ".env" copy ".env.example" ".env" >nul

echo [3/3] Starting the app (browser will open)...
python app.py

pause
