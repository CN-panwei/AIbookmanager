import httpx
from typing import Optional
from config import ConfigManager


async def generate_summary(text: str, max_tokens: int = 500) -> str:
    """使用 DeepSeek API 生成书籍简介"""
    cfg = ConfigManager.load()
    api_key = cfg.get("deepseek_api_key", "")
    base_url = cfg.get("deepseek_base_url", "https://api.deepseek.com/v1")
    model = cfg.get("deepseek_model", "deepseek-chat")

    if not api_key:
        raise ValueError("DeepSeek API Key 未配置，请在设置中配置")

    system_prompt = (
        "你是一位专业的书评人。请根据提供的书籍内容片段，"
        "生成一段 150-250 字的中文简介。语言简洁优美，突出书籍的核心主题与价值。"
        "只返回简介正文，不要添加标题或其他说明。"
    )

    # 截断文本避免超出 token 限制
    text = text[:12000]

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"请为以下书籍生成简介：\n\n{text}"},
                ],
                "max_tokens": max_tokens,
                "temperature": 0.7,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return content.strip()


async def generate_note(text: str, prompt: str, max_tokens: int = 2000) -> str:
    """使用 DeepSeek API 根据提示词生成笔记"""
    cfg = ConfigManager.load()
    api_key = cfg.get("deepseek_api_key", "")
    base_url = cfg.get("deepseek_base_url", "https://api.deepseek.com/v1")
    model = cfg.get("deepseek_model", "deepseek-chat")

    if not api_key:
        raise ValueError("DeepSeek API Key 未配置，请在设置中配置")

    system_prompt = (
        "你是一位专业的阅读助手。请根据提供的书籍内容和用户的要求，"
        "生成结构清晰、内容丰富的 Markdown 格式笔记。"
        "使用 Markdown 语法（标题、列表、引用等）组织内容。"
    )

    # 截断文本
    text = text[:12000]

    user_content = (
        f"用户要求：{prompt}\n\n"
        f"书籍内容：\n{text}\n\n"
        f"请根据上述内容生成 Markdown 格式的笔记。"
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "max_tokens": max_tokens,
                "temperature": 0.6,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return content.strip()


async def test_api_key() -> bool:
    """测试 API Key 是否有效"""
    cfg = ConfigManager.load()
    api_key = cfg.get("deepseek_api_key", "")
    base_url = cfg.get("deepseek_base_url", "https://api.deepseek.com/v1")
    model = cfg.get("deepseek_model", "deepseek-chat")

    if not api_key:
        return False

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "user", "content": "Hi"},
                    ],
                    "max_tokens": 5,
                },
            )
            return resp.status_code == 200
    except Exception:
        return False
