"""
Fiable Logistics - pre-launch data reset (DO NOT RUN CASUALLY).

PURPOSE
-------
Before going live for real customers, you will want to wipe out every
TEST/demo record that accumulated during development while keeping the
platform itself (pricing rules, role/permission config, and your real
Super Admin login) intact.

This script is NOT run automatically by anything. It must be invoked
deliberately, once, from a terminal, by a human who has already taken
a backup of the data directory.

WHAT IT PRESERVES (never touched)
----------------------------------
- admin_credentials.json entries whose role is "owner" or "super_admin"
  (your real production Super Admin login is never deleted).
- All pricing/plan/zone constants - these live in server.py, not in any
  data file, so there is nothing for this script to reset.
- All RBAC/permission definitions (ADMIN_PERMISSIONS, role labels) -
  also code, not data.

WHAT IT CLEARS (by default)
----------------------------
- accounts.json          (vendor accounts)
- deliveries.json         (orders)
- subscriptions.json      (subscription/billing history)
- rider_payments.json     (rider payout records)
- rider_notifications.json
- riders.json             (rider accounts)
- support_tickets.json
- submissions.json        (public contact-form enquiries)
- unit_adjustments.json   (manual unit adjustment history)
- reset_tokens.json       (password reset tokens)
- the proof-of-delivery upload directory contents

WHAT IT CLEARS ONLY IF YOU PASS --include-audit-log
----------------------------------------------------
- audit_log.json (append-only admin action history). This is excluded
  by default because audit history is often useful to keep even after
  a data reset; only clear it if you are certain you want a completely
  blank slate.

SAFETY GATES (all required)
----------------------------
1. Environment variable ALLOW_PRODUCTION_RESET=yes must be set.
2. --confirm "RESET" must be passed with the exact literal text RESET.
3. Interactive typed confirmation at the prompt (unless --yes is also
   passed, for scripted/CI use after you've already reviewed this file).

This script is intentionally never invoked by the agent that wrote it.
A human operator must run it deliberately when ready to launch.
"""

import argparse
import os
import sys
import json


def _wipe_list_file(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("[]", encoding="utf-8")


def _wipe_dict_file(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", required=True, help='Must be exactly "RESET".')
    parser.add_argument("--include-audit-log", action="store_true", help="Also clear audit_log.json.")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive typed prompt (for scripted use).")
    args = parser.parse_args()

    if os.environ.get("ALLOW_PRODUCTION_RESET", "").strip().lower() != "yes":
        print("Refusing to run: set ALLOW_PRODUCTION_RESET=yes to enable this script.")
        sys.exit(1)

    if args.confirm != "RESET":
        print('Refusing to run: --confirm must be exactly "RESET".')
        sys.exit(1)

    if not args.yes:
        typed = input(
            "This will permanently delete vendor/order/rider/ticket/subscription "
            "data. Have you backed up the data directory? Type YES-I-HAVE-A-BACKUP "
            "to proceed: "
        )
        if typed.strip() != "YES-I-HAVE-A-BACKUP":
            print("Confirmation text did not match. Aborting.")
            sys.exit(1)

    import server

    print(f"[reset] Target data directory: {server.DATA_DIR}")

    # Preserve owner/super_admin admin accounts; clear nothing else here -
    # admin_credentials.json intentionally is NOT wiped, only filtered.
    admins = server.load_admin_credentials()
    kept_admins = [a for a in admins if a.get("role") in ("owner", "super_admin")]
    removed_count = len(admins) - len(kept_admins)
    server.save_admin_credentials(kept_admins)
    print(f"[reset] admin_credentials.json: kept {len(kept_admins)} owner/super_admin account(s), removed {removed_count} other admin(s)")

    _wipe_list_file(server.ACCOUNTS_FILE)
    print("[reset] accounts.json cleared")

    _wipe_list_file(server.DELIVERIES_FILE)
    print("[reset] deliveries.json cleared")

    _wipe_list_file(server.SUBSCRIPTIONS_FILE)
    print("[reset] subscriptions.json cleared")

    _wipe_list_file(server.RIDER_PAYMENTS_FILE)
    print("[reset] rider_payments.json cleared")

    _wipe_list_file(server.RIDER_NOTIFICATIONS_FILE)
    print("[reset] rider_notifications.json cleared")

    _wipe_list_file(server.RIDERS_FILE)
    print("[reset] riders.json cleared")

    _wipe_list_file(server.SUPPORT_TICKETS_FILE)
    print("[reset] support_tickets.json cleared")

    _wipe_list_file(server.DATA_FILE)
    print("[reset] submissions.json (contact enquiries) cleared")

    _wipe_list_file(server.UNIT_ADJUSTMENTS_FILE)
    print("[reset] unit_adjustments.json cleared")

    _wipe_dict_file(server.RESET_TOKENS_FILE)
    print("[reset] reset_tokens.json cleared")

    if server.PROOF_DIR.exists():
        for item in server.PROOF_DIR.iterdir():
            if item.is_file():
                item.unlink()
        print("[reset] proof-of-delivery uploads cleared")

    if args.include_audit_log:
        _wipe_list_file(server.AUDIT_LOG_FILE)
        print("[reset] audit_log.json cleared (--include-audit-log was passed)")
    else:
        print("[reset] audit_log.json left untouched (pass --include-audit-log to clear it too)")

    print()
    print("[reset] Done. In-memory sessions (admin/vendor/rider) are not")
    print("[reset] touched by this script - restart the server process to")
    print("[reset] also clear those, or they will simply expire naturally.")


if __name__ == "__main__":
    main()
