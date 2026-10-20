"""Lagos catalog rollout and admin edits, using isolated temporary storage."""
import copy
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, login, requests
from express_delivery_checks import booking
from rider_portal_checks import Client


def migration_checks():
    fresh = server.default_batch_routing()
    additions = {key for key, _, _ in server.LAGOS_LOCATION_ADDITIONS}
    assert len(additions) == 30 and not additions.intersection(server.LOCATION_ZONES)
    assert len(fresh["locations"]) == len(server.LOCATION_ZONES) + 30
    assert server.validate_batch_routing(fresh) == fresh
    legacy = copy.deepcopy(fresh)
    del legacy["locationCatalogVersion"]
    legacy["locations"] = [item for item in legacy["locations"] if item["id"] not in additions]
    legacy["areas"] = [area for area in legacy["areas"] if not set(area["locations"]) & additions]
    # Simulate existing admin additions and changed rates, names and assignments.
    legacy["locations"] += [
        {"id": "maryland-gra", "label": "Maryland", "zone": "extended"},
        {"id": "berger", "label": "Berger", "zone": "mainland-east"},
    ]
    legacy["areas"][0]["locations"].extend(["maryland-gra", "berger"])
    legacy["areas"][0]["label"] = "Akowonjo"  # New area labels must avoid collisions.
    legacy["locations"][0]["zone"] = "extended"
    legacy["zoneUnits"][0]["units"] = 6
    legacy["pickupRules"]["alimosho"] = server.batch_routing_groups(legacy, "alimosho")
    legacy = server.validate_batch_routing(legacy)
    before = copy.deepcopy(legacy)
    server.atomic_write_json(server.BATCH_ROUTING_FILE, legacy)
    raw = server.BATCH_ROUTING_FILE.read_bytes()
    expanded = server.load_batch_routing()
    assert server.BATCH_ROUTING_FILE.read_bytes() == raw, "Read migration must not write storage"
    assert legacy == before and expanded["zoneUnits"] == before["zoneUnits"]
    assert expanded["pricingZones"] == before["pricingZones"]
    assert expanded["areas"][:len(before["areas"])] == before["areas"]
    assert expanded["pickupRules"]["alimosho"][:len(before["areas"])] == before["pickupRules"]["alimosho"]
    assert len(expanded["locations"]) == len(before["locations"]) + 29
    assert not any(item["id"] == "maryland" for item in expanded["locations"])
    assert next(item for item in expanded["locations"] if item["id"] == "maryland-gra")["zone"] == "extended"
    assert next(item for item in expanded["locations"] if item["id"] == "berger")["label"] == "Ojodu Berger"
    assert all(len(group["areas"]) == 1 for group in expanded["pickupRules"]["alimosho"])
    assert server.expand_lagos_location_catalog(expanded) == expanded
    server.atomic_write_json(server.BATCH_ROUTING_FILE, expanded)
    assert server.load_batch_routing() == expanded
    # An invalid old file must fail rather than being repaired by the rollout.
    broken = copy.deepcopy(legacy)
    broken["areas"][0]["locations"].pop()
    server.atomic_write_json(server.BATCH_ROUTING_FILE, broken)
    try:
        server.load_batch_routing()
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid legacy settings were silently repaired")
    server.atomic_write_json(server.BATCH_ROUTING_FILE, fresh)
    print("PASS: 30 editable defaults; idempotent legacy rollout; preserved rates, areas and groups; duplicate avoidance; Berger clarification; invalid-file rejection.", flush=True)


def api_checks(port):
    owner, vendor, guest = login(port, "owner@example.test", admin=True), login(port), Client(port)
    status, initial = owner.request('/api/admin/batch-routing')
    assert status == 200
    _, public = guest.request('/api/locations')
    catalog = {item["id"]: item for item in public["locations"]}
    for key, label, zone in server.LAGOS_LOCATION_ADDITIONS:
        assert catalog[key] == {"id": key, "label": label, "zone": zone}
        assert key not in initial["standardLocationIds"], "Seeded names must stay editable in admin"
        for pickup, dropoff in [("egbeda", key), (key, "egbeda")]:
            status, quote = guest.request('/api/calculate', {"pickup": pickup, "dropoff": dropoff})
            assert status == 200 and quote["cost"] == quote["units"] * 2000
    _, quote = guest.request('/api/express/quote', {"pickup": "agungi", "dropoff": "badore"})
    status, booked = guest.request('/api/express/book', booking(pickup="agungi", dropoff="badore", quotedCost=quote["cost"]))
    assert status == 201, booked
    deliveries = requests(["ogba"] * 3, pickup="iyana-ipaja")
    status, quote = vendor.request('/api/batch-delivery-quote', {"deliveries": deliveries})
    assert status == 200
    status, booked = vendor.request('/api/batch-delivery-request', {"deliveries": deliveries, "quoteToken": quote["quoteToken"]})
    assert status == 201, booked
    orders = copy.deepcopy(server.load_deliveries())
    edited = copy.deepcopy(initial["config"])
    ogba = next(item for item in edited["locations"] if item["id"] == "ogba")
    ogba.update(label="Ogba / Aguda", zone="extended")
    old_area = next(area for area in edited["areas"] if "ogba" in area["locations"])
    old_area["locations"].remove("ogba")
    edited["areas"].remove(old_area)
    next(area for area in edited["areas"] if area["id"] == "ikeja")["locations"].append("ogba")
    edited = server.validate_batch_routing(edited)
    assert vendor.request('/api/admin/batch-routing', {"config": edited, "version": initial["version"]})[0] == 403
    status, saved = owner.request('/api/admin/batch-routing', {"config": edited, "version": initial["version"]})
    assert status == 200, saved
    assert server.load_batch_routing() == saved["config"] == edited
    updated = {item["id"]: item for item in guest.request('/api/locations')[1]["locations"]}
    assert updated["ogba"] == ogba and len(updated) == len(catalog)
    assert guest.request('/api/calculate', {"pickup": "ogba", "dropoff": "egbeda"})[1]["units"] == 7
    assert server.load_deliveries() == orders, "Admin edits must preserve booked orders"
    print("PASS: all 30 public locations and both route directions; express/batch booking; permission checks; saved name, zone and area edits; unchanged order snapshots.", flush=True)


if __name__ == '__main__':
    server.DATABASE = None
    with tempfile.TemporaryDirectory(prefix='apexwings-lagos-check-') as directory:
        fixtures(directory)
        migration_checks()
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            api_checks(httpd.server_port)
        finally:
            httpd.shutdown()
            httpd.server_close()
