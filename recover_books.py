#!/usr/bin/env python3
"""
BookManager 数据库恢复脚本
根据 books/ 目录下的实际文件重建数据库
用法:
  python3 recover_books.py         # 快速模式（推荐）：只用文件名重建，几秒完成
  python3 recover_books.py --full  # 完整模式：逐本解析元数据和封面，较慢
"""
import os
import sys
import re
import sqlite3
from pathlib import Path

DB_PATH = Path("bookmanager.db")
BOOKS_ROOT = Path("books")

# 拼音文件夹名 → 默认中文分类名
DEFAULT_CATEGORY_MAP = {
    "shangye": "商业",
    "jingji": "经济",
    "yanjiang": "演讲",
    "xiezuo": "写作",
    "guoxue": "国学",
    "jishu": "技术",
    "xinlixue": "心理学",
}

# 尝试导入依赖；如果失败且有 venv，自动切换到 venv
try:
    import pypinyin
except ImportError:
    _venv = Path("venv/bin/python")
    if _venv.exists():
        os.execv(str(_venv), [str(_venv), __file__] + sys.argv[1:])
    else:
        print("错误: 缺少必要依赖，请先运行 pip install -r requirements.txt")
        sys.exit(1)


def extract_title_from_filename(filename):
    """从文件名提取标题和作者"""
    name = Path(filename).stem
    name = re.sub(r'\s*\(z-library\.[^)]+\)', '', name, flags=re.I)
    name = re.sub(r'\s*\(1lib\.[^)]+\)', '', name, flags=re.I)
    name = re.sub(r'\s*\(z-lib\.[^)]+\)', '', name, flags=re.I)
    author_match = re.search(r'\(([^)]+)\)\s*$', name)
    author = author_match.group(1).strip() if author_match else None
    if author_match:
        title = name[:author_match.start()].strip()
    else:
        title = name.strip()
    return title, author


def to_pinyin_folder_name(name):
    """拼音转换"""
    pinyin = pypinyin.lazy_pinyin(name)
    folder = "".join(pinyin).lower()
    folder = re.sub(r'[^a-z0-9]', '_', folder)
    folder = re.sub(r'_+', '_', folder).strip('_')
    return folder or "uncategorized"


def full_parse(file_path, file_format):
    """完整解析：提取元数据和封面"""
    # 激活虚拟环境后 import
    from services.book_parser import parse_book, save_cover_image
    try:
        parsed = parse_book(str(file_path), file_format)
    except Exception as e:
        parsed = {"error": str(e)}
    return parsed


def recover(full_mode=False):
    print("=" * 60)
    print("BookManager 数据库恢复")
    mode = "完整模式（解析元数据+封面）" if full_mode else "快速模式（仅用文件名）"
    print(f"模式: {mode}")
    print("=" * 60)

    if not DB_PATH.exists():
        print(f"错误: 数据库文件 {DB_PATH} 不存在")
        sys.exit(1)
    if not BOOKS_ROOT.exists():
        print(f"错误: 书籍目录 {BOOKS_ROOT} 不存在")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 确保表结构
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            folder_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            description TEXT,
            cover_path TEXT,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            file_format TEXT CHECK(file_format IN ('pdf', 'epub')),
            category_id INTEGER REFERENCES categories(id),
            page_count INTEGER,
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            content TEXT,
            is_ai_generated BOOLEAN DEFAULT 0,
            prompt TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 扫描文件夹
    folders = []
    unknown_folders = []
    for entry in sorted(BOOKS_ROOT.iterdir()):
        if entry.is_dir() and not entry.name.startswith('.') and not entry.name.startswith('_'):
            files = [f for f in entry.iterdir() if f.is_file() and f.suffix.lower() in ('.pdf', '.epub')]
            if not files:
                continue
            if entry.name in DEFAULT_CATEGORY_MAP:
                folders.append((entry.name, DEFAULT_CATEGORY_MAP[entry.name], files))
            else:
                unknown_folders.append((entry.name, files))

    if unknown_folders:
        print(f"\n发现 {len(unknown_folders)} 个未知分类文件夹:")
        for folder_name, files in unknown_folders:
            cat_name = input(f"  '{folder_name}' 对应分类名（回车跳过）: ").strip()
            if cat_name:
                folders.append((folder_name, cat_name, files))

    if not folders:
        print("\n未找到任何可恢复的书籍")
        conn.close()
        sys.exit(0)

    total_books = sum(len(f) for _, _, f in folders)
    print(f"\n将恢复 {len(folders)} 个分类，共 {total_books} 本书\n")

    # 建立分类
    category_map = {}
    for folder_name, cat_name, files in folders:
        folder_safe = to_pinyin_folder_name(cat_name)
        cursor.execute("SELECT id FROM categories WHERE folder_name = ?", (folder_safe,))
        row = cursor.fetchone()
        if row:
            cat_id = row['id']
        else:
            cursor.execute(
                "INSERT INTO categories (name, folder_name) VALUES (?, ?)",
                (cat_name, folder_safe)
            )
            cat_id = cursor.lastrowid
        category_map[folder_name] = cat_id
        print(f"  分类 '{cat_name}' → {len(files)} 本")

    conn.commit()
    print()

    # 准备完整模式需要的模块
    cover_default = "covers/default.jpg"
    if full_mode:
        try:
            from services.book_parser import get_default_cover_path, save_cover_image
            cover_default = get_default_cover_path()
        except Exception:
            pass

    # 逐本恢复
    processed = 0
    success = 0
    print(f"开始恢复 {total_books} 本书...")
    print("-" * 60)

    for folder_name, cat_name, files in folders:
        cat_id = category_map[folder_name]
        for file_path in files:
            processed += 1
            filename = file_path.name
            ext = file_path.suffix.lower()
            file_format = 'pdf' if ext == '.pdf' else 'epub'
            rel_path = str(file_path.relative_to(BOOKS_ROOT))
            file_size = file_path.stat().st_size

            title = ""
            author = ""
            page_count = None
            metadata = {}
            cover_path = cover_default

            if full_mode:
                # 完整解析
                parsed = full_parse(file_path, file_format)
                title = parsed.get("title") or ""
                author = parsed.get("author") or ""
                page_count = parsed.get("page_count")
                metadata = parsed.get("metadata", {})

                if not title:
                    title, author_from_name = extract_title_from_filename(filename)
                    if not author and author_from_name:
                        author = author_from_name

                # 保存封面
                cover_bytes = parsed.get("cover_bytes")
                if cover_bytes:
                    try:
                        cover_path = save_cover_image(processed, cover_bytes)
                    except Exception:
                        cover_path = cover_default
            else:
                # 快速模式：只用文件名
                title, author = extract_title_from_filename(filename)

            # 插入记录
            meta_json = None
            if metadata:
                import json
                meta_json = json.dumps(metadata, ensure_ascii=False)

            cursor.execute(
                """
                INSERT INTO books (title, author, file_path, file_size, file_format,
                                   category_id, page_count, metadata, cover_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (title, author, rel_path, file_size, file_format,
                 cat_id, page_count, meta_json, cover_path)
            )
            conn.commit()
            success += 1
            display = (title[:45] + "...") if len(title) > 45 else title
            print(f"  [{processed:2d}/{total_books}] {display}")

    print("-" * 60)
    print(f"\n恢复完成: 成功 {success}/{total_books} 本")
    if not full_mode:
        print("提示: 使用 --full 参数可重新解析元数据和封面")
        print("      或在 BookManager 中逐本点击「生成简介」补充信息")
    conn.close()
    print(f"\n数据库已更新: {DB_PATH.resolve()}")
    print("现在可以启动 BookManager 查看恢复的书籍了。")


if __name__ == "__main__":
    full_mode = "--full" in sys.argv
    try:
        recover(full_mode=full_mode)
    except KeyboardInterrupt:
        print("\n\n已中断")
        sys.exit(1)
