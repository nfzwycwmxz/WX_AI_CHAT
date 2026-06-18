import socket
import sys
import time
import re
import httpx
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.database import db
from backend.auto_reply import process_incoming_message
from backend.config import settings, get_local_ip, get_pywxrobot_url
from backend.pywxrobot_client import (
    get_current_account,
    get_current_wxid,
    get_logged_in_accounts,
    get_primary_wxpid,
    normalize_list_response,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============ Pydantic Models ============

class MessagePush(BaseModel):
    wxpid: Optional[int] = None
    local_type: Optional[int] = None
    msg_type: Optional[int] = None
    sender: Optional[str] = None
    recipient: Optional[str] = None
    room_sender: Optional[str] = None
    username: Optional[str] = None
    userName: Optional[str] = None
    UserName: Optional[str] = None
    user_name: Optional[str] = None
    nick_name: Optional[str] = None
    nickname: Optional[str] = None
    voice: Optional[str] = None
    msgid: Optional[str] = None
    timestamp: Optional[int] = None
    msgsource: Optional[str] = None
    content: Optional[str] = None


class KBConfigCreate(BaseModel):
    name: str
    provider: str = "zhipu"
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    api_url: Optional[str] = None
    kb_id: Optional[str] = None
    model: Optional[str] = None
    app_id: Optional[str] = None


class KBConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    api_url: Optional[str] = None
    kb_id: Optional[str] = None
    model: Optional[str] = None
    app_id: Optional[str] = None
    is_active: Optional[bool] = None


class LLMConfigCreate(BaseModel):
    name: str
    provider: str = "zhipu"
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    api_url: Optional[str] = None
    model: Optional[str] = None
    app_id: Optional[str] = None


class LLMConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    api_url: Optional[str] = None
    model: Optional[str] = None
    app_id: Optional[str] = None
    is_active: Optional[bool] = None


class ProxyConfigCreate(BaseModel):
    proxy_url: str
    proxy_username: Optional[str] = None
    proxy_password: Optional[str] = None


class ProxyConfigUpdate(BaseModel):
    proxy_url: Optional[str] = None
    proxy_username: Optional[str] = None
    proxy_password: Optional[str] = None
    is_active: Optional[bool] = None


class SendTestMessage(BaseModel):
    wxid: str
    content: str
    wait: bool = False


class SystemConfigUpdate(BaseModel):
    value: str


class ConversationReadRequest(BaseModel):
    sender: str


# ============ FastAPI App ============

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"VX智能AI starting on {settings.host}:{settings.port}")
    mount_frontend_static()
    yield
    logger.info("VX智能AI shutting down")


app = FastAPI(title="VX智能AI", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ API Routes ============

@app.get("/api/health")
async def health_check():
    """Health check, webhook URL, and pywxrobot connectivity status."""
    local_ip = get_local_ip()
    webhook_url = f"http://{local_ip}:{settings.port}/api/messages"

    pywxrobot_url = get_pywxrobot_url()
    pywxrobot_connected = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{pywxrobot_url}/introduction")
            pywxrobot_connected = resp.status_code == 200
    except Exception:
        pass

    return {
        "status": "running",
        "version": "1.0.0",
        "server": {"host": settings.host, "port": settings.port},
        "webhook_url": webhook_url,
        "pywxrobot": {
            "url": pywxrobot_url,
            "connected": pywxrobot_connected,
        },
    }


# ---------- Messages ----------

def extract_wechat_text(raw: str) -> str:
    """Extract the actual human-readable text from a WeChat XML message."""
    if not raw:
        return raw
    # Try <title> first (covers appmsg, link cards, etc.)
    m = re.search(r'<title>(?:<!\[CDATA\[)?([^\]>]+?)(?:\]\]>)?<\/title>', raw)
    if m and m.group(1).strip():
        return m.group(1).strip()
    # Try <content>
    m = re.search(r'<content>(?:<!\[CDATA\[)?([^\]>]+?)(?:\]\]>)?<\/content>', raw)
    if m and m.group(1).strip():
        return m.group(1).strip()
    # If not XML, return raw
    if not raw.strip().startswith('<'):
        return raw.strip()
    return ''


def is_selectable_friend_wxid(wxid: str) -> bool:
    if not wxid or "@chatroom" in wxid:
        return False
    if wxid.startswith("gh_"):
        return False
    return wxid not in {
        "mphelper", "weixin", "notifymessage", "wxpay", "qqmail",
        "fmessage", "medianote", "qmessage", "tmessage", "floatbottle",
    }


def guess_image_media_type(path: Path) -> str:
    try:
        header = path.read_bytes()[:16]
    except Exception:
        return "application/octet-stream"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


async def download_wechat_image(message: dict, flag: int) -> Optional[Path]:
    """Ask pywxrobot to download a WeChat image and return its local file path."""
    pywxrobot_url = get_pywxrobot_url()
    msgid = str(message.get("msgid") or "")
    candidates = [
        message.get("sender"),
        message.get("room_sender"),
        message.get("recipient"),
    ]
    seen = set()
    wxids = []
    for wxid in candidates:
        if wxid and wxid not in seen:
            seen.add(wxid)
            wxids.append(wxid)

    async with httpx.AsyncClient(timeout=30.0) as client:
        for wxid in wxids:
            try:
                resp = await client.post(
                    f"{pywxrobot_url}/cdn/image",
                    json={"msgid": msgid, "wxid": wxid, "flag": flag, "wait": True},
                )
                if resp.status_code != 200:
                    continue
                payload = resp.json() if resp.text else {}
                image_path = payload.get("path") if isinstance(payload, dict) else None
                if image_path:
                    path = Path(image_path)
                    if path.is_file():
                        return path
            except Exception as e:
                logger.debug(f"Failed to download image {msgid} with wxid {wxid}: {e}")
    return None


@app.post("/api/messages")
async def receive_message(msg: MessagePush):
    """Endpoint for pywxrobot to push incoming WeChat messages.

    This triggers the auto-reply pipeline automatically.
    """
    data = msg.model_dump(exclude_none=True) if hasattr(msg, 'model_dump') else msg.dict(exclude_none=True)
    # Clean text messages only. Media/app messages need their raw XML for display.
    if data.get('content') and data.get('msg_type') in (1, None):
        clean = extract_wechat_text(data['content'])
        if clean:
            data['content'] = clean
    logger.info(f"Received message from {data.get('sender', 'unknown')}: {data.get('content', '')[:50]}")

    try:
        result = await process_incoming_message(data)
        return {"status": "received", "auto_reply": result}
    except Exception as e:
        logger.error(f"Error processing message: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/messages")
async def get_messages(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Get message history (most recent first)."""
    messages = db.get_messages(limit=limit, offset=offset)
    return {"messages": messages}


@app.get("/api/messages/stats")
async def get_message_statistics():
    """Get message statistics for the dashboard."""
    return db.get_message_stats()


@app.get("/api/messages/image/{msgid}")
async def get_message_image(msgid: str, variant: str = Query(default="thumb", pattern="^(thumb|full)$")):
    """Return a locally downloaded WeChat image thumbnail/full image."""
    message = db.get_message(msgid)
    if not message:
        raise HTTPException(status_code=404, detail="message not found")
    if int(message.get("msg_type") or 0) != 3:
        raise HTTPException(status_code=400, detail="message is not an image")

    flags = [1, 2] if variant == "thumb" else [2, 1]
    for flag in flags:
        path = await download_wechat_image(message, flag)
        if path:
            return FileResponse(
                str(path),
                media_type=guess_image_media_type(path),
                headers={"Cache-Control": "public, max-age=86400"},
            )

    raise HTTPException(status_code=404, detail="image file not available")


@app.delete("/api/messages")
async def reset_all_messages():
    """Delete ALL messages from the database to reset statistics."""
    from backend.database import db
    deleted = db.clear_all_messages()
    return {"deleted": deleted, "message": f"已删除 {deleted} 条消息，统计已清零"}


# ---------- Knowledge Base Configs ----------

@app.get("/api/kb-configs")
async def get_kb_configs():
    return db.get_kb_configs()


@app.post("/api/kb-configs")
async def create_kb_config(config: KBConfigCreate):
    data = config.model_dump() if hasattr(config, 'model_dump') else config.dict()
    result = db.create_kb_config(**data)
    return result


@app.put("/api/kb-configs/{config_id}")
async def update_kb_config(config_id: int, config: KBConfigUpdate):
    data = config.model_dump(exclude_none=True) if hasattr(config, 'model_dump') else config.dict(exclude_none=True)
    result = db.update_kb_config(config_id, **data)
    if not result:
        raise HTTPException(status_code=404, detail="配置未找到")
    return result


@app.delete("/api/kb-configs/{config_id}")
async def delete_kb_config(config_id: int):
    success = db.delete_kb_config(config_id)
    if not success:
        raise HTTPException(status_code=404, detail="配置未找到")
    return {"message": "已删除"}


# ---------- Default LLM Configs ----------

@app.get("/api/llm-configs")
async def get_llm_configs():
    return db.get_llm_configs()


@app.post("/api/llm-configs")
async def create_llm_config(config: LLMConfigCreate):
    data = config.model_dump() if hasattr(config, 'model_dump') else config.dict()
    return db.create_llm_config(**data)


@app.put("/api/llm-configs/{config_id}")
async def update_llm_config(config_id: int, config: LLMConfigUpdate):
    data = config.model_dump(exclude_none=True) if hasattr(config, 'model_dump') else config.dict(exclude_none=True)
    result = db.update_llm_config(config_id, **data)
    if not result:
        raise HTTPException(status_code=404, detail="閰嶇疆鏈壘鍒?")
    return result


@app.delete("/api/llm-configs/{config_id}")
async def delete_llm_config(config_id: int):
    success = db.delete_llm_config(config_id)
    if not success:
        raise HTTPException(status_code=404, detail="閰嶇疆鏈壘鍒?")
    return {"message": "宸插垹闄?"}


# ---------- Proxy Configs ----------

@app.get("/api/proxy-configs")
async def get_proxy_configs():
    return db.get_proxy_configs()


@app.post("/api/proxy-configs")
async def create_proxy_config(config: ProxyConfigCreate):
    data = config.model_dump() if hasattr(config, 'model_dump') else config.dict()
    result = db.create_proxy_config(**data)
    return result


@app.put("/api/proxy-configs/{config_id}")
async def update_proxy_config(config_id: int, config: ProxyConfigUpdate):
    data = config.model_dump(exclude_none=True) if hasattr(config, 'model_dump') else config.dict(exclude_none=True)
    result = db.update_proxy_config(config_id, **data)
    if not result:
        raise HTTPException(status_code=404, detail="配置未找到")
    return result


@app.delete("/api/proxy-configs/{config_id}")
async def delete_proxy_config(config_id: int):
    success = db.delete_proxy_config(config_id)
    if not success:
        raise HTTPException(status_code=404, detail="配置未找到")
    return {"message": "已删除"}


# ---------- System Config ----------

@app.get("/api/system-config")
async def get_all_system_configs():
    return db.get_all_system_configs()


@app.get("/api/system-config/{key}")
async def get_system_config(key: str):
    config = db.get_system_config(key)
    if not config:
        raise HTTPException(status_code=404, detail="配置项未找到")
    return config


@app.put("/api/system-config/{key}")
async def update_system_config(key: str, config: SystemConfigUpdate):
    return db.set_system_config(key, config.value)


async def trigger_pywxrobot_other_feature(path: str, feature_name: str, payload: dict):
    """Trigger a pywxrobot /other/* feature endpoint."""
    pywxrobot_url = get_pywxrobot_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{pywxrobot_url}{path}", json=payload)
            payload = {}
            if resp.text:
                try:
                    payload = resp.json()
                except Exception:
                    payload = {"raw": resp.text}

            ret_value = payload.get("ret") if isinstance(payload, dict) else None
            if resp.status_code == 200 and (not payload or ret_value in (0, "0", None)):
                return {"status": "ok", "feature": feature_name, "response": payload}

            raise HTTPException(
                status_code=502,
                detail={
                    "feature": feature_name,
                    "status_code": resp.status_code,
                    "response": payload or resp.text,
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to trigger {feature_name}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail={"feature": feature_name, "error": str(e)})


@app.post("/api/other/dontrevoke")
async def enable_dont_revoke():
    return await trigger_pywxrobot_other_feature("/other/dontrevoke", "dontrevoke", {"revoke": True})


# ---------- Send Test ----------

@app.post("/api/send-test")
async def send_test_message(msg: SendTestMessage):
    """Manually send a WeChat message via pywxrobot (for testing from UI)."""
    pywxrobot_url = get_pywxrobot_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{pywxrobot_url}/send/text",
                json=msg.model_dump() if hasattr(msg, 'model_dump') else msg.dict(),
            )

            # Save outbound message for chat display
            if resp.status_code == 200:
                self_accounts = db.get_self_accounts()
                self_wxid = self_accounts[0]["wxid"] if self_accounts else "self"
                db.save_outbound_message(
                    self_wxid, msg.wxid, msg.content,
                    timestamp=int(time.time() * 1000),
                )

            return {"status": resp.status_code, "response": resp.json() if resp.text else {}}
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=f"无法连接到pywxrobot ({pywxrobot_url})")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Get Logged-in Users (Wx Accounts) ----------

@app.get("/api/wx-accounts")
async def get_wx_accounts():
    """Get all currently logged-in WeChat accounts from pywxrobot."""
    pywxrobot_url = get_pywxrobot_url()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            accounts = await get_logged_in_accounts(client, pywxrobot_url)
            for acc in accounts:
                try:
                    db.upsert_self_account(acc)
                except Exception as e:
                    logger.warning(f"Failed to cache wx account: {e}")
            return accounts
    except Exception as e:
        logger.warning(f"Failed to get wx accounts: {e}")
        return {"error": str(e), "accounts": []}

@app.get("/api/wx-accounts/cached")
async def get_cached_wx_accounts():
    """Get cached WeChat accounts from local database."""
    return db.get_self_accounts()


# ---------- Contacts & Conversations ----------

@app.get("/api/contacts")
async def get_contacts():
    """Get all cached contacts with their info."""
    contacts = db.get_all_contacts()
    return {"contacts": contacts}

@app.get("/api/contacts/{wxid}")
async def get_contact_detail(wxid: str):
    """Get detailed info for a contact from pywxrobot's /user/info."""
    pywxrobot_url = get_pywxrobot_url()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{pywxrobot_url}/user/info",
                json={"wxpid": None, "wxid": wxid},
            )
            if resp.status_code == 200:
                info = resp.json()
                # Extract fields we care about
                return {
                    "wxid": info.get("wxid", wxid),
                    "nick_name": info.get("nick_name", info.get("nickname", "")),
                    "remarks": info.get("remarks", ""),
                    "sex": info.get("sex", 0),
                    "country": info.get("country", ""),
                    "province": info.get("province", ""),
                    "city": info.get("city", ""),
                    "signature": info.get("signature", ""),
                    "avatar": info.get("big_head_url", info.get("small_head_url", "")),
                    "raw": info,
                }
            return {"error": f"HTTP {resp.status_code}"}
    except Exception as e:
        logger.warning(f"Failed to get contact detail: {e}")
        return {"error": str(e)}

@app.put("/api/contacts/cache")
async def cache_contact(data: dict = Body(...)):
    """Manually cache a contact's info."""
    wxid = data.get("wxid", "")
    if not wxid:
        raise HTTPException(status_code=400, detail="wxid required")
    result = db.upsert_contact(wxid, **{k: v for k, v in data.items() if k != "wxid"})
    return result or {"status": "ok"}


# ---------- Conversations (grouped by sender) ----------

@app.get("/api/conversations")
async def get_conversations():
    """Get unique senders/conversations."""
    from_collect = db.get_conversations()
    return {"conversations": from_collect}


@app.post("/api/conversations/read")
async def mark_conversation_read(data: ConversationReadRequest):
    """Mark a conversation as read (reset unread count)."""
    db.mark_conversation_read(data.sender)
    return {"ok": True}


@app.get("/api/messages/by-sender/{sender}")
async def get_messages_by_sender(
    sender: str,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
):
    """Get messages from a specific sender."""
    messages = db.get_messages_by_sender(sender, limit=limit, offset=offset)
    return {"messages": messages, "sender": sender, "count": len(messages)}

@app.delete("/api/messages/by-sender/{sender}")
async def clear_messages_by_sender(sender: str):
    """Clear all messages from a specific sender."""
    deleted = db.clear_messages_by_sender(sender)
    return {"deleted": deleted, "sender": sender}


# ---------- Smart Features: Group Configs ----------

class GroupConfigCreate(BaseModel):
    roomid: str
    name: Optional[str] = None
    enabled: bool = True
    reply_mode: str = "mention"

@app.get("/api/groups")
async def get_group_configs():
    """Get group configs for the current logged-in account."""
    current_wxid = await get_current_wxid()
    return db.get_group_configs(wxid=current_wxid)

@app.post("/api/groups")
async def create_group_config(config: GroupConfigCreate):
    """Create group config for the current logged-in account."""
    current_wxid = await get_current_wxid()
    return db.save_group_config(config.roomid, config.name, config.enabled, config.reply_mode, wxid=current_wxid)

@app.put("/api/groups/{config_id}")
async def update_group_config(config_id: int, config: GroupConfigCreate):
    """Update group config for the current logged-in account."""
    current_wxid = await get_current_wxid()
    cfg = db.get_group_configs(wxid=current_wxid)
    target = next((c for c in cfg if c["id"] == config_id), None)
    if target:
        return db.save_group_config(config.roomid, config.name, config.enabled, config.reply_mode, wxid=current_wxid)
    raise HTTPException(404, "配置未找到")

@app.delete("/api/groups/{config_id}")
async def delete_group_config(config_id: int):
    if db.delete_group_config(config_id):
        return {"message": "已删除"}
    raise HTTPException(404, "配置未找到")


# ---------- Smart Features: Keyword Triggers ----------

class KeywordCreate(BaseModel):
    keyword: str

@app.get("/api/keywords")
async def get_keywords():
    return db.get_keyword_triggers()

@app.post("/api/keywords")
async def create_keyword(config: KeywordCreate):
    result = db.save_keyword_trigger(config.keyword)
    if not result:
        raise HTTPException(400, "关键词已存在")
    return result

@app.delete("/api/keywords/{keyword_id}")
async def delete_keyword(keyword_id: int):
    if db.delete_keyword_trigger(keyword_id):
        return {"message": "已删除"}
    raise HTTPException(404, "关键词未找到")


# ---------- Smart Features: Friend Access (Whitelist) ----------

class FriendAccessCreate(BaseModel):
    wxid: str
    remark: Optional[str] = None

@app.get("/api/friend-access")
async def get_friend_access():
    """Get friend access list for the current logged-in account."""
    current_wxid = await get_current_wxid()
    return db.get_friend_access_list(account_wxid=current_wxid)

@app.post("/api/friend-access")
async def add_friend_access(config: FriendAccessCreate):
    """Add friend to whitelist for the current logged-in account."""
    current_wxid = await get_current_wxid()
    result = db.add_friend_access(config.wxid, config.remark, account_wxid=current_wxid)
    if not result:
        raise HTTPException(400, "该好友已在列表中")
    return result

@app.delete("/api/friend-access/{access_id}")
async def remove_friend_access(access_id: int):
    if db.remove_friend_access(access_id):
        return {"message": "已删除"}
    raise HTTPException(404, "未找到")


# ---------- Smart Features: Context ----------

@app.delete("/api/context/{sender}")
async def clear_context(sender: str):
    if sender == "all":
        db.clear_context()
    else:
        db.clear_context(sender)
    return {"message": "上下文已清空"}

@app.get("/api/context/{sender}")
async def get_context(sender: str):
    return {"context": db.get_context(sender)}


# ---------- Smart Features: Friend Request (Auto-accept) ----------

class FriendRequestProcess(BaseModel):
    v4: str
    wxid: str
    msg: str = ""


@app.post("/api/friend-request")
async def process_friend_request(data: FriendRequestProcess):
    """Trigger auto-accept for a friend request."""
    from backend.auto_reply import process_friend_request as do_accept
    return await do_accept(data.v4, data.wxid, data.msg)


# ---------- Proxy: wx contacts list ----------

@app.get("/api/wx-contacts")
async def get_wx_contacts():
    """Proxy pywxrobot's /user/list to get all contacts with names."""
    pywxrobot_url = get_pywxrobot_url()
    result = []
    try:
        transport = httpx.AsyncHTTPTransport(retries=1)
        async with httpx.AsyncClient(transport=transport, timeout=10.0) as client:
            wxpid = await get_primary_wxpid(client, pywxrobot_url)
            resp = await client.post(f"{pywxrobot_url}/user/list", json={"wxpid": wxpid})
            if resp.status_code == 200:
                contacts = normalize_list_response(resp.json())
                for c in contacts:
                    if isinstance(c, dict):
                        wxid = c.get("wxid") or c.get("userName") or c.get("username") or c.get("UserName")
                        if not is_selectable_friend_wxid(wxid):
                            continue
                        result.append({
                            "wxid": wxid,
                            "nickname": c.get("nickname", "") or c.get("nick_name", "") or c.get("NickName", ""),
                            "remarks": c.get("remarks", "") or c.get("remark", "") or c.get("Remark", ""),
                            "avatar": c.get("big_head_url", "") or c.get("small_head_url", "") or c.get("avatar", ""),
                        })
            error = None if resp.status_code == 200 else f"HTTP {resp.status_code}"
    except Exception as e:
        logger.warning(f"Failed to get wx contacts: {e}")
        error = str(e)

    return {"contacts": result, "error": error if not result else None}


# ---------- Proxy: wx rooms list ----------

@app.get("/api/wx-rooms")
async def get_wx_rooms():
    """Proxy pywxrobot's /room/list to get all group chats with names."""
    pywxrobot_url = get_pywxrobot_url()
    result = []
    try:
        transport = httpx.AsyncHTTPTransport(retries=1)
        async with httpx.AsyncClient(transport=transport, timeout=10.0) as client:
            wxpid = await get_primary_wxpid(client, pywxrobot_url)
            resp = await client.post(f"{pywxrobot_url}/room/list", json={"wxpid": wxpid})
            if resp.status_code == 200:
                rooms = normalize_list_response(resp.json())
                for r in rooms:
                    if isinstance(r, dict):
                        roomid = r.get("wxid") or r.get("roomid") or r.get("userName") or r.get("username")
                        if not roomid:
                            continue
                        result.append({
                            "roomid": roomid,
                            "name": r.get("nickname", r.get("nick_name", "")) or r.get("name", "") or r.get("NickName", ""),
                            "member_count": r.get("member_count", 0),
                        })
            error = None if resp.status_code == 200 else f"HTTP {resp.status_code}"
    except Exception as e:
        logger.warning(f"Failed to get wx rooms: {e}")
        error = str(e)

    return {"rooms": result, "error": error if not result else None}


# ============ Static File Serving ============

# Determine the frontend dist directory
if getattr(sys, "frozen", False):
    # BASE_DIR = Path(sys.executable).parent
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).resolve().parent.parent

# FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
FRONTEND_DIR = BASE_DIR / "frontend" / "dist"


def mount_frontend_static():
    if FRONTEND_DIR.exists() and not any(route.name == "static" for route in app.routes):
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
        logger.info(f"Serving static files from {FRONTEND_DIR}")
    elif not FRONTEND_DIR.exists():
        logger.warning(f"Frontend dist not found at {FRONTEND_DIR}. Run 'cd frontend && npm run build' to build.")


# Static serving is mounted during FastAPI startup, not at import time. This
# keeps module-level database checks stable on Windows when SQLite has a journal.


# ============ Entry Point ============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.host, port=settings.port, reload=True)
    # uvicorn.run(app, host=settings.host, port=settings.port, reload=False)
