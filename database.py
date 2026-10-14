"""PostgreSQL persistence for Fiable's existing record shapes.

Each entity has its own table with one JSONB row per record. The adapter keeps
the current API shapes intact while moving persistence and transactions to
Postgres. DATABASE_URL is read only by server-side code and is never logged.
"""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import os
import threading


COLLECTIONS = (
    "accounts", "admin_credentials", "deliveries", "riders", "subscriptions",
    "rider_notifications", "rider_payments", "submissions", "audit_log",
    "unit_adjustments", "support_tickets", "notification_log", "payments",
    "reset_tokens", "batch_routing",
)
WRITE_LOCK = 734924067116  # Shared across every Fiable process using this database.


class DatabaseUnavailable(RuntimeError):
    """A safe-to-display error that deliberately excludes connection details."""


class PostgresStore:
    def __init__(self, url):
        if not url or not url.startswith(("postgres://", "postgresql://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL connection URL.")
        self._url = url
        self._local = threading.local()

    @staticmethod
    def collection(path):
        name = Path(path).stem
        if name not in COLLECTIONS:
            raise ValueError("Unknown database collection.")
        return name

    def _connect(self):
        try:
            import psycopg
        except ImportError:
            raise DatabaseUnavailable("Install requirements.txt before using PostgreSQL.") from None
        try:
            return psycopg.connect(self._url, connect_timeout=10, application_name="fiable")
        except psycopg.Error:
            raise DatabaseUnavailable("Database connection unavailable. Check the server database configuration.") from None

    @contextmanager
    def transaction(self):
        """One connection and atomic commit for a complete app operation.

        Existing handlers update lists of records. A transaction advisory lock
        serializes these operations across processes to prevent stale list
        replacements. Nested calls reuse the transaction without another lock.
        """
        if getattr(self._local, "connection", None) is not None:
            yield self._local.connection
            return
        try:
            import psycopg
        except ImportError:
            raise DatabaseUnavailable("Install requirements.txt before using PostgreSQL.") from None
        try:
            with self._connect() as connection:
                self._local.connection = connection
                connection.execute("SET LOCAL lock_timeout = '15s'")
                connection.execute("SET LOCAL statement_timeout = '30s'")
                connection.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK,))
                yield connection
        except psycopg.Error:
            raise DatabaseUnavailable("Database operation failed. Please try again or contact the administrator.") from None
        finally:
            self._local.connection = None

    def initialize(self):
        sql = (Path(__file__).parent / "migrations" / "001_postgres.sql").read_text(encoding="utf-8")
        with self.transaction() as connection:
            connection.execute(sql)

    def exists(self, path):
        name = self.collection(path)
        with self.transaction() as connection:
            return connection.execute("SELECT 1 FROM fiable.collections WHERE name = %s", (name,)).fetchone() is not None

    def read(self, path):
        from psycopg import sql
        name = self.collection(path)
        with self.transaction() as connection:
            meta = connection.execute("SELECT shape FROM fiable.collections WHERE name = %s", (name,)).fetchone()
            if meta is None:
                raise FileNotFoundError(name)
            rows = connection.execute(sql.SQL(
                "SELECT record_key, data FROM fiable.{} ORDER BY position, record_key"
            ).format(sql.Identifier(name))).fetchall()
            if meta[0] == "list":
                return [row[1] for row in rows]
            if meta[0] == "map":
                return {row[0]: row[1] for row in rows}
            return rows[0][1] if rows else {}

    @staticmethod
    def records(name, value):
        if name == "reset_tokens" and isinstance(value, dict):
            return "map", [(str(key), index, data) for index, (key, data) in enumerate(value.items())]
        if isinstance(value, list):
            records, seen = [], set()
            for position, record in enumerate(value):
                if not isinstance(record, dict):
                    raise ValueError(f"{name}: every record must be an object.")
                key = record.get("id")
                if key is None:
                    key = record.get("email") if name in {"accounts", "admin_credentials"} else None
                if key is None:
                    key = f"position:{position}"
                key = str(key)
                if key in seen:
                    raise ValueError(f"{name}: duplicate record identifier; import was not applied.")
                seen.add(key)
                records.append((key, position, record))
            return "list", records
        if isinstance(value, dict):
            return "document", [("document", 0, value)]
        raise ValueError(f"{name}: expected a JSON list or object.")

    def write(self, path, value):
        from psycopg import sql
        from psycopg.types.json import Jsonb
        name = self.collection(path)
        shape, records = self.records(name, value)
        with self.transaction() as connection:
            connection.execute(
                "INSERT INTO fiable.collections (name, shape) VALUES (%s, %s) "
                "ON CONFLICT (name) DO UPDATE SET shape = EXCLUDED.shape", (name, shape)
            )
            table = sql.Identifier(name)
            keys = [record[0] for record in records]
            connection.execute(sql.SQL("DELETE FROM fiable.{} WHERE NOT (record_key = ANY(%s))").format(table), (keys,))
            statement = sql.SQL(
                "INSERT INTO fiable.{} (record_key, position, data) VALUES (%s, %s, %s) "
                "ON CONFLICT (record_key) DO UPDATE SET position = EXCLUDED.position, "
                "data = EXCLUDED.data, updated_at = now() "
                "WHERE {}.position IS DISTINCT FROM EXCLUDED.position OR {}.data IS DISTINCT FROM EXCLUDED.data"
            ).format(table, table, table)
            with connection.cursor() as cursor:
                cursor.executemany(statement, [(key, position, Jsonb(data)) for key, position, data in records])

    def write_blob(self, filename, data, mime_type):
        if Path(filename).name != filename or not filename:
            raise ValueError("Invalid proof filename.")
        with self.transaction() as connection:
            connection.execute(
                "INSERT INTO fiable.proof_files (filename, content, mime_type, sha256) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (filename) DO NOTHING",
                (filename, data, mime_type, hashlib.sha256(data).hexdigest()),
            )

    def read_blob(self, filename):
        with self.transaction() as connection:
            row = connection.execute("SELECT content, mime_type FROM fiable.proof_files WHERE filename = %s", (filename,)).fetchone()
            if row is None:
                raise FileNotFoundError(filename)
            return bytes(row[0]), row[1]

    def health(self):
        try:
            with self.transaction() as connection:
                connection.execute("SELECT 1 FROM fiable.collections LIMIT 1")
                writable = connection.execute(
                    "SELECT current_setting('transaction_read_only') = 'off' "
                    "AND has_table_privilege(current_user, 'fiable.collections', 'INSERT') "
                    "AND has_table_privilege(current_user, 'fiable.collections', 'UPDATE') "
                    "AND has_table_privilege(current_user, 'fiable.collections', 'DELETE')"
                ).fetchone()[0]
            return {"reachable": True, "writable": bool(writable)}
        except DatabaseUnavailable:
            return {"reachable": False, "writable": False}


def configured_store():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        if os.environ.get("REQUIRE_DATABASE", "").strip().lower() in {"1", "true", "yes"}:
            raise DatabaseUnavailable("DATABASE_URL is required for this deployment.")
        return None
    return PostgresStore(url)
