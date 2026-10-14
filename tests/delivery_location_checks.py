"""Admin-added locations, migration and single/batch booking in temporary storage."""
import copy
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, requests, login
from rider_portal_checks import Client


def with_ogudu(config):
    config = copy.deepcopy(config)
    config["locations"].append({"id": "ogudu", "label": "Ogudu", "zone": "mainland-east"})
    next(area for area in config["areas"] if area["id"] == "ikeja")["locations"].append("ogudu")
    return server.validate_batch_routing(config)


def validation_checks():
    default = server.default_batch_routing()
    legacy = copy.deepcopy(default); del legacy["locations"]
    upgraded = server.validate_batch_routing(legacy)
    assert upgraded["locations"] == default["locations"]
    assert upgraded["areas"] == legacy["areas"] and upgraded["pickupRules"] == legacy["pickupRules"]
    custom = with_ogudu(default)
    invalid = []
    duplicate = copy.deepcopy(custom); duplicate["locations"][-1]["label"] = "  KOSOFE  "; invalid.append(duplicate)
    duplicate_id = copy.deepcopy(custom); duplicate_id["locations"][-1]["id"] = "kosofe"; invalid.append(duplicate_id)
    bad_zone = copy.deepcopy(custom); bad_zone["locations"][-1]["zone"] = "unknown"; invalid.append(bad_zone)
    bad_id = copy.deepcopy(custom); bad_id["locations"][-1]["id"] = "../ogudu"; invalid.append(bad_id)
    empty = copy.deepcopy(custom); empty["locations"][-1]["label"] = "   "; invalid.append(empty)
    unassigned = copy.deepcopy(custom)
    next(area for area in unassigned["areas"] if area["id"] == "ikeja")["locations"].remove("ogudu")
    invalid.append(unassigned)
    changed_standard = copy.deepcopy(custom); changed_standard["locations"][0]["zone"] = "extended"; invalid.append(changed_standard)
    removed_standard = copy.deepcopy(default); removed_standard["locations"].pop(); invalid.append(removed_standard)
    for config in invalid:
        try:
            server.validate_batch_routing(config)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid location configuration accepted")
    assert server.estimate_batch_deliveries(requests(["ogudu", "kosofe", "ikeja"]), "Basic", routing=custom)["groups"][0]["deliveryCount"] == 3
    print("PASS: legacy configuration migration, custom-location validation, coverage and grouping.", flush=True)


def api_checks(port):
    public = Client(port)
    owner = login(port, "owner@example.test", admin=True)
    vendor = login(port)
    status, saved = owner.request('/api/admin/batch-routing')
    assert status == 200
    custom = with_ogudu(saved["config"])
    deliveries = requests(["ogudu"] * 3)
    before_orders = server.DELIVERIES_FILE.read_bytes()
    before_accounts = server.ACCOUNTS_FILE.read_bytes()
    assert not any(location["id"] == "ogudu" for location in public.request('/api/locations')[1]["locations"])
    status, preview = owner.request('/api/admin/batch-routing/preview', {"config": custom, "deliveries": deliveries})
    assert status == 200 and preview["originalUnits"] == 9 and preview["groups"][0]["axis"] == "ikeja"
    assert server.DELIVERIES_FILE.read_bytes() == before_orders and server.ACCOUNTS_FILE.read_bytes() == before_accounts
    assert not any(location["id"] == "ogudu" for location in public.request('/api/locations')[1]["locations"]), "Unsaved locations must stay out of customer lists"
    assert vendor.request('/api/admin/batch-routing', {"config": custom, "version": saved["version"]})[0] == 403
    status, saved = owner.request('/api/admin/batch-routing', {"config": custom, "version": saved["version"]})
    assert status == 200
    assert server.load_batch_routing() == custom
    status, catalog = public.request('/api/locations')
    assert status == 200 and next(location for location in catalog["locations"] if location["id"] == "ogudu")["label"] == "Ogudu"
    for pickup, dropoff, units in [('egbeda', 'ogudu', 3), ('ogudu', 'chevron', 5), ('ogudu', 'ogudu', 1)]:
        status, quote = vendor.request('/api/calculate', {"pickup": pickup, "dropoff": dropoff})
        assert status == 200 and quote["units"] == units
    status, single = vendor.request('/api/delivery-request', deliveries[0])
    assert status == 201 and single["delivery"]["dropoff"] == 'ogudu' and single["delivery"]["units"] == 3
    status, quote = vendor.request('/api/batch-delivery-quote', {"deliveries": deliveries})
    assert status == 200 and quote["originalUnits"] == 9
    status, booked = vendor.request('/api/batch-delivery-request', {"deliveries": deliveries, "quoteToken": quote["quoteToken"]})
    assert status == 201 and len(booked["deliveries"]) == 3
    assert all(order["pricing"]["deliveryArea"] == 'ikeja' for order in booked["deliveries"])
    old_orders = copy.deepcopy(server.load_deliveries())
    changed = copy.deepcopy(saved["config"])
    changed["locations"][-1]["zone"] = 'extended'
    status, updated = owner.request('/api/admin/batch-routing', {"config": changed, "version": saved["version"]})
    assert status == 200
    assert server.estimate_delivery('egbeda', 'ogudu', 'Basic')["units"] == 7
    assert server.load_deliveries() == old_orders
    status, stale = vendor.request('/api/batch-delivery-request', {"deliveries": deliveries, "quoteToken": quote["quoteToken"]})
    assert status == 409 and stale["quoteChanged"]
    print("PASS: unsaved-location dry runs, shared public list, persistence, permissions, single/batch pricing and booking, pricing edits and booking snapshots.", flush=True)


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='fiable-location-check-') as directory:
        fixtures(directory)
        validation_checks()
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            api_checks(httpd.server_port)
        finally:
            httpd.shutdown(); httpd.server_close()
