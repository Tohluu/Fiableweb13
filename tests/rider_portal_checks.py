"""Rider regression checks with temporary storage; never changes saved site data."""
import base64
import http.cookiejar
import json
from pathlib import Path
import sys
import tempfile
import threading
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

TEST_PASSWORD = "Rider-check-password"
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="


def fixtures(directory):
    root = Path(directory)
    for attribute in ["RIDERS_FILE", "DELIVERIES_FILE", "RIDER_NOTIFICATIONS_FILE", "ACCOUNTS_FILE", "AUDIT_LOG_FILE", "RESET_TOKENS_FILE", "DATA_FILE", "SUBSCRIPTIONS_FILE", "NOTIFICATION_LOG_FILE"]:
        setattr(server, attribute, root / getattr(server, attribute).name)
    server.PROOF_DIR = root / "proof"
    riders = [{"id": i, "riderRef": f"FL-RIDER-{i:04d}", "name": f"Check Rider {i}", "email": f"rider{i}@example.test", "phone": "08000000000", "vehicle": "Motorcycle", "status": "available", "salt": "test-salt", "passwordHash": server.password_hash(TEST_PASSWORD, "test-salt"), "mustChangePassword": i == 3} for i in [1, 2, 3]]
    server.save_riders(riders)
    orders = [{"id": i, "orderRef": f"CHECK-{i}", "riderId": rider, "status": status, "pickup": "Yaba", "dropoff": "Ikeja", "units": 2, "createdAt": server.now_iso(), "updatedAt": server.now_iso(), "deliveryOtp": "654321", "details": {"recipientName": '<img src=x onerror="window.injected=true">', "pickupAddress": "10 Example Street", "deliveryAddress": "20 Example Street"}} for i, rider, status in [(1, 1, "assigned"), (2, 2, "assigned"), (3, 1, "returned"), (4, 1, "assigned")]]
    server.save_deliveries(orders)
    server.save_rider_notifications([{"id": str(i), "riderId": i, "title": f"Update for rider {i}", "message": "Delivery assigned", "createdAt": server.now_iso()} for i in [1, 2]])
    server.atomic_write_json(server.ACCOUNTS_FILE, [])
    server.atomic_write_json(server.RESET_TOKENS_FILE, {})
    server.RIDER_SESSIONS.clear()
    return root


class Client:
    def __init__(self, port):
        self.base = f"http://127.0.0.1:{port}"
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, path, payload=None):
        headers = {"Content-Type": "application/json"}
        if payload is not None:
            for cookie in self.cookies:
                if cookie.name == "fiable_csrf":
                    headers["X-CSRF-Token"] = cookie.value
        request = urllib.request.Request(self.base + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())


def checks(port):
    client = Client(port)
    assert client.request("/api/rider/notifications")[0] == 401
    assert client.request("/api/rider/login", {"email": "rider1@example.test", "password": "wrong"})[0] == 401
    assert client.request("/api/rider/login", {"email": "rider1@example.test", "password": TEST_PASSWORD})[0] == 200
    status, account = client.request("/api/rider/account")
    assert status == 200 and "passwordHash" not in account["rider"]
    status, notifications = client.request("/api/rider/notifications")
    assert status == 200 and len(notifications["notifications"]) == 1
    assert notifications["notifications"][0]["riderId"] == 1
    history = client.request("/api/rider/deliveries")[1]["deliveries"]
    assert len(history) == 1 and history[0]["status"] == "returned" and "deliveryOtp" not in history[0]
    assert client.request("/api/rider/delivery/accept", {"orderId": 2})[0] == 403
    assert client.request("/api/rider/delivery/status", {"orderId": 1, "status": "picked_up"})[0] == 400
    assert client.request("/api/rider/delivery/accept", {"orderId": 1})[0] == 200
    assert any(order["id"] == 1 for order in client.request("/api/rider/delivery")[1]["deliveries"])
    for state in ["arriving_at_pickup", "picked_up", "on_delivery"]:
        status, result = client.request("/api/rider/delivery/status", {"orderId": 1, "status": state})
        assert status == 200, result
        assert "deliveryOtp" not in result["order"] and "passwordHash" not in result["rider"]
        assert any(order["id"] == 1 and order["status"] == state for order in client.request("/api/rider/delivery")[1]["deliveries"])
    assert client.request("/api/rider/delivery/complete", {"orderId": 1})[0] == 400
    status, result = client.request("/api/rider/delivery/complete", {"orderId": 1, "recipientName": "Recipient", "photo": PNG})
    assert status == 200 and result["order"]["status"] == "delivered", result
    assert "passwordHash" not in result["rider"]
    assert client.request("/api/rider/delivery/decline", {"orderId": 4, "reason": "Test decline"})[0] == 200
    assert next(o for o in server.load_deliveries() if o["id"] == 4)["riderId"] is None
    assert client.request("/api/rider/logout", {})[0] == 200
    assert client.request("/api/rider/account")[0] == 401
    temporary = Client(port)
    assert temporary.request("/api/rider/login", {"email": "rider3@example.test", "password": TEST_PASSWORD})[0] == 200
    assert temporary.request("/api/rider/delivery")[0] == 403
    assert temporary.request("/api/rider/change-password", {"currentPassword": TEST_PASSWORD, "newPassword": "New-rider-password"})[0] == 200
    assert temporary.request("/api/rider/delivery")[0] == 200
    reset = server.create_reset_token("rider2@example.test")
    assert Client(port).request("/api/rider/reset-password", {"token": reset, "password": "Reset-rider-password", "confirmPassword": "Reset-rider-password"})[0] == 200
    assert Client(port).request("/api/rider/reset-password", {"token": reset, "password": "Reset-rider-password", "confirmPassword": "Reset-rider-password"})[0] == 400
    print("PASS: login/logout, rider isolation, notifications, history/OTP privacy, forward transitions, decline, proof completion, temporary password gate and one-use password reset.", flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-rider-check-") as directory:
        fixtures(directory)
        serve = "--serve" in sys.argv
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 8091 if serve else 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            checks(httpd.server_port)
            if serve:
                fixtures(directory)
                print("Isolated browser test site ready at http://127.0.0.1:8091/rider.html", flush=True)
                threading.Event().wait()
        finally:
            httpd.shutdown()
            httpd.server_close()
