"""Editable pricing zones, legacy migration and booking prices in isolated storage."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, login, requests
from express_delivery_checks import booking
from rider_portal_checks import Client


def set_units(config, origin, destination, units):
    route = next(route for route in config["zoneUnits"]
                 if {route["from"], route["to"]} == {origin, destination})
    route["units"] = units


def validation_checks():
    config = server.default_batch_routing()
    assert server.validate_batch_routing(config) == config
    assert len(config["pricingZones"]) == 10 and len(config["zoneUnits"]) == 55
    zones = {location["id"]: location["zone"] for location in config["locations"]}
    assert zones["chevron"] == zones["ikate-elegushi"] == "lekki-corridor-1"
    assert zones["ajah"] == zones["vgc"] == zones["sangotedo"] == "lekki-corridor-2"
    assert zones["lekki-phase-1"] == "island-central"
    assert zones["egbeda"] == "mainland-north"
    assert zones["ayobo"] == zones["ipaja"] == zones["abule-egba"] == "mainland-north-west"
    assert zones["agege"] == zones["ifako-ijaiye"] == "mainland-north-east"
    legacy = copy.deepcopy(config)
    del legacy["pricingZones"], legacy["zoneUnits"]
    for location in legacy["locations"]:
        if location["zone"].startswith("lekki-corridor-"):
            location["zone"] = "lekki"
        if location["id"] in server.MAINLAND_ZONE_MOVES:
            location["zone"] = server.MAINLAND_ZONE_MOVES[location["id"]][0]
    server.atomic_write_json(server.BATCH_ROUTING_FILE, legacy)
    before = server.BATCH_ROUTING_FILE.read_bytes()
    assert server.load_batch_routing() == config
    assert server.BATCH_ROUTING_FILE.read_bytes() == before, "Migration on read must not write settings"
    for origin in server.LOCATION_ZONES:
        for destination in server.LOCATION_ZONES:
            original_zones = [server.MAINLAND_ZONE_MOVES[location][0] if location in server.MAINLAND_ZONE_MOVES else zones[location]
                              for location in (origin, destination)]
            pair = frozenset("lekki" if zone.startswith("lekki-corridor-") else zone for zone in original_zones)
            expected = server.ZONE_UNIT_MATRIX.get(pair, 7 if "extended" in pair else 3)
            actual = server.estimate_delivery(origin, destination, "Basic", routing=config)["units"]
            assert actual >= expected, (origin, destination, expected, actual)
            if origin not in server.MAINLAND_ZONE_MOVES and destination not in server.MAINLAND_ZONE_MOVES:
                assert actual == expected
    for origin, destination in [('egbeda', 'ipaja'), ('ipaja', 'egbeda'), ('egbeda', 'ifako-ijaiye'),
                                ('ayobo', 'abule-egba'), ('agege', 'ifako-ijaiye'), ('ipaja', 'ipaja')]:
        assert server.estimate_delivery(origin, destination, "Basic", routing=config)["units"] == 3
    previous = copy.deepcopy(config)
    previous["pricingZones"] = {key: label for key, label in previous["pricingZones"].items() if key not in server.NEW_MAINLAND_ZONES}
    previous["zoneUnits"] = [route for route in previous["zoneUnits"]
                             if route["from"] not in server.NEW_MAINLAND_ZONES and route["to"] not in server.NEW_MAINLAND_ZONES]
    for location in previous["locations"]:
        if location["id"] in server.MAINLAND_ZONE_MOVES:
            location["zone"] = server.MAINLAND_ZONE_MOVES[location["id"]][0]
    previous["pricingZones"]["mainland-north"] = 'Custom northern zone'
    set_units(previous, "mainland-west", "mainland-central", 5)
    next(location for location in previous["locations"] if location["id"] == "agege")["zone"] = "mainland-east"
    old_snapshot = copy.deepcopy(previous)
    upgraded = server.validate_batch_routing(previous)
    assert previous == old_snapshot, "Migration must not mutate caller input"
    assert upgraded["pricingZones"]["mainland-north"] == 'Custom northern zone'
    assert next(location for location in upgraded["locations"] if location["id"] == "agege")["zone"] == "mainland-east"
    assert server.estimate_delivery('ipaja', 'yaba', 'Basic', routing=upgraded)["units"] == 5
    assert all(route in upgraded["zoneUnits"] for route in previous["zoneUnits"])
    modern = copy.deepcopy(config)
    next(location for location in modern["locations"] if location["id"] == "ipaja")["zone"] = "mainland-north"
    set_units(modern, "mainland-north-west", "mainland-north-west", 1)
    assert server.validate_batch_routing(modern) == modern, "Modern settings must preserve intentional assignments and unit edits"
    invalid = []
    for units in [0, 8, 1.5, True, "3", None]:
        bad = copy.deepcopy(config); bad["zoneUnits"][0]["units"] = units; invalid.append(bad)
    missing = copy.deepcopy(config); missing["zoneUnits"].pop(); invalid.append(missing)
    duplicate = copy.deepcopy(config); duplicate["zoneUnits"][-1] = duplicate["zoneUnits"][0]; invalid.append(duplicate)
    unknown = copy.deepcopy(config); unknown["zoneUnits"][0]["from"] = "unknown"; invalid.append(unknown)
    malformed = copy.deepcopy(config); malformed["zoneUnits"][0]["from"] = []; invalid.append(malformed)
    blank = copy.deepcopy(config); blank["pricingZones"]["extended"] = " "; invalid.append(blank)
    repeated = copy.deepcopy(config); repeated["pricingZones"]["extended"] = repeated["pricingZones"]["mainland-west"].upper(); invalid.append(repeated)
    missing_zone = copy.deepcopy(config); del missing_zone["pricingZones"]["extended"]; invalid.append(missing_zone)
    broken_legacy = copy.deepcopy(previous); broken_legacy["zoneUnits"].pop(); invalid.append(broken_legacy)
    for bad in invalid:
        try:
            server.validate_batch_routing(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid pricing accepted")
    print("PASS: mainland northern zones, both Lekki corridors, legacy migrations, preserved custom rates and assignments, no automatic price reductions, corrected one-unit routes and invalid pricing rejection.", flush=True)


def api_checks(port):
    owner = login(port, "owner@example.test", admin=True)
    vendor = login(port)
    guest = Client(port)
    _, initial = owner.request('/api/admin/batch-routing')
    assert initial["pricingZones"] == initial["config"]["pricingZones"]
    for origin, destination in [('egbeda', 'ipaja'), ('egbeda', 'ifako-ijaiye'), ('ayobo', 'abule-egba')]:
        status, quote = guest.request('/api/calculate', {"pickup": origin, "dropoff": destination})
        assert status == 200 and quote["units"] == 3 and quote["cost"] == 6000
    deliveries = requests(["chevron"] * 3)
    _, old_quote = vendor.request('/api/batch-delivery-quote', {"deliveries": deliveries})
    status, old_order = vendor.request('/api/delivery-request', deliveries[0])
    assert status == 201
    before_orders = copy.deepcopy(server.load_deliveries())
    before_accounts = copy.deepcopy(server.load_accounts())
    config = copy.deepcopy(initial["config"])
    config["pricingZones"]["lekki-corridor-1"] = 'Lekki Corridor 1 - revised'
    set_units(config, "mainland-north", "lekki-corridor-1", 4)
    set_units(config, "mainland-north", "lekki-corridor-2", 7)
    set_units(config, "lekki-corridor-1", "lekki-corridor-1", 2)
    next(location for location in config["locations"] if location["id"] == "vgc")["zone"] = "lekki-corridor-1"
    assert vendor.request('/api/admin/batch-routing', {"config": config, "version": initial["version"]})[0] == 403
    assert guest.request('/api/admin/batch-routing', {"config": config, "version": initial["version"]})[0] == 403
    status, preview = owner.request('/api/admin/batch-routing/preview', {"config": config, "deliveries": deliveries})
    assert status == 200 and preview["originalUnits"] == 12
    assert server.load_accounts() == before_accounts and server.load_deliveries() == before_orders
    assert server.estimate_delivery('egbeda', 'chevron', 'Basic')["units"] == 6
    status, saved = owner.request('/api/admin/batch-routing', {"config": config, "version": initial["version"]})
    assert status == 200 and saved["version"] != initial["version"]
    assert server.load_batch_routing() == saved["config"] == json.loads(server.BATCH_ROUTING_FILE.read_text())
    assert owner.request('/api/admin/batch-routing', {"config": config, "version": initial["version"]})[0] == 409
    for origin, destination, units in [('egbeda', 'chevron', 4), ('chevron', 'egbeda', 4),
                                       ('egbeda', 'ajah', 7), ('egbeda', 'vgc', 4), ('chevron', 'chevron', 2)]:
        status, quote = guest.request('/api/calculate', {"pickup": origin, "dropoff": destination})
        assert status == 200 and quote["units"] == units and quote["cost"] == units * 2000
    status, subscriber_quote = vendor.request('/api/calculate', {
        "pickup": "egbeda", "dropoff": "chevron", "email": "batch@example.test",
    })
    assert status == 200 and subscriber_quote["units"] == 4 and subscriber_quote["cost"] == 6000
    status, express_quote = guest.request('/api/express/quote', {"pickup": "egbeda", "dropoff": "chevron"})
    assert status == 200 and express_quote["units"] == 4 and express_quote["cost"] == 8000
    assert server.load_deliveries() == before_orders, "Saved bookings must retain prices"
    assert next(location for location in guest.request('/api/locations')[1]["locations"] if location["id"] == "vgc")["zone"] == "lekki-corridor-1"
    status, stale = vendor.request('/api/batch-delivery-request', {"deliveries": deliveries, "quoteToken": old_quote["quoteToken"]})
    assert status == 409 and stale["quoteChanged"]
    _, quote = vendor.request('/api/batch-delivery-quote', {"deliveries": deliveries})
    status, booked = vendor.request('/api/batch-delivery-request', {"deliveries": deliveries, "quoteToken": quote["quoteToken"]})
    assert status == 201 and all(order["pricing"]["originalUnits"] == 4 for order in booked["deliveries"])
    status, single = vendor.request('/api/delivery-request', deliveries[0])
    assert status == 201 and single["delivery"]["units"] == 4
    status, express = guest.request('/api/express/book', booking(pickup='egbeda', dropoff='chevron', quotedCost=8000))
    assert status == 201 and express["estimatedCost"] == 8000 and express["units"] == 4
    bad = copy.deepcopy(config); bad["zoneUnits"][0]["units"] = 0
    assert owner.request('/api/admin/batch-routing', {"config": bad, "version": saved["version"]})[0] == 400
    assert server.load_batch_routing() == config
    print("PASS: draft preview, permissions, save/reload, concurrency, public and subscriber prices, symmetric rates, location reassignment, same-zone pricing, stale quotes and booking snapshots.", flush=True)


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='apexwings-zone-check-') as directory:
        fixtures(directory)
        validation_checks()
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            api_checks(httpd.server_port)
        finally:
            httpd.shutdown(); httpd.server_close()
