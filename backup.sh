#!/bin/bash
# BookManager 数据备份脚本
# 用法: ./backup.sh

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

cp "$PROJECT_DIR/bookmanager.db" "$BACKUP_DIR/" 2>/dev/null
cp "$PROJECT_DIR/.bookmanager_config.json" "$BACKUP_DIR/" 2>/dev/null
cp -r "$PROJECT_DIR/books" "$BACKUP_DIR/" 2>/dev/null
cp -r "$PROJECT_DIR/static/covers" "$BACKUP_DIR/" 2>/dev/null

echo "✓ 数据已备份到: $BACKUP_DIR"
