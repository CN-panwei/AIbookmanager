#!/bin/bash
set -e

# 确保数据目录存在
mkdir -p /app/data/books /app/data/covers

# 数据库：如果不存在则创建空文件，然后链接到应用目录
if [ ! -f "/app/data/bookmanager.db" ]; then
    touch /app/data/bookmanager.db
fi
rm -f /app/bookmanager.db
ln -sf /app/data/bookmanager.db /app/bookmanager.db

# 配置文件：如果不存在则创建空 JSON，然后链接到应用目录
if [ ! -f "/app/data/.bookmanager_config.json" ]; then
    echo '{}' > /app/data/.bookmanager_config.json
fi
rm -f /app/.bookmanager_config.json
ln -sf /app/data/.bookmanager_config.json /app/.bookmanager_config.json

# 图书目录链接到数据目录
rm -rf /app/books
ln -sf /app/data/books /app/books

# 封面目录链接到数据目录
rm -rf /app/static/covers
ln -sf /app/data/covers /app/static/covers

exec "$@"
