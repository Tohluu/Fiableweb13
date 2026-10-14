"""Pickup-specific routing, persistence and quote protection in isolated storage."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, requests, login, PASSWORD
from rider_portal_checks import Client


def combined_config():
    config = server.default_batch_routing()
    groups = [
        {"id": "test-corridor", "label": "Test corridor", "areas": ["lekki-phase-1", "lekki"]},
        *[{"id": area["id"], "label": area["label"], "areas": [area["id"]]}
          for area in config["areas"] if area["id"] not in {"lekki-phase-1", "lekki"}],
    ]
    config["pickupRules"]["alimosho"] = groups
    return config


def validation_checks():
    config = server.default_batch_routing()
    assert server.validate_batch_routing(config) == config
    invalid = []
    missing = copy.deepcopy(config); missing["areas"][0]["locations"].pop(); invalid.append(missing)
    duplicate = copy.deepcopy(config); duplicate["areas"][1]["locations"].append(config["areas"][0]["locations"][0]); invalid.append(duplicate)
    bad_id = copy.deepcopy(config); bad_id["areas"][0]["id"] = "../../invalid"; invalid.append(bad_id)
    empty = copy.deepcopy(config); empty["areas"][0]["locations"] = []; invalid.append(empty)
    label = copy.deepcopy(config); label["areas"][0]["label"] = label["areas"][1]["label"].upper(); invalid.append(label)
    rule = combined_config(); rule["pickupRules"]["alimosho"][0]["areas"].append("epe"); invalid.append(rule)
    missing_group = combined_config(); missing_group["pickupRules"]["alimosho"].pop(); invalid.append(missing_group)
    unknown = combined_config(); unknown["pickupRules"]["unknown"] = unknown["pickupRules"].pop("alimosho"); invalid.append(unknown)
    for value in [None, [], {}, *invalid]:
        try:
            server.validate_batch_routing(value)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid routing accepted")
    deliveries = requests(["lekki-phase-1", "chevron", "chevron"])
    original = server.estimate_batch_deliveries(deliveries, "Basic")
    combined = server.estimate_batch_deliveries(deliveries, "Basic", combined_config())
    elsewhere = server.estimate_batch_deliveries(requests(["lekki-phase-1", "chevron", "chevron"], pickup="ikeja"), "Basic", combined_config())
    assert len(original["groups"]) == len(elsewhere["groups"]) == 2
    assert all(group["discountRate"] == 0 for group in original["groups"] + elsewhere["groups"])
    assert len(combined["groups"]) == 1 and combined["discountRate"] == .05
    assert original["quoteToken"] != combined["quoteToken"]
    assert all(delivery["pickupArea"] == "alimosho" for delivery in combined["deliveries"])
    assert {delivery["deliveryArea"] for delivery in combined["deliveries"]} == {"lekki-phase-1", "lekki"}
    print("PASS: area coverage, overlap/partition validation, pickup-dependent grouping and per-group tiers.", flush=True)


def api_checks(port):
    owner = login(port, "owner@example.test", admin=True)
    vendor = login(port)
    status, saved = owner.request("/api/admin/batch-routing")
    assert status == 200 and saved["canManage"]
    assert not server.BATCH_ROUTING_FILE.exists(), "Loading defaults must not write settings"
    assert Client(port).request("/api/admin/batch-routing")[0] == 403
    assert vendor.request("/api/admin/batch-routing")[0] == 403
    config = combined_config()
    deliveries = requests(["lekki-phase-1"] * 3 + ["chevron"] * 3)
    status, quote = vendor.request("/api/batch-delivery-quote", {"deliveries": deliveries})
    assert status == 200 and len(quote["groups"]) == 2
    orders_before = server.DELIVERIES_FILE.read_bytes()
    accounts_before = server.ACCOUNTS_FILE.read_bytes()
    status, preview = owner.request("/api/admin/batch-routing/preview", {"config": config, "deliveries": deliveries})
    assert status == 200 and len(preview["groups"]) == 1
    assert server.DELIVERIES_FILE.read_bytes() == orders_before
    assert server.ACCOUNTS_FILE.read_bytes() == accounts_before
    assert not server.BATCH_ROUTING_FILE.exists(), "Dry run must not save edits"
    status, updated = owner.request("/api/admin/batch-routing", {"config": config, "version": saved["version"]})
    assert status == 200 and updated["version"] != saved["version"]
    assert server.load_batch_routing() == updated["config"]
    assert json.loads(server.AUDIT_LOG_FILE.read_text())[-1]["action"] == "batch_routing_updated"
    assert owner.request("/api/admin/batch-routing", {"config": config, "version": saved["version"]})[0] == 409
    status, stale = vendor.request("/api/batch-delivery-request", {"deliveries": deliveries, "quoteToken": quote["quoteToken"]})
    assert status == 409 and stale["quoteChanged"]
    assert server.DELIVERIES_FILE.read_bytes() == orders_before
    status, fresh = vendor.request("/api/batch-delivery-quote", {"deliveries": deliveries})
    assert status == 200 and fresh["routingVersion"] == updated["version"]
    missing = vendor.request("/api/batch-delivery-request", {"deliveries": deliveries})
    assert missing[0] == 409 and missing[1]["quoteChanged"]
    status, booking = vendor.request("/api/batch-delivery-request", {"deliveries": deliveries, "quoteToken": fresh["quoteToken"]})
    assert status == 201, booking
    snapshot = copy.deepcopy(server.load_deliveries())
    assert all(order["pricing"]["batchRoutingVersion"] == updated["version"] for order in snapshot)
    assert owner.request("/api/admin/batch-routing", {"config": saved["config"], "version": updated["version"]})[0] == 200
    assert server.load_deliveries() == snapshot, "Rule edits must preserve booked prices and group labels"
    admins = server.load_admin_credentials()
    for index, role in enumerate(["dispatcher", "operations_manager", "analyst", "finance"], 2):
        admins.append({"id": index, "email": f"{role}@example.test", "name": role, "role": role,
                       "status": "active", "salt": "test-salt", "passwordHash": server.password_hash(PASSWORD, "test-salt")})
    server.save_admin_credentials(admins)
    for role in ["dispatcher", "operations_manager", "analyst", "finance"]:
        admin = login(port, f"{role}@example.test", admin=True)
        status, data = admin.request("/api/admin/batch-routing")
        if role == "finance":
            assert status == 403
            assert admin.request("/api/admin/batch-routing/preview", {"config": config, "deliveries": deliveries})[0] == 403
            continue
        assert status == 200 and data["canManage"] == (role == "operations_manager")
        assert admin.request("/api/admin/batch-routing/preview", {"config": config, "deliveries": deliveries})[0] == 200
        status, _ = admin.request("/api/admin/batch-routing", {"config": data["config"], "version": data["version"]})
        assert status == (200 if role == "operations_manager" else 403)
    server.BATCH_ROUTING_FILE.write_text('{broken', encoding="utf-8")
    assert owner.request("/api/admin/batch-routing")[0] == 503
    assert vendor.request("/api/batch-delivery-quote", {"deliveries": deliveries})[0] == 400
    print("PASS: dry runs, persistence, audit, concurrent-edit protection, stale/missing quote rejection, booking snapshots, role permissions and corrupt-config handling.", flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-routing-check-") as directory:
        fixtures(directory)
        validation_checks()
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            api_checks(httpd.server_port)
        finally:
            httpd.shutdown(); httpd.server_close()
