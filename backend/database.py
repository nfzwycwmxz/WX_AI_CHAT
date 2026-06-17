import sqlite3
from datetime import datetime
from typing import List, Optional, Dict
from pathlib import Path


class Database:
    """SQLite database for VX智能AI"""

    def __init__(self, db_path: str = "./data/vx_chat.db"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        db_exists = Path(db_path).exists()
        if db_exists:
            # Run any pending migrations on existing database
            try:
                self._run_migrations()
            except Exception:
                pass  # Non-critical; table creation will be retried on use
            return
        try:
            self._init_db()
        except sqlite3.OperationalError as e:
            if db_exists and "disk I/O error" in str(e):
                # The existing DB can still be readable while another process keeps
                # a journal/write lock. Let the app start and retry normal reads later.
                return
            raise

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout = 10000")
        except sqlite3.Error:
            pass
        return conn

    def _table_sql(self, conn, table_name: str) -> str:
        cursor = conn.cursor()
        cursor.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table_name,))
        row = cursor.fetchone()
        return row["sql"] if row and row["sql"] else ""

    def _rebuild_group_configs(self, conn):
        cursor = conn.cursor()
        cursor.execute("ALTER TABLE group_configs RENAME TO group_configs_legacy")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                roomid TEXT NOT NULL,
                wxid TEXT,
                name TEXT,
                enabled BOOLEAN DEFAULT 1,
                reply_mode TEXT DEFAULT 'mention',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(roomid, wxid)
            )
        """)
        cursor.execute("""
            INSERT INTO group_configs (id, roomid, wxid, name, enabled, reply_mode, created_at, updated_at)
            SELECT id, roomid, COALESCE(wxid, ''), name, enabled, reply_mode, created_at, CURRENT_TIMESTAMP
            FROM group_configs_legacy
        """)
        cursor.execute("DROP TABLE group_configs_legacy")

    def _rebuild_friend_access(self, conn):
        cursor = conn.cursor()
        cursor.execute("ALTER TABLE friend_access RENAME TO friend_access_legacy")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS friend_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wxid TEXT NOT NULL,
                remark TEXT,
                account_wxid TEXT,
                access_type TEXT NOT NULL DEFAULT 'whitelist',
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(wxid, account_wxid, access_type)
            )
        """)
        cursor.execute("""
            INSERT INTO friend_access (id, wxid, remark, account_wxid, access_type, is_active, created_at, updated_at)
            SELECT id, wxid, remark, COALESCE(account_wxid, ''), access_type, is_active, created_at, CURRENT_TIMESTAMP
            FROM friend_access_legacy
        """)
        cursor.execute("DROP TABLE friend_access_legacy")

    def _ensure_scope_migrations(self, conn):
        cursor = conn.cursor()
        group_sql = self._table_sql(conn, "group_configs")
        if "UNIQUE(roomid,wxid)" not in group_sql.replace(" ", ""):
            self._rebuild_group_configs(conn)
        friend_sql = self._table_sql(conn, "friend_access")
        if "UNIQUE(wxid,account_wxid,access_type)" not in friend_sql.replace(" ", ""):
            self._rebuild_friend_access(conn)
        cursor.execute("PRAGMA table_info(group_configs)")
        group_cols = {row["name"] for row in cursor.fetchall()}
        if "wxid" not in group_cols:
            try:
                cursor.execute("ALTER TABLE group_configs ADD COLUMN wxid TEXT")
            except sqlite3.OperationalError:
                pass
        cursor.execute("PRAGMA table_info(friend_access)")
        friend_cols = {row["name"] for row in cursor.fetchall()}
        if "account_wxid" not in friend_cols:
            try:
                cursor.execute("ALTER TABLE friend_access ADD COLUMN account_wxid TEXT")
            except sqlite3.OperationalError:
                pass
        conn.commit()

    def _ensure_message_name_columns(self, conn):
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(messages)")
        cols = {row["name"] for row in cursor.fetchall()}
        if "username" not in cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN username TEXT")
        if "nick_name" not in cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN nick_name TEXT")
            conn.commit()

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wxpid INTEGER,
                local_type INTEGER,
                msg_type INTEGER,
                sender TEXT NOT NULL,
                recipient TEXT,
                room_sender TEXT,
                username TEXT,
                nick_name TEXT,
                voice TEXT,
                msgid TEXT UNIQUE,
                content TEXT,
                timestamp BIGINT,
                msgsource TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reply_content TEXT,
                reply_status TEXT DEFAULT 'pending',
                reply_error TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS kb_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'zhipu',
                api_key TEXT,
                api_secret TEXT,
                api_url TEXT,
                kb_id TEXT,
                model TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS llm_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'zhipu',
                api_key TEXT,
                api_secret TEXT,
                api_url TEXT,
                model TEXT,
                app_id TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wxid TEXT NOT NULL UNIQUE,
                nickname TEXT,
                remarks TEXT,
                avatar TEXT,
                sex INTEGER DEFAULT 0,
                country TEXT,
                province TEXT,
                city TEXT,
                signature TEXT,
                wxpid INTEGER,
                is_self BOOLEAN DEFAULT 0,
                last_msg_time BIGINT DEFAULT 0,
                last_msg_content TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS self_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wxid TEXT NOT NULL UNIQUE,
                nickname TEXT,
                wxh TEXT,
                phone TEXT,
                pid INTEGER,
                signature TEXT,
                city TEXT,
                province TEXT,
                country TEXT,
                avatar TEXT,
                wxpid INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS proxy_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                proxy_url TEXT NOT NULL,
                proxy_username TEXT,
                proxy_password TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_name TEXT NOT NULL UNIQUE,
                key_value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # ===== Smart features tables =====

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                roomid TEXT NOT NULL UNIQUE,
                name TEXT,
                enabled BOOLEAN DEFAULT 1,
                reply_mode TEXT DEFAULT 'mention',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS keyword_triggers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                keyword TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS friend_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wxid TEXT NOT NULL UNIQUE,
                remark TEXT,
                access_type TEXT NOT NULL DEFAULT 'whitelist',
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversation_contexts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                account_wxid TEXT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                msgid TEXT,
                timestamp BIGINT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversation_read_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL UNIQUE,
                last_read_time BIGINT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: add api_secret column to kb_configs if missing
        try:
            cursor.execute("ALTER TABLE kb_configs ADD COLUMN api_secret TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Migration: add app_id column to kb_configs if missing
        try:
            cursor.execute("ALTER TABLE kb_configs ADD COLUMN app_id TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Migration: add llm_configs table/columns for default chat models
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS llm_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'zhipu',
                api_key TEXT,
                api_secret TEXT,
                api_url TEXT,
                model TEXT,
                app_id TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        try:
            cursor.execute("ALTER TABLE conversation_contexts ADD COLUMN account_wxid TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists

        self._ensure_message_name_columns(conn)
        self._ensure_scope_migrations(conn)

        conn.commit()
        conn.close()

    def _run_migrations(self):
        """Run any pending schema migrations on an existing database."""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS conversation_read_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender TEXT NOT NULL UNIQUE,
                    last_read_time BIGINT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Migration: add wxid column to group_configs if missing
            try:
                cursor.execute("ALTER TABLE group_configs ADD COLUMN wxid TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # Migration: add account_wxid column to friend_access if missing
            try:
                cursor.execute("ALTER TABLE friend_access ADD COLUMN account_wxid TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists

            try:
                cursor.execute("ALTER TABLE conversation_contexts ADD COLUMN account_wxid TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists

            try:
                cursor.execute("ALTER TABLE messages ADD COLUMN username TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists
            self._ensure_message_name_columns(conn)

            self._ensure_scope_migrations(conn)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS llm_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    provider TEXT NOT NULL DEFAULT 'zhipu',
                    api_key TEXT,
                    api_secret TEXT,
                    api_url TEXT,
                    model TEXT,
                    app_id TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.commit()
        finally:
            conn.close()

    # ============ Messages ============

    def save_message(self, data: dict) -> Optional[Dict]:
        """Save an incoming message (from contact to user)."""
        username = (
            data.get("username")
            or data.get("userName")
            or data.get("UserName")
            or data.get("user_name")
            or data.get("room_username")
        )
        nick_name = data.get("nick_name") or data.get("nickname") or data.get("NickName")
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            self._ensure_message_name_columns(conn)
            cursor.execute("""
                INSERT INTO messages (wxpid, local_type, msg_type, sender, recipient,
                                      room_sender, username, nick_name, voice, msgid, content, timestamp, msgsource)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                data.get("wxpid"),
                data.get("local_type"),
                data.get("msg_type"),
                data.get("sender", ""),
                data.get("recipient"),
                data.get("room_sender"),
                username,
                nick_name,
                data.get("voice"),
                data.get("msgid"),
                data.get("content"),
                data.get("timestamp"),
                data.get("msgsource"),
            ))
            conn.commit()
            new_id = cursor.lastrowid
            cursor.execute("SELECT * FROM messages WHERE id = ?", (new_id,))
            row = cursor.fetchone()
            conn.close()

            # Auto-update contact last_msg
            sender = data.get("sender", "")
            if sender:
                self.upsert_contact(
                    sender,
                    wxpid=data.get("wxpid"),
                    last_msg_time=data.get("timestamp", int(datetime.now().timestamp() * 1000)),
                    last_msg_content=data.get("content", ""),
                )

            return dict(row) if row else None
        except sqlite3.IntegrityError:
            conn.close()
            sender = data.get("sender", "")
            if sender:
                self.upsert_contact(
                    sender,
                    last_msg_time=data.get("timestamp", int(datetime.now().timestamp() * 1000)),
                    last_msg_content=data.get("content", ""),
                )
            return self.get_message(data.get("msgid", ""))

    def save_outbound_message(self, sender: str, recipient: str, content: str,
                              msgid: str = None, timestamp: int = None,
                              reply_status: str = "sent") -> Optional[Dict]:
        """Save an outbound message (sent by the logged-in user to a contact).

        This is used to display sent messages in the chat UI.
        """
        if not msgid:
            msgid = f"outbound_{int(datetime.now().timestamp() * 1000000)}"
        if not timestamp:
            timestamp = int(datetime.now().timestamp() * 1000)

        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO messages (wxpid, local_type, msg_type, sender, recipient,
                                      room_sender, msgid, content, timestamp, reply_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                None,        # wxpid
                2,           # local_type=2 for outbound
                1,           # msg_type=1 for text
                sender,      # sender = our wxid (self)
                recipient,   # recipient = friend's wxid
                None,        # room_sender
                msgid,
                content,
                timestamp,
                reply_status,
            ))
            conn.commit()
            new_id = cursor.lastrowid
            cursor.execute("SELECT * FROM messages WHERE id = ?", (new_id,))
            row = cursor.fetchone()
            conn.close()
            return dict(row) if row else None
        except sqlite3.IntegrityError:
            conn.close()
            return None

    def get_message(self, msgid: str) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM messages WHERE msgid = ?", (msgid,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_messages(self, limit: int = 50, offset: int = 0) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM messages ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?",
            (limit, offset)
        )
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def update_message_reply(self, msgid: str, reply_content: str = None,
                             status: str = None, error: str = None) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        updates = []
        params = []
        if reply_content is not None:
            updates.append("reply_content = ?")
            params.append(reply_content)
        if status is not None:
            updates.append("reply_status = ?")
            params.append(status)
        if error is not None:
            updates.append("reply_error = ?")
            params.append(error)
        if not updates:
            conn.close()
            return self.get_message(msgid)
        params.append(msgid)
        cursor.execute(
            f"UPDATE messages SET {', '.join(updates)} WHERE msgid = ?",
            params
        )
        conn.commit()
        conn.close()
        return self.get_message(msgid)

    def get_message_stats(self) -> Dict:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as total FROM messages")
        total = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as total FROM messages WHERE reply_status = 'sent'")
        replied = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as total FROM messages WHERE reply_status = 'failed'")
        failed = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as total FROM messages WHERE reply_status = 'pending'")
        pending = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as total FROM messages WHERE reply_status = 'skipped'")
        skipped = cursor.fetchone()["total"]
        conn.close()
        return {
            "total": total,
            "replied": replied,
            "failed": failed,
            "pending": pending,
            "skipped": skipped,
        }

    def get_messages_by_sender(self, sender: str, limit: int = 50, offset: int = 0) -> List[Dict]:
        """Get messages from a specific sender, ordered by time.

        Gets messages where the sender matches (inbound from friend),
        or where the recipient matches (outbound to friend).
        Also includes messages where sender is self and recipient is the contact.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT * FROM messages
               WHERE sender = ? OR recipient = ?
               ORDER BY timestamp ASC, id ASC
               LIMIT ? OFFSET ?""",
            (sender, sender, limit, offset)
        )
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_conversations(self) -> List[Dict]:
        """Get all contacts with message counts (both inbound and outbound).

        For the contact list: groups by the other party (not self),
        counting messages sent BY them AND messages sent TO them.
        """
        self_accounts = self.get_self_accounts()
        self_wxid = self_accounts[0]["wxid"] if self_accounts else None

        conn = self._get_connection()
        cursor = conn.cursor()

        if self_wxid:
            cursor.execute("""
                SELECT contact, COUNT(*) as msg_count, MAX(ts) as last_time
                FROM (
                    SELECT
                        CASE WHEN sender = ? THEN recipient ELSE sender END as contact,
                        timestamp as ts, content
                    FROM messages
                    WHERE sender != ? AND recipient IS NOT NULL
                      AND recipient != ''
                )
                WHERE contact IS NOT NULL AND contact != ''
                GROUP BY contact
                ORDER BY last_time DESC
            """, (self_wxid, self_wxid))
        else:
            cursor.execute("""
                SELECT sender as contact, COUNT(*) as msg_count,
                       MAX(timestamp) as last_time
                FROM messages
                WHERE sender IS NOT NULL AND sender != ''
                GROUP BY sender
                ORDER BY last_time DESC
            """)
        rows = cursor.fetchall()

        # Fetch all read states for unread counting
        read_states = {}
        try:
            cursor.execute("SELECT sender, last_read_time FROM conversation_read_state")
            for rs in cursor.fetchall():
                read_states[rs["sender"]] = rs["last_read_time"]
        except Exception:
            pass  # Table might not exist yet on first run

        # Get last content for each contact
        result = []
        for r in rows:
            contact = r["contact"]

            # Last message content
            cursor.execute(
                "SELECT content, msg_type FROM messages WHERE (sender = ? OR recipient = ?) "
                "AND content IS NOT NULL AND content != '' "
                "ORDER BY timestamp DESC LIMIT 1",
                (contact, contact)
            )
            last = cursor.fetchone()

            # Unread count: messages FROM this contact after last_read_time
            last_read = read_states.get(contact, 0)
            if last_read:
                cursor.execute(
                    "SELECT COUNT(*) as cnt FROM messages WHERE sender = ? AND timestamp > ?",
                    (contact, last_read)
                )
                unread = cursor.fetchone()["cnt"]
            else:
                unread = 0

            result.append({
                "sender": contact,
                "msg_count": r["msg_count"],
                "last_time": r["last_time"],
                "last_content": last["content"] if last else None,
                "last_msg_type": last["msg_type"] if last else None,
                "unread_count": unread,
            })

        conn.close()
        return result

    def clear_messages_by_sender(self, sender: str) -> int:
        """Delete all messages related to a specific contact.
        Deletes both messages FROM the contact (sender = ?)
        and messages TO the contact (recipient = ?)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages WHERE sender = ? OR recipient = ?", (sender, sender))
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        return affected

    def mark_conversation_read(self, sender: str) -> None:
        """Mark a conversation as read by updating last_read_time to now."""
        now = int(datetime.now().timestamp() * 1000)
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO conversation_read_state (sender, last_read_time, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(sender) DO UPDATE SET
                last_read_time = excluded.last_read_time,
                updated_at = CURRENT_TIMESTAMP
        """, (sender, now))
        conn.commit()
        conn.close()

    def get_conversation_read_state(self, sender: str) -> int:
        """Get the last_read_time for a conversation, or 0 if never read."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT last_read_time FROM conversation_read_state WHERE sender = ?", (sender,))
        row = cursor.fetchone()
        conn.close()
        return row["last_read_time"] if row else 0

    def clear_all_messages(self) -> int:
        """Delete ALL messages from the database. Returns deleted count."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages")
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        return affected

    # ============ Knowledge Base Configs ============

    def create_kb_config(self, name: str, provider: str = "zhipu",
                         api_key: str = None, api_secret: str = None, api_url: str = None,
                         kb_id: str = None, model: str = None, app_id: str = None) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO kb_configs (name, provider, api_key, api_secret, api_url, kb_id, model, app_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (name, provider, api_key, api_secret, api_url, kb_id, model, app_id))
        conn.commit()
        new_id = cursor.lastrowid
        cursor.execute("SELECT * FROM kb_configs WHERE id = ?", (new_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_kb_config(self, config_id: int) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM kb_configs WHERE id = ?", (config_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_kb_configs(self) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM kb_configs ORDER BY created_at DESC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def update_kb_config(self, config_id: int, **kwargs) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        updates = []
        params = []
        for field in ["name", "provider", "api_key", "api_secret", "api_url", "kb_id", "model", "app_id", "is_active"]:
            if field in kwargs and kwargs[field] is not None:
                updates.append(f"{field} = ?")
                params.append(kwargs[field])
        if not updates:
            conn.close()
            return self.get_kb_config(config_id)
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(config_id)
        cursor.execute(
            f"UPDATE kb_configs SET {', '.join(updates)} WHERE id = ?",
            params
        )
        conn.commit()
        conn.close()
        return self.get_kb_config(config_id)

    def delete_kb_config(self, config_id: int) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM kb_configs WHERE id = ?", (config_id,))
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        return affected > 0

    def get_active_kb_config(self) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM kb_configs WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1"
        )
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    # ============ Default LLM Configs ============

    def create_llm_config(self, name: str, provider: str = "zhipu",
                          api_key: str = None, api_secret: str = None, api_url: str = None,
                          model: str = None, app_id: str = None) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO llm_configs (name, provider, api_key, api_secret, api_url, model, app_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (name, provider, api_key, api_secret, api_url, model, app_id))
        conn.commit()
        new_id = cursor.lastrowid
        cursor.execute("SELECT * FROM llm_configs WHERE id = ?", (new_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_llm_config(self, config_id: int) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM llm_configs WHERE id = ?", (config_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_llm_configs(self) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM llm_configs ORDER BY created_at DESC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def update_llm_config(self, config_id: int, **kwargs) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        updates = []
        params = []
        for field in ["name", "provider", "api_key", "api_secret", "api_url", "model", "app_id", "is_active"]:
            if field in kwargs and kwargs[field] is not None:
                updates.append(f"{field} = ?")
                params.append(kwargs[field])
        if not updates:
            conn.close()
            return self.get_llm_config(config_id)
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(config_id)
        cursor.execute(
            f"UPDATE llm_configs SET {', '.join(updates)} WHERE id = ?",
            params
        )
        conn.commit()
        conn.close()
        return self.get_llm_config(config_id)

    def delete_llm_config(self, config_id: int) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM llm_configs WHERE id = ?", (config_id,))
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        return affected > 0

    def get_active_llm_config(self) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM llm_configs WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1"
        )
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    # ============ Proxy Configs ============

    def create_proxy_config(self, proxy_url: str, proxy_username: str = None,
                            proxy_password: str = None) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO proxy_configs (proxy_url, proxy_username, proxy_password)
            VALUES (?, ?, ?)
        """, (proxy_url, proxy_username, proxy_password))
        conn.commit()
        new_id = cursor.lastrowid
        cursor.execute("SELECT * FROM proxy_configs WHERE id = ?", (new_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_proxy_configs(self) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM proxy_configs ORDER BY created_at DESC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_proxy_config(self, config_id: int) -> Optional[Dict]:
        """Get a single proxy config by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM proxy_configs WHERE id = ?", (config_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_active_proxy_config(self) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM proxy_configs WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1"
        )
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def update_proxy_config(self, config_id: int, **kwargs) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        updates = []
        params = []
        for field in ["proxy_url", "proxy_username", "proxy_password", "is_active"]:
            if field in kwargs and kwargs[field] is not None:
                updates.append(f"{field} = ?")
                params.append(kwargs[field])
        if not updates:
            conn.close()
            return self.get_proxy_config(config_id)
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(config_id)
        cursor.execute(
            f"UPDATE proxy_configs SET {', '.join(updates)} WHERE id = ?",
            params
        )
        conn.commit()
        conn.close()
        return self.get_proxy_config(config_id)

    def delete_proxy_config(self, config_id: int) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM proxy_configs WHERE id = ?", (config_id,))
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        return affected > 0

    # ============ System Config ============

    def set_system_config(self, key: str, value: str) -> Dict:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO system_config (key_name, key_value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key_name) DO UPDATE SET
                key_value = excluded.key_value,
                updated_at = CURRENT_TIMESTAMP
        """, (key, value))
        conn.commit()
        conn.close()
        return {"key_name": key, "key_value": value}

    def get_system_config(self, key: str) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM system_config WHERE key_name = ?", (key,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_all_system_configs(self) -> Dict[str, str]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM system_config")
        rows = cursor.fetchall()
        conn.close()
        return {r["key_name"]: r["key_value"] for r in rows}


# ============ Contacts (好友缓存) ============

    def upsert_contact(self, wxid: str, **kwargs) -> Optional[Dict]:
        """Insert or update a contact."""
        conn = self._get_connection()
        cursor = conn.cursor()
        # Check if exists
        cursor.execute("SELECT * FROM contacts WHERE wxid = ?", (wxid,))
        existing = cursor.fetchone()

        if existing:
            updates = ["updated_at = CURRENT_TIMESTAMP"]
            params = []
            for field in ["nickname", "remarks", "avatar", "sex", "country",
                          "province", "city", "signature", "wxpid", "last_msg_content"]:
                if field in kwargs and kwargs[field] is not None:
                    updates.append(f"{field} = ?")
                    params.append(kwargs[field])
            if "last_msg_time" in kwargs and kwargs["last_msg_time"] is not None:
                updates.append("last_msg_time = MAX(last_msg_time, ?)")
                params.append(kwargs["last_msg_time"])
            if not updates:
                conn.close()
                return self.get_contact(wxid)
            params.append(wxid)
            cursor.execute(
                f"UPDATE contacts SET {', '.join(updates)} WHERE wxid = ?",
                params
            )
        else:
            cursor.execute("""
                INSERT INTO contacts (wxid, nickname, remarks, avatar, sex, country,
                                      province, city, signature, wxpid)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                wxid,
                kwargs.get("nickname"),
                kwargs.get("remarks"),
                kwargs.get("avatar"),
                kwargs.get("sex", 0),
                kwargs.get("country"),
                kwargs.get("province"),
                kwargs.get("city"),
                kwargs.get("signature"),
                kwargs.get("wxpid"),
            ))
        conn.commit()
        conn.close()
        return self.get_contact(wxid)

    def get_contact(self, wxid: str) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM contacts WHERE wxid = ?", (wxid,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_all_contacts(self) -> List[Dict]:
        """Get all contacts with their last message info, ordered."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM contacts
            ORDER BY last_msg_time DESC, updated_at DESC
        """)
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def delete_contact(self, wxid: str) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM contacts WHERE wxid = ?", (wxid,))
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        return affected > 0

    # ============ Self Accounts (登录用户) ============

    def upsert_self_account(self, data: dict) -> Optional[Dict]:
        """Insert or update a logged-in WeChat account."""
        wxid = data.get("wxid", "")
        if not wxid:
            return None
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO self_accounts (wxid, nickname, wxh, phone, pid, signature,
                                       city, province, country, wxpid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(wxid) DO UPDATE SET
                nickname = excluded.nickname,
                wxh = excluded.wxh,
                phone = excluded.phone,
                pid = excluded.pid,
                signature = excluded.signature,
                city = excluded.city,
                province = excluded.province,
                country = excluded.country,
                wxpid = excluded.wxpid,
                updated_at = CURRENT_TIMESTAMP
        """, (
            wxid,
            data.get("nickname"),
            data.get("wxh"),
            data.get("phone"),
            data.get("pid"),
            data.get("signature"),
            data.get("city"),
            data.get("province"),
            data.get("country"),
            data.get("wxpid"),
        ))
        conn.commit()
        cursor.execute("SELECT * FROM self_accounts WHERE wxid = ?", (wxid,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def get_self_accounts(self) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM self_accounts ORDER BY updated_at DESC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]


# ============ Smart Features: Groups, Keywords, Friend Access, Context ============

    # ---- Group Configs ----
    def get_group_configs(self, wxid: str = None) -> List[Dict]:
        """Get group configs, optionally filtered by account wxid."""
        conn = self._get_connection(); cursor = conn.cursor()
        wxid = wxid or ""
        if wxid:
            cursor.execute(
                "SELECT * FROM group_configs WHERE wxid = ? OR wxid IS NULL OR wxid = '' ORDER BY CASE WHEN wxid = ? THEN 0 ELSE 1 END, created_at DESC",
                (wxid, wxid),
            )
        else:
            cursor.execute("SELECT * FROM group_configs WHERE wxid IS NULL OR wxid = '' ORDER BY created_at DESC")
        rows = cursor.fetchall(); conn.close(); return [dict(r) for r in rows]

    def save_group_config(self, roomid: str, name: str = None,
                          enabled: bool = True, reply_mode: str = "mention", wxid: str = None) -> Optional[Dict]:
        conn = self._get_connection(); cursor = conn.cursor()
        wxid = wxid or ""
        cursor.execute("""
            INSERT INTO group_configs (roomid, wxid, name, enabled, reply_mode)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(roomid, wxid) DO UPDATE SET
                name=excluded.name, enabled=excluded.enabled,
                reply_mode=excluded.reply_mode, updated_at=CURRENT_TIMESTAMP
        """, (roomid, wxid, name or roomid, int(enabled), reply_mode))
        conn.commit()
        cursor.execute("SELECT * FROM group_configs WHERE roomid = ? AND wxid = ?", (roomid, wxid))
        row = cursor.fetchone(); conn.close(); return dict(row) if row else None

    def delete_group_config(self, config_id: int) -> bool:
        conn = self._get_connection(); cursor = conn.cursor()
        cursor.execute("DELETE FROM group_configs WHERE id = ?", (config_id,))
        affected = cursor.rowcount; conn.commit(); conn.close(); return affected > 0

    def is_group_enabled(self, roomid: str, account_wxid: str = None) -> Optional[str]:
        """Check if group is enabled for the current account, return reply_mode or None."""
        conn = self._get_connection(); cursor = conn.cursor()
        account_wxid = account_wxid or ""
        if account_wxid:
            cursor.execute(
                "SELECT reply_mode FROM group_configs WHERE roomid = ? AND enabled = 1 AND (wxid = ? OR wxid IS NULL OR wxid = '') ORDER BY CASE WHEN wxid = ? THEN 0 ELSE 1 END LIMIT 1",
                (roomid, account_wxid, account_wxid),
            )
        else:
            cursor.execute("SELECT reply_mode FROM group_configs WHERE roomid = ? AND enabled = 1 AND (wxid IS NULL OR wxid = '')", (roomid,))
        row = cursor.fetchone(); conn.close()
        return row["reply_mode"] if row else None

    # ---- Keyword Triggers ----
    def get_keyword_triggers(self) -> List[Dict]:
        conn = self._get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT * FROM keyword_triggers WHERE is_active = 1 ORDER BY created_at")
        rows = cursor.fetchall(); conn.close(); return [dict(r) for r in rows]

    def save_keyword_trigger(self, keyword: str) -> Optional[Dict]:
        conn = self._get_connection(); cursor = conn.cursor()
        try:
            cursor.execute("INSERT INTO keyword_triggers (keyword) VALUES (?)", (keyword,))
            conn.commit()
            cursor.execute("SELECT * FROM keyword_triggers WHERE id = ?", (cursor.lastrowid,))
            row = cursor.fetchone(); conn.close(); return dict(row) if row else None
        except sqlite3.IntegrityError:
            conn.close(); return None  # Duplicate keyword
        except Exception:
            conn.close(); return None

    def delete_keyword_trigger(self, trigger_id: int) -> bool:
        conn = self._get_connection(); cursor = conn.cursor()
        cursor.execute("DELETE FROM keyword_triggers WHERE id = ?", (trigger_id,))
        affected = cursor.rowcount; conn.commit(); conn.close(); return affected > 0

    def check_keyword_match(self, text: str) -> bool:
        """Check if text matches any active keyword trigger."""
        conn = self._get_connection(); cursor = conn.cursor()
        cursor.execute("SELECT keyword FROM keyword_triggers WHERE is_active = 1")
        rows = cursor.fetchall(); conn.close()
        for r in rows:
            if r["keyword"].lower() in text.lower():
                return True
        return False

    # ---- Friend Access (whitelist) ----
    def get_friend_access_list(self, account_wxid: str = None) -> List[Dict]:
        """Get friend access list, optionally filtered by account wxid."""
        conn = self._get_connection(); cursor = conn.cursor()
        account_wxid = account_wxid or ""
        if account_wxid:
            cursor.execute(
                "SELECT * FROM friend_access WHERE access_type = 'whitelist' AND (account_wxid = ? OR account_wxid IS NULL OR account_wxid = '') ORDER BY CASE WHEN account_wxid = ? THEN 0 ELSE 1 END, created_at DESC",
                (account_wxid, account_wxid),
            )
        else:
            cursor.execute("SELECT * FROM friend_access WHERE access_type = 'whitelist' AND (account_wxid IS NULL OR account_wxid = '') ORDER BY created_at DESC")
        rows = cursor.fetchall(); conn.close(); return [dict(r) for r in rows]

    def add_friend_access(self, friend_wxid: str, remark: str = None, account_wxid: str = None) -> Optional[Dict]:
        conn = self._get_connection(); cursor = conn.cursor()
        account_wxid = account_wxid or ""
        try:
            cursor.execute("""
                INSERT INTO friend_access (wxid, remark, account_wxid, access_type)
                VALUES (?, ?, ?, 'whitelist')
                ON CONFLICT(wxid, account_wxid, access_type) DO UPDATE SET
                    remark = excluded.remark,
                    is_active = 1,
                    updated_at = CURRENT_TIMESTAMP
            """, (friend_wxid, remark or friend_wxid, account_wxid))
            conn.commit()
            cursor.execute("SELECT * FROM friend_access WHERE wxid = ? AND account_wxid = ? AND access_type = 'whitelist'", (friend_wxid, account_wxid))
            row = cursor.fetchone(); conn.close(); return dict(row) if row else None
        except sqlite3.IntegrityError:
            conn.close(); return None
        except Exception:
            conn.close(); return None

    def remove_friend_access(self, access_id: int) -> bool:
        conn = self._get_connection(); cursor = conn.cursor()
        cursor.execute("DELETE FROM friend_access WHERE id = ?", (access_id,))
        affected = cursor.rowcount; conn.commit(); conn.close(); return affected > 0

    def is_friend_allowed(self, friend_wxid: str, account_wxid: str = None) -> bool:
        """Check if a friend wxid is in the whitelist for the current account (if whitelist mode is on)."""
        mode = self.get_system_config("reply_mode")
        if mode and mode.get("key_value") == "whitelist":
            conn = self._get_connection(); cursor = conn.cursor()
            account_wxid = account_wxid or ""
            if account_wxid:
                cursor.execute(
                    "SELECT 1 FROM friend_access WHERE wxid = ? AND is_active = 1 AND (account_wxid = ? OR account_wxid IS NULL OR account_wxid = '') ORDER BY CASE WHEN account_wxid = ? THEN 0 ELSE 1 END LIMIT 1",
                    (friend_wxid, account_wxid, account_wxid),
                )
            else:
                cursor.execute("SELECT 1 FROM friend_access WHERE wxid = ? AND is_active = 1 AND (account_wxid IS NULL OR account_wxid = '') LIMIT 1", (friend_wxid,))
            row = cursor.fetchone(); conn.close()
            return row is not None
        return True  # No whitelist mode = allow all

    # ---- Conversation Context (keep last N messages per sender) ----
    MAX_CONTEXT = 10

    def push_context(self, sender: str, role: str, content: str, msgid: str = None, timestamp: int = None,
                     account_wxid: str = None):
        """Add a message to conversation context and trim to MAX_CONTEXT."""
        conn = self._get_connection(); cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO conversation_contexts (sender, account_wxid, role, content, msgid, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (sender, account_wxid, role, content, msgid, timestamp))
        # Delete old entries beyond MAX_CONTEXT
        if account_wxid:
            cursor.execute("""
                DELETE FROM conversation_contexts
                WHERE id NOT IN (
                    SELECT id FROM conversation_contexts
                    WHERE sender = ? AND account_wxid = ?
                    ORDER BY id DESC LIMIT ?
                ) AND sender = ? AND account_wxid = ?
            """, (sender, account_wxid, self.MAX_CONTEXT, sender, account_wxid))
        else:
            cursor.execute("""
                DELETE FROM conversation_contexts
                WHERE id NOT IN (
                    SELECT id FROM conversation_contexts
                    WHERE sender = ?
                    ORDER BY id DESC LIMIT ?
                ) AND sender = ?
            """, (sender, self.MAX_CONTEXT, sender))
        conn.commit(); conn.close()

    def get_context(self, sender: str, account_wxid: str = None) -> List[Dict]:
        """Get conversation context for a sender (oldest first)."""
        conn = self._get_connection(); cursor = conn.cursor()
        if account_wxid:
            cursor.execute(
                "SELECT role, content FROM conversation_contexts WHERE sender = ? AND account_wxid = ? ORDER BY id ASC",
                (sender, account_wxid))
        else:
            cursor.execute(
                "SELECT role, content FROM conversation_contexts WHERE sender = ? ORDER BY id ASC",
                (sender,))
        rows = cursor.fetchall(); conn.close(); return [dict(r) for r in rows]

    def clear_context(self, sender: str = None, account_wxid: str = None):
        """Clear context for a sender, or all contexts if sender is None."""
        conn = self._get_connection(); cursor = conn.cursor()
        if sender:
            if account_wxid:
                cursor.execute("DELETE FROM conversation_contexts WHERE sender = ? AND account_wxid = ?", (sender, account_wxid))
            else:
                cursor.execute("DELETE FROM conversation_contexts WHERE sender = ?", (sender,))
        else:
            if account_wxid:
                cursor.execute("DELETE FROM conversation_contexts WHERE account_wxid = ?", (account_wxid,))
            else:
                cursor.execute("DELETE FROM conversation_contexts")
        conn.commit(); conn.close()


# Global database instance
db = Database()
