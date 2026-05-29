import aiosqlite
import json
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime

BASE_DIR = Path(__file__).parent.resolve()
DB_PATH = BASE_DIR / "bookmanager.db"


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript("""
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
        await db.commit()
    finally:
        await db.close()


# ----- Categories -----

async def create_category(name: str, folder_name: str) -> Dict[str, Any]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO categories (name, folder_name) VALUES (?, ?)",
            (name, folder_name)
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": name, "folder_name": folder_name}
    finally:
        await db.close()


async def get_categories() -> List[Dict[str, Any]]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM categories ORDER BY created_at")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_category_by_id(category_id: int) -> Optional[Dict[str, Any]]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM categories WHERE id = ?", (category_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def delete_category(category_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        await db.commit()
    finally:
        await db.close()


async def update_category(category_id: int, name: str, folder_name: str):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE categories SET name = ?, folder_name = ? WHERE id = ?",
            (name, folder_name, category_id)
        )
        await db.commit()
    finally:
        await db.close()


# ----- Books -----

async def create_book(
    title: str,
    author: Optional[str],
    file_path: str,
    file_size: int,
    file_format: str,
    category_id: int,
    cover_path: Optional[str] = None,
    page_count: Optional[int] = None,
    metadata: Optional[dict] = None,
) -> Dict[str, Any]:
    db = await get_db()
    try:
        meta_json = json.dumps(metadata, ensure_ascii=False) if metadata else None
        cursor = await db.execute(
            """
            INSERT INTO books (title, author, file_path, file_size, file_format,
                               category_id, cover_path, page_count, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (title, author, file_path, file_size, file_format,
             category_id, cover_path, page_count, meta_json)
        )
        await db.commit()
        return await get_book_by_id(cursor.lastrowid)
    finally:
        await db.close()


async def get_book_by_id(book_id: int) -> Optional[Dict[str, Any]]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT b.*, c.name as category_name FROM books b LEFT JOIN categories c ON b.category_id = c.id WHERE b.id = ?",
            (book_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        book = dict(row)
        if book.get("metadata"):
            try:
                book["metadata"] = json.loads(book["metadata"])
            except Exception:
                pass
        return book
    finally:
        await db.close()


async def get_books(category_id: Optional[int] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    db = await get_db()
    try:
        query = """
            SELECT b.*, c.name as category_name
            FROM books b
            LEFT JOIN categories c ON b.category_id = c.id
            WHERE 1=1
        """
        params = []
        if category_id:
            query += " AND b.category_id = ?"
            params.append(category_id)
        if search:
            query += " AND (b.title LIKE ? OR b.author LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        query += " ORDER BY b.created_at DESC"
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        books = []
        for row in rows:
            book = dict(row)
            if book.get("metadata"):
                try:
                    book["metadata"] = json.loads(book["metadata"])
                except Exception:
                    pass
            books.append(book)
        return books
    finally:
        await db.close()


async def update_book(book_id: int, **kwargs):
    db = await get_db()
    try:
        allowed = {"title", "author", "description", "cover_path", "file_path",
                   "file_size", "file_format", "category_id", "page_count", "metadata"}
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return
        if "metadata" in updates and isinstance(updates["metadata"], dict):
            updates["metadata"] = json.dumps(updates["metadata"], ensure_ascii=False)
        updates["updated_at"] = datetime.now().isoformat()
        fields = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [book_id]
        await db.execute(f"UPDATE books SET {fields} WHERE id = ?", values)
        await db.commit()
    finally:
        await db.close()


async def delete_book(book_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM books WHERE id = ?", (book_id,))
        await db.commit()
    finally:
        await db.close()


# ----- Notes -----

async def create_note(book_id: int, title: str, content: str = "",
                      is_ai_generated: bool = False, prompt: Optional[str] = None) -> Dict[str, Any]:
    db = await get_db()
    try:
        cursor = await db.execute(
            """
            INSERT INTO notes (book_id, title, content, is_ai_generated, prompt)
            VALUES (?, ?, ?, ?, ?)
            """,
            (book_id, title, content, int(is_ai_generated), prompt)
        )
        await db.commit()
        return await get_note_by_id(cursor.lastrowid)
    finally:
        await db.close()


async def get_note_by_id(note_id: int) -> Optional[Dict[str, Any]]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM notes WHERE id = ?", (note_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_notes_by_book(book_id: int) -> List[Dict[str, Any]]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM notes WHERE book_id = ? ORDER BY updated_at DESC",
            (book_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_notes_by_ids(note_ids: List[int]) -> List[Dict[str, Any]]:
    db = await get_db()
    try:
        placeholders = ",".join("?" for _ in note_ids)
        cursor = await db.execute(
            f"""
            SELECT n.*, b.title as book_title
            FROM notes n
            JOIN books b ON n.book_id = b.id
            WHERE n.id IN ({placeholders})
            ORDER BY n.updated_at DESC
            """,
            tuple(note_ids)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def update_note(note_id: int, title: Optional[str] = None, content: Optional[str] = None):
    db = await get_db()
    try:
        updates = {}
        if title is not None:
            updates["title"] = title
        if content is not None:
            updates["content"] = content
        if not updates:
            return
        updates["updated_at"] = datetime.now().isoformat()
        fields = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [note_id]
        await db.execute(f"UPDATE notes SET {fields} WHERE id = ?", values)
        await db.commit()
    finally:
        await db.close()


async def delete_note(note_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        await db.commit()
    finally:
        await db.close()
