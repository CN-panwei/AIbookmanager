#!/bin/bash
set -e

# 切换到脚本所在目录
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "📚 BookManager 启动器"
echo "====================="

# 自动备份配置文件和数据库（不备份书籍原文件以节省空间）
BACKUP_DIR="$PROJECT_DIR/.backup"
if [ -f "$PROJECT_DIR/bookmanager.db" ] || [ -f "$PROJECT_DIR/.bookmanager_config.json" ]; then
    mkdir -p "$BACKUP_DIR"
    cp "$PROJECT_DIR/bookmanager.db" "$BACKUP_DIR/" 2>/dev/null
    cp "$PROJECT_DIR/.bookmanager_config.json" "$BACKUP_DIR/" 2>/dev/null
    cp -r "$PROJECT_DIR/static/covers" "$BACKUP_DIR/" 2>/dev/null
    echo "✓ 配置与数据已自动备份到 .backup/ 目录（不含书籍原文件）"
fi

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未找到 python3，请先安装 Python 3.8+"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "✓ Python 版本: $PYTHON_VERSION"

# 创建虚拟环境（如果不存在）
if [ ! -d "venv" ]; then
    echo "→ 创建虚拟环境..."
    python3 -m venv venv
fi

# 激活虚拟环境
source venv/bin/activate

# 安装依赖（只在初次或 requirements.txt 更新时执行）
MARKER="venv/.deps_installed"
if [ ! -f "$MARKER" ] || [ "requirements.txt" -nt "$MARKER" ]; then
    echo "→ 安装依赖..."
    pip install -q --upgrade pip
    pip install -q -r requirements.txt
    touch "$MARKER"
    echo "✓ 依赖安装完成"
else
    echo "✓ 依赖已是最新，跳过安装"
fi

# 检测端口占用，自动寻找可用端口
BASE_PORT=8000
PORT=$BASE_PORT

while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    echo "⚠️ 端口 $PORT 已被占用"
    PORT=$((PORT + 1))
done

if [ "$PORT" -ne "$BASE_PORT" ]; then
    echo "→ 自动切换到可用端口: $PORT"
fi

echo "→ 启动服务..."
echo ""
echo "   🌐 服务地址: http://localhost:$PORT"
echo "   🛑 停止服务: 按 Ctrl+C"
echo ""

# 延迟自动打开浏览器
python3 -c "
import threading
import time
import webbrowser

PORT = $PORT

def open_browser():
    time.sleep(1.2)
    webbrowser.open(f'http://localhost:{PORT}')

threading.Thread(target=open_browser, daemon=True).start()

import uvicorn
uvicorn.run('main:app', host='0.0.0.0', port=PORT, reload=False, log_level='warning')
"
