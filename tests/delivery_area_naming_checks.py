"""Location-named delivery areas and one-time rollout in temporary storage."""
import copy
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, requests


def assert_names(config):
    by_location = {key: area for area in config["areas"] for key in area["locations"]}
    assert len(by_location) == len(config["locations"])
    for location in config["locations"]:
        expected = "Ikeja" if location["id"] in server.IKEJA_AREA_LOCATIONS else location["label"]
        assert by_location[location["id"]]["label"] == expected, location
    shared = [area for area in config["areas"] if len(area["locations"]) > 1]
    assert len(shared) == 1 and set(shared[0]["locations"]) == server.IKEJA_AREA_LOCATIONS


def checks():
    fresh = server.validate_batch_routing(server.default_batch_routing())
    assert_names(fresh)
    # Reconstruct the old broad areas and separate catalog additions.
    legacy = server.expand_lagos_location_catalog({
        "locations": server.default_delivery_locations(),
        "pricingZones": fresh["pricingZones"], "zoneUnits": fresh["zoneUnits"],
        "areas": [{"id": key, "label": label, "locations": sorted(members)}
                  for key, (label, members) in server.DEFAULT_DELIVERY_AREAS.items()],
        "pickupRules": {},
    })
    legacy["locations"].append({"id": "custom-town", "label": "Custom Town", "zone": "extended"})
    legacy["areas"][0]["locations"].append("custom-town")
    # Explicit combinations survive; old single-area groups are split.
    groups = server.batch_routing_groups(legacy, "alimosho")
    groups = [group for group in groups if group["id"] not in {"lekki-phase-1", "lekki"}]
    groups.insert(0, {"id": "island-run", "label": "Island run", "areas": ["lekki-phase-1", "lekki"]})
    legacy["pickupRules"]["alimosho"] = groups
    legacy["pickupRules"]["ikeja"] = server.batch_routing_groups(legacy, "ikeja")
    legacy["locations"][0]["zone"] = "extended"
    legacy["zoneUnits"][0]["units"] = 6
    legacy = server.validate_batch_routing(legacy)
    before = copy.deepcopy(legacy)
    server.atomic_write_json(server.BATCH_ROUTING_FILE, legacy)
    stored = server.BATCH_ROUTING_FILE.read_bytes()
    orders_before = server.DELIVERIES_FILE.read_bytes()
    migrated = server.load_batch_routing()
    assert legacy == before
    assert server.BATCH_ROUTING_FILE.read_bytes() == stored
    assert_names(migrated)
    assert migrated["locations"] == legacy["locations"]
    assert migrated["pricingZones"] == legacy["pricingZones"]
    assert migrated["zoneUnits"] == legacy["zoneUnits"]
    assert server.name_delivery_areas_after_locations(migrated) == migrated
    # Every configured pickup still partitions all destinations exactly once.
    assert server.validate_batch_routing(migrated) == migrated
    island = migrated["pickupRules"]["alimosho"][0]
    island_members = {location for area in migrated["areas"] if area["id"] in island["areas"]
                      for location in area["locations"]}
    assert island_members == set(legacy["areas"][0]["locations"] + legacy["areas"][1]["locations"])
    ikeja = next(area for area in migrated["areas"] if area["label"] == "Ikeja")
    assert ikeja["id"] == "ikeja" and "ikeja" in migrated["pickupRules"]
    quote = server.estimate_batch_deliveries(requests(["opebi", "oregun", "maryland"]), "Basic", routing=migrated)
    assert len(quote["groups"]) == 1 and quote["groups"][0]["label"] == "Ikeja"
    separate = server.estimate_batch_deliveries(requests(["ajah", "vgc", "abraham-adesanya"], pickup="ikeja"), "Basic", routing=migrated)
    assert len(separate["groups"]) == 3
    server.atomic_write_json(server.BATCH_ROUTING_FILE, migrated)
    assert server.load_batch_routing() == migrated
    # A later explicit admin edit is retained; the rollout does not repeat.
    migrated["areas"][0]["label"] = "Later admin label"
    server.atomic_write_json(server.BATCH_ROUTING_FILE, migrated)
    assert server.load_batch_routing() == migrated
    assert server.DELIVERIES_FILE.read_bytes() == orders_before
    for invalid in [True, -1, 2, "1"]:
        broken = {**fresh, "areaNamingVersion": invalid}
        try:
            server.validate_batch_routing(broken)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid naming version accepted")
    print("PASS: all location names, only Ikeja shared, custom locations, one-time rollout, existing prices, explicit groups, saved edits and order preservation.")


if __name__ == "__main__":
    server.DATABASE = None
    with tempfile.TemporaryDirectory(prefix="apexwings-area-names-") as directory:
        fixtures(directory)
        checks()
