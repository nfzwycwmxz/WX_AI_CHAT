import logging
from typing import Any, Dict, List, Optional

import httpx

from backend.config import get_pywxrobot_url

logger = logging.getLogger(__name__)


def _extract_first(mapping: Dict, keys: List[str]) -> Optional[str]:
    for key in keys:
        value = mapping.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _extract_int(mapping: Dict, keys: List[str]) -> Optional[int]:
    for key in keys:
        value = mapping.get(key)
        if value is None or value == "":
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return None


def extract_account_identity(account: Dict) -> Dict[str, Optional[str]]:
    """Best-effort extraction of wxid/wxpid from a pywxrobot account payload."""
    wxid = _extract_first(
        account,
        [
            "wxid",
            "wx_id",
            "wxId",
            "WxId",
            "userName",
            "username",
            "UserName",
            "account",
            "id",
        ],
    )
    wxpid = _extract_int(account, ["wxpid", "wx_pid", "wxPid", "WxPid", "pid", "Pid"])
    return {"wxid": wxid, "wxpid": wxpid}


def normalize_list_response(payload: Any) -> List[Dict]:
    """Normalize pywxrobot list-style responses into a plain list."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "list", "lists", "contacts", "rooms", "friends", "users", "accounts", "items", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                nested = normalize_list_response(value)
                if nested:
                    return nested
    return []


async def get_logged_in_accounts(
    client: Optional[httpx.AsyncClient] = None,
    pywxrobot_url: Optional[str] = None,
) -> List[Dict]:
    """Fetch the currently logged-in WeChat accounts from pywxrobot."""
    close_client = client is None
    pywxrobot_url = pywxrobot_url or get_pywxrobot_url()
    http_client = client or httpx.AsyncClient(timeout=5.0)
    try:
        attempts = [
            ("get", f"{pywxrobot_url}/getusers", None),
            ("post", f"{pywxrobot_url}/user/list", {"wxpid": None}),
        ]
        for method, url, payload in attempts:
            try:
                resp = await http_client.get(url) if method == "get" else await http_client.post(url, json=payload)
                if resp.status_code != 200:
                    continue
                items = [item for item in normalize_list_response(resp.json()) if isinstance(item, dict)]
                if items:
                    return items
            except Exception:
                continue
        return []
    except Exception as e:
        logger.warning(f"Failed to fetch logged-in accounts: {e}")
        return []
    finally:
        if close_client:
            await http_client.aclose()


async def get_current_account(
    client: Optional[httpx.AsyncClient] = None,
    pywxrobot_url: Optional[str] = None,
) -> Optional[Dict]:
    """Return the first logged-in account, which is the active local account."""
    accounts = await get_logged_in_accounts(client=client, pywxrobot_url=pywxrobot_url)
    for account in accounts:
        identity = extract_account_identity(account)
        wxid = identity["wxid"]
        if wxid:
            account["wxid"] = wxid
            if identity["wxpid"] is not None:
                account["wxpid"] = identity["wxpid"]
            return account

    try:
        from backend.database import db

        cached = db.get_self_accounts()
        if cached:
            return cached[0]
    except Exception:
        pass
    return None


async def get_current_wxid(
    client: Optional[httpx.AsyncClient] = None,
    pywxrobot_url: Optional[str] = None,
) -> Optional[str]:
    account = await get_current_account(client=client, pywxrobot_url=pywxrobot_url)
    return account.get("wxid") if account else None


async def get_primary_wxpid(
    client: httpx.AsyncClient,
    pywxrobot_url: Optional[str] = None,
) -> Optional[int]:
    """Get the first logged-in wxpid from pywxrobot."""
    accounts = await get_logged_in_accounts(client=client, pywxrobot_url=pywxrobot_url)
    for account in accounts:
        wxpid = extract_account_identity(account)["wxpid"]
        if wxpid is not None:
            return wxpid
    try:
        from backend.database import db

        cached = db.get_self_accounts()
        for account in cached:
            wxpid = extract_account_identity(account)["wxpid"]
            if wxpid is not None:
                return wxpid
    except Exception:
        pass
    return None
