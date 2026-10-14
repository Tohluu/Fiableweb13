"""Batch pricing and booking checks using isolated temporary storage.

Use --serve to leave a seeded browser fixture running on port 8093.
"""
from concurrent.futures import ThreadPoolExecutor
import copy
from pathlib import Path
import random
import sys
import tempfile
import threading
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from rider_portal_checks import Client

PASSWORD = "Batch-check-password"


def requests(destinations, pickup="egbeda", window="Next Day Delivery"):
    return [{
        "pickup": pickup, "dropoff": destination, "deliveryWindow": window,
        "pickupContactName": "Test Vendor", "pickupPhone": "08000000000",
        "pickupAddress": "10 Test Street", "recipientName": f"Recipient {index}",
        "recipientPhone": "08000000001", "deliveryAddress": f"{index + 20} Test Road",
        "packageDescription": "2 cartons of clothing, 5 kg",
    } for index, destination in enumerate(destinations)]


def fixtures(directory):
    root = Path(directory)
    for attribute, value in list(vars(server).items()):
        if attribute.endswith("_FILE") and isinstance(value, Path):
            setattr(server, attribute, root / value.name)
    server.DATA_DIR = root
    server.PROOF_DIR = root / "proof"
    server.VENDOR_SESSIONS.clear()
    server.ADMIN_SESSIONS.clear()
    accounts = [{
        "email": email, "name": "Batch Test Vendor", "subscriberId": f"FL-SUB-{index:04d}",
        "salt": "test-salt", "passwordHash": server.password_hash(PASSWORD, "test-salt"),
        "plan": "Basic", "paymentStatus": "pending" if email.startswith("unpaid") else "paid",
        "paidAt": server.now_iso(), "createdAt": server.now_iso(),
        "manualUnitAdjustment": -35 if email.startswith("limited") else 955,
    } for index, email in enumerate(["batch@example.test", "unpaid@example.test", "limited@example.test"], 1)]
    server.atomic_write_json(server.ACCOUNTS_FILE, accounts)
    server.save_deliveries([])
    server.save_admin_credentials([{
        "id": 1, "email": "owner@example.test", "name": "Test Owner", "role": "owner",
        "status": "active", "salt": "test-salt",
        "passwordHash": server.password_hash(PASSWORD, "test-salt"), "mfaEnabled": False,
    }])


def pricing_checks():
    grouped_locations = [location for _, locations in server.DEFAULT_DELIVERY_AREAS.values() for location in locations]
    assert len(grouped_locations) == len(set(grouped_locations))
    assert set(grouped_locations) == set(server.LOCATION_ZONES)
    mixed = server.estimate_batch_deliveries(requests(["chevron"] * 4 + ["ikeja"] * 2), "Basic")
    groups = {group["axis"]: group for group in mixed["groups"]}
    assert groups["lekki"]["discountRate"] == .05
    assert groups["ikeja"]["discountRate"] == 0
    assert mixed["chargedUnits"] == 29 and mixed["unitsSaved"] == 1
    extended = server.estimate_batch_deliveries(requests(["epe", "badagry", "ikorodu", "ibeju-lekki"]), "Basic")
    assert len(extended["groups"]) == 4 and extended["unitsSaved"] == 0
    for count, rate in [(3, .05), (5, .05), (6, .10), (10, .10), (11, .15), (100, .15)]:
        quote = server.estimate_batch_deliveries(requests(["ikorodu"] * count), "Basic")
        assert quote["discountRate"] == rate
        assert quote["chargedUnits"] == (count * 7 * (100 - round(rate * 100)) + 99) // 100
    short = server.estimate_batch_deliveries(requests(["ikeja"] * 11, pickup="ikeja"), "Basic")
    assert short["chargedUnits"] == 11 and short["unitsSaved"] == 0
    express = server.estimate_batch_deliveries(requests(["chevron"] * 3, window="Express"), "Basic")
    assert express["prioritySurcharge"] == 6000
    assert all(item["cost"] == item["units"] * 1500 + 2000 for item in express["deliveries"])
    invalid = [[], requests(["yaba"] * 2), requests(["yaba"] * 101), [None] * 3,
               requests(["unknown"] * 3), requests(["yaba"] * 3, window="Invalid")]
    for field in ["pickup", "pickupAddress", "pickupPhone", "deliveryWindow"]:
        different = requests(["chevron"] * 3)
        different[-1][field] = "other"
        invalid.append(different)
    for payload in invalid:
        try:
            server.estimate_batch_deliveries(payload, "Basic")
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid payload accepted: {payload}")
    rng = random.Random(42)
    locations = list(server.LOCATION_ZONES)
    for _ in range(200):
        payload = requests(rng.choices(locations, k=rng.randint(3, 100)), pickup=rng.choice(locations))
        quote = server.estimate_batch_deliveries(payload, "Basic")
        assert quote["chargedUnits"] == sum(item["units"] for item in quote["deliveries"])
        assert quote["originalUnits"] - quote["chargedUnits"] == quote["unitsSaved"]
        assert quote["vendorSaving"] == quote["unitsSaved"] * 1500
        assert [item["dropoff"] for item in quote["deliveries"]] == [item["dropoff"] for item in payload]
        for item in quote["deliveries"]:
            assert 1 <= item["units"] <= item["originalUnits"]
            assert item["cost"] == item["originalCost"] - item["vendorDiscountAmount"]
            assert item["riderPayout"] == round(item["originalCost"] * server.RIDER_PAYOUT_RATE)
    print("PASS: all locations grouped once, independent tiers, extended areas, whole-unit allocation, express pricing, 200 mixed-route cases.", flush=True)


def login(port, email="batch@example.test", admin=False):
    client = Client(port)
    status, result = client.request("/api/admin/login" if admin else "/api/login", {"email": email, "password": PASSWORD})
    assert status == 200, result
    return client


def api_checks(port):
    payload = {"deliveries": requests(["chevron"] * 4 + ["ikeja"] * 2)}
    assert Client(port).request("/api/batch-delivery-quote", payload)[0] == 401
    vendor = login(port)
    status, quote = vendor.request("/api/batch-delivery-quote", payload)
    payload["quoteToken"] = quote["quoteToken"]
    assert status == 200, quote
    before = server.load_deliveries()
    invalid = copy.deepcopy(payload)
    invalid["deliveries"][-1]["recipientName"] = " "
    invalid["quoteToken"] = vendor.request("/api/batch-delivery-quote", invalid)[1]["quoteToken"]
    assert vendor.request("/api/batch-delivery-request", invalid)[0] == 400
    assert server.load_deliveries() == before, "Invalid final row must not save earlier rows"
    assert login(port, "unpaid@example.test").request("/api/batch-delivery-request", payload)[0] == 402
    with patch.object(server, "save_deliveries", wraps=server.save_deliveries) as save:
        status, result = vendor.request("/api/batch-delivery-request", payload)
        assert status == 201, result
        assert save.call_count == 1, "Batch must be committed in a single write"
    orders = result["deliveries"]
    assert len(orders) == 6 and len({order["trackingCode"] for order in orders}) == 6
    assert len({order["batchId"] for order in orders}) == 1
    assert len({order["batchGroupId"] for order in orders}) == 2
    assert sum(order["units"] for order in orders) == quote["chargedUnits"]
    assert result["summary"]["unitsRemaining"] == 1000 - quote["chargedUnits"]
    assert all(order["window"] == "Next Day: 8:00 AM - 11:00 AM" and order["recipient"] for order in orders)
    assert all(order["packageDescription"] for order in orders)
    admin = login(port, "owner@example.test", admin=True)
    status, filtered = admin.request("/api/admin/orders?search=" + orders[0]["batchGroupId"])
    assert status == 200 and len(filtered["orders"]) == 4, filtered
    assert all(order["batchAxis"] == "lekki" for order in filtered["orders"])
    limited = login(port, "limited@example.test")
    assert limited.request("/api/batch-delivery-request", payload)[0] == 409
    small = {"deliveries": requests(["yaba"] * 3)}  # six units against a ten-unit balance
    small["quoteToken"] = limited.request("/api/batch-delivery-quote", small)[1]["quoteToken"]
    def book(_):
        return login(port, "limited@example.test").request("/api/batch-delivery-request", small)[0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(book, range(2))) == [201, 409]
    assert limited.request("/api/account/summary")[1]["unitsRemaining"] == 4
    # The optional in-memory creation path must not change ordinary bookings.
    count = len(server.load_deliveries())
    server.create_delivery("batch@example.test", "yaba", "ikeja", 2)
    assert len(server.load_deliveries()) == count + 1
    print("PASS: authentication, unpaid and insufficient balances, atomic booking, concurrent balance checks, tracking, group search and single-delivery persistence.", flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-batch-check-") as directory:
        fixtures(directory)
        pricing_checks()
        serve = "--serve" in sys.argv
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 8093 if serve else 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            api_checks(httpd.server_port)
            if serve:
                fixtures(directory)
                print("Isolated batch browser fixture: http://127.0.0.1:8093/portal.html", flush=True)
                threading.Event().wait()
        finally:
            httpd.shutdown()
            httpd.server_close()
