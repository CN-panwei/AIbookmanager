import io
import os
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
import fitz  # PyMuPDF
import ebooklib
from ebooklib import epub

from config import ConfigManager


def parse_pdf(file_path: str) -> Dict[str, Any]:
    """解析 PDF 文件，提取元数据、封面、前 N 页文本"""
    result = {
        "title": None,
        "author": None,
        "page_count": 0,
        "cover_path": None,
        "sample_text": "",
        "metadata": {},
    }
    try:
        doc = fitz.open(file_path)
        result["page_count"] = doc.page_count

        # 元数据
        meta = doc.metadata
        if meta:
            result["title"] = meta.get("title") or None
            result["author"] = meta.get("author") or None
            result["metadata"] = {k: v for k, v in meta.items() if v}

        # 提取封面（第 0 页）
        if doc.page_count > 0:
            page = doc[0]
            pix = page.get_pixmap(dpi=150)
            if pix.n > 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            img_data = pix.tobytes("jpeg")
            result["cover_bytes"] = img_data

        # 提取前 10 页文本用于 AI 简介
        sample_pages = min(10, doc.page_count)
        texts = []
        for i in range(sample_pages):
            text = doc[i].get_text()
            if text.strip():
                texts.append(text)
        result["sample_text"] = "\n".join(texts)[:8000]

        doc.close()
    except Exception as e:
        result["error"] = str(e)

    return result


def parse_epub(file_path: str) -> Dict[str, Any]:
    """解析 EPUB 文件，提取元数据、封面、前几个章节文本"""
    result = {
        "title": None,
        "author": None,
        "page_count": None,
        "cover_path": None,
        "sample_text": "",
        "metadata": {},
    }
    try:
        book = epub.read_epub(file_path)

        # 元数据
        titles = book.get_metadata("DC", "title")
        if titles:
            result["title"] = titles[0][0]
        creators = book.get_metadata("DC", "creator")
        if creators:
            result["author"] = creators[0][0]

        # 其他元数据
        meta_map = {
            "publisher": "DC", "publisher": "publisher",
            "date": "DC", "date": "date",
            "language": "DC", "language": "language",
            "identifier": "DC", "identifier": "identifier",
        }
        extra_meta = {}
        for key, (ns, tag) in {
            "publisher": ("DC", "publisher"),
            "date": ("DC", "date"),
            "language": ("DC", "language"),
            "identifier": ("DC", "identifier"),
        }.items():
            vals = book.get_metadata(ns, tag)
            if vals:
                extra_meta[key] = vals[0][0]
        result["metadata"] = extra_meta

        # 提取封面（先找 ITEM_COVER，再找 IMAGE）
        cover_bytes = None
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_COVER:
                cover_bytes = item.get_content()
                break
        if not cover_bytes:
            for item in book.get_items():
                if item.get_type() == ebooklib.ITEM_IMAGE:
                    props = getattr(item, "properties", [])
                    if "cover-image" in props:
                        cover_bytes = item.get_content()
                        break
        if not cover_bytes:
            # 尝试查找名为 cover 的图片
            for item in book.get_items():
                if item.get_type() in (ebooklib.ITEM_IMAGE, ebooklib.ITEM_COVER):
                    name = getattr(item, "file_name", "").lower()
                    if "cover" in name:
                        cover_bytes = item.get_content()
                        break
        if not cover_bytes:
            # 取第一个图片
            for item in book.get_items():
                if item.get_type() in (ebooklib.ITEM_IMAGE, ebooklib.ITEM_COVER):
                    cover_bytes = item.get_content()
                    break
        if cover_bytes:
            result["cover_bytes"] = cover_bytes

        # 提取前几个章节文本
        texts = []
        doc_items = [item for item in book.get_items() if item.get_type() == ebooklib.ITEM_DOCUMENT]
        for item in doc_items[:3]:
            content = item.get_content().decode("utf-8", errors="ignore")
            # 简单去除 HTML 标签
            import re
            text = re.sub(r'<[^>]+>', '', content)
            text = re.sub(r'\s+', ' ', text).strip()
            if text:
                texts.append(text)
        result["sample_text"] = "\n".join(texts)[:8000]

        # 估算页数（按 HTML 文档数粗略估算）
        result["page_count"] = len(doc_items) * 15 if doc_items else None

    except Exception as e:
        result["error"] = str(e)

    return result


def save_cover_image(book_id: int, image_bytes: bytes) -> str:
    """保存封面图片，返回相对 static/covers/ 的路径"""
    covers_root = Path(ConfigManager.get("covers_root"))
    covers_root.mkdir(parents=True, exist_ok=True)
    cover_path = covers_root / f"{book_id}.jpg"
    with open(cover_path, "wb") as f:
        f.write(image_bytes)
    return f"covers/{book_id}.jpg"


def get_default_cover_path() -> str:
    """返回默认封面路径（如不存在则创建一个占位图）"""
    covers_root = Path(ConfigManager.get("covers_root"))
    default_path = covers_root / "default.jpg"
    if not default_path.exists():
        # 创建一个简单的灰色占位图
        try:
            from PIL import Image
            img = Image.new("RGB", (300, 400), color="#e0e0e0")
            img.save(default_path, "JPEG")
        except ImportError:
            pass
    return "covers/default.jpg"


def parse_book(file_path: str, file_format: str) -> Dict[str, Any]:
    """根据格式调用对应解析器"""
    if file_format == "pdf":
        return parse_pdf(file_path)
    elif file_format == "epub":
        return parse_epub(file_path)
    else:
        return {"error": "Unsupported format"}
