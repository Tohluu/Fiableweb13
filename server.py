from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json
import re
import hashlib
import hmac
import secrets
from datetime import datetime, timezone, timedelta
import os

ROOT = Path(__file__).parent
DATA_FILE = ROOT / "data" / "submissions.json"
ACCOUNTS_FILE = ROOT / "data" / "accounts.json"
PORT = 8000

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

PLAN_UNIT_PRICES = {
    "Basic": 1500,
    "Growth": 1400,
    "Business": 1300,
}

EXPRESS_UNIT_PRICE = 2000

PLANS = {
    "Basic": {"units": 45},
    "Growth": {"units": 75},
    "Business": {"units": 110},
}

DELIVERIES_FILE = ROOT / "data" / "deliveries.json"
RIDERS_FILE = ROOT / "data" / "riders.json"
RIDER_NOTIFICATIONS_FILE = (
    ROOT / "data" / "rider_notifications.json"
)
RIDER_PAYMENTS_FILE = ROOT / "data" / "rider_payments.json"
ADMIN_CREDENTIALS_FILE = ROOT / "data" / "admin_credentials.json"
RESET_TOKENS_FILE = ROOT / "data" / "reset_tokens.json"
SUBSCRIPTIONS_FILE = ROOT / "data" / "subscriptions.json"
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


def estimate_delivery(pickup, dropoff, plan=None):
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
    return {
        "units": units,
        "cost": units * unit_price,
        "unitPrice": unit_price,
        "plan": billed_plan,
        "recommendedPlan": recommended,
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

def load_admin_credentials():

    if not ADMIN_CREDENTIALS_FILE.exists():
        return None

    try:

        content = ADMIN_CREDENTIALS_FILE.read_text(
            encoding="utf-8"
        ).strip()

        if not content:
            return None

        credentials = json.loads(content)

        if not isinstance(credentials, dict):
            return None

        return credentials

    except (json.JSONDecodeError, OSError):

        return None


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


def create_delivery(account_email, pickup, dropoff, units, details=None, order_ref=None, unit_price=None, plan=None):
    deliveries = load_deliveries()
    new_id = (deliveries[-1]["id"] + 1) if deliveries else 1
    record = {
        "id": new_id,
        "orderRef": order_ref or f"FL-{new_id:04d}",
        "accountEmail": account_email.lower(),
        "pickup": pickup,
        "dropoff": dropoff,
        "units": int(units),
        "unitPrice": int(unit_price or 0),
        "cost": int(units) * int(unit_price or 0),
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
    }
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


def rider_payment_for_delivery(delivery, account_plan=None):
    delivery_fee = delivery.get("cost")
    if delivery_fee is None:
        plan = delivery.get("subscriptionPlan") or account_plan
        unit_price = PLAN_UNIT_PRICES.get(plan, 0)
        delivery_fee = int(delivery.get("units", 0) or 0) * unit_price
    return round(float(delivery_fee or 0) * 0.80)


def rider_payment_summary(month=None):
    riders = load_riders()
    deliveries = load_deliveries()
    accounts = load_accounts()
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
            and (not month or delivery_month(delivery) == month)
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
                "orderRef": delivery.get("orderRef", f"#{delivery.get('id')}"),
                "route": f"{delivery.get('pickup', '—')} → {delivery.get('dropoff', '—')}",
                "units": delivery.get("units", 0),
                "status": delivery.get("status", ""),
                "deliveryFee": delivery_fee,
                "riderPayment": rider_payment,
                "payable": rider_payment > 0,
            })
        summaries.append({
            "riderId": rider.get("id"),
            "riderRef": rider.get("riderRef", ""),
            "name": rider.get("name", ""),
            "completedDeliveries": len(completed),
            "failedDeliveries": len(failed),
            "payable": payable,
            "paid": 0,
            "outstanding": payable,
            "breakdown": breakdown,
        })

    # Load paid amounts from rider_payments
    rider_payments = load_rider_payments()
    
    for summary in summaries:
        paid = 0
        for payment in rider_payments:
            if str(payment.get("riderId")) == str(summary["riderId"]):
                # When viewing all months, aggregate all payments across all months
                if not month:
                    paid += payment.get("amount", 0)
                # When viewing specific month, only count payments for that month
                elif payment.get("month") == month:
                    paid += payment.get("amount", 0)
        summary["paid"] = paid
        summary["outstanding"] = max(0, summary["payable"] - paid)

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

    return bool(session)

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
    print(
        "RIDER SESSION COOKIE:",
        token
    )

    print(
        "RIDER SESSIONS:",
        RIDER_SESSIONS
    )

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


def summary_for_account(account):
    plan = account.get("plan") if account.get("plan") in PLANS else None
    units_allocated = PLANS[plan]["units"] if plan else 0
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

        try:
            payload = self._read_json()
            if not isinstance(payload, dict):
                raise ValueError("Request body must be an object")
            # =====================================================
            # RIDER LOGIN
            # =====================================================
            if path == "/api/rider/login":

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

                    self._json_response(
                        401,
                        {
                            "error": "Invalid rider email or password."
                        }
                    )

                    return


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
                        "status": rider.get("status", "available")
                    }
                }).encode("utf-8")


                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    "application/json; charset=utf-8"
                )

                self.send_header(
                    "Set-Cookie",
                    f"fiable_rider_session={session_token}; "
                    f"Path=/; HttpOnly; SameSite=Lax; "
                    f"Max-Age={RIDER_SESSION_EXPIRY_HOURS * 60 * 60}"
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
                    "fiable_rider_session=; "
                    "Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
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


                # -------------------------------------------------
                # VALIDATE ORDER ID
                # -------------------------------------------------

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


                # -------------------------------------------------
                # ONLY ALLOW RIDER ACTIONS
                # -------------------------------------------------

                allowed_statuses = {
                    "on_delivery",
                    "delivered"
                }

                if new_status not in allowed_statuses:

                    self._json_response(
                        400,
                        {
                            "error": "Invalid delivery status."
                        }
                    )

                    return


                deliveries = load_deliveries()
                riders = load_riders()

                rider_id = str(
                    rider.get("id", "")
                )

                rider = next(
                    (
                        item
                        for item in riders
                        if str(item.get("id", "")) == rider_id
                    ),
                    None
                )

                if not rider:
                    self._json_response(
                        404,
                        {
                            "error": "Rider account not found."
                        }
                    )
                    return


                # -------------------------------------------------
                # FIND ORDER
                # -------------------------------------------------

                order = next(
                    (
                        item
                        for item in deliveries
                        if str(
                            item.get("id", "")
                        ) == str(order_id)
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


                # -------------------------------------------------
                # VERIFY RIDER OWNS THIS ORDER
                # -------------------------------------------------

                rider_id = str(
                    rider.get("id", "")
                )

                order_rider_id = str(
                    order.get("riderId", "")
                )


                if order_rider_id != rider_id:

                    self._json_response(
                        403,
                        {
                            "error":
                            "You are not assigned to this delivery."
                        }
                    )

                    return


                # -------------------------------------------------
                # CURRENT STATUS
                # -------------------------------------------------

                current_status = str(
                    order.get("status", "")
                ).strip().lower()


                # -------------------------------------------------
                # ASSIGNED → ON DELIVERY
                # -------------------------------------------------

                if new_status == "on_delivery":

                    if current_status != "assigned":

                        self._json_response(
                            400,
                            {
                                "error":
                                "This delivery cannot be started in its current status."
                            }
                        )

                        return


                    order["status"] = "on_delivery"

                    rider["status"] = "on_delivery"


                # -------------------------------------------------
                # ON DELIVERY → DELIVERED
                # -------------------------------------------------

                elif new_status == "delivered":

                    if current_status != "on_delivery":

                        self._json_response(
                            400,
                            {
                                "error":
                                "This delivery cannot be completed in its current status."
                            }
                        )

                        return


                    order["status"] = "delivered"

                    has_queued_delivery = any(
                        str(delivery.get("riderId", "")) == rider_id
                        and str(delivery.get("status", "")).strip().lower()
                        == "assigned"
                        for delivery in deliveries
                    )
                    rider["status"] = (
                        "assigned" if has_queued_delivery else "available"
                    )


                    rider["totalDeliveries"] = (
                        int(
                            rider.get(
                                "totalDeliveries",
                                0
                            ) or 0
                        ) + 1
                    )


                    rider["completedDeliveries"] = (
                        int(
                            rider.get(
                                "completedDeliveries",
                                0
                            ) or 0
                        ) + 1
                    )


                # -------------------------------------------------
                # UPDATE TIMESTAMP
                # -------------------------------------------------

                order["updatedAt"] = datetime.now(
                    timezone.utc
                ).isoformat()


                # -------------------------------------------------
                # SAVE BOTH
                # -------------------------------------------------

                save_deliveries(deliveries)
                save_riders(riders)


                self._json_response(
                    200,
                    {
                        "message":
                            "Delivery status updated successfully.",

                        "order": order,

                        "rider": rider
                    }
                )

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
                    account.get("plan") if account else None
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

                admin_credentials = load_admin_credentials()

                if not admin_credentials:

                    self._json_response(
                        500,
                        {
                            "error": "Unable to load admin credentials."
                        }
                    )

                    return


                admin_email = clean(
                    admin_credentials.get("email"),
                    160
                ).lower()

                admin_password_hash = admin_credentials.get(
                    "passwordHash"
                )

                admin_salt = admin_credentials.get(
                    "salt"
                )


                if not admin_email or not admin_password_hash or not admin_salt:

                    self._json_response(
                        500,
                        {
                            "error": "Admin credentials are incomplete."
                        }
                    )

                    return


                valid_email_login = hmac.compare_digest(
                    email,
                    admin_email
                )

                valid_password_login = hmac.compare_digest(
                    admin_password_hash,
                    password_hash(
                        password,
                        admin_salt
                    )
                )


                if not valid_email_login or not valid_password_login:

                    self._json_response(
                        401,
                        {
                            "error": "Invalid admin email or password."
                        }
                    )

                    return


                # -------------------------------------------------
                # CREATE ADMIN SESSION
                # -------------------------------------------------

                session_token = create_admin_session(admin_email)


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
                    f"fiable_admin_session={session_token}; "
                    f"Path=/; HttpOnly; SameSite=Lax; "
                    f"Max-Age={ADMIN_SESSION_EXPIRY_HOURS * 60 * 60}"
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
                    "fiable_admin_session=; "
                    "Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
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


                credentials = load_admin_credentials()

                if not credentials:

                    self._json_response(
                        500,
                        {
                            "error": "Unable to load admin credentials."
                        }
                    )

                    return


                stored_hash = credentials.get("passwordHash")
                stored_salt = credentials.get("salt")


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

                credentials["passwordHash"] = password_hash(
                    newPassword,
                    new_salt
                )

                credentials["salt"] = new_salt


                ADMIN_CREDENTIALS_FILE.write_text(
                    json.dumps(
                        credentials,
                        indent=2
                    ),
                    encoding="utf-8"
                )


                self._json_response(
                    200,
                    {
                        "message": "Admin password changed successfully."
                    }
                )

                return

            # =====================================================
            # ADMIN UPDATE RIDER
            # =====================================================

            if path == "/api/admin/riders/update":

                if not require_admin(self):
                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
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

                if not require_admin(self):
                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
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

                if not require_admin(self):
                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
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

                # Only riders actively on a delivery are unavailable.
                if rider.get("status") == "on_delivery":
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

                # Rider becomes assigned
                rider["status"] = "assigned"

                save_deliveries(deliveries)
                save_riders(riders)


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

                if not require_admin(self):
                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
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

                # Only riders actively on a delivery are unavailable.
                if rider.get("status") == "on_delivery":
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

                if not require_admin(self):
                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
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

                # Only riders actively on a delivery are unavailable.
                if new_rider.get("status") == "on_delivery":
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

                # New rider becomes assigned
                new_rider["status"] = "assigned"

                save_deliveries(deliveries)
                save_riders(riders)

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

                if not require_admin(self):
                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
                        }
                    )
                    return

                order_id = payload.get("orderId")
                new_status = clean(
                    payload.get("status"),
                    40
                ).lower()

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

                allowed_transitions = {
                    "assigned": {
                        "on_delivery"
                    },
                    "on_delivery": {
                        "delivered",
                        "failed"
                    }
                }

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

                allowed_next_statuses = allowed_transitions.get(
                    current_status,
                    set()
                )

                if new_status not in allowed_next_statuses:
                    self._json_response(
                        400,
                        {
                            "error": "This order cannot be moved to that status."
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

                # Assigned → On Delivery
                if current_status == "assigned":

                    order["status"] = "on_delivery"

                    if rider:
                        rider["status"] = "on_delivery"

                # On Delivery → Delivered
                elif current_status == "on_delivery":

                    order["status"] = new_status

                    if rider:

                        has_queued_delivery = any(
                            str(delivery.get("riderId", "")) ==
                            str(rider.get("id", ""))
                            and str(delivery.get("status", "")).strip().lower()
                            == "assigned"
                            for delivery in deliveries
                        )
                        rider["status"] = (
                            "assigned"
                            if has_queued_delivery
                            else "available"
                        )

                        if new_status == "delivered":

                            rider["totalDeliveries"] = (
                                int(
                                    rider.get(
                                        "totalDeliveries",
                                        0
                                    ) or 0
                                ) + 1
                            )

                            rider["completedDeliveries"] = (
                                int(
                                    rider.get(
                                        "completedDeliveries",
                                        0
                                    ) or 0
                                ) + 1
                            )

                        elif new_status == "failed":

                            rider["failedDeliveries"] = (
                                int(
                                    rider.get(
                                        "failedDeliveries",
                                        0
                                    ) or 0
                                ) + 1
                            )

                order["updatedAt"] = datetime.now(
                    timezone.utc
                ).isoformat()

                save_deliveries(deliveries)
                save_riders(riders)

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

                if not require_admin(self):
                    self._json_response(
                        401,
                        {
                            "error": "Admin authentication required."
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
                    "status": "available",
                    "totalDeliveries": 0,
                    "completedDeliveries": 0,
                    "failedDeliveries": 0,
                    "createdAt": datetime.now(
                        timezone.utc
                    ).isoformat(),
                }

                riders.append(rider)

                save_riders(riders)

                self._json_response(
                    201,
                    {
                        "message": "Rider created successfully.",
                        "rider": rider
                    }
                )

                return
            if path == "/api/login":
                email = clean(payload.get("email"), 160).lower()
                password = clean(payload.get("password"), 128)
                account = authenticate(email, password)
                if not account:
                    self._json_response(401, {"error": "Invalid email or password"})
                    return
                summary = summary_for_account(account)
                self._json_response(200, summary)
                return

            if path == "/api/change-password":
                email = clean(payload.get("email"), 160).lower()
                currentPassword = clean(payload.get("currentPassword"), 128)
                newPassword = clean(payload.get("newPassword"), 128)

                if not email or not currentPassword or not newPassword:
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
                email = clean(payload.get("email"), 160).lower()
                account = update_account(email, clean(payload.get("plan"), 40))
                self._json_response(200, summary_for_account(account))
                return
            if path == "/api/account/payment":
                email = clean(payload.get("email"), 160).lower()
                account = mark_payment_complete(email)
                self._json_response(200, {"paymentStatus": account["paymentStatus"], "message": "Payment recorded for local demo checkout."})
                return
            if path == "/api/delivery-request":
                email = clean(payload.get("email"), 160).lower()
                pickup = clean(payload.get("pickup"), 120)
                dropoff = clean(payload.get("dropoff"), 120)
                contactName = clean(payload.get("pickupContactName"), 100)
                contactPhone = clean(payload.get("pickupPhone"), 40)
                pickupAddress = clean(payload.get("pickupAddress"), 300)
                recipient = clean(payload.get("recipientName"), 100)
                recipientPhone = clean(payload.get("recipientPhone"), 40)
                deliveryAddress = clean(payload.get("deliveryAddress"), 300)
                packageType = clean(payload.get("packageType"), 40) or "General"
                priority = clean(payload.get("priority"), 40) or "Standard"
                window = clean(payload.get("deliveryWindow"), 40) or "Standard"
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
                    "packageType": packageType,
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
                est = estimate_delivery(pickup, dropoff, summary.get("plan"))
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
                    "priority": priority,
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
                    plan=summary.get("plan")
                )
                self._json_response(201, {"message": "Delivery request received", "delivery": delivery, "summary": summary_for_account(account)})
                return
            if path == "/api/delivery/status":

                # update delivery status
                delivery_id = int(
                    payload.get("id") or 0
                )

                status = clean(
                    payload.get("status"),
                    40
                ).lower()

                allowed = {
                    "requested",
                    "assigned",
                    "in-transit",
                    "delivered",
                    "cancelled"
                }

                if status not in allowed:
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
            self._json_response(200, {"status": "ok"})
            return
        if self.path.startswith("/api/account/subscriptions"):
            query = urlparse(self.path).query
            params = parse_qs(query)
            email = params.get("email", [None])[0]
            if not email:
                self._json_response(400, {"error": "email query required"})
                return
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
            if not require_admin(self):
                self._json_response(401, {"error": "Admin authentication required."})
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
            if not require_admin(self):
                self._json_response(401, {"error": "Admin authentication required."})
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
            query = urlparse(self.path).query
            params = parse_qs(query)
            email = params.get("email", [None])[0]
            if not email:
                self._json_response(400, {"error": "email query required"})
                return
            items = deliveries_for_account(email)
            self._json_response(200, {"deliveries": items})
            return
        if self.path.startswith("/api/dashboard-stats"):
            query = urlparse(self.path).query
            params = parse_qs(query)
            email = params.get("email", [None])[0]
            if not email:
                self._json_response(400, {"error": "email query required"})
                return
            stats = dashboard_stats_for_account(email)
            self._json_response(200, {"stats": stats})
            return
        if self.path == "/api/admin/summary":

            if not require_admin(self):
                self._json_response(
                    401,
                    {
                        "error": "Admin authentication required."
                    }
                )
                return

            self._json_response(200, admin_summary())
            return

        if self.path == "/api/admin/account":

            email = get_admin_email(self)

            if not email:
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
                    "email": email
                }
            )
            return

        if self.path == "/api/admin/riders":

            if not require_admin(self):
                self._json_response(
                    401,
                    {
                        "error": "Admin authentication required."
                    }
                )
                return

            riders = load_riders()
            deliveries = load_deliveries()
            accounts = load_accounts()

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

            self._json_response(
                200,
                {
                    "riders": riders
                }
            )

            return

        if self.path.startswith("/api/admin/rider-payments"):
            if not require_admin(self):
                self._json_response(
                    401,
                    {"error": "Admin authentication required."}
                )
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

            if not require_admin(self):
                self._json_response(
                    401,
                    {
                        "error": "Admin authentication required."
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
            query = urlparse(self.path).query
            params = parse_qs(query)
            email = params.get("email", [None])[0]
            if not email:
                self._json_response(400, {"error": "email query required"})
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
                in {"assigned", "on_delivery"}
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
                        )
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

        if self.path == "/api/admin/orders":

            if not require_admin(self):
                self._json_response(
                    401,
                    {
                        "error": "Admin authentication required."
                    }
                )
                return

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

                email = (
                    delivery.get("accountEmail", "")
                    .lower()
                )

                order["vendorName"] = vendor_names.get(
                    email,
                    "—"
                )

                orders.append(order)

            orders.sort(
                key=lambda order: order.get("createdAt", ""),
                reverse=True
            )

            self._json_response(
                200,
                {
                    "orders": orders
                }
            )

            return

        if self.path == "/":
            self.path = "/index.html"

        super().do_GET()


if __name__ == "__main__":
    migrate_subscriber_ids()
    print(f"Fiable server running at http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), FiableHandler).serve_forever()
