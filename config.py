import os
import json
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).parent.resolve()
BOOKS_ROOT = BASE_DIR / "books"
COVERS_ROOT = BASE_DIR / "static" / "covers"
CONFIG_FILE = BASE_DIR / ".bookmanager_config.json"

DEFAULT_CONFIG = {
    "deepseek_api_key": "",
    "deepseek_base_url": "https://api.deepseek.com/v1",
    "deepseek_model": "deepseek-chat",
    "books_root": str(BOOKS_ROOT),
    "covers_root": str(COVERS_ROOT),
}


class ConfigManager:
    _config: dict = {}

    @classmethod
    def load(cls) -> dict:
        if cls._config:
            return cls._config
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    cls._config = json.load(f)
            except Exception:
                cls._config = DEFAULT_CONFIG.copy()
        else:
            cls._config = DEFAULT_CONFIG.copy()
            cls.save()
        # Ensure paths exist
        Path(cls._config.get("books_root", str(BOOKS_ROOT))).mkdir(parents=True, exist_ok=True)
        Path(cls._config.get("covers_root", str(COVERS_ROOT))).mkdir(parents=True, exist_ok=True)
        return cls._config

    @classmethod
    def save(cls) -> None:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cls._config, f, ensure_ascii=False, indent=2)

    @classmethod
    def get(cls, key: str, default=None):
        cls.load()
        return cls._config.get(key, default)

    @classmethod
    def set(cls, key: str, value) -> None:
        cls.load()
        cls._config[key] = value
        cls.save()

    @classmethod
    def to_dict(cls, hide_secrets: bool = False) -> dict:
        cfg = cls.load().copy()
        if hide_secrets and cfg.get("deepseek_api_key"):
            cfg["deepseek_api_key"] = cfg["deepseek_api_key"][:4] + "****"
        return cfg
