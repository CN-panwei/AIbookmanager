@echo off
setlocal enabledelayedexpansion

chcp 65001 >nul
cd /d "%~dp0"

echo BookManager Launcher
echo =====================

python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python not found. Please install Python 3.8+ first.
    pause
    exit /b 1
)

if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

if not exist "venv\.deps_installed" (
    echo Installing dependencies...
    pip install -q --upgrade pip
    pip install -q -r requirements.txt
    echo. > venv\.deps_installed
    echo Dependencies installed.
) else (
    echo Dependencies up to date, skipping install.
)

echo.
echo Starting server...
echo    URL: http://localhost:8000
echo    Stop: Press Ctrl+C
echo.

python -c "import uvicorn; uvicorn.run('main:app', host='0.0.0.0', port=8000, reload=False, log_level='warning')"

pause
