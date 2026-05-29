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

REM Auto-backup database and config with timestamp (keep last 10)
python -c "
import shutil, os, glob
from datetime import datetime
bd = '.backup'
os.makedirs(bd, exist_ok=True)
ts = datetime.now().strftime('%Y%m%d_%H%M%S')
if os.path.exists('bookmanager.db'):
    shutil.copy('bookmanager.db', os.path.join(bd, f'bookmanager_{ts}.db'))
if os.path.exists('.bookmanager_config.json'):
    shutil.copy('.bookmanager_config.json', os.path.join(bd, f'.bookmanager_config_{ts}.json'))
if os.path.exists('static/covers'):
    shutil.copytree('static/covers', os.path.join(bd, 'covers'), dirs_exist_ok=True)
for pattern in [os.path.join(bd, 'bookmanager_*.db'), os.path.join(bd, '.bookmanager_config_*.json')]:
    files = sorted(glob.glob(pattern), key=os.path.getmtime)
    for old in files[:-10]:
        os.remove(old)
print('Backup done.')
"

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
