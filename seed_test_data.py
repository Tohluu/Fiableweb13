"""
Fiable Logistics - controlled test-data seeder.

WHAT THIS IS
------------
A small, standalone script that populates a FRESH/EMPTY data directory
(e.g. a brand-new Railway Volume) with a minimal, clearly-labeled set of
TEST records so the app has something to show and can be smoke-tested
end to end (vendor login, an order, a rider, a support ticket).

WHAT THIS IS NOT
----------------
- It does NOT copy your real local data/*.json files anywhere.
- It is NEVER imported or run automatically by server.py at startup.
- It is NOT reachable through any HTTP endpoint - it only runs when a
  human deliberately executes it from a terminal.

SAFETY GATES
------------
1. Refuses to run unless APP_ENV is "development" or "staging".
   (Never run this against a production data directory.)
2. Requires the --confirm flag, so it can never run "by accident".
3. Every record it creates is prefixed with "TEST-" / uses a
   @test.fiable.internal email so it is unmistakable in the UI and
   trivial to find and delete later.
4. Safe to re-run: it checks for existing TEST- records first and
   skips creating duplicates.

USAGE
-----
    APP_ENV=development python seed_test_data.py --confirm

    (On Railway, if you ever need to seed a fresh Volume, set APP_ENV
    to "staging" temporarily, run this once via a one-off command, then
    unset it. Never set APP_ENV=staging permanently on a production
    service.)
"""

import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required. Confirms you intentionally want to seed test data.",
    )
    args = parser.parse_args()

    app_env = os.environ.get("APP_ENV", "development").strip().lower()
    if app_env not in ("development", "staging"):
        print(
            f"Refusing to run: APP_ENV={app_env!r}. "
            "This script only runs when APP_ENV is 'development' or 'staging'. "
            "It will never run against a production environment."
        )
        sys.exit(1)

    if not args.confirm:
        print(
            "Refusing to run without --confirm. "
            "Re-run as: python seed_test_data.py --confirm"
        )
        sys.exit(1)

    # Imported here (after the safety gates) so the module-level
    # DATA_DIR.mkdir() and print statements only happen once we know
    # we're intentionally proceeding.
    import server

    print(f"[seed] APP_ENV={app_env}")
    print(f"[seed] Target data directory: {server.DATA_DIR}")

    created = []

    # ------------------------------------------------------------
    # TEST VENDOR ACCOUNT
    # ------------------------------------------------------------
    test_email = "vendor@test.fiable.internal"
    accounts = server.load_accounts()
    account = next((a for a in accounts if a["email"] == test_email), None)
    if account is None:
        server.create_account(
            email=test_email,
            name="TEST- Seed Vendor",
            password="TestSeed12345!",
            plan="Basic",
        )
        accounts = server.load_accounts()
        account = next(a for a in accounts if a["email"] == test_email)
        account["paymentStatus"] = "paid"
        account["unitsAllocated"] = server.PLANS["Basic"]["units"]
        account["unitsUsed"] = 0
        server.ACCOUNTS_FILE.write_text(
            __import__("json").dumps(accounts, indent=2), encoding="utf-8"
        )
        created.append(f"vendor account: {test_email}")
    else:
        print(f"[seed] Vendor {test_email} already exists, skipping.")

    # ------------------------------------------------------------
    # TEST RIDER
    # ------------------------------------------------------------
    riders = server.load_riders()
    rider = next((r for r in riders if r.get("email") == "rider@test.fiable.internal"), None)
    if rider is None:
        import secrets as _secrets
        new_id = max((int(r.get("id", 0)) for r in riders if str(r.get("id", "")).isdigit()), default=0) + 1
        rider_salt = _secrets.token_hex(16)
        rider = {
            "id": new_id,
            "riderRef": f"FL-RID-{new_id:04d}",
            "name": "TEST- Seed Rider",
            "phone": "+2340000000000",
            "email": "rider@test.fiable.internal",
            "passwordHash": server.password_hash("TestSeed12345!", rider_salt),
            "salt": rider_salt,
            "vehicle": "Motorbike",
            "status": "available",
            "totalDeliveries": 0,
            "completedDeliveries": 0,
            "failedDeliveries": 0,
            "mustChangePassword": False,
            "isLoggedIn": False,
            "createdAt": server.now_iso(),
        }
        riders.append(rider)
        server.save_riders(riders)
        created.append(f"rider: {rider['email']}")
    else:
        print(f"[seed] Rider {rider['email']} already exists, skipping.")

    # ------------------------------------------------------------
    # TEST DELIVERY (order)
    # ------------------------------------------------------------
    deliveries = server.load_deliveries()
    existing_test_order = next(
        (d for d in deliveries if d.get("accountEmail") == test_email and str(d.get("orderRef", "")).startswith("TEST-")),
        None,
    )
    if existing_test_order is None:
        server.create_delivery(
            account_email=test_email,
            pickup="TEST- Seed Pickup Point, Lagos",
            dropoff="TEST- Seed Dropoff Point, Lagos",
            units=1,
            details={"packageType": "Documents", "packageDescription": "Seed test package"},
            order_ref="TEST-0001",
            unit_price=server.PLAN_UNIT_PRICES.get("Basic", 0),
            plan="Basic",
        )
        created.append("delivery: TEST-0001")
    else:
        print("[seed] TEST-0001 delivery already exists, skipping.")

    # ------------------------------------------------------------
    # TEST SUPPORT TICKET
    # ------------------------------------------------------------
    tickets = server.load_json_list(server.SUPPORT_TICKETS_FILE)
    existing_test_ticket = next((t for t in tickets if t.get("vendorEmail") == test_email), None)
    if existing_test_ticket is None:
        ticket = {
            "id": server.next_ticket_id(tickets),
            "vendorEmail": test_email,
            "vendorName": "TEST- Seed Vendor",
            "orderId": None,
            "category": "other",
            "description": "TEST- seed ticket for smoke testing the support tickets view.",
            "priority": "normal",
            "status": "open",
            "assignedTo": None,
            "replies": [],
            "internalNotes": [],
            "createdAt": server.now_iso(),
            "updatedAt": server.now_iso(),
        }
        tickets.append(ticket)
        server.save_json_list(server.SUPPORT_TICKETS_FILE, tickets)
        created.append(f"support ticket: #{ticket['id']}")
    else:
        print("[seed] TEST support ticket already exists, skipping.")

    print()
    if created:
        print("[seed] Created:")
        for item in created:
            print(f"  - {item}")
    else:
        print("[seed] Nothing new to create - test data already present.")
    print()
    print("[seed] Test vendor login: vendor@test.fiable.internal / TestSeed12345!")
    print("[seed] Test rider login:  rider@test.fiable.internal / TestSeed12345!")
    print("[seed] Done.")


if __name__ == "__main__":
    main()
