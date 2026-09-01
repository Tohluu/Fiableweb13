import json
import hashlib
from pathlib import Path

path = Path("data") / "riders.json"
data = json.loads(path.read_text(encoding="utf-8"))
password = "Test@1234"
salt = "salt-rider-0001-fiable"
for rider in data:
    if rider.get("email") == "testrider@example.com":
        rider["passwordHash"] = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000).hex()
        rider["salt"] = salt
        break
else:
    raise RuntimeError("testrider@example.com not found")
path.write_text(json.dumps(data, indent=2), encoding="utf-8")
print("updated", "testrider@example.com", password, salt)
print("hash=", next(r for r in data if r.get("email") == "testrider@example.com")["passwordHash"])
