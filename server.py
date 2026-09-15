from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json
import re
import hashlib
import hmac
import secrets
import base64
import math
import csv
import io
from datetime import datetime, timezone, timedelta
import os

# Deploy marker (no functional change) - used once to force a Railway
# redeploy while verifying persistent-storage behavior across restarts.
_DEPLOY_VERIFICATION_MARKER = "storage-persistence-check-1"

ROOT = Path(__file__).parent

# =========================================================
# PERSISTENT STORAGE ROOT
# =========================================================
# Every persistent runtime file (vendor/rider/order/ticket/audit/proof data)
# resolves from this single directory. Locally it defaults to <project>/data
# (based on this file's real location, NOT the process's current working
# directory, so `python server.py` behaves the same regardless of which
# shell folder you launched it from). In production, set the DATA_DIR
# environment variable to the path where your persistent volume is
# mounted (e.g. Railway: Settings > Volumes) so runtime writes survive
# restarts/redeploys instead of living in the ephemeral container filesystem.
DATA_DIR = Path(os.environ.get("DATA_DIR") or (ROOT / "data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()

# Static-file paths that must never be served, even though they live
# under the project root that SimpleHTTPRequestHandler serves from.
BLOCKED_STATIC_PREFIXES = (
    "/data/",
    "/.git",
    "/.venv",
    "/__pycache__",
    "/server.py",
    "/README.md",
    "/Procfile",
    "/railway.toml",
    "/seed_test_data.py",
    "/reset_for_launch.py",
)
DATA_FILE = DATA_DIR / "submissions.json"
ACCOUNTS_FILE = DATA_DIR / "accounts.json"
PORT = int(os.environ.get("PORT", "8080"))

# =========================================================
# ADMIN AUTHENTICATION
# =========================================================

ADMIN_SESSION_EXPIRY_HOURS = 8

# Active admin sessions:
# {
#     "session_token": "expiry datetime"
# }
ADMIN_SESSIONS = {}

# =========================================================
# RIDER AUTHENTICATION
# =========================================================

RIDER_SESSION_EXPIRY_HOURS = 8

# Active rider sessions
# {
#     "session_token": {
#         "riderId": 1,
#         "expiresAt": datetime
#     }
# }
RIDER_SESSIONS = {}

# =========================================================
# VENDOR AUTHENTICATION
# =========================================================
# NOTE: pre-existing /api/account/* endpoints identify the vendor purely by
# an "email" query/body parameter with no session check at all. This session
# mechanism is an additive hardening layer: when a vendor session cookie is
# present, its email must match the requested email. Older frontend calls
# that don't yet send the cookie keep working unchanged. See final report
# for the recommendation to migrate portal.js to rely on this exclusively.
VENDOR_SESSION_EXPIRY_HOURS = 8
VENDOR_SESSIONS = {}

PLAN_UNIT_PRICES = {
    "Basic": 1500,
    "Growth": 1400,
    "Business": 1300,
}

EXPRESS_UNIT_PRICE = 2000
PRIORITY_SURCHARGE = 2000
RIDER_PAYOUT_RATE = 0.80
PRICING_VERSION = "2026-09-v1"
BATCH_DISCOUNT_TIERS = (
    (11, 0.15),
    (6, 0.10),
    (3, 0.05),
)

PLANS = {
    "Basic": {"units": 45},
    "Growth": {"units": 75},
    "Business": {"units": 110},
}

DELIVERIES_FILE = DATA_DIR / "deliveries.json"
RIDERS_FILE = DATA_DIR / "riders.json"
RIDER_NOTIFICATIONS_FILE = (
    DATA_DIR / "rider_notifications.json"
)
RIDER_PAYMENTS_FILE = DATA_DIR / "rider_payments.json"
ADMIN_CREDENTIALS_FILE = DATA_DIR / "admin_credentials.json"
RESET_TOKENS_FILE = DATA_DIR / "reset_tokens.json"
SUBSCRIPTIONS_FILE = DATA_DIR / "subscriptions.json"
RESET_TOKEN_EXPIRY_MINUTES = 60

LOCATION_ZONES = {
    "agege": "mainland-west", "ajeromi-ifelodun": "mainland-west",
    "egbeda": "mainland-north", "shasha": "mainland-north",
    "igando": "mainland-north", "ayobo": "mainland-north",
    "ipaja": "mainland-north", "abule-egba": "mainland-west",
    "agbado": "mainland-west", "alagbado": "mainland-west",
    "idimu": "mainland-north", "ikotun": "mainland-north",
    "amuwo-odofin": "mainland-west", "apapa": "mainland-west",
    "badagry": "extended", "epe": "extended", "ibeju-lekki": "extended",
    "ifako-ijaiye": "mainland-north", "ikeja": "mainland-east",
    "ikorodu": "extended", "kosofe": "mainland-east",
    "lagos-island": "island-central", "lagos-mainland": "mainland-central",
    "yaba": "mainland-central", "mushin": "mainland-central",
    "ojo": "mainland-west", "oshodi-isolo": "mainland-east",
    "shomolu": "mainland-east", "surulere": "mainland-east",
    "ajegunle": "mainland-west", "victoria-island-vi": "island-central",
    "ikoyi": "island-central", "lekki-phase-1": "island-central",
    "ikate-elegushi": "lekki", "ajah": "lekki", "sangotedo": "lekki",
    "oniru": "island-central", "lekki-phase-2": "lekki",
    "chevron": "lekki", "ikota": "lekki", "vgc": "lekki",
    "osapa-london": "lekki", "jakande-lekki": "lekki",
    "orchid-road": "lekki",
    "abraham-adesanya": "lekki", "ilasan": "lekki",
    "marwa": "lekki",
}

LEKKI_AXIS_LOCATIONS = {
    "lekki-phase-1", "marwa", "ikate-elegushi", "chevron", "ajah",
    "ikota", "vgc", "osapa-london", "jakande-lekki", "orchid-road",
    "abraham-adesanya", "ilasan",
}

# Distance-based unit matrix between zones.
# Symmetric — order of pickup/dropoff doesn't matter.
ZONE_UNIT_MATRIX = {
    frozenset(["mainland-west"]): 1,
    frozenset(["mainland-north"]): 1,
    frozenset(["mainland-central"]): 1,
    frozenset(["mainland-east"]): 1,
    frozenset(["island-central"]): 1,
    frozenset(["lekki"]): 1,
    frozenset(["extended"]): 1,

    frozenset(["mainland-west", "mainland-central"]): 2,
    frozenset(["mainland-central", "mainland-north"]): 2,
    frozenset(["mainland-central", "mainland-east"]): 2,
    frozenset(["island-central", "lekki"]): 2,

    frozenset(["mainland-west", "mainland-north"]): 3,
    frozenset(["mainland-west", "mainland-east"]): 3,
    frozenset(["mainland-north", "mainland-east"]): 3,
    frozenset(["mainland-central", "island-central"]): 3,

    frozenset(["mainland-west", "island-central"]): 4,
    frozenset(["mainland-east", "island-central"]): 4,
    frozenset(["mainland-central", "lekki"]): 4,

    frozenset(["mainland-north", "island-central"]): 5,
    frozenset(["mainland-west", "lekki"]): 5,
    frozenset(["mainland-east", "lekki"]): 5,

    frozenset(["mainland-north", "lekki"]): 6,

    # extended (Ikorodu, Badagry, Epe, Ibeju-lekki) — treat as far by default
    # you can override individual pairs above this if needed
}

EXTENDED_UNITS = 7  # default for any route touching "extended", unless overridden above


def estimate_delivery(pickup, dropoff, plan=None, priority="Standard"):
    pickup_zone = LOCATION_ZONES.get(pickup)
    dropoff_zone = LOCATION_ZONES.get(dropoff)
    if not pickup_zone or not dropoff_zone:
        raise ValueError("Pickup and delivery locations must be valid Lagos locations")

    if pickup == dropoff:
        units = 1
    else:
        pair = frozenset([pickup_zone, dropoff_zone])
        units = ZONE_UNIT_MATRIX.get(pair, EXTENDED_UNITS if "extended" in pair else 3)

    recommended = "Basic" if units <= 2 else "Growth" if units <= 4 else "Business"
    billed_plan = plan if plan in PLAN_UNIT_PRICES else recommended
    unit_price = PLAN_UNIT_PRICES[billed_plan]
    priority = clean(priority, 40).title()
    priority_surcharge = (
        PRIORITY_SURCHARGE
        if priority in {"Express", "Urgent"}
        else 0
    )
    base_cost = units * unit_price
    cost = base_cost + priority_surcharge
    return {
        "units": units,
        "baseCost": base_cost,
        "prioritySurcharge": priority_surcharge,
        "cost": cost,
        "unitPrice": unit_price,
        "plan": billed_plan,
        "recommendedPlan": recommended,
        "riderPayout": round(cost * RIDER_PAYOUT_RATE),
        "pricingVersion": PRICING_VERSION,
    }


def validate_delivery_window(window):
    valid_windows = {
        "8:00 AM - 11:00 AM",
        "12:00 PM - 3:00 PM",
        "Express",
        "Next Day Delivery",
    }
    if window not in valid_windows:
        raise ValueError("Choose a valid delivery window.")

    lagos_time = datetime.now(timezone(timedelta(hours=1)))
    if window == "8:00 AM - 11:00 AM" and lagos_time.hour >= 11:
        raise ValueError("The 8:00 AM - 11:00 AM delivery window has closed. Choose Express or Next Day Delivery.")
    if window == "12:00 PM - 3:00 PM" and lagos_time.hour >= 15:
        raise ValueError("The 12:00 PM - 3:00 PM delivery window has closed. Choose Express or Next Day Delivery.")

    return "Next Day: 8:00 AM - 11:00 AM" if window == "Next Day Delivery" else window


def batch_discount_rate(delivery_count):
    for minimum_count, rate in BATCH_DISCOUNT_TIERS:
        if delivery_count >= minimum_count:
            return rate
    return 0


def estimate_batch_deliveries(delivery_requests, plan=None):
    if len(delivery_requests) < 3:
        raise ValueError("A batch requires at least 3 deliveries.")

    pickup_locations = {
        clean(item.get("pickup"), 120)
        for item in delivery_requests
    }
    if len(pickup_locations) != 1:
        raise ValueError("All batch deliveries must use the same pickup location.")

    if not all(
        clean(item.get("dropoff"), 120) in LEKKI_AXIS_LOCATIONS
        for item in delivery_requests
    ):
        raise ValueError(
            "All batch destinations must be within the Lekki axis to receive the discount."
        )

    quotes = [
        estimate_delivery(
            clean(item.get("pickup"), 120),
            clean(item.get("dropoff"), 120),
            plan,
            clean(item.get("priority"), 40) or "Standard"
        )
        for item in delivery_requests
    ]
    total_original_units = sum(quote["units"] for quote in quotes)
    discount_rate = batch_discount_rate(len(quotes))
    total_charged_units = max(
        len(quotes),
        math.ceil(
            total_original_units * (1 - discount_rate)
        )
    )

    remaining_units = total_charged_units
    remaining_original_units = total_original_units
    for quote in quotes:
        if remaining_original_units == quote["units"]:
            charged_units = remaining_units
        else:
            charged_units = max(
                1,
                round(
                    quote["units"] /
                    remaining_original_units *
                    remaining_units
                )
            )
        quote["originalUnits"] = quote["units"]
        quote["units"] = charged_units
        quote["chargedUnits"] = charged_units
        quote["batchAxis"] = "lekki"
        quote["batchDiscountRate"] = discount_rate
        quote["batchDiscountUnits"] = quote["originalUnits"] - charged_units
        quote["vendorDiscountAmount"] = (
            quote["originalUnits"] - charged_units
        ) * quote["unitPrice"]
        quote["riderPayout"] = round(
            (quote["baseCost"] + quote["prioritySurcharge"]) *
            RIDER_PAYOUT_RATE
        )
        remaining_units -= charged_units
        remaining_original_units -= quote["originalUnits"]

    return {
        "axis": "lekki",
        "discountRate": discount_rate,
        "originalUnits": total_original_units,
        "chargedUnits": total_charged_units,
        "unitsSaved": total_original_units - total_charged_units,
        "vendorSaving": sum(quote["vendorDiscountAmount"] for quote in quotes),
        "deliveries": quotes,
    }


def clean(value, limit=500):
    return str(value or "").strip()[:limit]


def valid_email(value):
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value))


def load_accounts():
    if not ACCOUNTS_FILE.exists():
        return []
    try:
        return json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

def generate_subscriber_id(accounts):
    numbers = []

    for account in accounts:
        subscriber_id = account.get("subscriberId", "")

        if subscriber_id.startswith("FL-SUB-"):
            try:
                number = int(subscriber_id.replace("FL-SUB-", ""))
                numbers.append(number)
            except ValueError:
                pass

    next_number = max(numbers, default=0) + 1

    return f"FL-SUB-{next_number:04d}"

def migrate_subscriber_ids():
    accounts = load_accounts()
    changed = False

    existing_numbers = []

    for account in accounts:
        subscriber_id = account.get("subscriberId", "")

        if subscriber_id.startswith("FL-SUB-"):
            try:
                existing_numbers.append(
                    int(subscriber_id.replace("FL-SUB-", ""))
                )
            except ValueError:
                pass

    next_number = max(existing_numbers, default=0) + 1

    for account in accounts:
        if not account.get("subscriberId"):
            account["subscriberId"] = f"FL-SUB-{next_number:04d}"
            next_number += 1
            changed = True

    if changed:
        ACCOUNTS_FILE.write_text(
            json.dumps(accounts, indent=2),
            encoding="utf-8"
        )

def save_account(account):
    ACCOUNTS_FILE.parent.mkdir(exist_ok=True)
    accounts = load_accounts()
    accounts.append(account)
    ACCOUNTS_FILE.write_text(json.dumps(accounts, indent=2), encoding="utf-8")


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()

def save_admin_credentials(admins):
    ADMIN_CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ADMIN_CREDENTIALS_FILE.write_text(
        json.dumps(admins, indent=2),
        encoding="utf-8"
    )


def load_admin_credentials():

    if not ADMIN_CREDENTIALS_FILE.exists():
        return []

    try:

        content = ADMIN_CREDENTIALS_FILE.read_text(
            encoding="utf-8"
        ).strip()

        if not content:
            return []

        data = json.loads(content)

    except (json.JSONDecodeError, OSError):

        return []

    # Migrate the legacy single-admin dict file into a multi-admin list.
    if isinstance(data, dict):
        data = [{
            "id": 1,
            "email": data.get("email", ""),
            "name": data.get("name") or "Administrator",
            "passwordHash": data.get("passwordHash", ""),
            "salt": data.get("salt", ""),
            "role": "owner",
            "status": "active",
            "createdAt": data.get("createdAt") or datetime.now(timezone.utc).isoformat(),
        }]
        save_admin_credentials(data)

    if not isinstance(data, list):
        return []

    next_id = 1
    for admin in data:
        admin.setdefault("id", next_id)
        admin.setdefault("name", "Administrator")
        admin.setdefault("role", "staff")
        admin.setdefault("status", "active")
        admin.setdefault("createdAt", datetime.now(timezone.utc).isoformat())
        # MFA readiness - no provider is wired up yet, these fields exist so
        # future MFA activation doesn't need another schema migration.
        admin.setdefault("mfaEnabled", False)
        admin.setdefault("mfaMethod", None)
        admin.setdefault("mfaSecret", None)
        admin.setdefault("mfaRecoveryCodesHash", [])
        next_id = max(next_id, int(admin.get("id") or 0) + 1)

    return data


def find_admin_by_email(admins, email):
    normalized = (email or "").strip().lower()
    return next(
        (item for item in admins if item.get("email", "").lower() == normalized),
        None
    )


def get_current_admin(handler):
    email = get_admin_email(handler)
    if not email:
        return None
    return find_admin_by_email(load_admin_credentials(), email)


def require_owner(handler):
    admin = get_current_admin(handler)
    return bool(admin) and admin.get("role") in ("owner", "super_admin")


def purge_admin_sessions(email):
    normalized = (email or "").strip().lower()
    for token, session in list(ADMIN_SESSIONS.items()):
        if session.get("email", "").strip().lower() == normalized:
            ADMIN_SESSIONS.pop(token, None)
    
def bootstrap_admin_from_environment():
    email = clean(os.environ.get("ADMIN_BOOTSTRAP_EMAIL"), 160).lower()
    password = clean(os.environ.get("ADMIN_BOOTSTRAP_PASSWORD"), 128)
    
    if not email and not password:
        return
    
    if not valid_email(email) or len(password) < 8:
        raise RuntimeError(
            "ADMIN_BOOTSTRAP_EMAIL must be valid and ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters."
        )
    
    admins = load_admin_credentials()
    admin = find_admin_by_email(admins, email)
    salt = secrets.token_hex(16)
    
    if admin is None:
        admin = {
            "id": max((int(item.get("id") or 0) for item in admins), default=0) + 1,
            "email": email,
            "name": "Administrator",
            "role": "owner",
            "status": "active",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        admins.append(admin)
    
    admin["passwordHash"] = password_hash(password, salt)
    admin["salt"] = salt
    admin["role"] = "owner"
    admin["status"] = "active"
    save_admin_credentials(admins)
    purge_admin_sessions(email)


def check_storage_health():
    """Verify persistent storage is reachable and writable.

    Returns a dict with booleans only -- never a filesystem path -- so it is
    safe to expose through a public endpoint. Detailed diagnostics (the
    actual resolved path) are logged server-side only, via log_startup_state().
    """
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        probe = DATA_DIR / ".storage_healthcheck.tmp"
        probe.write_text("ok", encoding="utf-8")
        readable = probe.read_text(encoding="utf-8") == "ok"
        probe.unlink(missing_ok=True)
        return {"reachable": True, "writable": readable}
    except OSError:
        return {"reachable": False, "writable": False}


def log_startup_state():
    """Print safe, non-sensitive diagnostics to the server console/log stream.

    Never logs passwords, hashes, session tokens, CSRF tokens, OTP values,
    or other secrets. The resolved storage path is safe to log here because
    this only reaches server-side logs (e.g. the Railway dashboard), never
    an HTTP response body.
    """
    print(f"[startup] APP_ENV={APP_ENV}")
    print(f"[startup] Storage directory resolved: {DATA_DIR}")

    health = check_storage_health()
    if health["reachable"] and health["writable"]:
        print("[startup] Persistent storage available (reachable + writable)")
    elif health["reachable"]:
        print("[startup] WARNING: storage directory reachable but not writable")
    else:
        print("[startup] WARNING: storage directory is not reachable")

    required_files = {
        "accounts": ACCOUNTS_FILE,
        "deliveries": DELIVERIES_FILE,
        "riders": RIDERS_FILE,
        "admin_credentials": ADMIN_CREDENTIALS_FILE,
        "support_tickets": SUPPORT_TICKETS_FILE,
        "audit_log": AUDIT_LOG_FILE,
        "unit_adjustments": UNIT_ADJUSTMENTS_FILE,
        "subscriptions": SUBSCRIPTIONS_FILE,
        "rider_payments": RIDER_PAYMENTS_FILE,
        "rider_notifications": RIDER_NOTIFICATIONS_FILE,
        "reset_tokens": RESET_TOKENS_FILE,
        "submissions": DATA_FILE,
    }
    present = [name for name, path in required_files.items() if path.exists()]
    missing = [name for name, path in required_files.items() if not path.exists()]
    print(f"[startup] Required data files loaded: {', '.join(present) if present else '(none yet)'}")
    if missing:
        print(f"[startup] Data files not yet present (will be created empty on first write): {', '.join(missing)}")

    PROOF_DIR.mkdir(parents=True, exist_ok=True)
    print("[startup] Proof storage available")


def create_account(email, name, password, plan=None):
    normalized_email = email.lower()
    if any(account["email"] == normalized_email for account in load_accounts()):
        raise ValueError(
            "An account with this email already exists. Please log in instead."
        )
    if plan is not None and plan not in PLANS:
        raise ValueError("Please choose a valid subscription plan")
    salt = secrets.token_hex(16)
    accounts = load_accounts()
    save_account({
        "subscriberId": generate_subscriber_id(accounts),
        "email": normalized_email,
        "name": name,
        "salt": salt,
        "passwordHash": password_hash(password, salt),
        "plan": plan,
        "paymentStatus": "pending",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    })


def authenticate(identifier, password):
    normalized_identifier = identifier.strip().lower()
    for account in load_accounts():
        account_email = account.get("email", "").lower()
        subscriber_id = account.get("subscriberId", "").lower()
        if (
            account_email == normalized_identifier
            or subscriber_id == normalized_identifier
        ):
            valid = hmac.compare_digest(
                account["passwordHash"],
                password_hash(password, account["salt"])
            )
            return account if valid else None
    return None


def update_account(email, plan):
    if plan not in PLANS:
        raise ValueError("Please choose a valid subscription plan")
    accounts = load_accounts()
    for account in accounts:
        if account["email"] == email.lower():
            summary = summary_for_account(account)
            # Prevent changing an active subscription
            # while the vendor still has units remaining.
            if summary["subscriptionState"] in (
                "active",
                "expiring_soon",
                "grace_period"
            ) and summary["unitsRemaining"] > 0:
                raise ValueError(
                    "Your current subscription is still active. "
                    "You can renew after your units are exhausted "
                    "or after your subscription expires."
                )
            # Vendor is allowed to choose a new plan.
            account["plan"] = plan
            account["paymentStatus"] = "pending"
            ACCOUNTS_FILE.write_text(
                json.dumps(accounts, indent=2),
                encoding="utf-8"
            )
            return account
    raise ValueError("Account not found")


def load_reset_tokens():
    if not RESET_TOKENS_FILE.exists():
        return {}
    try:
        return json.loads(RESET_TOKENS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_reset_tokens(tokens):
    RESET_TOKENS_FILE.parent.mkdir(exist_ok=True)
    RESET_TOKENS_FILE.write_text(
        json.dumps(tokens, indent=2),
        encoding="utf-8"
    )


def create_reset_token(email):
    tokens = load_reset_tokens()

    # Remove expired tokens
    now = datetime.now(timezone.utc)

    for token, data in list(tokens.items()):
        expires_at = parse_iso_date(data.get("expiresAt"))
        if not expires_at or expires_at <= now:
            del tokens[token]

    token = secrets.token_urlsafe(48)

    tokens[token] = {
        "email": email.lower(),
        "expiresAt": (
            now + timedelta(minutes=RESET_TOKEN_EXPIRY_MINUTES)
        ).isoformat(),
    }

    save_reset_tokens(tokens)

    return token


def verify_reset_token(token):
    tokens = load_reset_tokens()
    data = tokens.get(token)

    if not data:
        return None

    expires_at = parse_iso_date(data.get("expiresAt"))

    if not expires_at or expires_at <= datetime.now(timezone.utc):
        tokens.pop(token, None)
        save_reset_tokens(tokens)
        return None

    return data


def consume_reset_token(token):
    tokens = load_reset_tokens()

    data = tokens.pop(token, None)

    save_reset_tokens(tokens)

    return data

def mark_payment_complete(email):
    accounts = load_accounts()
    for account in accounts:
        if account["email"] == email.lower():
            subscriptions = load_subscriptions()
            previous_paid_at = parse_iso_date(account.get("paidAt"))
            previous_period_start = (
                previous_paid_at.isoformat()
                if previous_paid_at else None
            )

            if previous_paid_at and not any(
                record.get("email", "").lower() == account["email"].lower()
                and record.get("periodStart") == previous_period_start
                for record in subscriptions
            ):
                subscriptions.append({
                    "id": f"SUB-{len(subscriptions) + 1:05d}",
                    "email": account["email"],
                    "subscriberId": account.get("subscriberId"),
                    "plan": account.get("plan"),
                    "amount": plan_price(account.get("plan")),
                    "unitsAllocated": PLANS.get(account.get("plan"), {}).get("units", 0),
                    "paymentStatus": "paid",
                    "paidAt": previous_period_start,
                    "periodStart": previous_period_start,
                    "periodEnd": (previous_paid_at + timedelta(days=30)).isoformat(),
                })

            paid_at = datetime.now(timezone.utc)
            account["paymentStatus"] = "paid"
            account["paidAt"] = paid_at.isoformat()
            ACCOUNTS_FILE.write_text(json.dumps(accounts, indent=2), encoding="utf-8")
            subscriptions.append({
                "id": f"SUB-{len(subscriptions) + 1:05d}",
                "email": account["email"],
                "subscriberId": account.get("subscriberId"),
                "plan": account.get("plan"),
                "amount": plan_price(account.get("plan")),
                "unitsAllocated": PLANS.get(account.get("plan"), {}).get("units", 0),
                "paymentStatus": "paid",
                "paidAt": paid_at.isoformat(),
                "periodStart": paid_at.isoformat(),
                "periodEnd": (paid_at + timedelta(days=30)).isoformat(),
            })
            save_subscriptions(subscriptions)
            return account
    raise ValueError("Account not found")


def plan_price(plan):
    return {"Basic": 67500, "Growth": 105000, "Business": 143000}.get(plan, 0)


def load_subscriptions():
    if not SUBSCRIPTIONS_FILE.exists():
        return []
    try:
        value = json.loads(SUBSCRIPTIONS_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_subscriptions(subscriptions):
    SUBSCRIPTIONS_FILE.parent.mkdir(exist_ok=True)
    SUBSCRIPTIONS_FILE.write_text(
        json.dumps(subscriptions, indent=2),
        encoding="utf-8"
    )


def subscription_history_for_account(account):
    records = [
        record for record in load_subscriptions()
        if record.get("email", "").lower() == account["email"].lower()
    ]
    if records:
        records = sorted(
            records,
            key=lambda record: record.get("periodStart", ""),
            reverse=True
        )
        return add_subscription_usage(account["email"], records)

    if account.get("plan") and account.get("paidAt"):
        paid_at = parse_iso_date(account["paidAt"])
        if paid_at:
            return add_subscription_usage(account["email"], [{
                "id": f"LEGACY-{account.get('subscriberId', account['email'])}",
                "email": account["email"],
                "subscriberId": account.get("subscriberId"),
                "plan": account.get("plan"),
                "amount": plan_price(account.get("plan")),
                "unitsAllocated": PLANS.get(account.get("plan"), {}).get("units", 0),
                "paymentStatus": account.get("paymentStatus", "pending"),
                "paidAt": account.get("paidAt"),
                "periodStart": paid_at.isoformat(),
                "periodEnd": (paid_at + timedelta(days=30)).isoformat(),
            }])
    return []


def add_subscription_usage(email, subscriptions):
    for subscription in subscriptions:
        deliveries = deliveries_for_subscription(email, subscription)
        units_used = sum(
            int(delivery.get("units", 0) or 0)
            for delivery in deliveries
            if delivery.get("status") != "cancelled"
        )
        subscription["unitsUsed"] = units_used
        subscription["subscriptionStatus"] = (
            "exhausted"
            if units_used >= int(subscription.get("unitsAllocated", 0) or 0)
            else subscription.get("paymentStatus", "pending")
        )
    return subscriptions


def deliveries_for_subscription(email, subscription):
    start = parse_iso_date(subscription.get("periodStart"))
    end = parse_iso_date(subscription.get("periodEnd"))
    if not start or not end:
        return []
    return [
        delivery for delivery in deliveries_for_account(email)
        if (created_at := parse_iso_date(delivery.get("createdAt")))
        and start <= created_at < end
    ]


def save_submission(kind, payload):
    DATA_FILE.parent.mkdir(exist_ok=True)
    submissions = []
    if DATA_FILE.exists():
        try:
            submissions = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            submissions = []
    submissions.append({
        "id": len(submissions) + 1,
        "type": kind,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "data": payload,
    })
    DATA_FILE.write_text(json.dumps(submissions, indent=2), encoding="utf-8")
    return submissions[-1]


def load_deliveries():
    if not DELIVERIES_FILE.exists():
        return []
    try:
        return json.loads(DELIVERIES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_deliveries(deliveries):
    DELIVERIES_FILE.parent.mkdir(exist_ok=True)
    DELIVERIES_FILE.write_text(json.dumps(deliveries, indent=2), encoding="utf-8")


def create_delivery(account_email, pickup, dropoff, units, details=None, order_ref=None, unit_price=None, plan=None, pricing=None):
    deliveries = load_deliveries()
    new_id = (deliveries[-1]["id"] + 1) if deliveries else 1
    record = {
        "id": new_id,
        "orderRef": order_ref or f"FL-{new_id:04d}",
        "trackingCode": generate_tracking_code(),
        "accountEmail": account_email.lower(),
        "pickup": pickup,
        "dropoff": dropoff,
        "units": int(units),
        "unitPrice": int(unit_price or 0),
        "cost": int(pricing.get("cost", 0)) if pricing else int(units) * int(unit_price or 0),
        "subscriptionPlan": plan or "",
        "priority": details.get("priority") if details else "Standard",
        "window": details.get("window") if details else "Standard",
        "packageType": details.get("packageType") if details else "General",
        "packageDescription": details.get("packageDescription") if details else "",
        "recipient": details.get("recipient") if details else "",
        "status": "requested",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "details": details or {},
        "timeline": [{
            "status": "requested",
            "label": DELIVERY_STATUS_LABELS["requested"],
            "at": now_iso(),
            "actorType": "vendor",
            "actorId": account_email.lower(),
            "actorName": None,
            "note": None,
        }],
        "proofOfDelivery": None,
        "deliveryOtp": None,
        "otpState": "not_generated",
    }
    if pricing:
        record["pricing"] = dict(pricing)
    deliveries.append(record)
    save_deliveries(deliveries)
    return record


def update_delivery_status(delivery_id, status):
    deliveries = load_deliveries()
    for d in deliveries:
        if d["id"] == delivery_id:
            d["status"] = status
            d["updatedAt"] = datetime.now(timezone.utc).isoformat()
            save_deliveries(deliveries)
            return d
    return None


def deliveries_for_account(email):
    email_n = (email or "").lower()
    return [d for d in load_deliveries() if d.get("accountEmail") == email_n]


def migrate_deliveries():
    """Backfill trackingCode/timeline/proofOfDelivery on records created
    before those fields existed. Never overwrites existing values."""
    deliveries = load_deliveries()
    changed = False
    for delivery in deliveries:
        if not delivery.get("trackingCode"):
            delivery["trackingCode"] = generate_tracking_code()
            changed = True
        if not delivery.get("timeline"):
            delivery["timeline"] = [{
                "status": delivery.get("status", "requested"),
                "label": DELIVERY_STATUS_LABELS.get(delivery.get("status", "requested"), delivery.get("status", "requested")),
                "at": delivery.get("createdAt") or now_iso(),
                "actorType": "system",
                "actorId": None,
                "actorName": "Migrated record",
                "note": "Backfilled - detailed history unavailable for orders created before the timeline feature.",
            }]
            changed = True
        if "proofOfDelivery" not in delivery:
            delivery["proofOfDelivery"] = None
            changed = True
        if "deliveryOtp" not in delivery:
            delivery["deliveryOtp"] = None
            changed = True
        if "otpState" not in delivery:
            if (delivery.get("proofOfDelivery") or {}).get("otpVerified"):
                delivery["otpState"] = "verified"
            elif delivery.get("deliveryOtp"):
                delivery["otpState"] = "generated"
            else:
                delivery["otpState"] = "not_generated"
            changed = True
    if changed:
        save_deliveries(deliveries)


def rider_payment_for_delivery(delivery, account_plan=None):
    saved_payout = delivery.get("pricing", {}).get("riderPayout")
    if saved_payout is not None:
        return round(float(saved_payout))

    delivery_fee = delivery.get("cost")
    if delivery_fee is None:
        plan = delivery.get("subscriptionPlan") or account_plan
        unit_price = PLAN_UNIT_PRICES.get(plan, 0)
        delivery_fee = int(delivery.get("units", 0) or 0) * unit_price
    return round(float(delivery_fee or 0) * RIDER_PAYOUT_RATE)


def rider_payment_summary(month=None):
    riders = load_riders()
    deliveries = load_deliveries()
    accounts = load_accounts()
    rider_payments = load_rider_payments()
    summaries = []

    def delivery_month(delivery):
        delivered_at = parse_iso_date(
            delivery.get("updatedAt") or delivery.get("createdAt")
        )
        return delivered_at.strftime("%Y-%m") if delivered_at else None

    for rider in riders:
        rider_id = str(rider.get("id", ""))
        rider_deliveries = [
            delivery for delivery in deliveries
            if str(delivery.get("riderId", "")) == rider_id
        ]
        completed = [
            delivery for delivery in rider_deliveries
            if str(delivery.get("status", "")).lower() == "delivered"
        ]
        failed = [
            delivery for delivery in rider_deliveries
            if str(delivery.get("status", "")).lower()
            in {"failed", "cancelled"}
        ]
        payable = 0
        breakdown = []
        for delivery in completed:
            account = next(
                (
                    item for item in accounts
                    if item.get("email", "").lower() ==
                    str(delivery.get("accountEmail", "")).lower()
                ),
                None
            )
            payable += rider_payment_for_delivery(
                delivery,
                account.get("plan") if account else None
            )
        for delivery in rider_deliveries:
            account = next(
                (
                    item for item in accounts
                    if item.get("email", "").lower() ==
                    str(delivery.get("accountEmail", "")).lower()
                ),
                None
            )
            rider_payment = rider_payment_for_delivery(
                delivery,
                account.get("plan") if account else None
            ) if str(delivery.get("status", "")).lower() == "delivered" else 0
            delivery_fee = delivery.get("cost")
            if delivery_fee is None:
                plan = delivery.get("subscriptionPlan") or (account.get("plan") if account else None)
                delivery_fee = int(delivery.get("units", 0) or 0) * PLAN_UNIT_PRICES.get(plan, 0)
            breakdown.append({
                "id": delivery.get("id"),
                "orderRef": delivery.get("orderRef", f"#{delivery.get('id')}"),
                "route": f"{delivery.get('pickup', '—')} → {delivery.get('dropoff', '—')}",
                "units": delivery.get("units", 0),
                "status": delivery.get("status", ""),
                "deliveryFee": delivery_fee,
                "riderPayment": rider_payment,
                "payable": rider_payment > 0,
                "completedAt": delivery.get("updatedAt") or delivery.get("createdAt"),
                "deliveryMonth": delivery_month(delivery),
                "paidAmount": 0,
            })

        completed_breakdown = sorted(
            (item for item in breakdown if item["payable"]),
            key=lambda item: item["completedAt"] or ""
        )
        payments = sorted(
            (
                item for item in rider_payments
                if str(item.get("riderId")) == rider_id
            ),
            key=lambda item: item.get("paidAt") or ""
        )

        for payment in payments:
            remaining_payment = float(payment.get("amount", 0) or 0)
            paid_at = payment.get("paidAt") or ""

            for delivery in completed_breakdown:
                if remaining_payment <= 0 or (delivery["completedAt"] or "") > paid_at:
                    continue

                remaining_delivery = (
                    float(delivery["riderPayment"]) -
                    float(delivery["paidAmount"])
                )
                applied_amount = min(remaining_payment, remaining_delivery)
                delivery["paidAmount"] += applied_amount
                remaining_payment -= applied_amount

        for delivery in breakdown:
            if not delivery["payable"]:
                delivery["paymentStatus"] = "not_payable"
            elif delivery["paidAmount"] >= delivery["riderPayment"]:
                delivery["paymentStatus"] = "paid"
            elif delivery["paidAmount"] > 0:
                delivery["paymentStatus"] = "part_paid"
            else:
                delivery["paymentStatus"] = "outstanding"

            delivery["outstandingAmount"] = max(
                0,
                delivery["riderPayment"] - delivery["paidAmount"]
            )

        breakdown.sort(
            key=lambda item: item["completedAt"] or "",
            reverse=True
        )
        visible_breakdown = [
            item for item in breakdown
            if not month or item["deliveryMonth"] == month
        ]
        visible_completed = [
            item for item in visible_breakdown
            if str(item["status"]).lower() == "delivered"
        ]
        visible_failed = [
            item for item in visible_breakdown
            if str(item["status"]).lower() in {"failed", "cancelled"}
        ]
        visible_payable = sum(
            item["riderPayment"] for item in visible_completed
        )
        visible_paid = sum(
            item["paidAmount"] for item in visible_completed
        )
        summaries.append({
            "riderId": rider.get("id"),
            "riderRef": rider.get("riderRef", ""),
            "name": rider.get("name", ""),
            "completedDeliveries": len(visible_completed),
            "failedDeliveries": len(visible_failed),
            "payable": visible_payable,
            "paid": visible_paid,
            "outstanding": max(0, visible_payable - visible_paid),
            "breakdown": visible_breakdown,
        })

    return summaries


def admin_revenue_summary():
    subscriptions = []
    for account in load_accounts():
        subscriptions.extend(subscription_history_for_account(account))

    monthly_revenue = {}
    for subscription in subscriptions:
        if subscription.get("paymentStatus") != "paid":
            continue
        paid_at = parse_iso_date(
            subscription.get("periodStart") or subscription.get("paidAt")
        )
        if paid_at:
            month = paid_at.strftime("%Y-%m")
            monthly_revenue[month] = monthly_revenue.get(month, 0) + int(
                subscription.get("amount", 0) or 0
            )

    monthly_rider_payments = {}
    accounts = load_accounts()
    for delivery in load_deliveries():
        if str(delivery.get("status", "")).lower() != "delivered":
            continue
        delivered_at = parse_iso_date(
            delivery.get("updatedAt") or delivery.get("createdAt")
        )
        if delivered_at:
            month = delivered_at.strftime("%Y-%m")
            account = next(
                (
                    item for item in accounts
                    if item.get("email", "").lower() ==
                    str(delivery.get("accountEmail", "")).lower()
                ),
                None
            )
            monthly_rider_payments[month] = monthly_rider_payments.get(month, 0) + rider_payment_for_delivery(
                delivery,
                account.get("plan") if account else None
            )

    months = sorted(
        set(monthly_revenue) | set(monthly_rider_payments),
        reverse=True
    )
    monthly = {
        month: {
            "revenue": monthly_revenue.get(month, 0),
            "riderPayments": monthly_rider_payments.get(month, 0),
            "profit": monthly_revenue.get(month, 0) - monthly_rider_payments.get(month, 0),
        }
        for month in months
    }
    current_year = str(datetime.now(timezone.utc).year)
    yearly = {
        "revenue": sum(value["revenue"] for month, value in monthly.items() if month.startswith(current_year)),
        "riderPayments": sum(value["riderPayments"] for month, value in monthly.items() if month.startswith(current_year)),
    }
    yearly["profit"] = yearly["revenue"] - yearly["riderPayments"]
    return {"monthly": monthly, "yearly": yearly}


def dashboard_stats_for_account(email):
    items = deliveries_for_account(email)
    counts = {"requested": 0, "assigned": 0, "picked-up": 0, "in-transit": 0, "delivered": 0, "failed": 0, "cancelled": 0}
    for d in items:
        s = str(d.get("status") or "requested").strip().lower()
        if s in {"on_delivery", "on-delivery", "in_transit"}:
            s = "in-transit"
        counts[s] = counts.get(s, 0) + 1
    return {"counts": counts, "total": len(items)}


def units_used_for_account(email):
    account = next(
        (item for item in load_accounts() if item["email"] == email.lower()),
        None
    )
    if not account:
        return 0
    paid_at = parse_iso_date(
        account.get("paidAt") or account.get("createdAt")
    )
    items = deliveries_for_account(email)
    total = 0
    for delivery in items:
        if delivery.get("status") == "cancelled":
            continue
        if paid_at:
            delivery_created = parse_iso_date(delivery.get("createdAt"))
            if not delivery_created or delivery_created < paid_at:
                continue
        total += int(delivery.get("units", 0))
    return total

# =========================================================
# RIDER STORAGE
# =========================================================

def load_riders():
    if not RIDERS_FILE.exists():
        return []

    try:
        return json.loads(
            RIDERS_FILE.read_text(
                encoding="utf-8"
            )
        )
    except json.JSONDecodeError:
        return []


def save_riders(riders):
    RIDERS_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    RIDERS_FILE.write_text(
        json.dumps(
            riders,
            indent=2,
            ensure_ascii=False
        ),
        encoding="utf-8"
    )

def load_rider_notifications():

    if not RIDER_NOTIFICATIONS_FILE.exists():
        return []

    try:

        content = RIDER_NOTIFICATIONS_FILE.read_text(
            encoding="utf-8"
        ).strip()

        if not content:
            return []

        notifications = json.loads(content)

        if not isinstance(notifications, list):
            return []

        return notifications

    except (json.JSONDecodeError, OSError):

        return []


def save_rider_notifications(notifications):

    RIDER_NOTIFICATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)

    RIDER_NOTIFICATIONS_FILE.write_text(
        json.dumps(
            notifications,
            indent=2
        ),
        encoding="utf-8"
    )


def create_rider_notification(
    rider_id,
    notification_type,
    title,
    message,
    order_id=None
):

    notifications = load_rider_notifications()

    notification = {
        "id": secrets.token_urlsafe(12),
        "riderId": rider_id,
        "type": notification_type,
        "title": title,
        "message": message,
        "orderId": order_id,
        "read": False,
        "createdAt": datetime.now(
            timezone.utc
        ).isoformat()
    }

    notifications.append(notification)

    save_rider_notifications(notifications)

    return notification

def load_rider_payments():
    if not RIDER_PAYMENTS_FILE.exists():
        return []

    try:
        return json.loads(
            RIDER_PAYMENTS_FILE.read_text(
                encoding="utf-8"
            )
        )
    except json.JSONDecodeError:
        return []


def save_rider_payments(payments):
    RIDER_PAYMENTS_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    RIDER_PAYMENTS_FILE.write_text(
        json.dumps(
            payments,
            indent=2,
            ensure_ascii=False
        ),
        encoding="utf-8"
    )

# =========================================================
# ADMIN SESSION FUNCTIONS
# =========================================================

def create_admin_session(email):
    token = secrets.token_urlsafe(48)

    expires_at = (
        datetime.now(timezone.utc)
        + timedelta(hours=ADMIN_SESSION_EXPIRY_HOURS)
    )

    ADMIN_SESSIONS[token] = {
        "email": email,
        "expiresAt": expires_at
    }

    return token


def get_admin_session(handler):
    cookie_header = handler.headers.get("Cookie", "")

    if not cookie_header:
        return None

    cookies = {}

    for part in cookie_header.split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            cookies[key] = value

    token = cookies.get("fiable_admin_session")

    if not token:
        return None

    session = ADMIN_SESSIONS.get(token)

    if not session:
        return None

    expires_at = session.get("expiresAt")

    if not expires_at:
        return None

    now = datetime.now(timezone.utc)

    if expires_at <= now:
        ADMIN_SESSIONS.pop(token, None)
        return None

    return session

def get_admin_email(handler):
    session = get_admin_session(handler)

    if not session:
        return None

    return session.get("email")


def clear_admin_session(handler):
    cookie_header = handler.headers.get("Cookie", "")

    if not cookie_header:
        return

    cookies = {}

    for part in cookie_header.split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            cookies[key] = value

    token = cookies.get("fiable_admin_session")

    if token:
        ADMIN_SESSIONS.pop(token, None)


def require_admin(handler):
    session = get_admin_session(handler)
    if not session:
        return False
    admin = get_current_admin(handler)
    return bool(admin) and admin.get("status") == "active"

def parse_iso_date(value):
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None

def create_rider_session(rider_id):
    token = secrets.token_urlsafe(48)

    expires_at = (
        datetime.now(timezone.utc)
        + timedelta(hours=RIDER_SESSION_EXPIRY_HOURS)
    )

    RIDER_SESSIONS[token] = {
        "riderId": rider_id,
        "expiresAt": expires_at
    }

    return token


def logged_in_rider_ids():
    now = datetime.now(timezone.utc)
    active_rider_ids = set()

    for token, session in list(RIDER_SESSIONS.items()):
        expires_at = session.get("expiresAt")
        if not expires_at or expires_at <= now:
            RIDER_SESSIONS.pop(token, None)
            continue
        active_rider_ids.add(str(session.get("riderId", "")))

    return active_rider_ids


def get_rider_session(handler):
    cookie_header = handler.headers.get("Cookie", "")

    if not cookie_header:
        return None

    cookies = {}

    for part in cookie_header.split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            cookies[key] = value

    token = cookies.get("fiable_rider_session")

    if not token:
        return None

    session = RIDER_SESSIONS.get(token)

    if not session:
        return None

    expires_at = session.get("expiresAt")

    if not expires_at:
        RIDER_SESSIONS.pop(token, None)
        return None

    now = datetime.now(timezone.utc)

    if expires_at <= now:
        RIDER_SESSIONS.pop(token, None)
        return None

    return session


def clear_rider_session(handler):
    session = get_rider_session(handler)

    if not session:
        return

    cookie_header = handler.headers.get("Cookie", "")

    cookies = {}

    for part in cookie_header.split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            cookies[key] = value

    token = cookies.get("fiable_rider_session")

    if token:
        RIDER_SESSIONS.pop(token, None)


def get_logged_in_rider(handler):

    session = get_rider_session(
        handler
    )

    if not session:
        return None

    rider_id = session.get(
        "riderId"
    )

    if rider_id is None:
        return None

    riders = load_riders()

    rider = next(
        (
            item
            for item in riders
            if str(
                item.get("id", "")
            ) == str(rider_id)
        ),
        None
    )

    return rider


# =========================================================
# VENDOR SESSION HELPERS
# =========================================================

def create_vendor_session(email):
    token = secrets.token_urlsafe(48)
    VENDOR_SESSIONS[token] = {
        "email": (email or "").strip().lower(),
        "expiresAt": datetime.now(timezone.utc) + timedelta(hours=VENDOR_SESSION_EXPIRY_HOURS),
    }
    return token


def _parse_cookies(handler):
    cookie_header = handler.headers.get("Cookie", "")
    cookies = {}
    for part in cookie_header.split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            cookies[key] = value
    return cookies


def get_vendor_session(handler):
    token = _parse_cookies(handler).get("fiable_vendor_session")
    if not token:
        return None
    session = VENDOR_SESSIONS.get(token)
    if not session:
        return None
    if session.get("expiresAt", datetime.min.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc):
        VENDOR_SESSIONS.pop(token, None)
        return None
    return session


def get_logged_in_vendor_email(handler):
    session = get_vendor_session(handler)
    return session.get("email") if session else None


def clear_vendor_session(handler):
    token = _parse_cookies(handler).get("fiable_vendor_session")
    if token:
        VENDOR_SESSIONS.pop(token, None)


def summary_for_account(account):
    plan = account.get("plan") if account.get("plan") in PLANS else None
    units_allocated = PLANS[plan]["units"] if plan else 0
    units_allocated += int(account.get("manualUnitAdjustment", 0) or 0)
    units_used = units_used_for_account(account["email"])
    units_remaining = max(units_allocated - units_used, 0)
    payment_status = account.get("paymentStatus", "pending")
    paid_at = parse_iso_date(account.get("paidAt") or account.get("createdAt"))
    renewal_date = None
    grace_period_end = None
    days_until_renewal = None
    grace_days_remaining = None
    now = datetime.now(timezone.utc)
    if paid_at:
        renewal = paid_at + timedelta(days=30)
        grace_end = renewal + timedelta(days=3)
        renewal_date = renewal.isoformat()
        grace_period_end = grace_end.isoformat()
        days_until_renewal = (renewal - now).days
        if now > renewal and now <= grace_end:
            grace_days_remaining = max((grace_end - now).days, 0)
    subscription_state = "no_plan"
    if plan and payment_status != "paid":
        subscription_state = "pending_payment"
    elif plan and payment_status == "paid":
        if paid_at:
            if now <= renewal:
                subscription_state = "active"
                if days_until_renewal <= 7:
                    subscription_state = "expiring_soon"
            elif now <= grace_end:
                subscription_state = "grace_period"
            else:
                subscription_state = "expired"
                units_remaining = 0
        else:
            subscription_state = "active"
    stats = dashboard_stats_for_account(account["email"])
    total_deliveries = stats["total"]
    completed = stats["counts"].get("delivered", 0)
    success_rate = round(
        (completed / total_deliveries * 100), 1
    ) if total_deliveries else 0.0
    return {
        "subscriberId": account.get("subscriberId"),
        "email": account["email"],
        "name": account["name"],
        "plan": plan,
        "paidAt": account.get("paidAt"),
        "unitsAllocated": units_allocated,
        "unitsUsed": units_used,
        "unitsRemaining": units_remaining,
        "paymentStatus": payment_status,
        "subscriptionState": subscription_state,
        "renewalDate": renewal_date,
        "gracePeriodEnd": grace_period_end,
        "daysUntilRenewal": days_until_renewal,
        "graceDaysRemaining": grace_days_remaining,
        "deliveryStats": stats,
        "successRate": success_rate,
    }

def admin_summary():
    accounts = load_accounts()
    deliveries = load_deliveries()

    vendor_summaries = [
        summary_for_account(account)
        for account in accounts
    ]

    total_vendors = len(vendor_summaries)

    active_subscribers = sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] in ("active", "expiring_soon", "grace_period")
    )

    pending_payment = sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "pending_payment"
    )

    expired_subscriptions = sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "expired"
    )

    no_plan = sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "no_plan"
    )

    delivery_counts = {
        "requested": 0,
        "assigned": 0,
        "in-transit": 0,
        "on_delivery": 0,
        "delivered": 0,
        "failed": 0,
        "cancelled": 0
    }

    for delivery in deliveries:
        status = delivery.get("status", "requested")

        if status in delivery_counts:
            delivery_counts[status] += 1

    total_orders = len(deliveries)

    total_units_allocated = sum(
        account["unitsAllocated"]
        for account in vendor_summaries
    )

    total_units_used = sum(
        account["unitsUsed"]
        for account in vendor_summaries
    )

    total_units_remaining = sum(
        account["unitsRemaining"]
        for account in vendor_summaries
    )

    return {
        "vendors": {
            "total": total_vendors,
            "items": vendor_summaries
        },

        "subscriptions": {
    "active": sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "active"
    ),
    "expiringSoon": sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "expiring_soon"
    ),
    "gracePeriod": sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "grace_period"
    ),
    "pendingPayment": sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "pending_payment"
    ),
    "expired": sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "expired"
    ),
    "noPlan": sum(
        1 for account in vendor_summaries
        if account["subscriptionState"] == "no_plan"
    )
},

        "orders": {
            "total": total_orders,
            "requested": delivery_counts["requested"],
            "assigned": delivery_counts["assigned"],
            "inTransit": delivery_counts["in-transit"],
            "on_delivery": delivery_counts["on_delivery"],
            "delivered": delivery_counts["delivered"],
            "failed": delivery_counts["failed"],
            "cancelled": delivery_counts["cancelled"]
        },

        "units": {
            "allocated": total_units_allocated,
            "used": total_units_used,
            "remaining": total_units_remaining
        }
    }


def saved_plan_for_email(email):
    if not DATA_FILE.exists():
        return None
    try:
        submissions = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    for submission in reversed(submissions):
        data = submission.get("data", {})
        plan = data.get("plan")
        if submission.get("type") == "vendor" and data.get("email", "").lower() == email and plan in PLANS:
            return plan
    return None


# =========================================================
# DELIVERY LIFECYCLE
# =========================================================
# Linear happy-path flow. Existing records already use
# "requested"/"assigned"/"on_delivery"/"delivered" so those values are
# kept as-is (no data migration needed); the new intermediate statuses
# are inserted between "assigned" and "on_delivery".
DELIVERY_STATUS_FLOW = [
    "requested",
    "assigned",
    "rider_accepted",
    "arriving_at_pickup",
    "picked_up",
    "on_delivery",
    "delivered",
]
DELIVERY_EXCEPTION_STATUSES = {"failed", "cancelled", "returned"}
DELIVERY_STATUS_LABELS = {
    "requested": "Pending",
    "assigned": "Assigned",
    "rider_accepted": "Rider Accepted",
    "arriving_at_pickup": "Arriving at Pickup",
    "picked_up": "Picked Up",
    "on_delivery": "In Transit",
    "delivered": "Delivered",
    "failed": "Failed",
    "cancelled": "Cancelled",
    "returned": "Returned",
}
# Safe subset of the flow surfaced on the public tracking page.
PUBLIC_TRACKING_STATUS_MAP = {
    "requested": "Order Received",
    "assigned": "Rider Assigned",
    "rider_accepted": "Rider Assigned",
    "arriving_at_pickup": "Rider Assigned",
    "picked_up": "Picked Up",
    "on_delivery": "In Transit",
    "delivered": "Delivered",
    "failed": "Delivery Issue",
    "cancelled": "Cancelled",
    "returned": "Returned",
}

# Which proof-of-delivery methods Fiable currently requires. Toggle here;
# no other code changes are needed to relax/tighten requirements.
PROOF_OF_DELIVERY_REQUIREMENTS = {
    "requireRecipientName": True,
    "requireOtp": False,
    "requirePhoto": True,
    "requireSignature": False,
    "requireGps": False,
}

PROOF_DIR = DATA_DIR / "proof"
AUDIT_LOG_FILE = DATA_DIR / "audit_log.json"
UNIT_ADJUSTMENTS_FILE = DATA_DIR / "unit_adjustments.json"
SUPPORT_TICKETS_FILE = DATA_DIR / "support_tickets.json"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def next_delivery_status(current):
    try:
        index = DELIVERY_STATUS_FLOW.index(current)
    except ValueError:
        return None
    if index + 1 < len(DELIVERY_STATUS_FLOW):
        return DELIVERY_STATUS_FLOW[index + 1]
    return None


def append_delivery_event(order, status, actor_type, actor_id=None, actor_name=None, note=None):
    """Append a status change to the delivery's permanent timeline (never overwritten)."""
    order.setdefault("timeline", [])
    order["timeline"].append({
        "status": status,
        "label": DELIVERY_STATUS_LABELS.get(status, status),
        "at": now_iso(),
        "actorType": actor_type,
        "actorId": actor_id,
        "actorName": actor_name,
        "note": note,
    })


def generate_tracking_code():
    return secrets.token_hex(5).upper()


def ensure_tracking_code(order):
    if not order.get("trackingCode"):
        order["trackingCode"] = generate_tracking_code()
    return order["trackingCode"]


def generate_delivery_otp():
    return f"{secrets.randbelow(1_000_000):06d}"


ALLOWED_PROOF_MIME_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}
MAX_PROOF_FILE_BYTES = 5 * 1024 * 1024


def save_proof_file(order_id, kind, data_url):
    """Decode+validate a base64 data URL and store it under data/proof/,
    a path that is never reachable through static file serving."""
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        raise ValueError(f"Invalid {kind} upload.")
    try:
        header, encoded = data_url.split(",", 1)
    except ValueError:
        raise ValueError(f"Invalid {kind} upload.")
    mime = header.split(";")[0].replace("data:", "").strip().lower()
    extension = ALLOWED_PROOF_MIME_TYPES.get(mime)
    if not extension:
        raise ValueError(f"Unsupported {kind} file type.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        raise ValueError(f"Could not decode {kind} upload.")
    if not raw:
        raise ValueError(f"{kind.capitalize()} upload is empty.")
    if len(raw) > MAX_PROOF_FILE_BYTES:
        raise ValueError(f"{kind.capitalize()} file is too large (max 5MB).")
    PROOF_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{int(order_id)}-{kind}-{secrets.token_hex(8)}{extension}"
    (PROOF_DIR / filename).write_bytes(raw)
    return filename


def load_json_list(path):
    if not path.exists():
        return []
    try:
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            return []
        data = json.loads(content)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_json_list(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# =========================================================
# AUDIT LOG (append-only; no admin-facing edit/delete endpoint)
# =========================================================

def append_audit_log(actor_email, actor_role, action, target_type=None, target_id=None, previous=None, new=None, note=None):
    log = load_json_list(AUDIT_LOG_FILE)
    entry = {
        "id": secrets.token_urlsafe(12),
        "at": now_iso(),
        "actorEmail": actor_email,
        "actorRole": actor_role,
        "action": action,
        "targetType": target_type,
        "targetId": target_id,
        "previousValue": previous,
        "newValue": new,
        "note": note,
    }
    log.append(entry)
    save_json_list(AUDIT_LOG_FILE, log)
    return entry


def audit_admin_action(handler, action, target_type=None, target_id=None, previous=None, new=None, note=None):
    admin = get_current_admin(handler)
    append_audit_log(
        actor_email=admin.get("email") if admin else None,
        actor_role=admin.get("role") if admin else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        previous=previous,
        new=new,
        note=note,
    )


# =========================================================
# ROLE-BASED ADMIN PERMISSIONS
# =========================================================
# "owner"/"staff" are the original two roles and are kept for backward
# compatibility with existing admin_credentials.json records. New admins
# can be created directly with one of the granular roles below.
ADMIN_ROLE_LABELS = {
    "super_admin": "Super Admin",
    "operations_manager": "Operations Manager",
    "dispatcher": "Dispatcher",
    "finance": "Finance",
    "customer_support": "Customer Support",
    "analyst": "Analyst (Read Only)",
    "owner": "Super Admin",
    "staff": "Operations Manager",
}

# Roles that can be assigned to a NEW admin via the team-management
# endpoints. "owner" is the legacy bootstrap role and is not reassignable
# here; use "super_admin" for equivalent full access instead.
ADMIN_ASSIGNABLE_ROLES = {
    "super_admin", "operations_manager", "dispatcher", "finance",
    "customer_support", "analyst", "staff",
}

ADMIN_PERMISSIONS = {
    "super_admin": {"*"},
    "owner": {"*"},
    "operations_manager": {
        "view_orders", "manage_orders", "view_riders", "manage_riders",
        "view_vendors", "manage_vendors", "view_tickets", "manage_tickets",
        "view_reports", "export_data", "view_audit_log", "view_team",
    },
    "staff": {
        "view_orders", "manage_orders", "view_riders", "manage_riders",
        "view_vendors", "manage_vendors", "view_tickets", "manage_tickets",
        "view_reports", "export_data",
    },
    "dispatcher": {"view_orders", "manage_orders", "view_riders", "view_reports"},
    "finance": {
        "view_finance", "manage_finance", "view_vendors", "view_reports",
        "export_data",
    },
    "customer_support": {
        "view_tickets", "manage_tickets", "view_orders", "view_vendors",
        "view_reports",
    },
    "analyst": {
        "view_orders", "view_riders", "view_vendors", "view_finance",
        "view_tickets", "view_reports", "export_data",
    },
}


def admin_has_permission(admin, permission):
    if not admin or admin.get("status") != "active":
        return False
    perms = ADMIN_PERMISSIONS.get(admin.get("role", ""), set())
    return "*" in perms or permission in perms


def require_permission(handler, permission):
    """Returns the current admin if they hold `permission`, else None. Always
    enforced server-side - the frontend hiding a button is not authorization."""
    admin = get_current_admin(handler)
    if not admin_has_permission(admin, permission):
        return None
    return admin


# =========================================================
# HARD PASSWORD-CHANGE GATE
# =========================================================
# While mustChangePassword is true, an admin/rider may only reach these
# endpoints. Everything else under /api/admin/ or /api/rider/ is blocked -
# static pages/assets are untouched so the change-password screen can load.
ADMIN_PASSWORD_GATE_ALLOWLIST = {
    "/api/admin/change-password", "/api/admin/logout", "/api/admin/account",
}
RIDER_PASSWORD_GATE_ALLOWLIST = {
    "/api/rider/change-password", "/api/rider/logout", "/api/rider/account",
}


def password_change_gate(handler, path):
    """Returns an error message if this request must be blocked because the
    signed-in admin/rider still has a temporary password, else None."""
    if path.startswith("/api/admin/") and path not in ADMIN_PASSWORD_GATE_ALLOWLIST:
        admin = get_current_admin(handler)
        if admin and admin.get("mustChangePassword"):
            return "You must change your temporary password before continuing."
    if path.startswith("/api/rider/") and path not in RIDER_PASSWORD_GATE_ALLOWLIST:
        rider = get_logged_in_rider(handler)
        if rider and rider.get("mustChangePassword"):
            return "You must change your temporary password before continuing."
    return None


# =========================================================
# COOKIE SECURITY
# =========================================================

def is_secure_request(handler):
    """True when the original client request was HTTPS. Railway (and most
    hosts) terminate TLS and forward via X-Forwarded-Proto, so the app
    server itself sees plain HTTP - check that header rather than the
    handler's own scheme. FORCE_SECURE_COOKIES=1 can force it on for any
    other reverse-proxy setup; local `python server.py` over http:// is
    unaffected either way."""
    if os.environ.get("FORCE_SECURE_COOKIES") == "1":
        return True
    return handler.headers.get("X-Forwarded-Proto", "").lower() == "https"


def session_cookie(handler, name, value, max_age_seconds):
    secure = "; Secure" if is_secure_request(handler) else ""
    return f"{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_seconds}{secure}"


# =========================================================
# CSRF PROTECTION (double-submit cookie)
# =========================================================
# On every successful login (admin/rider/vendor) a second cookie,
# `fiable_csrf`, is issued alongside the session cookie. Unlike the session
# cookie it is NOT HttpOnly, so front-end JS can read it and echo it back
# as an `X-CSRF-Token` header on every state-changing (POST) request -
# see csrf.js. A request is rejected if the header is missing or doesn't
# match the cookie. Requests with no session cookie at all (login, signup,
# password reset, public tracking) are exempt since there is no session to
# forge a request against yet.
def generate_csrf_token():
    return secrets.token_urlsafe(32)


def csrf_cookie(handler, value, max_age_seconds):
    secure = "; Secure" if is_secure_request(handler) else ""
    return f"fiable_csrf={value}; Path=/; SameSite=Lax; Max-Age={max_age_seconds}{secure}"


# Login/logout are exempt: a stale or cross-portal session cookie (e.g. an
# old vendor session still active while attempting a rider login) must
# never be able to block a fresh login or a logout attempt - that would
# leave a user unable to either escape or re-establish their session.
CSRF_EXEMPT_PATHS = {
    "/api/admin/login", "/api/admin/logout",
    "/api/rider/login", "/api/rider/logout",
    "/api/login", "/api/logout",
}


def validate_csrf(handler, path):
    if path in CSRF_EXEMPT_PATHS:
        return True
    has_session = bool(
        get_admin_session(handler)
        or get_rider_session(handler)
        or get_vendor_session(handler)
    )
    if not has_session:
        return True
    cookie_token = _parse_cookies(handler).get("fiable_csrf", "")
    header_token = handler.headers.get("X-CSRF-Token", "")
    return bool(cookie_token) and bool(header_token) and hmac.compare_digest(cookie_token, header_token)


# =========================================================
# LOGIN RATE LIMITING (in-memory sliding window per IP+endpoint)
# =========================================================
LOGIN_ATTEMPT_WINDOW_MINUTES = 15
LOGIN_ATTEMPT_MAX = 8
LOGIN_ATTEMPTS = {}


def rate_limit_key(handler, scope):
    ip = handler.client_address[0] if getattr(handler, "client_address", None) else "unknown"
    return f"{scope}:{ip}"


def is_login_rate_limited(key):
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=LOGIN_ATTEMPT_WINDOW_MINUTES)
    attempts = [t for t in LOGIN_ATTEMPTS.get(key, []) if t > window_start]
    LOGIN_ATTEMPTS[key] = attempts
    return len(attempts) >= LOGIN_ATTEMPT_MAX


def record_login_failure(key):
    LOGIN_ATTEMPTS.setdefault(key, []).append(datetime.now(timezone.utc))


def clear_login_attempts(key):
    LOGIN_ATTEMPTS.pop(key, None)


# =========================================================
# SUPPORT TICKETS
# =========================================================
SUPPORT_TICKET_CATEGORIES = {
    "delayed_delivery", "rider_issue", "package_damaged", "package_missing",
    "incorrect_units_charge", "payment_issue", "subscription_issue", "other",
}
SUPPORT_TICKET_PRIORITIES = {"low", "normal", "high", "urgent"}
SUPPORT_TICKET_STATUSES = {"open", "in_progress", "resolved", "closed"}


def vendor_safe_ticket(ticket):
    """Strip admin-only internal notes before returning a ticket to a vendor."""
    safe = dict(ticket)
    safe.pop("internalNotes", None)
    return safe


def next_ticket_id(tickets):
    numbers = []
    for ticket in tickets:
        try:
            numbers.append(int(str(ticket.get("id", "")).replace("TCK-", "")))
        except ValueError:
            continue
    return f"TCK-{(max(numbers, default=0) + 1):05d}"


# =========================================================
# CSV EXPORTS
# =========================================================
# Fields that must never appear in an export, regardless of source record.
EXPORT_FORBIDDEN_FIELDS = {
    "passwordhash", "salt", "password", "token", "sessiontoken",
    "resettoken", "otp", "deliveryotp",
}


def csv_safe_row(row):
    return {
        key: value for key, value in row.items()
        if key.lower() not in EXPORT_FORBIDDEN_FIELDS
    }


def rows_to_csv(rows):
    if not rows:
        return ""
    fieldnames = sorted({key for row in rows for key in row.keys()})
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()


def build_export_csv(kind):
    if kind == "orders":
        accounts = load_accounts()
        vendor_names = {a.get("email", "").lower(): a.get("name", "") for a in accounts}
        rows = []
        for d in load_deliveries():
            rows.append(csv_safe_row({
                "orderRef": d.get("orderRef"),
                "trackingCode": d.get("trackingCode"),
                "vendorEmail": d.get("accountEmail"),
                "vendorName": vendor_names.get(str(d.get("accountEmail", "")).lower(), ""),
                "pickup": d.get("pickup"),
                "dropoff": d.get("dropoff"),
                "status": d.get("status"),
                "units": d.get("units"),
                "cost": d.get("cost"),
                "riderName": d.get("riderName"),
                "createdAt": d.get("createdAt"),
                "updatedAt": d.get("updatedAt"),
            }))
        return rows_to_csv(rows)

    if kind == "vendors":
        rows = [
            csv_safe_row({
                "email": a.get("email"), "name": a.get("name"),
                "subscriberId": a.get("subscriberId"), "plan": a.get("plan"),
                "paymentStatus": a.get("paymentStatus"), "createdAt": a.get("createdAt"),
            })
            for a in load_accounts()
        ]
        return rows_to_csv(rows)

    if kind == "subscriptions":
        rows = [csv_safe_row(s) for s in load_subscriptions()]
        return rows_to_csv(rows)

    if kind == "payments":
        rows = [
            csv_safe_row({
                "subscriberId": a.get("subscriberId"), "email": a.get("email"),
                "plan": a.get("plan"), "paymentStatus": a.get("paymentStatus"),
                "paidAt": a.get("paidAt"),
            })
            for a in load_accounts()
        ]
        return rows_to_csv(rows)

    if kind == "rider-payments":
        rows = [csv_safe_row(p) for p in load_rider_payments()]
        return rows_to_csv(rows)

    if kind == "performance":
        riders = load_riders()
        deliveries = load_deliveries()
        rows = []
        for rider in riders:
            rider_id = str(rider.get("id", ""))
            rider_deliveries = [d for d in deliveries if str(d.get("riderId", "")) == rider_id]
            delivered = [d for d in rider_deliveries if d.get("status") == "delivered"]
            failed = [d for d in rider_deliveries if d.get("status") in ("failed", "returned")]
            rows.append(csv_safe_row({
                "riderRef": rider.get("riderRef"), "name": rider.get("name"),
                "totalDeliveries": len(rider_deliveries), "delivered": len(delivered),
                "failed": len(failed), "vehicle": rider.get("vehicle"),
            }))
        return rows_to_csv(rows)

    return None


class FiableHandler(SimpleHTTPRequestHandler):
    def _json_response(self, status, body):
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 100_000:
            raise ValueError("Request is too large")
        return json.loads(self.rfile.read(length).decode("utf-8"))


    def do_POST(self):
        path = urlparse(self.path).path

        gate_message = password_change_gate(self, path)
        if gate_message:
            self._json_response(403, {"error": gate_message, "mustChangePassword": True})
            return

        if not validate_csrf(self, path):
            self._json_response(403, {"error": "Invalid or missing CSRF token. Please refresh and try again."})
            return

        try:
            payload = self._read_json()
            if not isinstance(payload, dict):
                raise ValueError("Request body must be an object")
            # =====================================================
            # RIDER LOGIN
            # =====================================================
            if path == "/api/rider/login":

                rate_key = rate_limit_key(self, "rider-login")
                if is_login_rate_limited(rate_key):
                    self._json_response(429, {"error": "Too many login attempts. Please try again later."})
                    return

                email = clean(
                    payload.get("email"),
                    160
                ).lower()

                password = clean(
                    payload.get("password"),
                    128
                )

                if not email or not password:

                    self._json_response(
                        400,
                        {
                            "error": "Rider email and password are required."
                        }
                    )

                    return


                riders = load_riders()

                rider = next(
                    (
                        item
                        for item in riders
                        if clean(
                            item.get("email"),
                            160
                        ).lower() == email
                    ),
                    None
                )


                if not rider:

                    record_login_failure(rate_key)

                    self._json_response(
                        401,
                        {
                            "error": "Invalid rider email or password."
                        }
                    )

                    return


                stored_hash = rider.get("passwordHash")
                stored_salt = rider.get("salt")


                if not stored_hash or not stored_salt:

                    self._json_response(
                        500,
                        {
                            "error": "Rider credentials are incomplete."
                        }
                    )

                    return


                valid_password = hmac.compare_digest(
                    stored_hash,
                    password_hash(
                        password,
                        stored_salt
                    )
                )


                if not valid_password:

                    record_login_failure(rate_key)

                    self._json_response(
                        401,
                        {
                            "error": "Invalid rider email or password."
                        }
                    )

                    return

                if rider.get("status") == "inactive":
                    rider["status"] = "available"

                clear_login_attempts(rate_key)

                rider["lastLoginAt"] = datetime.now(
                    timezone.utc
                ).isoformat()
                save_riders(riders)


                session_token = create_rider_session(
                    rider["id"]
                )


                body = json.dumps({
                    "message": "Rider login successful.",
                    "rider": {
                        "id": rider["id"],
                        "riderRef": rider.get("riderRef", ""),
                        "name": rider.get("name", ""),
                        "email": rider.get("email", ""),
                        "phone": rider.get("phone", ""),
                        "vehicle": rider.get("vehicle", ""),
                        "status": rider.get("status", "available"),
                        "mustChangePassword": bool(rider.get("mustChangePassword", False))
                    }
                }).encode("utf-8")


                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    "application/json; charset=utf-8"
                )

                self.send_header(
                    "Set-Cookie",
                    session_cookie(self, "fiable_rider_session", session_token, RIDER_SESSION_EXPIRY_HOURS * 60 * 60)
                )

                self.send_header(
                    "Set-Cookie",
                    csrf_cookie(self, generate_csrf_token(), RIDER_SESSION_EXPIRY_HOURS * 60 * 60)
                )

                self.send_header(
                    "Content-Length",
                    str(len(body))
                )

                self.end_headers()

                self.wfile.write(body)

                return

            if path == "/api/rider/change-password":
                rider = get_logged_in_rider(self)
                if not rider:
                    self._json_response(401, {"error": "Rider authentication required."})
                    return
                current_password = clean(payload.get("currentPassword"), 128)
                new_password = clean(payload.get("newPassword"), 128)
                if not current_password or not new_password:
                    self._json_response(400, {"error": "All password fields are required."})
                    return
                if len(new_password) < 8:
                    self._json_response(400, {"error": "New password must be at least 8 characters."})
                    return
                riders = load_riders()
                stored_rider = next(
                    (item for item in riders if str(item.get("id")) == str(rider.get("id"))),
                    None
                )
                if not stored_rider or not stored_rider.get("passwordHash") or not hmac.compare_digest(
                    stored_rider["passwordHash"],
                    password_hash(current_password, stored_rider.get("salt", ""))
                ):
                    self._json_response(401, {"error": "Current password is incorrect."})
                    return
                salt = secrets.token_hex(16)
                stored_rider["salt"] = salt
                stored_rider["passwordHash"] = password_hash(new_password, salt)
                stored_rider["passwordChangedAt"] = datetime.now(timezone.utc).isoformat()
                stored_rider["mustChangePassword"] = False
                save_riders(riders)
                self._json_response(200, {"message": "Password changed successfully."})
                return

            if path == "/api/rider/forgot-password":
                email = clean(payload.get("email"), 160).lower()
                if not valid_email(email):
                    self._json_response(400, {"error": "Enter a valid email address."})
                    return
                rider = next((item for item in load_riders() if item.get("email", "").lower() == email), None)
                if not rider:
                    self._json_response(202, {"message": "If an account exists for this email, a password reset link has been created."})
                    return
                token = create_reset_token(email)
                self._json_response(202, {
                    "message": "Password reset link created.",
                    "resetLink": f"/rider.html?reset={token}"
                })
                return

            if path == "/api/rider/reset-password":
                token = clean(payload.get("token"), 200)
                new_password = clean(payload.get("password"), 128)
                confirm_password = clean(payload.get("confirmPassword"), 128)
                reset_data = verify_reset_token(token)
                if not reset_data or len(new_password) < 8 or new_password != confirm_password:
                    self._json_response(400, {"error": "The reset link or password is invalid."})
                    return
                riders = load_riders()
                rider = next((item for item in riders if item.get("email", "").lower() == reset_data["email"].lower()), None)
                if not rider:
                    self._json_response(400, {"error": "Rider account not found."})
                    return
                salt = secrets.token_hex(16)
                rider["salt"] = salt
                rider["passwordHash"] = password_hash(new_password, salt)
                rider["passwordResetAt"] = datetime.now(timezone.utc).isoformat()
                save_riders(riders)
                consume_reset_token(token)
                self._json_response(200, {"message": "Password reset successfully."})
                return

            # =====================================================
            # RIDER LOGOUT
            # =====================================================

            if path == "/api/rider/logout":

                clear_rider_session(self)

                body = json.dumps({
                    "message":
                        "Rider logged out successfully."
                }).encode("utf-8")

                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    "application/json; charset=utf-8"
                )

                self.send_header(
                    "Set-Cookie",
                    session_cookie(self, "fiable_rider_session", "", 0)
                )

                self.send_header(
                    "Set-Cookie",
                    csrf_cookie(self, "", 0)
                )

                self.send_header(
                    "Content-Length",
                    str(len(body))
                )

                self.end_headers()

                self.wfile.write(body)

                return
            # =====================================================
            # RIDER UPDATE DELIVERY STATUS
            # =====================================================

            if path == "/api/rider/delivery/status":

                rider = get_logged_in_rider(self)

                if not rider:
                    self._json_response(
                        401,
                        {
                            "error": "Rider authentication required."
                        }
                    )
                    return

                order_id = payload.get("orderId")

                new_status = clean(
                    payload.get("status"),
                    40
                ).strip().lower()

                note = clean(payload.get("note"), 300) or None

                try:
                    order_id = int(order_id)
                except (TypeError, ValueError):
                    self._json_response(
                        400,
                        {
                            "error": "A valid order ID is required."
                        }
                    )
                    return

                # "delivered" requires proof of delivery - see
                # /api/rider/delivery/complete. Accept/decline have their
                # own dedicated endpoints too.
                allowed_forward_statuses = {
                    "arriving_at_pickup",
                    "picked_up",
                    "on_delivery",
                }
                allowed_exception_statuses = {"failed", "returned"}

                if new_status not in allowed_forward_statuses | allowed_exception_statuses:
                    self._json_response(
                        400,
                        {
                            "error": "Invalid delivery status."
                        }
                    )
                    return

                deliveries = load_deliveries()
                riders = load_riders()

                rider_id = str(rider.get("id", ""))

                rider = next(
                    (item for item in riders if str(item.get("id", "")) == rider_id),
                    None
                )

                if not rider:
                    self._json_response(404, {"error": "Rider account not found."})
                    return

                order = next(
                    (item for item in deliveries if str(item.get("id", "")) == str(order_id)),
                    None
                )

                if not order:
                    self._json_response(404, {"error": "Order not found."})
                    return

                order_rider_id = str(order.get("riderId", ""))

                if order_rider_id != rider_id:
                    self._json_response(
                        403,
                        {"error": "You are not assigned to this delivery."}
                    )
                    return

                current_status = str(order.get("status", "")).strip().lower()

                is_forward_move = (
                    new_status in allowed_forward_statuses
                    and new_status == next_delivery_status(current_status)
                )
                is_exception_move = (
                    new_status in allowed_exception_statuses
                    and current_status not in (
                        {"delivered"} | DELIVERY_EXCEPTION_STATUSES
                    )
                )

                if not (is_forward_move or is_exception_move):
                    self._json_response(
                        400,
                        {
                            "error": "This delivery cannot move to that status from its current status."
                        }
                    )
                    return

                order["status"] = new_status

                if new_status == "picked_up" and not order.get("deliveryOtp"):
                    # Recipient OTP - shown to the vendor (who relays it to the
                    # recipient) since no SMS provider is configured yet, so it
                    # is never marked as automatically "sent".
                    order["deliveryOtp"] = generate_delivery_otp()
                    order["otpState"] = "generated"

                if new_status == "on_delivery":
                    rider["status"] = "on_delivery"
                elif new_status in allowed_exception_statuses:
                    has_queued_delivery = any(
                        str(delivery.get("riderId", "")) == rider_id
                        and str(delivery.get("status", "")).strip().lower()
                        not in ({"delivered"} | DELIVERY_EXCEPTION_STATUSES)
                        and delivery.get("id") != order.get("id")
                        for delivery in deliveries
                    )
                    rider["status"] = "assigned" if has_queued_delivery else "available"
                    if new_status == "failed":
                        rider["failedDeliveries"] = (
                            int(rider.get("failedDeliveries", 0) or 0) + 1
                        )

                order["updatedAt"] = now_iso()
                append_delivery_event(
                    order,
                    new_status,
                    actor_type="rider",
                    actor_id=rider.get("id"),
                    actor_name=rider.get("name"),
                    note=note,
                )

                save_deliveries(deliveries)
                save_riders(riders)

                self._json_response(
                    200,
                    {
                        "message": "Delivery status updated successfully.",
                        "order": order,
                        "rider": rider
                    }
                )

                return

            # =====================================================
            # RIDER ACCEPT / DECLINE ASSIGNMENT
            # =====================================================

            if path == "/api/rider/delivery/accept":

                rider = get_logged_in_rider(self)

                if not rider:
                    self._json_response(401, {"error": "Rider authentication required."})
                    return

                try:
                    order_id = int(payload.get("orderId"))
                except (TypeError, ValueError):
                    self._json_response(400, {"error": "A valid order ID is required."})
                    return

                deliveries = load_deliveries()
                riders = load_riders()
                rider_id = str(rider.get("id", ""))

                order = next(
                    (item for item in deliveries if str(item.get("id", "")) == str(order_id)),
                    None
                )

                if not order:
                    self._json_response(404, {"error": "Order not found."})
                    return

                if str(order.get("riderId", "")) != rider_id:
                    self._json_response(403, {"error": "You are not assigned to this delivery."})
                    return

                if str(order.get("status", "")).strip().lower() != "assigned":
                    self._json_response(400, {"error": "This delivery is not awaiting acceptance."})
                    return

                order["status"] = "rider_accepted"
                order["updatedAt"] = now_iso()
                append_delivery_event(
                    order, "rider_accepted", actor_type="rider",
                    actor_id=rider.get("id"), actor_name=rider.get("name"),
                )

                save_deliveries(deliveries)

                self._json_response(200, {"message": "Assignment accepted.", "order": order})
                return

            if path == "/api/rider/delivery/decline":

                rider = get_logged_in_rider(self)

                if not rider:
                    self._json_response(401, {"error": "Rider authentication required."})
                    return

                try:
                    order_id = int(payload.get("orderId"))
                except (TypeError, ValueError):
                    self._json_response(400, {"error": "A valid order ID is required."})
                    return

                reason = clean(payload.get("reason"), 300) or None

                deliveries = load_deliveries()
                riders = load_riders()
                rider_id = str(rider.get("id", ""))

                order = next(
                    (item for item in deliveries if str(item.get("id", "")) == str(order_id)),
                    None
                )

                if not order:
                    self._json_response(404, {"error": "Order not found."})
                    return

                if str(order.get("riderId", "")) != rider_id:
                    self._json_response(403, {"error": "You are not assigned to this delivery."})
                    return

                if str(order.get("status", "")).strip().lower() not in ("assigned", "rider_accepted"):
                    self._json_response(400, {"error": "This delivery cannot be declined in its current status."})
                    return

                rider_record = next(
                    (item for item in riders if str(item.get("id", "")) == rider_id),
                    None
                )

                # Return the delivery to the assignment queue.
                order["status"] = "requested"
                order["riderId"] = None
                order["riderRef"] = ""
                order["riderName"] = ""
                order["riderPhone"] = ""
                order["updatedAt"] = now_iso()
                append_delivery_event(
                    order, "requested", actor_type="rider",
                    actor_id=rider.get("id"), actor_name=rider.get("name"),
                    note=f"Declined by rider: {reason}" if reason else "Declined by rider",
                )

                if rider_record:
                    has_queued_delivery = any(
                        str(delivery.get("riderId", "")) == rider_id
                        and str(delivery.get("status", "")).strip().lower()
                        not in ({"delivered"} | DELIVERY_EXCEPTION_STATUSES)
                        and delivery.get("id") != order.get("id")
                        for delivery in deliveries
                    )
                    rider_record["status"] = "assigned" if has_queued_delivery else "available"

                save_deliveries(deliveries)
                save_riders(riders)

                append_audit_log(
                    actor_email=rider.get("email"),
                    actor_role="rider",
                    action="delivery_declined",
                    target_type="delivery",
                    target_id=order.get("id"),
                    note=reason,
                )

                self._json_response(200, {"message": "Assignment declined.", "order": order})
                return

            # =====================================================
            # RIDER COMPLETE DELIVERY WITH PROOF OF DELIVERY
            # =====================================================

            if path == "/api/rider/delivery/complete":

                rider = get_logged_in_rider(self)

                if not rider:
                    self._json_response(401, {"error": "Rider authentication required."})
                    return

                try:
                    order_id = int(payload.get("orderId"))
                except (TypeError, ValueError):
                    self._json_response(400, {"error": "A valid order ID is required."})
                    return

                deliveries = load_deliveries()
                riders = load_riders()
                rider_id = str(rider.get("id", ""))

                rider_record = next(
                    (item for item in riders if str(item.get("id", "")) == rider_id),
                    None
                )

                if not rider_record:
                    self._json_response(404, {"error": "Rider account not found."})
                    return

                order = next(
                    (item for item in deliveries if str(item.get("id", "")) == str(order_id)),
                    None
                )

                if not order:
                    self._json_response(404, {"error": "Order not found."})
                    return

                if str(order.get("riderId", "")) != rider_id:
                    self._json_response(403, {"error": "You are not assigned to this delivery."})
                    return

                if str(order.get("status", "")).strip().lower() != "on_delivery":
                    self._json_response(
                        400,
                        {"error": "This delivery cannot be completed in its current status."}
                    )
                    return

                recipient_name = clean(payload.get("recipientName"), 120)
                otp_input = clean(payload.get("otp"), 10)
                photo_data_url = payload.get("photo")
                signature_data_url = payload.get("signature")
                gps = payload.get("gps") if isinstance(payload.get("gps"), dict) else None

                requirements = PROOF_OF_DELIVERY_REQUIREMENTS
                missing = []

                if requirements.get("requireRecipientName") and not recipient_name:
                    missing.append("recipient name")
                if requirements.get("requireOtp"):
                    if not otp_input:
                        missing.append("delivery OTP")
                    elif not order.get("deliveryOtp") or not hmac.compare_digest(otp_input, str(order.get("deliveryOtp"))):
                        order["otpState"] = "failed"
                        save_deliveries(deliveries)
                        self._json_response(400, {"error": "The OTP entered does not match."})
                        return
                if requirements.get("requirePhoto") and not photo_data_url:
                    missing.append("delivery photo")
                if requirements.get("requireSignature") and not signature_data_url:
                    missing.append("recipient signature")
                if requirements.get("requireGps") and not (gps and gps.get("lat") is not None and gps.get("lng") is not None):
                    missing.append("GPS location")

                if missing:
                    self._json_response(
                        400,
                        {"error": f"Proof of delivery incomplete: missing {', '.join(missing)}."}
                    )
                    return

                photo_path = None
                signature_path = None

                try:
                    if photo_data_url:
                        photo_path = save_proof_file(order_id, "photo", photo_data_url)
                    if signature_data_url:
                        signature_path = save_proof_file(order_id, "signature", signature_data_url)
                except ValueError as error:
                    self._json_response(400, {"error": str(error)})
                    return

                order["status"] = "delivered"
                order["updatedAt"] = now_iso()
                if requirements.get("requireOtp") and otp_input:
                    order["otpState"] = "verified"
                order["proofOfDelivery"] = {
                    "recipientName": recipient_name or None,
                    "otpVerified": bool(requirements.get("requireOtp") and otp_input),
                    "deliveredAt": order["updatedAt"],
                    "photoPath": photo_path,
                    "signaturePath": signature_path,
                    "gps": {
                        "lat": gps.get("lat"), "lng": gps.get("lng")
                    } if gps and gps.get("lat") is not None and gps.get("lng") is not None else None,
                    "capturedByRiderId": rider_record.get("id"),
                }
                append_delivery_event(
                    order, "delivered", actor_type="rider",
                    actor_id=rider_record.get("id"), actor_name=rider_record.get("name"),
                    note="Proof of delivery captured",
                )

                has_queued_delivery = any(
                    str(delivery.get("riderId", "")) == rider_id
                    and str(delivery.get("status", "")).strip().lower()
                    not in ({"delivered"} | DELIVERY_EXCEPTION_STATUSES)
                    and delivery.get("id") != order.get("id")
                    for delivery in deliveries
                )
                rider_record["status"] = "assigned" if has_queued_delivery else "available"
                rider_record["totalDeliveries"] = int(rider_record.get("totalDeliveries", 0) or 0) + 1
                rider_record["completedDeliveries"] = int(rider_record.get("completedDeliveries", 0) or 0) + 1

                save_deliveries(deliveries)
                save_riders(riders)

                self._json_response(
                    200,
                    {
                        "message": "Delivery completed with proof of delivery.",
                        "order": order,
                        "rider": rider_record
                    }
                )
                return

            # =====================================================
            # SUPPORT TICKETS - VENDOR CREATE
            # =====================================================
            if path == "/api/tickets":
                email = get_logged_in_vendor_email(self)
                category = clean(payload.get("category"), 40).lower()
                description = clean(payload.get("description"), 2000)
                priority = clean(payload.get("priority"), 20).lower() or "normal"
                order_id = payload.get("orderId")

                if not email:
                    self._json_response(401, {"error": "Please log in to create a ticket."})
                    return
                if category not in SUPPORT_TICKET_CATEGORIES:
                    self._json_response(400, {"error": "Invalid ticket category."})
                    return
                if not description:
                    self._json_response(400, {"error": "A description is required."})
                    return
                if priority not in SUPPORT_TICKET_PRIORITIES:
                    priority = "normal"

                account = next((a for a in load_accounts() if a.get("email", "").lower() == email), None)
                if not account:
                    self._json_response(404, {"error": "Vendor account not found."})
                    return

                try:
                    order_id = int(order_id) if order_id not in (None, "") else None
                except (TypeError, ValueError):
                    order_id = None

                if order_id is not None:
                    related_order = next(
                        (d for d in load_deliveries() if d.get("id") == order_id),
                        None
                    )
                    if not related_order or str(related_order.get("accountEmail", "")).lower() != email:
                        self._json_response(403, {"error": "You cannot link a ticket to another account's order."})
                        return

                tickets = load_json_list(SUPPORT_TICKETS_FILE)
                ticket = {
                    "id": next_ticket_id(tickets),
                    "vendorEmail": email,
                    "vendorName": account.get("name", ""),
                    "orderId": order_id,
                    "category": category,
                    "description": description,
                    "priority": priority,
                    "status": "open",
                    "assignedTo": None,
                    "replies": [],
                    "internalNotes": [],
                    "createdAt": now_iso(),
                    "updatedAt": now_iso(),
                }
                tickets.append(ticket)
                save_json_list(SUPPORT_TICKETS_FILE, tickets)

                self._json_response(201, {"message": "Ticket created.", "ticket": vendor_safe_ticket(ticket)})
                return

            if path == "/api/admin/tickets/assign":
                admin = require_permission(self, "manage_tickets")
                if not admin:
                    self._json_response(403, {"error": "You do not have permission to assign tickets."})
                    return
                ticket_id = clean(payload.get("ticketId"), 20)
                assignee_email = clean(payload.get("assigneeEmail"), 160).lower()
                tickets = load_json_list(SUPPORT_TICKETS_FILE)
                ticket = next((t for t in tickets if t.get("id") == ticket_id), None)
                if not ticket:
                    self._json_response(404, {"error": "Ticket not found."})
                    return
                previous = ticket.get("assignedTo")
                ticket["assignedTo"] = assignee_email or None
                ticket["updatedAt"] = now_iso()
                save_json_list(SUPPORT_TICKETS_FILE, tickets)
                audit_admin_action(self, "ticket_assigned", "ticket", ticket_id, previous, assignee_email)
                self._json_response(200, {"message": "Ticket assigned.", "ticket": ticket})
                return

            if path == "/api/admin/tickets/respond":
                admin = require_permission(self, "manage_tickets")
                if not admin:
                    self._json_response(403, {"error": "You do not have permission to respond to tickets."})
                    return
                ticket_id = clean(payload.get("ticketId"), 20)
                message = clean(payload.get("message"), 2000)
                if not message:
                    self._json_response(400, {"error": "A response message is required."})
                    return
                tickets = load_json_list(SUPPORT_TICKETS_FILE)
                ticket = next((t for t in tickets if t.get("id") == ticket_id), None)
                if not ticket:
                    self._json_response(404, {"error": "Ticket not found."})
                    return
                ticket.setdefault("replies", []).append({
                    "from": "admin", "authorEmail": admin.get("email"),
                    "message": message, "at": now_iso(),
                })
                ticket["updatedAt"] = now_iso()
                save_json_list(SUPPORT_TICKETS_FILE, tickets)
                audit_admin_action(self, "ticket_response_added", "ticket", ticket_id)
                self._json_response(200, {"message": "Response added.", "ticket": ticket})
                return

            if path == "/api/admin/tickets/note":
                admin = require_permission(self, "manage_tickets")
                if not admin:
                    self._json_response(403, {"error": "You do not have permission to add internal notes."})
                    return
                ticket_id = clean(payload.get("ticketId"), 20)
                note = clean(payload.get("note"), 2000)
                if not note:
                    self._json_response(400, {"error": "A note is required."})
                    return
                tickets = load_json_list(SUPPORT_TICKETS_FILE)
                ticket = next((t for t in tickets if t.get("id") == ticket_id), None)
                if not ticket:
                    self._json_response(404, {"error": "Ticket not found."})
                    return
                # Internal notes are never returned to vendor-facing endpoints (see vendor_safe_ticket).
                ticket.setdefault("internalNotes", []).append({
                    "authorEmail": admin.get("email"), "note": note, "at": now_iso(),
                })
                ticket["updatedAt"] = now_iso()
                save_json_list(SUPPORT_TICKETS_FILE, tickets)
                audit_admin_action(self, "ticket_internal_note_added", "ticket", ticket_id)
                self._json_response(200, {"message": "Internal note added.", "ticket": ticket})
                return

            if path == "/api/admin/tickets/status":
                admin = require_permission(self, "manage_tickets")
                if not admin:
                    self._json_response(403, {"error": "You do not have permission to update ticket status."})
                    return
                ticket_id = clean(payload.get("ticketId"), 20)
                new_status = clean(payload.get("status"), 20).lower()
                if new_status not in SUPPORT_TICKET_STATUSES:
                    self._json_response(400, {"error": "Invalid ticket status."})
                    return
                tickets = load_json_list(SUPPORT_TICKETS_FILE)
                ticket = next((t for t in tickets if t.get("id") == ticket_id), None)
                if not ticket:
                    self._json_response(404, {"error": "Ticket not found."})
                    return
                previous = ticket.get("status")
                ticket["status"] = new_status
                ticket["updatedAt"] = now_iso()
                save_json_list(SUPPORT_TICKETS_FILE, tickets)
                audit_admin_action(self, "ticket_status_changed", "ticket", ticket_id, previous, new_status)
                self._json_response(200, {"message": "Ticket status updated.", "ticket": ticket})
                return

            # =====================================================
            # MANUAL VENDOR UNIT ADJUSTMENT
            # =====================================================
            if path == "/api/admin/vendors/adjust-units":
                admin = require_permission(self, "manage_vendors")
                if not admin:
                    self._json_response(403, {"error": "You do not have permission to adjust vendor units."})
                    return

                email = clean(payload.get("email"), 160).lower()
                reason = clean(payload.get("reason"), 500)
                try:
                    delta = int(payload.get("units"))
                except (TypeError, ValueError):
                    self._json_response(400, {"error": "A whole-number unit adjustment is required."})
                    return
                if delta == 0:
                    self._json_response(400, {"error": "The adjustment must be non-zero."})
                    return
                if not reason:
                    self._json_response(400, {"error": "A reason is required for every unit adjustment."})
                    return

                accounts = load_accounts()
                account = next((a for a in accounts if a.get("email", "").lower() == email), None)
                if not account:
                    self._json_response(404, {"error": "Vendor account not found."})
                    return

                previous_balance = int(account.get("manualUnitAdjustment", 0) or 0)
                new_balance = previous_balance + delta
                account["manualUnitAdjustment"] = new_balance
                ACCOUNTS_FILE.write_text(json.dumps(accounts, indent=2), encoding="utf-8")

                entries = load_json_list(UNIT_ADJUSTMENTS_FILE)
                entry = {
                    "id": secrets.token_urlsafe(10),
                    "email": email,
                    "unitsDelta": delta,
                    "reason": reason,
                    "adminEmail": admin.get("email"),
                    "previousBalance": previous_balance,
                    "newBalance": new_balance,
                    "at": now_iso(),
                }
                entries.append(entry)
                save_json_list(UNIT_ADJUSTMENTS_FILE, entries)

                audit_admin_action(
                    self, "manual_unit_adjustment", "vendor", email,
                    previous=previous_balance, new=new_balance, note=reason,
                )

                self._json_response(200, {"message": "Units adjusted.", "adjustment": entry})
                return

            if path == "/api/calculate":
                email = clean(payload.get("email"), 160).lower()
                account = next(
                    (item for item in load_accounts() if item["email"] == email),
                    None
                ) if email else None
                result = estimate_delivery(
                    clean(payload.get("pickup"), 80),
                    clean(payload.get("dropoff"), 80),
                    account.get("plan") if account else None,
                    clean(payload.get("priority"), 40) or "Standard"
                )
                self._json_response(200, result)
                return
            if path in ("/api/vendor", "/api/contact"):
                name = clean(payload.get("name"), 120)
                email = clean(payload.get("email"), 160).lower()
                if not name or not valid_email(email):
                    raise ValueError("A name and valid email address are required")
                if path == "/api/vendor":
                    password = clean(payload.get("password"), 128)
                    if len(password) < 8:
                        raise ValueError("Your password must be at least 8 characters")
                    selected_plan = clean(payload.get("plan"), 40) or None
                    create_account(email, name, password, selected_plan)
                saved = save_submission("vendor" if path.endswith("vendor") else "contact", {
                    key: clean(value) for key, value in payload.items() if key != "password"
                })
                message = "Account created. You can now log in." if path == "/api/vendor" else "Request received"
                self._json_response(201, {"id": saved["id"], "message": message})
                return
            # =====================================================
            # ADMIN LOGIN
            # =====================================================

            if path == "/api/admin/login":

                rate_key = rate_limit_key(self, "admin-login")
                if is_login_rate_limited(rate_key):
                    self._json_response(429, {"error": "Too many login attempts. Please try again later."})
                    return

                email = clean(
                    payload.get("email"),
                    160
                ).lower()

                password = clean(
                    payload.get("password"),
                    128
                )

                if not email or not password:

                    self._json_response(
                        400,
                        {
                            "error": "Admin email and password are required."
                        }
                    )

                    return


                # -------------------------------------------------
                # ADMIN CREDENTIALS
                # -------------------------------------------------

                admins = load_admin_credentials()

                matched_admin = find_admin_by_email(admins, email)

                if not matched_admin:

                    record_login_failure(rate_key)

                    self._json_response(
                        401,
                        {
                            "error": "Invalid admin email or password."
                        }
                    )

                    return


                admin_password_hash = matched_admin.get("passwordHash")
                admin_salt = matched_admin.get("salt")


                if not admin_password_hash or not admin_salt:

                    self._json_response(
                        500,
                        {
                            "error": "Admin credentials are incomplete."
                        }
                    )

                    return


                valid_password_login = hmac.compare_digest(
                    admin_password_hash,
                    password_hash(
                        password,
                        admin_salt
                    )
                )


                if not valid_password_login:

                    record_login_failure(rate_key)

                    self._json_response(
                        401,
                        {
                            "error": "Invalid admin email or password."
                        }
                    )

                    return


                if matched_admin.get("status") == "revoked":

                    self._json_response(
                        403,
                        {
                            "error": "Your access has been revoked. Contact the account owner."
                        }
                    )

                    return


                # -------------------------------------------------
                # CREATE ADMIN SESSION
                # -------------------------------------------------

                clear_login_attempts(rate_key)

                session_token = create_admin_session(matched_admin.get("email"))

                append_audit_log(
                    actor_email=matched_admin.get("email"),
                    actor_role=matched_admin.get("role"),
                    action="admin_login",
                    target_type="admin",
                    target_id=matched_admin.get("id"),
                )


                body = json.dumps({
                    "message": "Admin login successful."
                }).encode("utf-8")


                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    "application/json; charset=utf-8"
                )

                self.send_header(
                    "Set-Cookie",
                    session_cookie(self, "fiable_admin_session", session_token, ADMIN_SESSION_EXPIRY_HOURS * 60 * 60)
                )

                self.send_header(
                    "Set-Cookie",
                    csrf_cookie(self, generate_csrf_token(), ADMIN_SESSION_EXPIRY_HOURS * 60 * 60)
                )

                self.send_header(
                    "Content-Length",
                    str(len(body))
                )

                self.end_headers()

                self.wfile.write(body)

                return


            # =====================================================
            # ADMIN LOGOUT
            # =====================================================

            if path == "/api/admin/logout":

                clear_admin_session(self)


                body = json.dumps({
                    "message": "Admin logged out successfully."
                }).encode("utf-8")


                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    "application/json; charset=utf-8"
                )

                self.send_header(
                    "Set-Cookie",
                    session_cookie(self, "fiable_admin_session", "", 0)
                )

                self.send_header(
                    "Set-Cookie",
                    csrf_cookie(self, "", 0)
                )

                self.send_header(
                    "Content-Length",
                    str(len(body))
                )

                self.end_headers()

                self.wfile.write(body)

                return

            # =====================================================
            # ADMIN FORGOT PASSWORD
            # =====================================================

            if path == "/api/admin/forgot-password":

                email = clean(
                    payload.get("email"),
                    160
                ).lower()

                if not valid_email(email):
                    self._json_response(
                        202,
                        {
                            "message": "If an account exists for this email, a password reset link has been created."
                        }
                    )
                    return

                admin_creds = load_admin_credentials()

                admin_exists = next(
                    (
                        item for item in admin_creds
                        if item.get("email", "").lower() == email
                    ),
                    None
                )

                # Don't reveal whether an account exists
                if not admin_exists:
                    self._json_response(
                        202,
                        {
                            "message": "If an account exists for this email, a password reset link has been created."
                        }
                    )
                    return

                token = create_reset_token(email)

                save_submission("admin-password-reset", {
                    "email": email,
                    "token": token
                })

                # LOCAL DEVELOPMENT ONLY
                reset_link = f"/admin-login.html?reset={token}"

                self._json_response(
                    202,
                    {
                        "message": "Password reset link created.",
                        "resetLink": reset_link
                    }
                )

                return

            # =====================================================
            # ADMIN RESET PASSWORD
            # =====================================================

            if path == "/api/admin/reset-password":

                token = clean(
                    payload.get("token"),
                    200
                )
                password = clean(
                    payload.get("password"),
                    128
                )
                confirm_password = clean(
                    payload.get("confirmPassword"),
                    128
                )

                if not token:
                    raise ValueError("Invalid or missing reset link")

                if len(password) < 8:
                    raise ValueError("Your password must be at least 8 characters")

                if password != confirm_password:
                    raise ValueError("Passwords do not match")

                reset_data = verify_reset_token(token)

                if not reset_data:
                    raise ValueError(
                        "This reset link is invalid or has expired. Please request a new one."
                    )

                email = reset_data["email"]

                admin_creds = load_admin_credentials()

                admin_found = False

                for admin in admin_creds:
                    if admin.get("email", "").lower() == email:
                        salt = secrets.token_hex(16)

                        admin["salt"] = salt
                        admin["passwordHash"] = password_hash(password, salt)
                        admin["passwordResetAt"] = datetime.now(timezone.utc).isoformat()

                        admin_found = True
                        break

                if not admin_found:
                    raise ValueError("Admin account not found")

                save_admin_credentials(admin_creds)

                consume_reset_token(token)

                self._json_response(
                    200,
                    {
                        "message": "Password reset successfully. Please log in with your new password."
                    }
                )

                return

            # =====================================================
            # ADMIN CHANGE PASSWORD
            # =====================================================

            if path == "/api/admin/change-password":

                current_admin_email = get_admin_email(self)

                if not current_admin_email:

                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
                        }
                    )

                    return


                currentPassword = clean(
                    payload.get("currentPassword"),
                    128
                )

                newPassword = clean(
                    payload.get("newPassword"),
                    128
                )


                if not currentPassword or not newPassword:

                    self._json_response(
                        400,
                        {
                            "error": "Current and new passwords are required."
                        }
                    )

                    return


                if len(newPassword) < 8:

                    self._json_response(
                        400,
                        {
                            "error": "New password must be at least 8 characters."
                        }
                    )

                    return


                admins = load_admin_credentials()

                target_admin = find_admin_by_email(admins, current_admin_email)

                if not target_admin:

                    self._json_response(
                        500,
                        {
                            "error": "Unable to load admin credentials."
                        }
                    )

                    return


                stored_hash = target_admin.get("passwordHash")
                stored_salt = target_admin.get("salt")


                if not stored_hash or not stored_salt:

                    self._json_response(
                        500,
                        {
                            "error": "Admin credentials are incomplete."
                        }
                    )

                    return


                valid = hmac.compare_digest(
                    stored_hash,
                    password_hash(
                        currentPassword,
                        stored_salt
                    )
                )


                if not valid:

                    self._json_response(
                        401,
                        {
                            "error": "Current password is incorrect."
                        }
                    )

                    return


                new_salt = secrets.token_hex(16)

                target_admin["passwordHash"] = password_hash(
                    newPassword,
                    new_salt
                )

                target_admin["salt"] = new_salt
                target_admin["mustChangePassword"] = False


                save_admin_credentials(admins)


                self._json_response(
                    200,
                    {
                        "message": "Admin password changed successfully."
                    }
                )

                return


            # =====================================================
            # ADMIN TEAM MANAGEMENT
            # =====================================================

            if path == "/api/admin/team/add":

                if not require_owner(self):
                    self._json_response(
                        403,
                        {"error": "Only the account owner can add admins."}
                    )
                    return

                new_email = clean(payload.get("email"), 160).lower()
                new_role = clean(payload.get("role"), 40).lower() or "staff"
                initial_password = clean(payload.get("password"), 128)

                if not valid_email(new_email):
                    self._json_response(400, {"error": "Enter a valid email address."})
                    return

                if new_role not in ADMIN_ASSIGNABLE_ROLES:
                    self._json_response(400, {"error": "Invalid role."})
                    return

                if len(initial_password) < 8:
                    self._json_response(
                        400,
                        {"error": "Initial password must be at least 8 characters."}
                    )
                    return

                admins = load_admin_credentials()

                if find_admin_by_email(admins, new_email):
                    self._json_response(
                        400,
                        {"error": "An admin with this email already exists."}
                    )
                    return

                next_id = max((int(item.get("id") or 0) for item in admins), default=0) + 1
                salt = secrets.token_hex(16)

                new_admin = {
                    "id": next_id,
                    "email": new_email,
                    "name": clean(payload.get("name"), 120) or new_email.split("@")[0],
                    "passwordHash": password_hash(initial_password, salt),
                    "salt": salt,
                    "role": new_role,
                    "status": "active",
                    "invitedBy": get_admin_email(self),
                    "mustChangePassword": True,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                }

                admins.append(new_admin)
                save_admin_credentials(admins)

                saved_admins = load_admin_credentials()
                if not find_admin_by_email(saved_admins, new_email):
                    self._json_response(
                        500,
                        {"error": "Admin account could not be saved."}
                    )
                    return

                audit_admin_action(
                    self, "admin_account_created", "admin", new_admin["id"],
                    new=new_role,
                )

                self._json_response(
                    201,
                    {
                        "message": "Admin added successfully.",
                        "admin": {
                            "id": new_admin["id"],
                            "email": new_admin["email"],
                            "name": new_admin["name"],
                            "role": new_admin["role"],
                            "status": new_admin["status"],
                            "createdAt": new_admin["createdAt"],
                        },
                    }
                )
                return

            if path == "/api/admin/team/role":

                if not require_owner(self):
                    self._json_response(
                        403,
                        {"error": "Only the account owner can update roles."}
                    )
                    return

                target_email = clean(payload.get("email"), 160).lower()
                new_role = clean(payload.get("role"), 40).lower()

                if new_role not in ADMIN_ASSIGNABLE_ROLES:
                    self._json_response(400, {"error": "Invalid role."})
                    return

                current_admin_email_lower = (get_admin_email(self) or "").lower()

                if target_email == current_admin_email_lower:
                    self._json_response(
                        400,
                        {"error": "You cannot change your own access."}
                    )
                    return

                admins = load_admin_credentials()
                target_admin = find_admin_by_email(admins, target_email)

                if not target_admin:
                    self._json_response(404, {"error": "Admin not found."})
                    return

                if target_admin.get("role") in ("owner", "super_admin"):
                    self._json_response(
                        400,
                        {"error": "The account owner's role cannot be changed."}
                    )
                    return

                target_admin["role"] = new_role
                save_admin_credentials(admins)

                audit_admin_action(
                    self, "admin_role_changed", "admin", target_email,
                    previous=target_admin.get("role"), new=new_role,
                )

                self._json_response(200, {"message": "Role updated successfully."})
                return

            if path in ("/api/admin/team/revoke", "/api/admin/team/restore"):

                if not require_owner(self):
                    self._json_response(
                        403,
                        {"error": "Only the account owner can manage admin access."}
                    )
                    return

                target_email = clean(payload.get("email"), 160).lower()
                current_admin_email_lower = (get_admin_email(self) or "").lower()

                if target_email == current_admin_email_lower:
                    self._json_response(
                        400,
                        {"error": "You cannot change your own access."}
                    )
                    return

                admins = load_admin_credentials()
                target_admin = find_admin_by_email(admins, target_email)

                if not target_admin:
                    self._json_response(404, {"error": "Admin not found."})
                    return

                if target_admin.get("role") == "owner":
                    self._json_response(
                        400,
                        {"error": "The account owner's access cannot be changed."}
                    )
                    return

                target_admin["status"] = (
                    "revoked" if path.endswith("revoke") else "active"
                )

                save_admin_credentials(admins)
                purge_admin_sessions(target_email)

                audit_admin_action(
                    self,
                    "admin_access_revoked" if path.endswith("revoke") else "admin_access_restored",
                    "admin", target_email,
                )

                self._json_response(
                    200,
                    {
                        "message": (
                            "Access revoked successfully."
                            if path.endswith("revoke")
                            else "Access restored successfully."
                        )
                    }
                )
                return

            if path == "/api/admin/team/delete":

                if not require_owner(self):
                    self._json_response(
                        403,
                        {"error": "Only the account owner can remove admins."}
                    )
                    return

                target_email = clean(payload.get("email"), 160).lower()
                current_admin_email_lower = (get_admin_email(self) or "").lower()

                if target_email == current_admin_email_lower:
                    self._json_response(
                        400,
                        {"error": "You cannot remove your own access."}
                    )
                    return

                admins = load_admin_credentials()
                target_admin = find_admin_by_email(admins, target_email)

                if not target_admin:
                    self._json_response(404, {"error": "Admin not found."})
                    return

                if target_admin.get("role") == "owner":
                    self._json_response(
                        400,
                        {"error": "The account owner cannot be removed."}
                    )
                    return

                admins = [
                    item for item in admins
                    if item.get("email", "").lower() != target_email
                ]

                save_admin_credentials(admins)
                purge_admin_sessions(target_email)

                audit_admin_action(self, "admin_account_deleted", "admin", target_email)

                self._json_response(200, {"message": "Admin removed successfully."})
                return

            # =====================================================
            # ADMIN UPDATE RIDER
            # =====================================================

            if path == "/api/admin/riders/update":

                admin = require_permission(self, "manage_riders")

                if not admin:
                    self._json_response(
                        403,
                        {
                            "error": "You do not have permission to manage riders."
                        }
                    )
                    return

                rider_id = payload.get("id")

                try:
                    rider_id = int(rider_id)
                except (TypeError, ValueError):
                    self._json_response(
                        400,
                        {
                            "error": "A valid rider ID is required."
                        }
                    )
                    return

                name = clean(
                    payload.get("name"),
                    120
                )

                phone = clean(
                    payload.get("phone"),
                    40
                )

                email = clean(
                    payload.get("email"),
                    160
                ).lower()

                vehicle = clean(
                    payload.get("vehicle"),
                    80
                )

                status = clean(
                    payload.get("status"),
                    40
                )

                if not name or not phone or not vehicle:
                    self._json_response(
                        400,
                        {
                            "error": "Rider name, phone, and vehicle are required."
                        }
                    )
                    return

                allowed_statuses = {
                    "active",
                    "available",
                    "assigned",
                    "on_delivery",
                    "inactive"
                }

                if status not in allowed_statuses:
                    self._json_response(
                        400,
                        {
                            "error": "Invalid rider status."
                        }
                    )
                    return

                riders = load_riders()

                rider = next(
                    (
                        item
                        for item in riders
                        if str(item.get("id", "")) == str(rider_id)
                    ),
                    None
                )

                if not rider:
                    self._json_response(
                        404,
                        {
                            "error": "Rider not found."
                        }
                    )
                    return

                rider["name"] = name
                rider["phone"] = phone
                rider["email"] = email
                rider["vehicle"] = vehicle
                rider["status"] = status

                save_riders(riders)

                audit_admin_action(self, "rider_updated", "rider", rider_id, new={"status": status})

                self._json_response(
                    200,
                    {
                        "message": "Rider updated successfully.",
                        "rider": rider
                    }
                )

                return

            # =====================================================
            # ADMIN MARK RIDER PAYMENT AS PAID
            # =====================================================

            if path == "/api/admin/rider-payments/mark-paid":

                admin = require_permission(self, "manage_finance")

                if not admin:
                    self._json_response(
                        403,
                        {
                            "error": "You do not have permission to record rider payments."
                        }
                    )
                    return

                rider_id = payload.get("riderId")
                amount = payload.get("amount")
                month = payload.get("month")

                if not rider_id or amount is None or not month:
                    self._json_response(
                        400,
                        {
                            "error": "Rider ID, amount, and month are required."
                        }
                    )
                    return

                try:
                    amount = int(amount)
                    if amount <= 0:
                        raise ValueError("Amount must be positive")
                except (ValueError, TypeError):
                    self._json_response(
                        400,
                        {
                            "error": "Amount must be a positive number."
                        }
                    )
                    return

                rider_payments = load_rider_payments()
                
                payment = {
                    "id": secrets.token_urlsafe(12),
                    "riderId": rider_id,
                    "amount": amount,
                    "month": month,
                    "paidAt": datetime.now(timezone.utc).isoformat()
                }
                
                rider_payments.append(payment)
                save_rider_payments(rider_payments)

                audit_admin_action(self, "rider_payment_recorded", "rider", rider_id, new={"amount": amount, "month": month})

                self._json_response(
                    200,
                    {
                        "message": "Payment recorded successfully.",
                        "payment": payment
                    }
                )

                return

            # =====================================================
            # ADMIN ASSIGN RIDER TO DELIVERY
            # =====================================================

            if path == "/api/admin/orders/assign-rider":

                admin = require_permission(self, "manage_orders")

                if not admin:
                    self._json_response(
                        403,
                        {
                            "error": "You do not have permission to assign riders."
                        }
                    )
                    return

                order_id = payload.get("orderId")
                rider_id = payload.get("riderId")

                try:
                    order_id = int(order_id)
                    rider_id = int(rider_id)
                except (TypeError, ValueError):
                    self._json_response(
                        400,
                        {
                            "error": "Valid order ID and rider ID are required."
                        }
                    )
                    return

                deliveries = load_deliveries()
                riders = load_riders()

                # Find the order
                order = next(
                    (
                        item
                        for item in deliveries
                        if str(item.get("id", "")) == str(order_id)
                    ),
                    None
                )

                if not order:
                    self._json_response(
                        404,
                        {
                            "error": "Order not found."
                        }
                    )
                    return

                # Find the rider
                rider = next(
                    (
                        item
                        for item in riders
                        if str(item.get("id", "")) == str(rider_id)
                    ),
                    None
                )

                if not rider:
                    self._json_response(
                        404,
                        {
                            "error": "Rider not found."
                        }
                    )
                    return

                # A rider must be signed in and not actively on a delivery.
                if (
                    str(rider.get("id", "")) not in logged_in_rider_ids()
                    or rider.get("status") == "on_delivery"
                ):
                    self._json_response(
                        400,
                        {
                            "error": "Rider is not available for assignment."
                        }
                    )
                    return

                # Order must be assignable
                order_status = str(
                    order.get("status", "")
                ).strip().lower()

                if order_status != "requested":
                    self._json_response(
                        400,
                        {
                            "error": "Only requested orders can be assigned to a rider."
                        }
                    )
                    return

                # Assign rider to order
                order["riderId"] = rider["id"]
                order["riderRef"] = rider.get("riderRef", "")
                order["riderName"] = rider.get("name", "")
                order["riderPhone"] = rider.get("phone", "")

                # Order becomes assigned
                order["status"] = "assigned"
                order["updatedAt"] = datetime.now(
                    timezone.utc
                ).isoformat()
                order["assignedAt"] = order["updatedAt"]
                append_delivery_event(
                    order,
                    "assigned",
                    actor_type="admin",
                    actor_id=admin.get("email"),
                    actor_name=admin.get("name"),
                    note=f"Assigned to {rider.get('name', 'rider')}",
                )

                # Rider becomes assigned
                rider["status"] = "assigned"

                save_deliveries(deliveries)
                save_riders(riders)

                audit_admin_action(
                    self,
                    action="rider_assigned",
                    target_type="delivery",
                    target_id=order.get("id"),
                    previous=None,
                    new={"riderId": rider.get("id"), "riderName": rider.get("name")},
                )


                # -------------------------------------------------
                # CREATE RIDER NOTIFICATION
                # -------------------------------------------------

                create_rider_notification(
                    rider_id=rider["id"],
                    notification_type="order_assigned",
                    title="New Delivery Assigned",
                    message=(
                        f"Order #{order.get('id')} "
                        "has been assigned to you."
                    ),
                    order_id=order.get("id")
                )


                self._json_response(
                    200,
                    {
                        "message": "Rider assigned successfully.",
                        "order": order,
                        "rider": rider
                    }
                )

                return

            # =====================================================
            # ADMIN BULK ASSIGN RIDER TO MULTIPLE DELIVERIES
            # =====================================================

            if path == "/api/admin/orders/bulk-assign":

                admin = require_permission(self, "manage_orders")

                if not admin:
                    self._json_response(
                        403,
                        {
                            "error": "You do not have permission to assign riders."
                        }
                    )
                    return

                order_ids = payload.get("orderIds", [])
                rider_id = payload.get("riderId")

                # Validate inputs
                if not order_ids or not isinstance(order_ids, list):
                    self._json_response(
                        400,
                        {
                            "error": "Valid order IDs array is required."
                        }
                    )
                    return

                if not rider_id:
                    self._json_response(
                        400,
                        {
                            "error": "Rider ID is required."
                        }
                    )
                    return

                try:
                    rider_id = int(rider_id)
                    order_ids = [int(oid) for oid in order_ids]
                except (TypeError, ValueError):
                    self._json_response(
                        400,
                        {
                            "error": "Valid order IDs and rider ID are required."
                        }
                    )
                    return

                deliveries = load_deliveries()
                riders = load_riders()

                # Find the rider
                rider = next(
                    (
                        item
                        for item in riders
                        if str(item.get("id", "")) == str(rider_id)
                    ),
                    None
                )

                if not rider:
                    self._json_response(
                        404,
                        {
                            "error": "Rider not found."
                        }
                    )
                    return

                # A rider must be signed in and not actively on a delivery.
                if (
                    str(rider.get("id", "")) not in logged_in_rider_ids()
                    or rider.get("status") == "on_delivery"
                ):
                    self._json_response(
                        400,
                        {
                            "error": "Rider is not available for assignment."
                        }
                    )
                    return

                # Assign all orders
                assigned_count = 0
                failed_count = 0
                failed_orders = []

                for order_id in order_ids:
                    # Find the order
                    order = next(
                        (
                            item
                            for item in deliveries
                            if str(item.get("id", "")) == str(order_id)
                        ),
                        None
                    )

                    if not order:
                        failed_count += 1
                        failed_orders.append(order_id)
                        continue

                    # Order must be assignable
                    order_status = str(
                        order.get("status", "")
                    ).strip().lower()

                    if order_status != "requested":
                        failed_count += 1
                        failed_orders.append(order_id)
                        continue

                    # Assign rider to order
                    order["riderId"] = rider["id"]
                    order["riderRef"] = rider.get("riderRef", "")
                    order["riderName"] = rider.get("name", "")
                    order["riderPhone"] = rider.get("phone", "")

                    # Order becomes assigned
                    order["status"] = "assigned"
                    order["updatedAt"] = datetime.now(
                        timezone.utc
                    ).isoformat()
                    order["assignedAt"] = order["updatedAt"]
                    append_delivery_event(
                        order,
                        "assigned",
                        actor_type="admin",
                        actor_id=admin.get("email"),
                        actor_name=admin.get("name"),
                        note=f"Bulk-assigned to {rider.get('name', 'rider')}",
                    )

                    assigned_count += 1

                    # Create rider notification
                    create_rider_notification(
                        rider_id=rider["id"],
                        notification_type="order_assigned",
                        title="New Delivery Assigned",
                        message=(
                            f"Order #{order.get('id')} "
                            "has been assigned to you."
                        ),
                        order_id=order.get("id")
                    )

                # Mark rider as assigned if they have assignments
                if assigned_count > 0:
                    rider["status"] = "assigned"

                save_deliveries(deliveries)
                save_riders(riders)

                audit_admin_action(
                    self,
                    action="rider_bulk_assigned",
                    target_type="delivery",
                    target_id=order_ids,
                    new={"riderId": rider.get("id"), "riderName": rider.get("name"), "count": assigned_count},
                )

                message = f"Successfully assigned {assigned_count} order(s)"
                if failed_count > 0:
                    message += f" ({failed_count} failed)"

                self._json_response(
                    200,
                    {
                        "message": message,
                        "assigned": assigned_count,
                        "failed": failed_count,
                        "failedOrders": failed_orders
                    }
                )

                return

            # =====================================================
            # ADMIN REASSIGN RIDER TO DELIVERY
            # =====================================================

            if path == "/api/admin/orders/reassign-rider":

                admin = require_permission(self, "manage_orders")

                if not admin:
                    self._json_response(
                        403,
                        {
                            "error": "You do not have permission to reassign riders."
                        }
                    )
                    return

                order_id = payload.get("orderId")
                rider_id = payload.get("riderId")

                try:
                    order_id = int(order_id)
                    rider_id = int(rider_id)

                except (TypeError, ValueError):
                    self._json_response(
                        400,
                        {
                            "error": "Valid order ID and rider ID are required."
                        }
                    )
                    return

                deliveries = load_deliveries()
                riders = load_riders()

                # Find the order
                order = next(
                    (
                        item
                        for item in deliveries
                        if str(item.get("id", "")) == str(order_id)
                    ),
                    None
                )

                if not order:
                    self._json_response(
                        404,
                        {
                            "error": "Order not found."
                        }
                    )
                    return

                # Order must currently be assigned
                order_status = str(
                    order.get("status", "")
                ).strip().lower()

                if order_status != "assigned":
                    self._json_response(
                        400,
                        {
                            "error": "Only assigned orders can be reassigned."
                        }
                    )
                    return

                # Find current rider
                current_rider = None

                if order.get("riderId"):

                    current_rider = next(
                        (
                            item
                            for item in riders
                            if str(item.get("id", "")) ==
                            str(order.get("riderId"))
                        ),
                        None
                    )

                # Find new rider
                new_rider = next(
                    (
                        item
                        for item in riders
                        if str(item.get("id", "")) == str(rider_id)
                    ),
                    None
                )

                if not new_rider:
                    self._json_response(
                        404,
                        {
                            "error": "Rider not found."
                        }
                    )
                    return

                # A rider must be signed in and not actively on a delivery.
                if (
                    str(new_rider.get("id", "")) not in logged_in_rider_ids()
                    or new_rider.get("status") == "on_delivery"
                ):
                    self._json_response(
                        400,
                        {
                            "error": "New rider is not available for reassignment."
                        }
                    )
                    return

                # Prevent assigning the same rider again
                if (
                    current_rider
                    and str(current_rider.get("id")) ==
                    str(new_rider.get("id"))
                ):
                    self._json_response(
                        400,
                        {
                            "error": "This rider is already assigned to the order."
                        }
                    )
                    return

                # Release current rider
                if current_rider:
                    current_rider["status"] = "available"

                # Assign new rider
                order["riderId"] = new_rider["id"]
                order["riderRef"] = new_rider.get("riderRef", "")
                order["riderName"] = new_rider.get("name", "")
                order["riderPhone"] = new_rider.get("phone", "")

                # Keep order assigned
                order["status"] = "assigned"

                order["updatedAt"] = datetime.now(
                    timezone.utc
                ).isoformat()
                append_delivery_event(
                    order,
                    "assigned",
                    actor_type="admin",
                    actor_id=admin.get("email"),
                    actor_name=admin.get("name"),
                    note=f"Reassigned from {current_rider.get('name') if current_rider else 'unassigned'} to {new_rider.get('name', 'rider')}",
                )

                # New rider becomes assigned
                new_rider["status"] = "assigned"

                save_deliveries(deliveries)
                save_riders(riders)

                audit_admin_action(
                    self,
                    action="rider_reassigned",
                    target_type="delivery",
                    target_id=order.get("id"),
                    previous={"riderId": current_rider.get("id") if current_rider else None, "riderName": current_rider.get("name") if current_rider else None},
                    new={"riderId": new_rider.get("id"), "riderName": new_rider.get("name")},
                )

                self._json_response(
                    200,
                    {
                        "message": "Rider reassigned successfully.",
                        "order": order,
                        "rider": new_rider,
                        "previousRider": current_rider
                    }
                )

                return

            # =====================================================
            # ADMIN UPDATE ORDER STATUS
            # =====================================================

            if path == "/api/admin/orders/update-status":

                admin = require_permission(self, "manage_orders")

                if not admin:
                    self._json_response(
                        403,
                        {
                            "error": "You do not have permission to update order status."
                        }
                    )
                    return

                order_id = payload.get("orderId")
                new_status = clean(
                    payload.get("status"),
                    40
                ).lower()
                note = clean(payload.get("note"), 300) or None

                try:
                    order_id = int(order_id)
                except (TypeError, ValueError):
                    self._json_response(
                        400,
                        {
                            "error": "A valid order ID is required."
                        }
                    )
                    return

                deliveries = load_deliveries()
                riders = load_riders()

                order = next(
                    (
                        item
                        for item in deliveries
                        if str(item.get("id", "")) == str(order_id)
                    ),
                    None
                )

                if not order:
                    self._json_response(
                        404,
                        {
                            "error": "Order not found."
                        }
                    )
                    return

                current_status = str(
                    order.get("status", "")
                ).strip().lower()

                # An admin may move an order forward one step in the normal
                # flow, or divert it to an exception status at any active
                # (non-final) point in its lifecycle.
                forward_status = next_delivery_status(current_status)
                is_forward_move = (
                    current_status != "requested"
                    and new_status == forward_status
                    and forward_status is not None
                )
                is_exception_move = (
                    new_status in DELIVERY_EXCEPTION_STATUSES
                    and current_status not in (
                        "delivered", "failed", "cancelled", "returned"
                    )
                )

                if not (is_forward_move or is_exception_move):
                    self._json_response(
                        400,
                        {
                            "error": "This order cannot be moved to that status."
                        }
                    )
                    return

                if new_status == "delivered":
                    self._json_response(
                        400,
                        {
                            "error": "Delivered can only be recorded by the rider, with proof of delivery."
                        }
                    )
                    return

                rider = None

                if order.get("riderId"):

                    rider = next(
                        (
                            item
                            for item in riders
                            if str(item.get("id", "")) ==
                            str(order.get("riderId"))
                        ),
                        None
                    )

                previous_status = current_status
                order["status"] = new_status

                if rider:
                    if is_exception_move:
                        has_queued_delivery = any(
                            str(delivery.get("riderId", "")) ==
                            str(rider.get("id", ""))
                            and str(delivery.get("status", "")).strip().lower()
                            not in ({"delivered"} | DELIVERY_EXCEPTION_STATUSES)
                            and delivery.get("id") != order.get("id")
                            for delivery in deliveries
                        )
                        rider["status"] = (
                            "assigned" if has_queued_delivery else "available"
                        )
                        if new_status == "failed":
                            rider["failedDeliveries"] = (
                                int(rider.get("failedDeliveries", 0) or 0) + 1
                            )
                    elif new_status == "on_delivery":
                        rider["status"] = "on_delivery"

                order["updatedAt"] = now_iso()
                append_delivery_event(
                    order,
                    new_status,
                    actor_type="admin",
                    actor_id=admin.get("email"),
                    actor_name=admin.get("name"),
                    note=note,
                )

                save_deliveries(deliveries)
                save_riders(riders)

                audit_admin_action(
                    self,
                    action="delivery_status_override",
                    target_type="delivery",
                    target_id=order.get("id"),
                    previous=previous_status,
                    new=new_status,
                    note=note,
                )

                self._json_response(
                    200,
                    {
                        "message": "Order status updated successfully.",
                        "order": order,
                        "rider": rider
                    }
                )

                return
            
            # =====================================================
            # ADMIN CREATE RIDER
            # =====================================================

            if path == "/api/admin/riders":

                admin = require_permission(self, "manage_riders")

                if not admin:
                    self._json_response(
                        403,
                        {
                            "error": "You do not have permission to create riders."
                        }
                    )
                    return

                name = clean(
                    payload.get("name"),
                    120
                )

                phone = clean(
                    payload.get("phone"),
                    40
                )

                email = clean(
                    payload.get("email"),
                    160
                ).lower()

                vehicle = clean(
                    payload.get("vehicle"),
                    80
                )

                password = clean(
                    payload.get("password"),
                    128
                )

                if not name or not phone or not vehicle or not password:
                    self._json_response(
                        400,
                        {
                            "error": "Rider name, phone, vehicle and password are required."
                        }
                    )
                    return

                if len(password) < 8:
                    self._json_response(
                        400,
                        {
                            "error": "Rider password must be at least 8 characters."
                        }
                    )
                    return

                riders = load_riders()

                salt = secrets.token_hex(16)

                password_hash_value = password_hash(
                    password,
                    salt
                )

                # Generate the next rider ID
                new_id = (
                    max(
                        (
                            int(rider.get("id", 0))
                            for rider in riders
                            if str(rider.get("id", "")).isdigit()
                        ),
                        default=0
                    ) + 1
                )

                rider_salt = secrets.token_hex(16)

                rider = {
                    "id": new_id,
                    "riderRef": f"FL-RID-{new_id:04d}",
                    "name": name,
                    "phone": phone,
                    "email": email,
                    "passwordHash": password_hash(
                        password,
                        rider_salt
                    ),
                    "salt": rider_salt,
                    "vehicle": vehicle,
                    "status": "inactive",
                    "totalDeliveries": 0,
                    "completedDeliveries": 0,
                    "failedDeliveries": 0,
                    "mustChangePassword": True,
                    "createdAt": datetime.now(
                        timezone.utc
                    ).isoformat(),
                }

                riders.append(rider)

                save_riders(riders)

                audit_admin_action(self, "rider_created", "rider", rider["id"])

                self._json_response(
                    201,
                    {
                        "message": "Rider created successfully.",
                        "rider": rider
                    }
                )

                return
            if path == "/api/login":
                rate_key = rate_limit_key(self, "vendor-login")
                if is_login_rate_limited(rate_key):
                    self._json_response(429, {"error": "Too many login attempts. Please try again later."})
                    return
                email = clean(payload.get("email"), 160).lower()
                password = clean(payload.get("password"), 128)
                account = authenticate(email, password)
                if not account:
                    record_login_failure(rate_key)
                    self._json_response(401, {"error": "Invalid email or password"})
                    return
                clear_login_attempts(rate_key)
                summary = summary_for_account(account)
                session_token = create_vendor_session(account["email"])
                body = json.dumps(summary).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header(
                    "Set-Cookie",
                    session_cookie(self, "fiable_vendor_session", session_token, VENDOR_SESSION_EXPIRY_HOURS * 60 * 60)
                )
                self.send_header(
                    "Set-Cookie",
                    csrf_cookie(self, generate_csrf_token(), VENDOR_SESSION_EXPIRY_HOURS * 60 * 60)
                )
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if path == "/api/logout":
                clear_vendor_session(self)
                body = json.dumps({"message": "Logged out."}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header(
                    "Set-Cookie",
                    session_cookie(self, "fiable_vendor_session", "", 0)
                )
                self.send_header(
                    "Set-Cookie",
                    csrf_cookie(self, "", 0)
                )
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if path == "/api/change-password":
                email = get_logged_in_vendor_email(self)
                if not email:
                    self._json_response(401, {"error": "Please log in to change your password."})
                    return
                currentPassword = clean(payload.get("currentPassword"), 128)
                newPassword = clean(payload.get("newPassword"), 128)

                if not currentPassword or not newPassword:
                    self._json_response(
                        400,
                        {"error": "All password fields are required."}
                    )
                    return

                if len(newPassword) < 8:
                    self._json_response(
                        400,
                        {"error": "New password must be at least 8 characters."}
                    )
                    return

                accounts = load_accounts()

                account = next(
                    (item for item in accounts if item["email"] == email),
                    None
                )

                if not account:
                    self._json_response(
                        401,
                        {"error": "Account not found"}
                    )
                    return

                valid = hmac.compare_digest(
                    account["passwordHash"],
                    password_hash(currentPassword, account["salt"])
                )

                if not valid:
                    self._json_response(
                        401,
                        {"error": "Current password is incorrect."}
                    )
                    return

                salt = secrets.token_hex(16)

                account["salt"] = salt
                account["passwordHash"] = password_hash(newPassword, salt)
                account["passwordChangedAt"] = datetime.now(timezone.utc).isoformat()

                ACCOUNTS_FILE.write_text(
                    json.dumps(accounts, indent=2),
                    encoding="utf-8"
                )

                self._json_response(
                    200,
                    {"message": "Password changed successfully."}
                )
                return
            if path == "/api/account/plan":
                email = get_logged_in_vendor_email(self)
                if not email:
                    self._json_response(401, {"error": "Please log in."})
                    return
                account = update_account(email, clean(payload.get("plan"), 40))
                self._json_response(200, summary_for_account(account))
                return
            if path == "/api/account/payment":
                email = get_logged_in_vendor_email(self)
                if not email:
                    self._json_response(401, {"error": "Please log in."})
                    return
                account = mark_payment_complete(email)
                self._json_response(200, {"paymentStatus": account["paymentStatus"], "message": "Payment recorded for local demo checkout."})
                return
            if path == "/api/batch-delivery-quote":
                email = get_logged_in_vendor_email(self)
                if not email:
                    self._json_response(401, {"error": "Please log in."})
                    return
                requests = payload.get("deliveries")
                if not isinstance(requests, list):
                    raise ValueError("Batch deliveries must be provided as a list.")
                account = next(
                    (item for item in load_accounts() if item["email"] == email),
                    None
                )
                if not account:
                    self._json_response(401, {"error": "Account not found"})
                    return
                self._json_response(
                    200,
                    estimate_batch_deliveries(requests, account.get("plan"))
                )
                return
            if path == "/api/batch-delivery-request":
                email = get_logged_in_vendor_email(self)
                if not email:
                    self._json_response(401, {"error": "Please log in."})
                    return
                requests = payload.get("deliveries")
                if not isinstance(requests, list):
                    raise ValueError("Batch deliveries must be provided as a list.")
                account = next(
                    (item for item in load_accounts() if item["email"] == email),
                    None
                )
                if not account:
                    self._json_response(401, {"error": "Account not found"})
                    return
                summary = summary_for_account(account)
                if summary["subscriptionState"] not in ("active", "expiring_soon", "grace_period"):
                    self._json_response(402, {"error": "Complete payment and activate your subscription before requesting deliveries."})
                    return
                batch_quote = estimate_batch_deliveries(
                    requests,
                    summary.get("plan")
                )
                if summary["unitsRemaining"] < batch_quote["chargedUnits"]:
                    self._json_response(409, {"error": "Insufficient units for this batch delivery."})
                    return

                created_deliveries = []
                batch_id = f"BATCH-{secrets.token_urlsafe(8)}"
                for request, quote in zip(requests, batch_quote["deliveries"]):
                    required_fields = {
                        "pickup": clean(request.get("pickup"), 120),
                        "dropoff": clean(request.get("dropoff"), 120),
                        "pickupContactName": clean(request.get("pickupContactName"), 100),
                        "pickupPhone": clean(request.get("pickupPhone"), 40),
                        "pickupAddress": clean(request.get("pickupAddress"), 300),
                        "recipientName": clean(request.get("recipientName"), 100),
                        "recipientPhone": clean(request.get("recipientPhone"), 40),
                        "deliveryAddress": clean(request.get("deliveryAddress"), 300),
                    }
                    if not all(required_fields.values()):
                        raise ValueError("Complete all required details for every batch delivery.")
                    requested_window = clean(request.get("deliveryWindow"), 40)
                    delivery_window = validate_delivery_window(requested_window)
                    priority = "Express" if requested_window == "Express" else "Standard"
                    details = {
                        "pickupContactName": required_fields["pickupContactName"],
                        "pickupPhone": required_fields["pickupPhone"],
                        "pickupAddress": required_fields["pickupAddress"],
                        "recipientName": required_fields["recipientName"],
                        "recipientPhone": required_fields["recipientPhone"],
                        "deliveryAddress": required_fields["deliveryAddress"],
                        "packageType": "General",
                        "priority": priority,
                        "deliveryWindow": delivery_window,
                        "packageDescription": clean(request.get("packageDescription"), 300),
                        "pickupInstructions": clean(request.get("pickupInstructions"), 300),
                        "deliveryInstructions": clean(request.get("deliveryInstructions"), 300),
                    }
                    quote["batchId"] = batch_id
                    delivery = create_delivery(
                        email,
                        required_fields["pickup"],
                        required_fields["dropoff"],
                        quote["chargedUnits"],
                        details,
                        unit_price=quote["unitPrice"],
                        plan=summary.get("plan"),
                        pricing=quote
                    )
                    delivery["batchId"] = batch_id
                    created_deliveries.append(delivery)

                save_deliveries(
                    load_deliveries()[:-len(created_deliveries)] +
                    created_deliveries
                )
                self._json_response(201, {
                    "message": "Batch delivery requests received.",
                    "deliveries": created_deliveries,
                    "batchQuote": batch_quote,
                    "summary": summary_for_account(account),
                })
                return
            if path == "/api/delivery-request":
                email = get_logged_in_vendor_email(self)
                if not email:
                    self._json_response(401, {"error": "Please log in."})
                    return
                pickup = clean(payload.get("pickup"), 120)
                dropoff = clean(payload.get("dropoff"), 120)
                contactName = clean(payload.get("pickupContactName"), 100)
                contactPhone = clean(payload.get("pickupPhone"), 40)
                pickupAddress = clean(payload.get("pickupAddress"), 300)
                recipient = clean(payload.get("recipientName"), 100)
                recipientPhone = clean(payload.get("recipientPhone"), 40)
                deliveryAddress = clean(payload.get("deliveryAddress"), 300)
                packageType = "General"
                requested_window = clean(payload.get("deliveryWindow"), 40)
                window = validate_delivery_window(requested_window)
                priority = "Express" if requested_window == "Express" else "Standard"
                packageDescription = clean(payload.get("packageDescription"), 300)
                required_fields = {
                    "pickup": pickup,
                    "dropoff": dropoff,
                    "pickupContactName": contactName,
                    "pickupPhone": contactPhone,
                    "pickupAddress": pickupAddress,
                    "recipientName": recipient,
                    "recipientPhone": recipientPhone,
                    "deliveryAddress": deliveryAddress,
                    "deliveryWindow": window,
                }
                missing_fields = [
                    field for field, value in required_fields.items()
                    if not value
                ]
                if missing_fields:
                    self._json_response(
                        400,
                        {
                            "error": "Please complete all required delivery fields.",
                            "missingFields": missing_fields,
                        }
                    )
                    return
                account = next((item for item in load_accounts() if item["email"] == email), None)
                if not account:
                    self._json_response(401, {"error": "Account not found"})
                    return
                summary = summary_for_account(account)
                if summary["subscriptionState"] not in ("active", "expiring_soon", "grace_period"):
                    self._json_response(402, {"error": "Complete payment and activate your subscription before requesting deliveries."})
                    return
                est = estimate_delivery(
                    pickup,
                    dropoff,
                    summary.get("plan"),
                    priority
                )
                if summary["unitsRemaining"] < est["units"]:
                    self._json_response(409, {"error": "Insufficient units for this delivery. Please renew or choose a smaller route."})
                    return
                details = {
                    "pickupContactName": contactName,
                    "pickupPhone": contactPhone,
                    "pickupAddress": pickupAddress,
                    "recipientName": recipient,
                    "recipientPhone": recipientPhone,
                    "deliveryAddress": deliveryAddress,
                    "packageType": packageType,
                    "deliveryWindow": window,
                    "packageDescription": packageDescription,
                    "pickupInstructions": clean(payload.get("pickupInstructions"), 300),
                    "deliveryInstructions": clean(payload.get("deliveryInstructions"), 300),
                }
                delivery = create_delivery(
                    email,
                    pickup,
                    dropoff,
                    est.get("units", 1),
                    details,
                    unit_price=est.get("unitPrice"),
                    plan=summary.get("plan"),
                    pricing=est
                )
                self._json_response(201, {"message": "Delivery request received", "delivery": delivery, "summary": summary_for_account(account)})
                return
            if path == "/api/delivery/status":

                # Vendor-initiated cancellation only - this endpoint used to
                # accept ANY status for ANY delivery ID with no auth at all.
                vendor_email = get_logged_in_vendor_email(self)

                if not vendor_email:
                    self._json_response(401, {"error": "Please log in to manage this delivery."})
                    return

                delivery_id = int(
                    payload.get("id") or 0
                )

                status = clean(
                    payload.get("status"),
                    40
                ).lower()

                if status != "cancelled":
                    raise ValueError(
                        "Invalid delivery status"
                    )

                deliveries = load_deliveries()

                delivery = next(
                    (
                        item
                        for item in deliveries
                        if str(item.get("id", "")) ==
                        str(delivery_id)
                    ),
                    None
                )

                if delivery and str(delivery.get("accountEmail", "")).lower() != vendor_email:
                    self._json_response(403, {"error": "You cannot manage another account's delivery."})
                    return

                if not delivery:
                    self._json_response(
                        404,
                        {
                            "error": "Delivery not found"
                        }
                    )
                    return

                current_status = str(
                    delivery.get("status", "")
                ).strip().lower()

                # A delivery can only be cancelled
                # while it is still requested.
                if status == "cancelled" and current_status != "requested":

                    self._json_response(
                        400,
                        {
                            "error": "Only requested orders can be cancelled."
                        }
                    )
                    return

                updated = update_delivery_status(
                    delivery_id,
                    status
                )

                if not updated:
                    self._json_response(
                        404,
                        {
                            "error": "Delivery not found"
                        }
                    )
                    return

                self._json_response(
                    200,
                    {
                        "delivery": updated
                    }
                )

                return
            
            if path == "/api/forgot-password":
                email = clean(payload.get("email"), 160).lower()

                if not valid_email(email):
                    raise ValueError("Enter a valid email address")

                account = next(
                    (item for item in load_accounts()
                    if item["email"] == email),
                    None
                )

                # Don't reveal whether an account exists
                if not account:
                    self._json_response(202, {
                        "message": "If an account exists for this email, a password reset link has been created."
                    })
                    return

                token = create_reset_token(email)

                save_submission("password-reset", {
                    "email": email,
                    "token": token
                })

                # LOCAL DEVELOPMENT ONLY
                reset_link = f"/portal.html?reset={token}"

                self._json_response(202, {
                    "message": "Password reset link created.",
                    "resetLink": reset_link
                })

                return
            if path == "/api/reset-password":
                token = clean(payload.get("token"), 200)
                password = clean(payload.get("password"), 128)
                confirm_password = clean(payload.get("confirmPassword"), 128)

                if not token:
                    raise ValueError("Invalid or missing reset link")

                if len(password) < 8:
                    raise ValueError("Your password must be at least 8 characters")

                if password != confirm_password:
                    raise ValueError("Passwords do not match")

                reset_data = verify_reset_token(token)

                if not reset_data:
                    raise ValueError(
                        "This reset link is invalid or has expired. Please request a new one."
                    )

                email = reset_data["email"]

                accounts = load_accounts()

                account_found = False

                for account in accounts:
                    if account["email"] == email:
                        salt = secrets.token_hex(16)

                        account["salt"] = salt
                        account["passwordHash"] = password_hash(password, salt)
                        account["passwordResetAt"] = datetime.now(timezone.utc).isoformat()

                        account_found = True
                        break

                if not account_found:
                    raise ValueError("Account not found")

                ACCOUNTS_FILE.write_text(
                    json.dumps(accounts, indent=2),
                    encoding="utf-8"
                )

                # Make the reset token unusable immediately
                consume_reset_token(token)

                self._json_response(200, {
                    "message": "Your password has been reset successfully. You can now log in."
                })

                return
            self._json_response(404, {"error": "Endpoint not found"})
        except (ValueError, json.JSONDecodeError) as error:
            self._json_response(400, {"error": str(error)})

    def do_GET(self):
        # =====================================================
        # BLOCK ACCESS TO SERVER INTERNALS / DATA FILES
        # These must never be reachable through static file serving.
        # =====================================================
        request_path = urlparse(self.path).path
        if ".." in request_path or request_path.startswith(BLOCKED_STATIC_PREFIXES):
            self._json_response(404, {"error": "Not found"})
            return

        gate_message = password_change_gate(self, request_path)
        if gate_message:
            self._json_response(403, {"error": gate_message, "mustChangePassword": True})
            return

        # =====================================================
        # PROTECT ADMIN DASHBOARD
        # =====================================================

        if self.path == "/admin.html":

            if not require_admin(self):

                self.send_response(302)

                self.send_header(
                    "Location",
                    "/admin-login.html"
                )
                self.send_header(
                    "Cache-Control",
                    "no-store, no-cache, must-revalidate, max-age=0"
                )

                self.end_headers()

                return
        if self.path == "/admin-login.html":
            if require_admin(self):
                self.send_response(302)
                self.send_header(
                    "Location",
                    "/admin.html"
                )
                self.end_headers()
                return
        if self.path == "/api/health":
            health = check_storage_health()
            if health["reachable"] and health["writable"]:
                self._json_response(200, {"status": "healthy", "storage": "available"})
            elif health["reachable"]:
                self._json_response(200, {"status": "degraded", "storage": "read-only"})
            else:
                self._json_response(503, {"status": "unhealthy", "storage": "unavailable"})
            return
        if self.path.startswith("/api/account/subscriptions"):
            email = get_logged_in_vendor_email(self)
            if not email:
                self._json_response(401, {"error": "Please log in."})
                return
            query = urlparse(self.path).query
            params = parse_qs(query)
            account = next(
                (item for item in load_accounts() if item["email"] == email.lower()),
                None
            )
            if not account:
                self._json_response(404, {"error": "Account not found"})
                return
            subscriptions = subscription_history_for_account(account)
            selected_id = params.get("subscriptionId", [None])[0]
            selected = next(
                (item for item in subscriptions if item.get("id") == selected_id),
                None
            ) if selected_id else None
            self._json_response(200, {
                "subscriptions": subscriptions,
                "deliveries": deliveries_for_subscription(email, selected) if selected else []
            })
            return
        if self.path == "/api/admin/subscriptions":
            if not require_permission(self, "view_finance"):
                self._json_response(403, {"error": "You do not have permission to view subscriptions."})
                return
            records = []
            for account in load_accounts():
                for record in subscription_history_for_account(account):
                    record["name"] = account.get("name", "")
                    record["deliveryCount"] = len(
                        deliveries_for_subscription(account["email"], record)
                    )
                    records.append(record)
            records.sort(key=lambda record: record.get("periodStart", ""), reverse=True)
            self._json_response(200, {
                "subscriptions": records,
                "revenueSummary": admin_revenue_summary()
            })
            return
        if self.path.startswith("/api/admin/subscriptions/details"):
            if not require_permission(self, "view_finance"):
                self._json_response(403, {"error": "You do not have permission to view subscriptions."})
                return
            query = urlparse(self.path).query
            subscription_id = parse_qs(query).get("subscriptionId", [None])[0]
            for account in load_accounts():
                record = next(
                    (
                        item for item in subscription_history_for_account(account)
                        if item.get("id") == subscription_id
                    ),
                    None
                )
                if record:
                    self._json_response(200, {
                        "subscription": record,
                        "deliveries": deliveries_for_subscription(account["email"], record)
                    })
                    return
            self._json_response(404, {"error": "Subscription record not found."})
            return
        # dashboard and delivery listing endpoints
        if self.path.startswith("/api/account/deliveries"):
            email = get_logged_in_vendor_email(self)
            if not email:
                self._json_response(401, {"error": "Please log in."})
                return
            items = deliveries_for_account(email)
            self._json_response(200, {"deliveries": items})
            return
        if self.path.startswith("/api/dashboard-stats"):
            email = get_logged_in_vendor_email(self)
            if not email:
                self._json_response(401, {"error": "Please log in."})
                return
            stats = dashboard_stats_for_account(email)
            self._json_response(200, {"stats": stats})
            return
        if self.path == "/api/admin/summary":

            if not require_permission(self, "view_reports"):
                self._json_response(
                    403,
                    {
                        "error": "You do not have permission to view the dashboard summary."
                    }
                )
                return

            self._json_response(200, admin_summary())
            return

        if self.path == "/api/admin/account":

            current_admin = get_current_admin(self)

            if not current_admin:
                self._json_response(
                    401,
                    {
                        "error": "Admin authentication required."
                    }
                )
                return

            self._json_response(
                200,
                {
                    "id": current_admin.get("id"),
                    "name": current_admin.get("name", "Administrator"),
                    "email": current_admin.get("email", ""),
                    "role": current_admin.get("role", "staff"),
                    "roleLabel": ADMIN_ROLE_LABELS.get(current_admin.get("role", "staff"), current_admin.get("role", "staff")),
                    "status": current_admin.get("status", "active"),
                    "isOwner": current_admin.get("role") in ("owner", "super_admin"),
                    "mustChangePassword": bool(current_admin.get("mustChangePassword", False)),
                    "mfaEnabled": bool(current_admin.get("mfaEnabled", False)),
                    "permissions": sorted(ADMIN_PERMISSIONS.get(current_admin.get("role", ""), set()))
                }
            )
            return

        if self.path == "/api/admin/team":

            current_admin = get_current_admin(self)

            if not admin_has_permission(current_admin, "view_team"):
                self._json_response(
                    403,
                    {"error": "You do not have permission to view the admin team."}
                )
                return

            admins = [
                {
                    "id": admin.get("id"),
                    "name": admin.get("name", "Administrator"),
                    "email": admin.get("email", ""),
                    "role": admin.get("role", "staff"),
                    "roleLabel": ADMIN_ROLE_LABELS.get(admin.get("role", "staff"), admin.get("role", "staff")),
                    "status": admin.get("status", "active"),
                    "createdAt": admin.get("createdAt"),
                    "mustChangePassword": bool(admin.get("mustChangePassword", False)),
                    "mfaEnabled": bool(admin.get("mfaEnabled", False)),
                }
                for admin in load_admin_credentials()
            ]

            self._json_response(
                200,
                {
                    "admins": admins,
                    "currentAdminEmail": current_admin.get("email", ""),
                    "isOwner": current_admin.get("role") in ("owner", "super_admin")
                }
            )
            return

        if self.path == "/api/admin/riders":

            if not require_permission(self, "view_riders"):
                self._json_response(
                    403,
                    {
                        "error": "You do not have permission to view riders."
                    }
                )
                return

            riders = load_riders()
            deliveries = load_deliveries()
            accounts = load_accounts()
            active_rider_ids = logged_in_rider_ids()

            # Calculate delivery history from actual orders
            for rider in riders:

                rider_id = str(
                    rider.get("id", "")
                )

                completed_count = 0
                failed_count = 0
                total_count = 0
                rider_deliveries = []

                for order in deliveries:

                    order_rider_id = str(
                        order.get("riderId", "")
                    )

                    order_status = str(
                        order.get("status", "")
                    ).strip().lower()

                    if order_rider_id != rider_id:
                        continue

                    total_count += 1
                    delivery_record = dict(order)
                    vendor = next(
                        (
                            account
                            for account in accounts
                            if account.get("email", "").lower() ==
                            str(order.get("accountEmail", "")).lower()
                        ),
                        None
                    )
                    delivery_record["vendorName"] = (
                        vendor.get("name", "") if vendor else ""
                    )
                    rider_deliveries.append(delivery_record)

                    if order_status == "delivered":
                        completed_count += 1

                    elif order_status == "failed":
                        failed_count += 1

                rider["totalDeliveries"] = total_count
                rider["completedDeliveries"] = completed_count
                rider["failedDeliveries"] = failed_count
                rider["deliveries"] = rider_deliveries
                rider["isLoggedIn"] = rider_id in active_rider_ids

            self._json_response(
                200,
                {
                    "riders": riders
                }
            )

            return

        if self.path.startswith("/api/admin/rider-payments"):
            if not require_permission(self, "view_finance"):
                self._json_response(403, {"error": "You do not have permission to view rider payments."})
                return

            month = parse_qs(urlparse(self.path).query).get("month", [None])[0]
            all_delivery_months = sorted(
                {
                    parsed.strftime("%Y-%m")
                    for delivery in load_deliveries()
                    if str(delivery.get("status", "")).lower() == "delivered"
                    and (parsed := parse_iso_date(
                        delivery.get("updatedAt") or delivery.get("createdAt")
                    ))
                },
                reverse=True
            )
            self._json_response(
                200,
                {
                    "payments": rider_payment_summary(month),
                    "months": all_delivery_months,
                    "selectedMonth": month
                }
            )
            return
        # =====================================================
        # ADMIN VENDORS
        # =====================================================

        if self.path == "/api/admin/vendors":

            if not require_permission(self, "view_vendors"):
                self._json_response(
                    403,
                    {
                        "error": "You do not have permission to view vendors."
                    }
                )
                return

            accounts = load_accounts()

            vendors = [
                summary_for_account(account)
                for account in accounts
            ]

            self._json_response(
                200,
                {
                    "vendors": vendors
                }
            )

            return
        
        if self.path.startswith("/api/account/summary"):
            email = get_logged_in_vendor_email(self)
            if not email:
                self._json_response(401, {"error": "Please log in."})
                return
            account = next((item for item in load_accounts() if item["email"] == email.lower()), None)
            if not account:
                self._json_response(404, {"error": "Account not found"})
                return
            self._json_response(200, summary_for_account(account))
            return

        # =====================================================
        # RIDER ACCOUNT
        # =====================================================

        if self.path == "/api/rider/account":

            rider = get_logged_in_rider(self)

            if not rider:

                self._json_response(
                    401,
                    {
                        "error":
                            "Rider authentication required."
                    }
                )

                return

            deliveries = load_deliveries()
            has_active_delivery = any(
                str(delivery.get("riderId", "")) == str(rider.get("id", ""))
                and str(delivery.get("status", "")).strip().lower()
                not in ({"delivered"} | DELIVERY_EXCEPTION_STATUSES)
                for delivery in deliveries
            )

            if not has_active_delivery and rider.get("status") != "available":
                riders = load_riders()
                stored_rider = next(
                    (
                        item
                        for item in riders
                        if str(item.get("id", "")) == str(rider.get("id", ""))
                    ),
                    None
                )

                if stored_rider and stored_rider.get("status") != "available":
                    stored_rider["status"] = "available"
                    save_riders(riders)
                    rider = stored_rider

            self._json_response(
                200,
                {
                    "rider": {
                        "id": rider.get("id"),
                        "riderRef": rider.get(
                            "riderRef",
                            ""
                        ),
                        "name": rider.get(
                            "name",
                            ""
                        ),
                        "email": rider.get(
                            "email",
                            ""
                        ),
                        "phone": rider.get(
                            "phone",
                            ""
                        ),
                        "vehicle": rider.get(
                            "vehicle",
                            ""
                        ),
                        "status": rider.get(
                            "status",
                            "available"
                        ),
                        "totalDeliveries": rider.get(
                            "totalDeliveries",
                            0
                        ),
                        "completedDeliveries": rider.get(
                            "completedDeliveries",
                            0
                        ),
                        "failedDeliveries": rider.get(
                            "failedDeliveries",
                            0
                        ),
                        "mustChangePassword": bool(rider.get("mustChangePassword", False))
                    }
                }
            )

            return

        # =====================================================
        # RIDER CURRENT DELIVERY
        # =====================================================

        if self.path == "/api/rider/delivery":

            rider = get_logged_in_rider(self)

            if not rider:
                self._json_response(
                    401,
                    {
                        "error": "Rider authentication required."
                    }
                )
                return


            rider_id = str(
                rider.get("id", "")
            )


            deliveries = load_deliveries()

            # Get all assigned and on_delivery orders for this rider
            assigned_deliveries = []

            for order in deliveries:

                order_rider_id = str(
                    order.get("riderId", "")
                )

                if order_rider_id != rider_id:
                    continue

                status = str(
                    order.get("status", "")
                ).strip().lower()

                if status in {"assigned", "on_delivery"}:
                    assigned_deliveries.append(order)

            # Sort: on_delivery first, then assigned
            assigned_deliveries.sort(
                key=lambda x: (
                    x.get("status", "").lower() != "on_delivery",
                    x.get("createdAt", "")
                )
            )

            # Return the current delivery (first one) for backward compatibility
            current_delivery = (
                assigned_deliveries[0]
                if assigned_deliveries
                else None
            )

            self._json_response(
                200,
                {
                    "delivery": current_delivery,
                    "deliveries": assigned_deliveries,
                    "count": len(assigned_deliveries)
                }
            )


            return

        if self.path == "/api/rider/deliveries":

            rider = get_logged_in_rider(self)

            if not rider:
                self._json_response(
                    401,
                    {"error": "Rider authentication required."}
                )
                return

            rider_id = str(rider.get("id", ""))
            deliveries = [
                order for order in load_deliveries()
                if str(order.get("riderId", "")) == rider_id
                and str(order.get("status", "")).strip().lower()
                in {"delivered", "failed", "cancelled"}
            ]
            deliveries.sort(
                key=lambda order: order.get("updatedAt", order.get("createdAt", "")),
                reverse=True
            )

            self._json_response(
                200,
                {"deliveries": deliveries}
            )

            return
        # =====================================================
        # ADMIN ORDERS
        # =====================================================

        if self.path.startswith("/api/admin/orders") and not self.path.startswith("/api/admin/orders/"):

            if not require_permission(self, "view_orders"):
                self._json_response(
                    403,
                    {
                        "error": "You do not have permission to view orders."
                    }
                )
                return

            query = parse_qs(urlparse(self.path).query)
            search = clean((query.get("search", [""])[0]), 120).lower()
            status_filter = clean((query.get("status", [""])[0]), 40).lower()
            vendor_filter = clean((query.get("vendor", [""])[0]), 160).lower()
            rider_filter = clean((query.get("rider", [""])[0]), 40)
            pickup_filter = clean((query.get("pickup", [""])[0]), 80).lower()
            dropoff_filter = clean((query.get("dropoff", [""])[0]), 80).lower()
            date_from = parse_iso_date(query.get("dateFrom", [""])[0])
            date_to = parse_iso_date(query.get("dateTo", [""])[0])

            try:
                page = max(1, int(query.get("page", ["1"])[0]))
            except ValueError:
                page = 1
            try:
                # Default kept generous (well above current order volume) since
                # admin.js does not yet have pagination controls; callers that
                # want a smaller page can still pass ?pageSize=.
                page_size = min(500, max(1, int(query.get("pageSize", ["500"])[0])))
            except ValueError:
                page_size = 500

            deliveries = load_deliveries()
            accounts = load_accounts()

            # Create a quick email → vendor name lookup
            vendor_names = {
                account.get("email", "").lower(): account.get("name", "—")
                for account in accounts
            }

            orders = []

            for delivery in deliveries:

                order = dict(delivery)
                email = delivery.get("accountEmail", "").lower()
                order["vendorName"] = vendor_names.get(email, "—")

                if status_filter and str(order.get("status", "")).lower() != status_filter:
                    continue
                if vendor_filter and vendor_filter not in email and vendor_filter not in order["vendorName"].lower():
                    continue
                if rider_filter and str(order.get("riderId", "")) != rider_filter:
                    continue
                if pickup_filter and pickup_filter not in str(order.get("pickup", "")).lower():
                    continue
                if dropoff_filter and dropoff_filter not in str(order.get("dropoff", "")).lower():
                    continue
                if search:
                    haystack = " ".join(str(order.get(field, "")) for field in (
                        "orderRef", "trackingCode", "accountEmail", "riderName", "vendorName"
                    )).lower()
                    if search not in haystack:
                        continue
                created_at = parse_iso_date(order.get("createdAt"))
                if date_from and (not created_at or created_at < date_from):
                    continue
                if date_to and (not created_at or created_at > date_to):
                    continue

                orders.append(order)

            orders.sort(
                key=lambda order: order.get("createdAt", ""),
                reverse=True
            )

            total = len(orders)
            start = (page - 1) * page_size
            page_items = orders[start:start + page_size]

            self._json_response(
                200,
                {
                    "orders": page_items,
                    "pagination": {
                        "page": page,
                        "pageSize": page_size,
                        "total": total,
                        "totalPages": max(1, math.ceil(total / page_size)),
                    }
                }
            )

            return

        # =====================================================
        # PROTECTED PROOF-OF-DELIVERY FILE ACCESS
        # (never reachable through the static file server)
        # =====================================================
        if self.path.startswith("/api/proof/"):
            filename = urlparse(self.path).path.removeprefix("/api/proof/")

            if "/" in filename or ".." in filename:
                self._json_response(404, {"error": "Not found."})
                return

            deliveries = load_deliveries()
            order = next(
                (
                    d for d in deliveries
                    if (d.get("proofOfDelivery") or {}).get("photoPath") == filename
                    or (d.get("proofOfDelivery") or {}).get("signaturePath") == filename
                ),
                None
            )

            if not order:
                self._json_response(404, {"error": "Not found."})
                return

            admin = get_current_admin(self)
            vendor_email = get_logged_in_vendor_email(self)
            is_owning_vendor = (
                vendor_email
                and vendor_email == str(order.get("accountEmail", "")).lower()
            )

            if not admin and not is_owning_vendor:
                self._json_response(403, {"error": "You are not authorized to view this file."})
                return

            file_path = PROOF_DIR / filename
            if not file_path.exists():
                self._json_response(404, {"error": "Not found."})
                return

            suffix = file_path.suffix.lower()
            content_type = {
                ".png": "image/png", ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg", ".webp": "image/webp",
            }.get(suffix, "application/octet-stream")

            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            self.wfile.write(data)
            return

        # =====================================================
        # PUBLIC DELIVERY TRACKING (no authentication - safe fields only)
        # =====================================================
        if self.path.startswith("/api/track"):
            code = clean(parse_qs(urlparse(self.path).query).get("code", [""])[0], 20).upper()

            if not code:
                self._json_response(400, {"error": "A tracking code is required."})
                return

            order = next(
                (d for d in load_deliveries() if str(d.get("trackingCode", "")).upper() == code),
                None
            )

            if not order:
                self._json_response(404, {"error": "No delivery found for that tracking code."})
                return

            status = str(order.get("status", "")).lower()
            safe_timeline = [
                {
                    "status": PUBLIC_TRACKING_STATUS_MAP.get(event.get("status"), None),
                    "at": event.get("at"),
                }
                for event in order.get("timeline", [])
                if PUBLIC_TRACKING_STATUS_MAP.get(event.get("status"))
            ]

            self._json_response(
                200,
                {
                    "trackingCode": order.get("trackingCode"),
                    "orderRef": order.get("orderRef"),
                    "status": PUBLIC_TRACKING_STATUS_MAP.get(status, "Order Received"),
                    "createdAt": order.get("createdAt"),
                    "updatedAt": order.get("updatedAt"),
                    "timeline": safe_timeline,
                }
            )
            return

        # =====================================================
        # ADMIN AUDIT LOG (read-only; no edit/delete endpoint exists)
        # =====================================================
        if self.path.startswith("/api/admin/audit-log"):
            if not require_permission(self, "view_audit_log"):
                self._json_response(403, {"error": "You do not have permission to view the audit log."})
                return

            query = parse_qs(urlparse(self.path).query)
            try:
                page = max(1, int(query.get("page", ["1"])[0]))
            except ValueError:
                page = 1
            try:
                page_size = min(200, max(1, int(query.get("pageSize", ["50"])[0])))
            except ValueError:
                page_size = 50

            entries = sorted(load_json_list(AUDIT_LOG_FILE), key=lambda e: e.get("at", ""), reverse=True)
            total = len(entries)
            start = (page - 1) * page_size

            self._json_response(
                200,
                {
                    "entries": entries[start:start + page_size],
                    "pagination": {
                        "page": page, "pageSize": page_size, "total": total,
                        "totalPages": max(1, math.ceil(total / page_size)),
                    }
                }
            )
            return

        # =====================================================
        # UNIT ADJUSTMENT HISTORY
        # =====================================================
        if self.path.startswith("/api/admin/unit-adjustments"):
            if not require_permission(self, "manage_vendors"):
                self._json_response(403, {"error": "You do not have permission to view unit adjustments."})
                return

            email = clean(parse_qs(urlparse(self.path).query).get("email", [""])[0], 160).lower()
            entries = load_json_list(UNIT_ADJUSTMENTS_FILE)
            if email:
                entries = [e for e in entries if str(e.get("email", "")).lower() == email]
            entries.sort(key=lambda e: e.get("at", ""), reverse=True)

            self._json_response(200, {"adjustments": entries})
            return

        if self.path.startswith("/api/account/unit-adjustments"):
            email = get_logged_in_vendor_email(self)
            if not email:
                self._json_response(401, {"error": "Please log in."})
                return
            entries = [
                e for e in load_json_list(UNIT_ADJUSTMENTS_FILE)
                if str(e.get("email", "")).lower() == email
            ]
            entries.sort(key=lambda e: e.get("at", ""), reverse=True)
            self._json_response(200, {"adjustments": entries})
            return

        # =====================================================
        # SUPPORT TICKETS
        # =====================================================
        if self.path.startswith("/api/admin/tickets"):
            if not require_permission(self, "view_tickets"):
                self._json_response(403, {"error": "You do not have permission to view support tickets."})
                return

            query = parse_qs(urlparse(self.path).query)
            status_filter = clean(query.get("status", [""])[0], 20).lower()
            category_filter = clean(query.get("category", [""])[0], 40).lower()
            search = clean(query.get("search", [""])[0], 120).lower()

            tickets = load_json_list(SUPPORT_TICKETS_FILE)
            if status_filter:
                tickets = [t for t in tickets if str(t.get("status", "")).lower() == status_filter]
            if category_filter:
                tickets = [t for t in tickets if str(t.get("category", "")).lower() == category_filter]
            if search:
                tickets = [
                    t for t in tickets
                    if search in str(t.get("id", "")).lower()
                    or search in str(t.get("vendorEmail", "")).lower()
                    or search in str(t.get("description", "")).lower()
                ]
            tickets.sort(key=lambda t: t.get("createdAt", ""), reverse=True)

            self._json_response(200, {"tickets": tickets})
            return

        if self.path.startswith("/api/account/tickets"):
            email = get_logged_in_vendor_email(self)
            if not email:
                self._json_response(401, {"error": "Please log in."})
                return

            tickets = [
                vendor_safe_ticket(t)
                for t in load_json_list(SUPPORT_TICKETS_FILE)
                if str(t.get("vendorEmail", "")).lower() == email
            ]
            tickets.sort(key=lambda t: t.get("createdAt", ""), reverse=True)

            self._json_response(200, {"tickets": tickets})
            return

        # =====================================================
        # CSV EXPORTS (role-gated; never includes secrets)
        # =====================================================
        if self.path.startswith("/api/admin/export/"):
            export_kind = urlparse(self.path).path.removeprefix("/api/admin/export/")
            export_permissions = {
                "orders": "view_orders",
                "vendors": "view_vendors",
                "subscriptions": "view_finance",
                "payments": "view_finance",
                "rider-payments": "view_finance",
                "performance": "view_reports",
            }
            required_permission = export_permissions.get(export_kind)

            if not required_permission or not require_permission(self, "export_data") or not require_permission(self, required_permission):
                self._json_response(403, {"error": "You do not have permission to export this data."})
                return

            csv_text = build_export_csv(export_kind)
            if csv_text is None:
                self._json_response(404, {"error": "Unknown export type."})
                return

            body = csv_text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{export_kind}.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/":
            self.path = "/index.html"

        super().do_GET()


if __name__ == "__main__":
    log_startup_state()
    migrate_subscriber_ids()
    migrate_deliveries()
    bootstrap_admin_from_environment()
    print(f"Fiable server running on 0.0.0.0:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), FiableHandler).serve_forever()
