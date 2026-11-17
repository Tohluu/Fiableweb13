"""Verify vendor and website booking tracking with temporary records only."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, PASSWORD
from rider_portal_checks import Client


def checks(port):
    owner, other, guest = Client(port), Client(port), Client(port)
    for client, email in [(owner, "batch@example.test"), (other, "limited@example.test")]:
        assert client.request("/api/login", {"email": email, "password": PASSWORD})[0] == 200
    order = {
        "id": 1, "orderRef": "CONTACT-1", "trackingCode": "ABC1234567",
        "accountEmail": "batch@example.test", "status": "assigned", "riderId": 1,
        "riderName": "Previous name", "riderPhone": "08000000000", "deliveryOtp": "654321",
        "details": {"recipientPhone": "08000000009"},
        "timeline": [{"status": "assigned", "at": server.now_iso(), "note": "Internal note"}],
    }
    server.save_deliveries([order])
    server.save_riders([
        {"id": 1, "name": "Current Rider", "phone": "+234 800 000 0001", "passwordHash": "private"},
        {"id": 2, "name": "Replacement Rider", "phone": "08000000002"},
    ])
    path = "/api/track?code=abc1234567"
    public_fields = {"trackingCode", "orderRef", "status", "createdAt", "updatedAt", "timeline"}
    for client in [guest, other]:
        status, result = client.request(path)
        assert status == 200 and set(result) == public_fields, result
    status, result = owner.request(path)
    assert status == 200 and set(result) == public_fields | {"riderContact"}
    assert result["riderContact"] == {"name": "Current Rider", "phone": "+234 800 000 0001"}
    assert all(set(event) == {"status", "at"} for event in result["timeline"])
    with owner.opener.open(owner.base + path) as response:
        assert response.headers["Cache-Control"] == "private, no-store"
        assert response.headers["Vary"] == "Cookie"

    order["riderId"] = 2
    server.save_deliveries([order])
    assert owner.request(path)[1]["riderContact"] == {"name": "Replacement Rider", "phone": "08000000002"}
    order["riderId"] = None  # A declined assignment must not expose stale contact fields.
    server.save_deliveries([order])
    assert owner.request(path)[1]["riderContact"] is None
    order["riderId"] = 3  # Historical assignment with a removed rider profile.
    server.save_deliveries([order])
    assert owner.request(path)[1]["riderContact"] == {"name": "Previous name", "phone": "08000000000"}
    order["riderPhone"] = ""
    server.save_deliveries([order])
    assert owner.request(path)[1]["riderContact"]["phone"] == ""
    order["accountEmail"] = ""  # A query parameter cannot claim ownership.
    server.save_deliveries([order])
    assert "riderContact" not in owner.request(path + "&email=batch@example.test")[1]
    order["accountEmail"] = "batch@example.test"
    server.save_deliveries([order])
    for session in server.VENDOR_SESSIONS.values():
        session["expiresAt"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert "riderContact" not in owner.request(path)[1]

    # Website customers use the tracking code from their confirmation without a login.
    order.update({"accountEmail": "", "bookingType": "express", "bookingSource": "website", "riderId": 1})
    server.save_deliveries([order])
    for client in [guest, other, owner]:
        status, result = client.request(path)
        assert status == 200 and set(result) == public_fields | {"riderContact"}, result
        assert result["riderContact"] == {"name": "Current Rider", "phone": "+234 800 000 0001"}
        assert all(set(event) == {"status", "at"} for event in result["timeline"])
    order["riderId"] = 2
    server.save_deliveries([order])
    assert guest.request(path)[1]["riderContact"] == {"name": "Replacement Rider", "phone": "08000000002"}
    order["riderId"] = None
    server.save_deliveries([order])
    assert guest.request(path)[1]["riderContact"] is None
    for booking_type, booking_source in [("express", "admin"), ("subscription", "website")]:
        order.update({"bookingType": booking_type, "bookingSource": booking_source, "riderId": 1})
        server.save_deliveries([order])
        assert "riderContact" not in guest.request(path)[1]
    assert guest.request("/api/track?code=")[0] == 400
    assert guest.request("/api/track?code=UNKNOWN")[0] == 404
    print("PASS: vendor isolation, website guest contact access, reassignment, pending assignment, missing phone, expired sessions and private caching.")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-tracking-check-") as directory:
        fixtures(directory)
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            checks(httpd.server_port)
        finally:
            httpd.shutdown()
            httpd.server_close()
