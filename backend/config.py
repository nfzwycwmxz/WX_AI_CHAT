import socket
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8080

    # pywxrobot
    pywxrobot_url: str = "http://127.0.0.1:23235"

    # Database
    db_path: str = "./data/vx_chat.db"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()


def get_pywxrobot_url() -> str:
    """Return the pywxrobot URL, allowing the UI saved exe_port to override it."""
    try:
        from backend.database import db

        port_config = db.get_system_config("exe_port")
        if port_config and port_config.get("key_value"):
            port = str(port_config["key_value"]).strip()
            if port.isdigit():
                return f"http://127.0.0.1:{port}"
    except Exception:
        pass
    return settings.pywxrobot_url.rstrip("/")


def get_local_ip() -> str:
    """Get the local network IP address for the webhook URL display."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip
