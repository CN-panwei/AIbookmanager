import os
import shutil
import asyncio
import time
import signal
import subprocess
import platform
import tempfile
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from contextlib import asynccontextmanager

import database as db
from config import ConfigManager
from services.file_service import (
    to_pinyin_folder_name, move_book_to_category, delete_book_file,
    rename_category_folder, delete_category_folder, get_books_root,
    ensure_category_folder, move_book_to_new_category
)
from services.book_parser import parse_book, save_cover_image, get_default_cover_path
from services.ai_service import generate_summary, generate_note, test_api_key


# Global heartbeat state
_last_ping_time = time.time()
_HEARTBEAT_TIMEOUT = 180  # seconds without ping before auto-exit (3 min)
_HEARTBEAT_CHECK_INTERVAL = 60  # seconds between checks


async def _heartbeat_checker():
    """Background task: exit if no ping received for a while."""
    while True:
        await asyncio.sleep(_HEARTBEAT_CHECK_INTERVAL)
        if time.time() - _last_ping_time > _HEARTBEAT_TIMEOUT:
            os.kill(os.getpid(), signal.SIGTERM)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure required directories exist
    Path("books").mkdir(parents=True, exist_ok=True)
    Path("static/covers").mkdir(parents=True, exist_ok=True)

    await db.init_db()
    # Start heartbeat checker in background
    task = asyncio.create_task(_heartbeat_checker())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


# Ensure required directories exist before mounting
Path("books").mkdir(parents=True, exist_ok=True)
Path("static/covers").mkdir(parents=True, exist_ok=True)

app = FastAPI(title="BookManager", lifespan=lifespan)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/books", StaticFiles(directory="books"), name="books")


@app.get("/", response_class=HTMLResponse)
async def index():
    with open("templates/index.html", "r", encoding="utf-8") as f:
        return f.read()


# ========== Categories ==========

@app.get("/api/ping")
async def ping():
    global _last_ping_time
    _last_ping_time = time.time()
    return {"ok": True}


@app.get("/api/categories")
async def list_categories():
    return await db.get_categories()


@app.post("/api/categories")
async def create_category(data: dict):
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    folder_name = to_pinyin_folder_name(name)
    ensure_category_folder(folder_name)
    try:
        cat = await db.create_category(name, folder_name)
        return cat
    except Exception as e:
        if "UNIQUE constraint failed" in str(e):
            raise HTTPException(status_code=409, detail="分类名称已存在")
        raise


@app.delete("/api/categories/{category_id}")
async def remove_category(category_id: int, delete_books: bool = False):
    cat = await db.get_category_by_id(category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    # Update books in this category to no category? Or delete them?
    # For simplicity: delete books and their files if delete_books=True, else move books to uncategorized
    books = await db.get_books(category_id=category_id)
    if delete_books:
        for book in books:
            delete_book_file(book["file_path"])
            cover = book.get("cover_path")
            if cover and "default" not in cover:
                cp = Path("static") / cover
                if cp.exists():
                    cp.unlink()
            await db.delete_book(book["id"])
        delete_category_folder(cat["folder_name"], delete_books=True)
    else:
        # Move books to uncategorized folder
        uncategorized = "uncategorized"
        ensure_category_folder(uncategorized)
        for book in books:
            old_full = get_books_root() / book["file_path"]
            new_rel = f"{uncategorized}/{old_full.name}"
            new_full = get_books_root() / new_rel
            # Handle name conflict
            counter = 1
            original = new_full
            while new_full.exists():
                stem = original.stem
                suffix = original.suffix
                new_full = original.parent / f"{stem}_{counter}{suffix}"
                counter += 1
            if old_full.exists():
                old_full.rename(new_full)
                new_rel = str(new_full.relative_to(get_books_root()))
            else:
                new_rel = book["file_path"]
            await db.update_book(book["id"], file_path=new_rel, category_id=None)
        # Remove empty folder
        delete_category_folder(cat["folder_name"], delete_books=False)
    await db.delete_category(category_id)
    return {"success": True}


@app.put("/api/categories/{category_id}")
async def update_category(category_id: int, data: dict):
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    cat = await db.get_category_by_id(category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    new_folder = to_pinyin_folder_name(name)
    old_folder = cat["folder_name"]
    if old_folder != new_folder:
        rename_category_folder(old_folder, new_folder)
        # Update file_path for all books in this category
        books = await db.get_books(category_id=category_id)
        for book in books:
            old_rel = book["file_path"]
            new_rel = old_rel.replace(f"{old_folder}/", f"{new_folder}/", 1)
            await db.update_book(book["id"], file_path=new_rel)
    await db.update_category(category_id, name, new_folder)
    return {"success": True}


# ========== Books ==========

@app.get("/api/books")
async def list_books(category_id: Optional[int] = None, search: Optional[str] = None):
    return await db.get_books(category_id=category_id, search=search)


@app.post("/api/books/upload")
async def upload_book(
    file: UploadFile = File(...),
    category_id: int = Form(...)
):
    cat = await db.get_category_by_id(category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")

    # Validate format
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        file_format = "pdf"
    elif ext == ".epub":
        file_format = "epub"
    else:
        raise HTTPException(status_code=400, detail="仅支持 PDF 和 EPUB 格式")

    # Save to temp location
    temp_path = os.path.join(tempfile.gettempdir(), filename)
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_size = os.path.getsize(temp_path)

    # Parse metadata and cover
    parsed = parse_book(temp_path, file_format)

    title = parsed.get("title") or Path(filename).stem
    author = parsed.get("author")
    page_count = parsed.get("page_count")
    metadata = parsed.get("metadata", {})

    # Move to category folder
    rel_path = move_book_to_category(temp_path, cat["folder_name"], filename)

    # Create DB record first (to get book_id for cover)
    book = await db.create_book(
        title=title,
        author=author,
        file_path=rel_path,
        file_size=file_size,
        file_format=file_format,
        category_id=category_id,
        page_count=page_count,
        metadata=metadata,
    )

    # Save cover
    cover_rel = get_default_cover_path()
    if "cover_bytes" in parsed and parsed["cover_bytes"]:
        try:
            cover_rel = save_cover_image(book["id"], parsed["cover_bytes"])
        except Exception:
            pass
    await db.update_book(book["id"], cover_path=cover_rel)
    book["cover_path"] = cover_rel

    return book


@app.get("/api/books/{book_id}")
async def get_book(book_id: int):
    book = await db.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="图书不存在")
    return book


@app.put("/api/books/{book_id}/category")
async def update_book_category(book_id: int, category_id: int = Form(...)):
    book = await db.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="图书不存在")

    cat = await db.get_category_by_id(category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")

    # Move file to new category folder
    new_rel_path = move_book_to_new_category(book["file_path"], cat["folder_name"])

    # Update database
    await db.update_book(book_id, category_id=category_id, file_path=new_rel_path)

    return {"success": True, "new_category_id": category_id}


@app.post("/api/books/{book_id}/open")
async def open_book_with_system(book_id: int):
    book = await db.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="图书不存在")

    file_path = get_books_root() / book["file_path"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="图书文件不存在")

    full_path = str(file_path.resolve())
    system = platform.system()

    try:
        if system == "Darwin":
            subprocess.Popen(["open", full_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif system == "Windows":
            subprocess.Popen(["start", "", full_path], shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.Popen(["xdg-open", full_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法打开文件: {str(e)}")

    return {"success": True}


@app.delete("/api/books/{book_id}")
async def remove_book(book_id: int, delete_file: bool = True):
    book = await db.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="图书不存在")
    if delete_file:
        delete_book_file(book["file_path"])
    cover = book.get("cover_path")
    if cover and "default" not in cover:
        cp = Path("static") / cover
        if cp.exists():
            cp.unlink()
    await db.delete_book(book_id)
    return {"success": True}


@app.post("/api/books/{book_id}/summary")
async def create_summary(book_id: int):
    book = await db.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="图书不存在")

    # Re-parse to get sample text (in case it wasn't stored)
    full_path = str(get_books_root() / book["file_path"])
    parsed = parse_book(full_path, book["file_format"])
    sample_text = parsed.get("sample_text", "")

    if not sample_text:
        raise HTTPException(status_code=400, detail="无法提取书籍内容，无法生成简介")

    try:
        summary = await generate_summary(sample_text)
        await db.update_book(book_id, description=summary)
        return {"success": True, "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 生成失败: {str(e)}")


# ========== Notes ==========

@app.get("/api/books/{book_id}/notes")
async def list_notes(book_id: int):
    book = await db.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="图书不存在")
    return await db.get_notes_by_book(book_id)


@app.post("/api/notes")
async def create_note(data: dict):
    book_id = data.get("book_id")
    title = data.get("title", "").strip()
    content = data.get("content", "")
    if not book_id or not title:
        raise HTTPException(status_code=400, detail="book_id 和 title 不能为空")
    note = await db.create_note(book_id, title, content)
    return note


@app.put("/api/notes/{note_id}")
async def update_note(note_id: int, data: dict):
    note = await db.get_note_by_id(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    title = data.get("title")
    content = data.get("content")
    await db.update_note(note_id, title=title, content=content)
    return await db.get_note_by_id(note_id)


@app.delete("/api/notes/{note_id}")
async def remove_note(note_id: int):
    note = await db.get_note_by_id(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    await db.delete_note(note_id)
    return {"success": True}


@app.post("/api/notes/ai-generate")
async def ai_generate_note(data: dict):
    book_id = data.get("book_id")
    prompt = data.get("prompt", "").strip()
    if not book_id or not prompt:
        raise HTTPException(status_code=400, detail="book_id 和 prompt 不能为空")

    book = await db.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="图书不存在")

    full_path = str(get_books_root() / book["file_path"])
    parsed = parse_book(full_path, book["file_format"])
    sample_text = parsed.get("sample_text", "")

    if not sample_text:
        raise HTTPException(status_code=400, detail="无法提取书籍内容")

    try:
        content = await generate_note(sample_text, prompt)
        title = f"AI笔记: {prompt[:20]}"
        note = await db.create_note(
            book_id=book_id,
            title=title,
            content=content,
            is_ai_generated=True,
            prompt=prompt
        )
        return note
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 生成失败: {str(e)}")


# ========== Config ==========

@app.get("/api/config")
async def get_config():
    return ConfigManager.to_dict(hide_secrets=True)


@app.post("/api/config")
async def update_config(data: dict):
    api_key = data.get("deepseek_api_key", "").strip()
    base_url = data.get("deepseek_base_url", "").strip()
    model = data.get("deepseek_model", "").strip()
    prompts = data.get("ai_prompts")

    if api_key:
        ConfigManager.set("deepseek_api_key", api_key)
    if base_url:
        ConfigManager.set("deepseek_base_url", base_url)
    if model:
        ConfigManager.set("deepseek_model", model)
    if prompts is not None:
        ConfigManager.set("ai_prompts", prompts)

    return ConfigManager.to_dict(hide_secrets=True)


@app.post("/api/config/test")
async def test_config():
    cfg = ConfigManager.load()
    api_key = cfg.get("deepseek_api_key", "")
    base_url = cfg.get("deepseek_base_url", "https://api.deepseek.com/v1")

    if not api_key:
        return {"valid": False, "message": "API Key 未配置"}

    try:
        ok = await test_api_key()
        if ok:
            return {"valid": True, "message": "连接成功"}
        return {"valid": False, "message": "API 认证失败，请检查 Key 是否有效"}
    except Exception as e:
        err = str(e).lower()
        if "timeout" in err or "timed out" in err:
            return {"valid": False, "message": "连接超时，请检查网络或 Base URL"}
        if "connection" in err or "connect" in err:
            return {"valid": False, "message": "无法连接到 API 服务器，请检查网络或 Base URL"}
        return {"valid": False, "message": f"测试失败: {str(e)[:80]}"}


# Run
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
