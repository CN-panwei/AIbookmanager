#!/bin/bash
# BookManager.command - macOS 双击在 Terminal 中启动
# 将此文件放在项目根目录，双击即可在终端中启动服务

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if [ -f "$PROJECT_DIR/start.sh" ]; then
    exec "$PROJECT_DIR/start.sh"
else
    echo "❌ 错误：未找到 start.sh"
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi
