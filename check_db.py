import sqlite3
import os
from pathlib import Path

print("=" * 50)
print("BookManager 数据库排查脚本")
print("=" * 50)

# 1. 当前工作目录
print(f"\n[1] 当前工作目录: {os.getcwd()}")

# 2. 查找所有 bookmanager.db 文件
print("\n[2] 查找所有 bookmanager.db 文件:")
base = Path(".")
found = list(base.rglob("bookmanager.db"))
if not found:
    print("   未找到任何 bookmanager.db 文件!")
else:
    for p in found:
        size = p.stat().st_size
        print(f"   {p.resolve()}  (大小: {size} bytes)")

# 3. 检查当前目录下的 bookmanager.db
main_db = Path("bookmanager.db")
if main_db.exists():
    print(f"\n[3] 检查当前目录的 bookmanager.db:")
    conn = sqlite3.connect(str(main_db))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 列出所有表
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    print(f"   表: {tables}")
    
    # 统计每张表的行数
    for t in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {t}")
        count = cursor.fetchone()[0]
        print(f"   {t}: {count} 条记录")
    
    # 如果有书籍，列出前 3 本
    if "books" in tables:
        cursor.execute("SELECT id, title, file_path, category_id FROM books LIMIT 3")
        rows = cursor.fetchall()
        if rows:
            print(f"\n   前 3 本书:")
            for r in rows:
                print(f"     ID={r['id']}  《{r['title']}》  path={r['file_path']}  cat={r['category_id']}")
        else:
            print(f"\n   books 表为空!")
    
    # 如果有分类，列出所有分类
    if "categories" in tables:
        cursor.execute("SELECT id, name FROM categories")
        rows = cursor.fetchall()
        if rows:
            print(f"\n   分类列表:")
            for r in rows:
                print(f"     ID={r['id']}  {r['name']}")
        else:
            print(f"\n   categories 表为空!")
    
    conn.close()
else:
    print(f"\n[3] 当前目录下没有 bookmanager.db")

print("\n" + "=" * 50)
print("请把上面的完整输出复制给我")
print("=" * 50)
