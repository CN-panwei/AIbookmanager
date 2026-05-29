import os
import json
from pathlib import Path
from typing import Optional

APP_VERSION = "1.1.2"

BASE_DIR = Path(__file__).parent.resolve()
BOOKS_ROOT = BASE_DIR / "books"
COVERS_ROOT = BASE_DIR / "static" / "covers"
CONFIG_FILE = BASE_DIR / ".bookmanager_config.json"

DEFAULT_PROMPTS = [
    {"id": "1", "name": "逻辑大纲提取", "content": "请分析这份资料或书的整体结构，提取出一份详细的逻辑大纲。请特别标注出作者是为了解决什么核心问题而写这本书/这篇文章的，以及他是通过哪几个关键维度来论证的。"},
    {"id": "2", "name": "3分钟核心金句", "content": "如果我要在 3 分钟内向别人解释这份资料或书的核心思想，请为我列出 5 个最不可错过的'金句'或核心结论，并简要说明它们为什么重要。"},
    {"id": "3", "name": "术语通俗解释", "content": "请从这份资料或书中提取所有专业术语、专有名词或作者特有的概念，并结合上下文给出通俗易懂的解释。如果可能，请用一个生活中的类比来辅助说明。"},
    {"id": "4", "name": "证据与逻辑漏洞", "content": "针对[具体章节/某个观点]，请梳理作者给出的所有证据。作者是否存在逻辑漏洞？或者有哪些结论是基于假设而非实证的？请基于文本给出你的分析。"},
    {"id": "5", "name": "苏格拉底式提问", "content": "请扮演一位严苛的苏格拉底式导师，针对这份资料的内容向我提出 5 个具有挑战性的问题，迫使我思考这些知识背后的深层逻辑。在我回答后，请结合原文评价我的理解。"},
    {"id": "6", "name": "跨章节关联分析", "content": "请分析第[A]部分提到的观点与第[B]部分的内容有何内在联系？它们是如何相互支持或产生矛盾的？请总结出这种关联对整体主题的影响。"},
    {"id": "7", "name": "行动清单", "content": "基于书中的理论，请为我制定一个'行动清单'。如果我要在现实生活中应用这些知识，第一步、第二步、第三步分别应该做什么？请尽量具体到可操作的程度。"},
    {"id": "8", "name": "通俗重述", "content": "请尝试用最简单的语言（确保一个 10 岁的孩子也能听懂）重述这份资料中关于[具体知识点]的解释。不要使用任何专业术语。"},
    {"id": "9", "name": "作者角色扮演", "content": "现在你就是[作者姓名]，我是一名深入阅读了你作品的记者。我会针对书中的争议点向你提问，请完全根据书中的立场和语气回答我。"},
    {"id": "10", "name": "自测题生成", "content": "请根据源文件内容，为我出一份包含选择题、简答题和案例分析题的测验卷，用于检测我对[具体主题]的掌握程度。在我回答完后，请给出标准答案并引用原文进行讲解。"},
]

DEFAULT_CONFIG = {
    "deepseek_api_key": "",
    "deepseek_base_url": "https://api.deepseek.com/v1",
    "deepseek_model": "deepseek-chat",
    "books_root": str(BOOKS_ROOT),
    "covers_root": str(COVERS_ROOT),
    "ai_prompts": [],
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
        # Ensure paths exist
        Path(cls._config.get("books_root", str(BOOKS_ROOT))).mkdir(parents=True, exist_ok=True)
        Path(cls._config.get("covers_root", str(COVERS_ROOT))).mkdir(parents=True, exist_ok=True)
        # Ensure default prompts are populated
        if not cls._config.get("ai_prompts"):
            cls._config["ai_prompts"] = [p.copy() for p in DEFAULT_PROMPTS]
            cls.save()
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
            key = cfg["deepseek_api_key"]
            cfg["deepseek_api_key"] = key[:3] + "****************" + key[-4:]
        cfg["deepseek_api_key_set"] = bool(cfg.get("deepseek_api_key"))
        if "ai_prompts" not in cfg:
            cfg["ai_prompts"] = [p.copy() for p in DEFAULT_PROMPTS]
        cfg["app_version"] = APP_VERSION
        return cfg
