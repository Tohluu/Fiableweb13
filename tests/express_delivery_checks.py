"""Express booking and dispatch checks. All records use temporary storage."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import sys
import tempfile
import threading
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures as account_fixtures, PASSWORD
from rider_portal_checks import Client, PNG


def fixtures(directory):
    account_fixtures(directory)
    server.save_riders([{
        "id": 1, "riderRef": "FL-RIDER-0001", "name": "Express Test Rider",
        "email": "express-rider@example.test", "phone": "08000000002",
        "vehicle": "Motorcycle", "status": "available", "salt": "test-salt",
        "passwordHash": server.password_hash(PASSWORD, "test-salt"),
    }])
    server.RIDER_SESSIONS.clear()
    admins = server.load_admin_credentials()
    admins.append({**admins[0], "id": 2, "email": "analyst@example.test", "role": "analyst"})
    admins.append({**admins[0], "id": 3, "email": "finance@example.test", "role": "finance"})
    server.save_admin_credentials(admins)


def booking(**changes):
    return {
        "pickup": "yaba", "dropoff": "ikeja", "pickupContactName": "Express Customer",
        "pickupPhone": "08000000000", "pickupAddress": "10 Test Street, Yaba",
        "recipientName": "Test Recipient", "recipientPhone": "+2348000000001",
        "deliveryAddress": "20 Test Road, Ikeja", "packageDescription": "Clothing, 2 kg",
        "quotedCost": server.estimate_express_delivery("yaba", "ikeja")["cost"],
        "requestId": str(uuid.uuid4()), **changes,
    }


def checks(port):
    guest = Client(port)
    before = json.dumps(server.load_accounts(), sort_keys=True)
    status, quote = guest.request("/api/express/quote", {"pickup": "yaba", "dropoff": "ikeja", "email": "batch@example.test"})
    assert status == 200 and quote["cost"] == quote["units"] * 2000
    assert quote["prioritySurcharge"] == 0 and quote["unitPrice"] == 2000
    assert guest.request("/api/express/quote", {"pickup": "unknown", "dropoff": "ikeja"})[0] == 400
    for change in [{"pickupContactName": "   "}, {"recipientName": ""}, {"recipientPhone": "abc"},
                   {"pickupAddress": "x" * 301}, {"pickupPhone": {}}, {"requestId": "short"}]:
        assert guest.request("/api/express/book", booking(**change))[0] == 400, change
    assert guest.request("/api/express/book", booking(quotedCost=1))[0] == 409
    assert not server.load_deliveries()
    payload = booking()
    status, booked = guest.request("/api/express/book", payload)
    assert status == 201 and booked["status"] == "requested", booked
    assert set(booked) == {"orderRef", "trackingCode", "status", "estimatedCost", "units"}
    assert guest.request("/api/express/book", payload) == (200, booked)
    assert guest.request("/api/express/book", {**payload, "recipientName": "Changed"})[0] == 409
    assert len(server.load_deliveries()) == 1
    order = server.load_deliveries()[0]
    assert order["priority"] == order["window"] == "Express"
    assert order["bookingType"] == "express" and order["bookingSource"] == "website"
    assert order["paymentStatus"] == "pending" and order["accountEmail"] == ""
    assert order["timeline"][0]["actorType"] == "customer"
    assert order["details"]["recipientPhone"] == payload["recipientPhone"]
    assert json.dumps(server.load_accounts(), sort_keys=True) == before
    tracked = guest.request("/api/track?code=" + booked["trackingCode"])[1]
    assert tracked["orderRef"] == booked["orderRef"] and "details" not in tracked

    def check_tracking(expected):
        status, public = guest.request("/api/track?code=" + booked["trackingCode"])
        assert status == 200 and public["status"] == expected, public
        assert public["timeline"][-1]["status"] == expected
        assert all(set(event) == {"status", "at"} for event in public["timeline"])
        assert "deliveryOtp" not in public and "details" not in public and "riderPhone" not in public
        return public

    check_tracking("Order Received")

    duplicate = booking()
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: Client(port).request("/api/express/book", duplicate), range(4)))
    assert sorted(status for status, _ in responses) == [200, 200, 200, 201]
    assert len({result["trackingCode"] for _, result in responses}) == 1
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: Client(port).request("/api/express/book", booking()), range(4)))
    assert all(status == 201 for status, _ in responses)
    assert len(server.load_deliveries()) == 6
    assert len({order["id"] for order in server.load_deliveries()}) == 6

    assert guest.request("/api/admin/orders?bookingType=express")[0] == 403
    assignment = {"orderId": order["id"], "riderId": 1}
    assert guest.request("/api/admin/orders/assign-rider", assignment)[0] == 403
    analyst = Client(port)
    assert analyst.request("/api/admin/login", {"email": "analyst@example.test", "password": PASSWORD})[0] == 200
    assert analyst.request("/api/admin/orders/assign-rider", assignment)[0] == 403
    admin = Client(port)
    assert admin.request("/api/admin/login", {"email": "owner@example.test", "password": PASSWORD})[0] == 200
    payment = {"orderId": order["id"], "amount": order["cost"], "method": "bank_transfer", "reference": "TEST-TRANSFER-001"}
    assert guest.request("/api/admin/orders/express-payment", payment)[0] == 403
    assert analyst.request("/api/admin/orders/express-payment", payment)[0] == 403
    for changes in [{"amount": 0}, {"amount": True}, {"method": "unknown"}, {"reference": "x" * 161}]:
        assert admin.request("/api/admin/orders/express-payment", {**payment, **changes})[0] == 400
    assert admin.request("/api/admin/orders/express-payment", {**payment, "amount": 1})[0] == 409
    assert admin.request("/api/admin/orders/express-payment", {**payment, "orderId": 999999})[0] == 404
    finance = Client(port)
    assert finance.request("/api/admin/login", {"email": "finance@example.test", "password": PASSWORD})[0] == 200
    assert finance.request("/api/admin/orders?bookingType=express")[0] == 200
    status, paid = finance.request("/api/admin/orders/express-payment", payment)
    assert status == 200 and paid["order"]["paymentStatus"] == "paid", paid
    assert paid["order"]["paymentMethod"] == "bank_transfer" and paid["order"]["amountPaid"] == order["cost"]
    assert paid["order"]["paymentReference"] == "TEST-TRANSFER-001" and paid["order"]["paymentRecordedBy"] == "finance@example.test"
    assert paid["order"]["pricingStatus"] == "confirmed" and paid["order"]["status"] == "requested"
    assert admin.request("/api/admin/orders/express-payment", payment)[1]["order"]["paidAt"] == paid["order"]["paidAt"]
    audits = server.load_json_list(server.AUDIT_LOG_FILE)
    assert len([entry for entry in audits if entry.get("action") == "express_payment_received"]) == 1
    assert json.dumps(server.load_accounts(), sort_keys=True) == before
    assert not server.load_rider_payments()
    orders = admin.request("/api/admin/orders?bookingType=express&search=08000000000")[1]["orders"]
    assert len(orders) == 6 and all(o["vendorName"] == "Express Customer" for o in orders)
    assert not admin.request("/api/admin/orders?bookingType=subscription")[1]["orders"]
    # An offline rider remains unavailable under the existing dispatch rules.
    assert admin.request("/api/admin/orders/assign-rider", assignment)[0] == 400
    rider = Client(port)
    assert rider.request("/api/rider/login", {"email": "express-rider@example.test", "password": PASSWORD})[0] == 200
    status, assigned = admin.request("/api/admin/orders/assign-rider", assignment)
    assert status == 200 and assigned["order"]["status"] == "assigned", assigned
    check_tracking("Rider Assigned")
    assert admin.request("/api/admin/orders/assign-rider", assignment)[0] == 400
    rider_orders = rider.request("/api/rider/delivery")[1]["deliveries"]
    assert len(rider_orders) == 1 and rider_orders[0]["details"]["pickupAddress"] == payload["pickupAddress"]
    assert "deliveryOtp" not in rider_orders[0]
    assert rider.request("/api/rider/notifications")[1]["notifications"]
    assert rider.request("/api/rider/delivery/accept", {"orderId": order["id"]})[0] == 200
    check_tracking("Rider Accepted")
    for status, label in [("arriving_at_pickup", "Arriving at Pickup"), ("picked_up", "Picked Up"), ("on_delivery", "In Transit")]:
        assert rider.request("/api/rider/delivery/status", {"orderId": order["id"], "status": status})[0] == 200
        public = check_tracking(label)
        if status == "arriving_at_pickup":
            assert [event["status"] for event in public["timeline"]] == ["Order Received", "Rider Assigned", "Rider Accepted", "Arriving at Pickup"]
    assert rider.request("/api/rider/delivery/complete", {"orderId": order["id"], "recipientName": "Test Recipient", "photo": PNG})[0] == 200
    check_tracking("Delivered")
    print("PASS: guest express bookings, validation/pricing, retry deduplication, concurrency, account isolation, finance access, payment receipt persistence/audit/idempotence, admin filtering, rider assignment, proof and tracking.", flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-express-check-") as directory:
        fixtures(directory)
        serve = "--serve" in sys.argv
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 8095 if serve else 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            checks(httpd.server_port)
            if serve:
                fixtures(directory)
                print("Isolated express browser fixture: http://127.0.0.1:8095/get-started.html#quick-express", flush=True)
                threading.Event().wait()
        finally:
            httpd.shutdown()
            httpd.server_close()
