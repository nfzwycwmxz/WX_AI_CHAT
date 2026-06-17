from abc import ABC, abstractmethod
from typing import Optional
import httpx
import logging

logger = logging.getLogger(__name__)


class KBProvider(ABC):
    @abstractmethod
    async def query(self, question: str, config: dict) -> str:
        pass


class ZhipuKBProvider(KBProvider):
    _transport_cache = None

    def _get_transport(self):
        if self._transport_cache is None:
            self._transport_cache = httpx.AsyncHTTPTransport(retries=2)
        return self._transport_cache

    def _client_args(self, proxy_url=None):
        if proxy_url:
            return {"proxy": proxy_url}
        return {"transport": self._get_transport()}

    async def _post(self, api_key, payload, client_kwargs, api_url=None):
        async with httpx.AsyncClient(timeout=60.0, **client_kwargs) as c:
            r = await c.post(
                api_url or "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            if r.status_code != 200:
                raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
            return r.json()

    async def query(self, question: str, config: dict) -> str:
        api_key = config.get("api_key", "")
        kb_id = config.get("kb_id", "")
        model = config.get("model") or "glm-4-flash"
        api_url = config.get("api_url") or None
        context = config.get("_context") or []
        reply_style = config.get("_reply_style", "kb")
        if not api_key:
            return ""

        proxy_url = self._get_proxy_url()
        ca = self._client_args(proxy_url)

        async def direct_chat(prompt_messages):
            r = await self._post(api_key, {"model": model, "messages": prompt_messages}, ca, api_url=api_url)
            for choice in r.get("choices", []):
                content = choice.get("message", {}).get("content", "")
                if content:
                    return content.strip()
            return ""

        def system_prompt() -> str:
            if reply_style == "fallback":
                return (
                    "你是微信里的真人聊天助手。"
                    "请用自然、亲切、轻松的口吻回复，不要提知识库、文档、检索、接口、API。"
                    "如果信息不足，就像朋友一样顺着话题接一句，不要机械道歉，也不要说我查不到。"
                    "回答尽量简短，优先给出可继续聊下去的一句话。"
                )
            if kb_id:
                return (
                    "你是微信里的真人助手。"
                    "请基于提供的参考信息回答，但表达要自然、像朋友聊天。"
                    "不要提文档、知识库、检索、接口、API。"
                    "如果参考信息不够，就顺着话题轻松回答，不要硬邦邦地道歉。"
                )
            return (
                "你是微信里的聊天助手。"
                "请自然、简洁地回复，保持上下文连贯。"
                "不要像客服，不要写长篇解释。"
            )

        if not kb_id:
            messages = [{"role": "system", "content": system_prompt()}]
            if context:
                recent = context[-8:]
                context_text = "\n".join(
                    f"{'user' if item.get('role') == 'user' else 'assistant'}: {item.get('content', '')}"
                    for item in recent
                    if item.get("content")
                )
                if context_text.strip():
                    messages.append({
                        "role": "system",
                        "content": f"Recent conversation context for reference only, do not repeat verbatim:\n{context_text[-1200:]}",
                    })
            messages.append({"role": "user", "content": question})
            try:
                return await direct_chat(messages)
            except Exception as e:
                logger.error(f"Direct chat failed: {e}")
                return ""

        kb_context = ""
        try:
            r1 = await self._post(api_key, {
                "model": model,
                "messages": [{"role": "user", "content": question}],
                "tools": [{"type": "retrieval", "retrieval": {"knowledge_id": kb_id, "top_k": 5}}],
            }, ca, api_url=api_url)
            msg = r1.get("choices", [{}])[0].get("message", {})
            kb_context = msg.get("content") or ""
        except Exception as e1:
            logger.warning(f"Step 1 (retrieval) failed: {e1}")

        messages = [{"role": "system", "content": system_prompt()}]

        if context:
            recent = context[-8:]
            context_text = "\n".join(
                f"{'friend' if item.get('role') == 'user' else 'me'}: {item.get('content', '')}"
                for item in recent
                if item.get("content")
            )
            if context_text.strip():
                messages.append({
                    "role": "system",
                    "content": f"Use the following recent chat history as background only, do not copy it verbatim:\n{context_text[-1200:]}",
                })

        if kb_context:
            trimmed = kb_context[-800:] if len(kb_context) > 800 else kb_context
            if trimmed.strip():
                messages.append({
                    "role": "system",
                    "content": (
                        "以下内容是参考知识，只在有帮助时自然融入回答，不要逐字照搬，也不要提到文档、知识库或检索。\n"
                        f"{trimmed}"
                    ),
                })

        messages.append({"role": "user", "content": question})

        try:
            return await direct_chat(messages)
        except RuntimeError as e:
            if proxy_url:
                logger.warning(f"Proxy failed, retrying direct: {e}")
                try:
                    r2 = await self._post(api_key, {"model": model, "messages": messages},
                                          {"transport": self._get_transport()}, api_url=api_url)
                    for c in r2.get("choices", []):
                        content = c.get("message", {}).get("content", "")
                        if content:
                            return content.strip()
                except Exception as e2:
                    logger.error(f"Both proxy and direct failed: {e2}")
                    return ""
            return ""
        except Exception as e:
            logger.error(f"Step 2 failed: {e}")
            return ""

    def _get_proxy_url(self) -> Optional[str]:
        try:
            from backend.database import db
            p = db.get_active_proxy_config()
            return p["proxy_url"] if p else None
        except Exception:
            return None


class DifyKBProvider(KBProvider):
    _transport_cache = None

    def _get_transport(self):
        if self._transport_cache is None:
            self._transport_cache = httpx.AsyncHTTPTransport(retries=2)
        return self._transport_cache

    async def query(self, question: str, config: dict) -> str:
        api_key = config.get("api_key", "")
        api_url = config.get("api_url", "https://api.dify.ai/v1")
        if not api_key:
            return ""
        proxy_url = self._get_proxy_url()
        ca = {"transport": self._get_transport()}
        if proxy_url:
            ca = {"proxy": proxy_url}
        try:
            async with httpx.AsyncClient(timeout=60.0, **ca) as c:
                r = await c.post(f"{api_url}/chat-messages", json={
                    "query": question, "response_mode": "blocking",
                    "user": "wx-ai-robot", "inputs": {},
                }, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
                if r.status_code == 200:
                    return r.json().get("answer", "").strip()
        except Exception as e:
            logger.error(f"Dify error: {e}")
        return ""

    def _get_proxy_url(self) -> Optional[str]:
        try:
            from backend.database import db
            p = db.get_active_proxy_config()
            return p["proxy_url"] if p else None
        except Exception:
            return None


class FastGPTKBProvider(KBProvider):
    _transport_cache = None

    def _get_transport(self):
        if self._transport_cache is None:
            self._transport_cache = httpx.AsyncHTTPTransport(retries=2)
        return self._transport_cache

    async def query(self, question: str, config: dict) -> str:
        api_key = config.get("api_key", "")
        api_url = config.get("api_url", "http://localhost:3000")
        if not api_key:
            return ""
        proxy_url = self._get_proxy_url()
        ca = {"transport": self._get_transport()}
        if proxy_url:
            ca = {"proxy": proxy_url}
        try:
            async with httpx.AsyncClient(timeout=60.0, **ca) as c:
                r = await c.post(f"{api_url}/api/v1/chat/completions", json={
                    "model": config.get("model", "gpt-3.5-turbo"),
                    "messages": [
                        {"role": "system", "content": "你是一个微信聊天助手，请自然回复用户问题，不要输出模板化客服话术。"},
                        {"role": "user", "content": question},
                    ],
                    "stream": False,
                }, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
                if r.status_code == 200:
                    return r.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        except Exception as e:
            logger.error(f"FastGPT error: {e}")
        return ""

    def _get_proxy_url(self) -> Optional[str]:
        try:
            from backend.database import db
            p = db.get_active_proxy_config()
            return p["proxy_url"] if p else None
        except Exception:
            return None


class XunfeiKBProvider(KBProvider):
    _transport_cache = None

    def _get_transport(self):
        if self._transport_cache is None:
            self._transport_cache = httpx.AsyncHTTPTransport(retries=2)
        return self._transport_cache

    def _client_args(self, proxy_url=None):
        if proxy_url:
            return {"proxy": proxy_url}
        return {"transport": self._get_transport()}

    def _get_proxy(self):
        try:
            from backend.database import db
            p = db.get_active_proxy_config()
            return p["proxy_url"] if p else None
        except Exception:
            return None

    def _build_auth_headers(self, api_key: str, api_secret: str, api_url: str) -> dict:
        from datetime import datetime, timezone
        from urllib.parse import urlparse
        import hashlib
        import hmac
        import base64

        parsed = urlparse(api_url)
        host = parsed.netloc
        path = parsed.path or "/"
        date = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        sig_str = f"host: {host}\ndate: {date}\nPOST {path} HTTP/1.1"
        sig = hmac.new(api_secret.encode(), sig_str.encode(), hashlib.sha256).digest()
        sig_b64 = base64.b64encode(sig).decode()
        auth_value = f'api_key="{api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="{sig_b64}"'
        return {
            "Authorization": f"HMAC-SHA256 {auth_value}",
            "Content-Type": "application/json",
            "Date": date,
            "Accept": "application/json",
        }

    async def query(self, question: str, config: dict) -> str:
        api_key = config.get("api_key", "")
        api_secret = config.get("api_secret", "")
        app_id = config.get("app_id", "")
        kb_id = config.get("kb_id", "")
        model = config.get("model") or "generalv3.5"
        api_url = config.get("api_url") or "https://spark-api.xf-yun.com/v3.5/chat"

        if not api_key or not api_secret or not app_id:
            logger.warning(f"Xunfei: missing fields (key={bool(api_key)} secret={bool(api_secret)} app_id={bool(app_id)})")
            return ""

        proxy_url = self._get_proxy()
        ca = self._client_args(proxy_url)

        try:
            headers = self._build_auth_headers(api_key, api_secret, api_url)
        except Exception as e:
            logger.error(f"Xunfei auth build error: {e}")
            return ""

        payload = {
            "header": {"app_id": app_id},
            "parameter": {
                "chat": {"domain": model},
            },
            "payload": {
                "message": {
                    "text": [
                        {"role": "user", "content": question},
                    ],
                },
            },
        }
        if kb_id:
            payload["parameter"]["chat"]["knowledge_id"] = kb_id

        try:
            async with httpx.AsyncClient(timeout=60.0, **ca) as c:
                r = await c.post(api_url, json=payload, headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    try:
                        return data["payload"]["choices"]["text"][0]["content"].strip()
                    except (KeyError, IndexError, TypeError):
                        return (data.get("text", "") or data.get("result", "") or "").strip()
                logger.error(f"Xunfei API error: {r.status_code} {r.text[:500]}")
                return ""
        except Exception as e:
            logger.error(f"Xunfei error: {e}")
            return ""


PROVIDER_MAP = {
    "zhipu": ZhipuKBProvider(),
    "dify": DifyKBProvider(),
    "fastgpt": FastGPTKBProvider(),
    "xunfei": XunfeiKBProvider(),
}


def get_kb_provider(provider_name: str) -> Optional[KBProvider]:
    return PROVIDER_MAP.get(provider_name.lower())
