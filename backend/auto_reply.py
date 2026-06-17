import logging
import time
from typing import Optional

import httpx

from backend.config import get_pywxrobot_url
from backend.database import db
from backend.kb_service import get_kb_provider
from backend.pywxrobot_client import get_current_account, get_current_wxid

logger = logging.getLogger(__name__)

NON_FRIEND_PATTERNS = [
    lambda s: s.startswith("gh_"),
    lambda s: s in ("mphelper", "weixin", "notifymessage", "wxpay", "qqmail", "fmessage", "medianote", "qmessage", "tmessage", "floatbottle"),
    lambda s: s and s[0].isdigit() and "@" not in s,
]

FALLBACK_REPLY_TEMPLATE = (
    "我大概懂你的意思。"
    "这个我先帮你接住，咱们可以继续往下聊细一点。"
)


def is_friend_sender(sender: str) -> bool:
    if not sender:
        return False
    return not any(pattern(sender) for pattern in NON_FRIEND_PATTERNS)


def classify_intent(text: str) -> str:
    keywords = [
        "价格", "多少钱", "尺码", "颜色", "款式", "材料", "面料", "怎么选", "推荐",
        "适合", "有货", "库存", "发货", "物流", "退换", "售后", "保修", "客服", "质量", "优惠",
        "怎么", "如何", "能否", "是否", "介绍", "参数", "规格", "功能",
    ]
    t = text.lower()
    return "consultation" if any(kw in t for kw in keywords) else "chitchat"


async def current_account_wxid() -> Optional[str]:
    try:
        return await get_current_wxid()
    except Exception:
        return None


def get_active_group_mode(sender: str, account_wxid: Optional[str]) -> Optional[str]:
    return db.is_group_enabled(sender, account_wxid=account_wxid)


def get_default_llm_config() -> Optional[dict]:
    preferred = db.get_system_config("auto_reply_llm_id")
    if preferred and preferred.get("key_value"):
        try:
            target_id = int(preferred["key_value"])
            cfg = next((c for c in db.get_llm_configs() if c["id"] == target_id and c["is_active"]), None)
            if cfg:
                return cfg
        except ValueError:
            pass
    return db.get_active_llm_config()


def get_active_kb_config() -> Optional[dict]:
    preferred = db.get_system_config("auto_reply_kb_id")
    if preferred and preferred.get("key_value"):
        try:
            target_id = int(preferred["key_value"])
            cfg = next((c for c in db.get_kb_configs() if c["id"] == target_id and c["is_active"]), None)
            if cfg:
                return cfg
        except ValueError:
            pass
    return db.get_active_kb_config()


async def process_incoming_message(message_data: dict) -> dict:
    try:
        msgid = message_data.get("msgid", "")
        content = message_data.get("content", "")
        sender = message_data.get("sender", "")
        msg_type = message_data.get("msg_type", 0)

        msg = db.save_message(message_data)
        if not msg:
            db.update_message_reply(msgid, "", "failed", "保存消息失败")
            return {"status": "error", "reason": "save_failed"}

        auto_reply_enabled = db.get_system_config("auto_reply_enabled")
        if not auto_reply_enabled or auto_reply_enabled.get("key_value") != "true":
            db.update_message_reply(msgid, "", "skipped")
            return {"status": "skipped", "reason": "auto_reply_disabled"}

        if msg_type and msg_type != 1:
            db.update_message_reply(msgid, "", "skipped")
            return {"status": "skipped", "reason": "non_text_message"}

        if not content or not content.strip():
            db.update_message_reply(msgid, "", "skipped")
            return {"status": "skipped", "reason": "empty_content"}

        account_wxid = await current_account_wxid()

        if "@chatroom" in sender:
            group_mode = get_active_group_mode(sender, account_wxid)
            if not group_mode:
                db.update_message_reply(msgid, "", "skipped")
                return {"status": "skipped", "reason": "group_not_enabled"}
            if group_mode == "mention" and account_wxid and f"@{account_wxid}" not in content:
                db.update_message_reply(msgid, "", "skipped")
                return {"status": "skipped", "reason": "not_mentioned"}
        elif not is_friend_sender(sender):
            db.update_message_reply(msgid, "", "skipped")
            return {"status": "skipped", "reason": "non_friend_sender"}

        reply_mode = db.get_system_config("reply_mode")
        if reply_mode and reply_mode.get("key_value") == "keyword" and not db.check_keyword_match(content):
            db.update_message_reply(msgid, "", "skipped")
            return {"status": "skipped", "reason": "no_keyword_match"}

        if "@chatroom" not in sender and not db.is_friend_allowed(sender, account_wxid=account_wxid):
            db.update_message_reply(msgid, "", "skipped")
            return {"status": "skipped", "reason": "not_in_whitelist"}

        db.push_context(sender, "user", content, msgid=msgid, timestamp=int(time.time() * 1000), account_wxid=account_wxid)

        use_intent = db.get_system_config("intent_mode")
        intent = classify_intent(content) if use_intent and use_intent.get("key_value") == "true" else "consultation"

        kb_config = get_active_kb_config()
        llm_config = get_default_llm_config()

        reply_text = ""
        if kb_config:
            if intent == "consultation":
                reply_text = await query_knowledge_base(content, kb_config, sender, account_wxid)
            if not reply_text and llm_config:
                reply_text = await query_default_llm(content, llm_config, sender, account_wxid, reply_style="fallback")
        elif llm_config:
            reply_text = await query_default_llm(content, llm_config, sender, account_wxid, reply_style="default")

        if not reply_text:
            reply_text = FALLBACK_REPLY_TEMPLATE
            if intent == "consultation":
                reply_text = f"{FALLBACK_REPLY_TEMPLATE} 你把具体情况再说一下，我继续帮你看。"

        prefix_config = db.get_system_config("auto_reply_prefix")
        if prefix_config and prefix_config.get("key_value"):
            reply_text = f"{prefix_config['key_value']}\n{reply_text}"

        result = await send_reply(sender, msgid, reply_text)
        if result.get("status") == "sent":
            db.push_context(sender, "assistant", reply_text, msgid=msgid, timestamp=int(time.time() * 1000), account_wxid=account_wxid)
        return result
    except Exception as e:
        logger.error(f"process_incoming_message error: {e}", exc_info=True)
        db.update_message_reply(message_data.get("msgid", ""), "", "failed", str(e))
        return {"status": "error", "error": str(e)}


async def query_knowledge_base(question: str, kb_config: dict, sender: str, account_wxid: Optional[str]) -> str:
    provider = get_kb_provider(kb_config.get("provider", ""))
    if not provider:
        return ""
    try:
        payload = dict(kb_config)
        payload["_context"] = db.get_context(sender, account_wxid=account_wxid)
        payload["_reply_style"] = "kb"
        return await provider.query(question, payload)
    except Exception as e:
        logger.error(f"KB query error: {e}")
        return ""


async def query_default_llm(question: str, llm_config: dict, sender: str, account_wxid: Optional[str], reply_style: str = "default") -> str:
    provider = get_kb_provider(llm_config.get("provider", ""))
    if not provider:
        return ""
    try:
        payload = dict(llm_config)
        payload["kb_id"] = ""
        payload["_context"] = db.get_context(sender, account_wxid=account_wxid)
        payload["_reply_style"] = reply_style
        return await provider.query(question, payload)
    except Exception as e:
        logger.error(f"LLM query error: {e}")
        return ""


async def send_reply(wxid: str, msgid: str, reply_text: str) -> dict:
    pywxrobot_url = get_pywxrobot_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{pywxrobot_url}/send/text",
                json={"wxid": wxid, "content": reply_text, "wait": False},
            )
            if resp.status_code == 200:
                db.update_message_reply(msgid, reply_text, "sent")
                current = await get_current_account()
                self_wxid = (current or {}).get("wxid") or "self"
                db.save_outbound_message(
                    self_wxid,
                    wxid,
                    reply_text,
                    msgid=f"reply_{msgid}_{int(time.time())}",
                    timestamp=int(time.time() * 1000),
                )
                return {"status": "sent", "reply": reply_text}

            db.update_message_reply(msgid, reply_text, "failed", f"HTTP {resp.status_code}")
            return {"status": "failed", "reply": reply_text, "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        db.update_message_reply(msgid, reply_text, "failed", str(e))
        return {"status": "failed", "reply": reply_text, "error": str(e)}


async def process_friend_request(v4: str, wxid: str, msg: str = "") -> dict:
    config = db.get_system_config("auto_accept_friend")
    if not config or config.get("key_value") != "true":
        return {"status": "skipped", "reason": "auto_accept_disabled"}

    try:
        pywxrobot_url = get_pywxrobot_url()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{pywxrobot_url}/user/agreefriend",
                json={"wxpid": None, "wxid": wxid, "v4": v4, "remarks": "", "add_type": 6},
            )
            if resp.status_code == 200 and resp.json().get("ret") == 0:
                welcome = db.get_system_config("auto_accept_welcome")
                if welcome and welcome.get("key_value"):
                    await client.post(
                        f"{pywxrobot_url}/send/text",
                        json={"wxid": wxid, "content": welcome["key_value"], "wait": False},
                    )
                return {"status": "accepted"}
            return {"status": "failed", "error": resp.text[:300]}
    except Exception as e:
        logger.error(f"process_friend_request error: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
