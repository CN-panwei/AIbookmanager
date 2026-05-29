import os
import re
from pathlib import Path
from typing import Optional
from pypinyin import lazy_pinyin

from config import ConfigManager


def to_pinyin_folder_name(name: str) -> str:
    """将中文分类名转换为拼音文件夹名（小写，无空格）"""
    pinyin = lazy_pinyin(name)
    folder = "".join(pinyin).lower()
    folder = re.sub(r'[^a-z0-9]', '_', folder)
    folder = re.sub(r'_+', '_', folder).strip('_')
    if not folder:
        folder = "uncategorized"
    return folder


def get_books_root() -> Path:
    return Path(ConfigManager.get("books_root"))


def get_covers_root() -> Path:
    return Path(ConfigManager.get("covers_root"))


def ensure_category_folder(folder_name: str) -> Path:
    path = get_books_root() / folder_name
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_unique_filename(folder: Path, original_name: str) -> str:
    """如果文件名冲突，自动追加数字后缀"""
    name = original_name
    counter = 1
    stem = Path(original_name).stem
    suffix = Path(original_name).suffix
    while (folder / name).exists():
        name = f"{stem}_{counter}{suffix}"
        counter += 1
    return name


def move_book_to_category(temp_path: str, folder_name: str, original_name: str) -> str:
    """将上传的临时文件移动到分类目录，返回相对路径"""
    folder = ensure_category_folder(folder_name)
    unique_name = get_unique_filename(folder, original_name)
    dest = folder / unique_name
    os.replace(temp_path, str(dest))
    return str(dest.relative_to(get_books_root()))


def delete_book_file(file_path: str):
    """删除磁盘上的图书文件"""
    full_path = get_books_root() / file_path
    if full_path.exists():
        full_path.unlink()


def rename_category_folder(old_folder: str, new_folder: str):
    """重命名分类文件夹"""
    root = get_books_root()
    old_path = root / old_folder
    new_path = root / new_folder
    if old_path.exists() and not new_path.exists():
        old_path.rename(new_path)
        # 更新数据库中所有图书的 file_path
        return True
    return False


def delete_category_folder(folder_name: str, delete_books: bool = False):
    """删除分类文件夹"""
    folder = get_books_root() / folder_name
    if folder.exists():
        if delete_books:
            import shutil
            shutil.rmtree(folder)
        else:
            # 如果文件夹内有文件且不移除书籍，则保留文件夹
            if not any(folder.iterdir()):
                folder.rmdir()


def move_book_to_new_category(file_path: str, new_folder_name: str) -> str:
    """将图书文件移动到新的分类文件夹，返回新的相对路径"""
    root = get_books_root()
    old_full = root / file_path
    if not old_full.exists():
        return file_path

    new_folder = ensure_category_folder(new_folder_name)
    filename = old_full.name
    unique_name = get_unique_filename(new_folder, filename)
    new_full = new_folder / unique_name

    os.replace(str(old_full), str(new_full))
    return str(new_full.relative_to(root))
