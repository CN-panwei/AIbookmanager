@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo 📚 BookManager 启动器
echo =====================

python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未找到 python，请先安装 Python 3.8+
    pause
    exit /b 1
)

if not exist "venv\" (
    echo → 创建虚拟环境...
    python -m venv venv
)

call venv\Scripts\activate.bat

if not exist "venv\.deps_installed" (
    echo → 安装依赖...
    pip install -q --upgrade pip
    pip install -q -r requirements.txt
    echo. > venv\.deps_installed
    echo ✓ 依赖安装完成
) else (
    echo ✓ 依赖已是最新，跳过安装
)
echo → 启动服务...
echo.
echo    🌐 服务地址: http://localhost:8000
echo    🛑 停止服务: 按 Ctrl+C
echo.

python -c "import uvicorn; uvicorn.run('main:app', host='0.0.0.0', port=8000, reload=False, log_level='warning')"

pause
