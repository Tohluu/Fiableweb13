"""Monthly payment overview checks; every record is stored in a temporary folder."""
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from express_delivery_checks import fixtures as express_fixtures, PASSWORD
from rider_portal_checks import Client


def fixtures(directory):
    express_fixtures(directory)
    year = int(server.revenue_month(server.now_iso())[:4])
    accounts = [{"email": "subscription@example.test", "name": "Subscription Test", "plan": "Basic"}]
    server.atomic_write_json(server.ACCOUNTS_FILE, accounts)
    server.save_subscriptions([
        {"id": "SUB-1", "email": accounts[0]["email"], "amount": 100000, "paymentStatus": "paid",
         "plan": "Basic", "paidAt": f"{year}-02-01T00:00:00+00:00", "periodStart": f"{year}-01-25T00:00:00+00:00", "periodEnd": f"{year}-03-01T00:00:00+00:00"},
        {"id": "SUB-2", "email": accounts[0]["email"], "amount": 70000, "paymentStatus": "pending",
         "plan": "Basic", "periodStart": f"{year}-02-15T00:00:00+00:00", "periodEnd": f"{year}-03-15T00:00:00+00:00"},
        {"id": "SUB-3", "email": accounts[0]["email"], "amount": 30000, "paymentStatus": "paid",
         "plan": "Basic", "paidAt": f"{year - 1}-12-20T00:00:00+00:00", "periodStart": f"{year - 1}-12-20T00:00:00+00:00", "periodEnd": f"{year}-01-20T00:00:00+00:00"},
    ])
    # A gateway receipt represents SUB-1, not another NGN 100,000 of revenue.
    server.save_payments([{"id": "PAY-1", "amount": 100000, "status": "successful", "paidAt": f"{year}-02-01T00:00:00+00:00"}])
    orders = [
        {"id": 1, "bookingType": "express", "bookingSource": "website", "status": "delivered", "paymentStatus": "paid",
         "amountPaid": 6000, "cost": 6000, "pricing": {"riderPayout": 4800},
         "createdAt": f"{year}-01-20T12:00:00+00:00", "paidAt": f"{year}-02-10T12:00:00+00:00",
         "updatedAt": f"{year}-02-10T12:00:00+00:00", "proofOfDelivery": {"deliveredAt": f"{year}-01-21T12:00:00+00:00"}},
        {"id": 2, "bookingType": "express", "status": "requested", "paymentStatus": "pending", "cost": 4000,
         "createdAt": f"{year}-02-10T12:00:00+00:00"},
        {"id": 3, "bookingType": "express", "status": "cancelled", "paymentStatus": "pending", "cost": 9000,
         "createdAt": f"{year}-02-10T12:00:00+00:00"},
        # 23:30 UTC on Jan 31 is February in Lagos.
        {"id": 4, "bookingType": "express", "status": "requested", "paymentStatus": "paid", "amountPaid": 2000, "cost": 2000,
         "paidAt": f"{year}-01-31T23:30:00+00:00", "createdAt": f"{year}-01-31T21:00:00+00:00"},
        {"id": 5, "bookingType": "express", "status": "delivered", "paymentStatus": "pending", "cost": 1000,
         "pricing": {"riderPayout": 800}, "createdAt": f"{year}-02-12T12:00:00+00:00",
         "updatedAt": f"{year}-03-12T12:00:00+00:00", "timeline": [{"status": "delivered", "at": f"{year}-02-12T12:00:00+00:00"}]},
        {"id": 6, "status": "delivered", "accountEmail": accounts[0]["email"], "cost": 3000, "pricing": {"riderPayout": 2400},
         "createdAt": f"{year}-02-12T12:00:00+00:00", "updatedAt": f"{year}-02-12T12:00:00+00:00"},
        {"id": 7, "bookingType": "express", "status": "requested", "paymentStatus": "paid", "amountPaid": 5000, "cost": 5000,
         "createdAt": f"{year-1}-12-15T12:00:00+00:00", "paidAt": f"{year-1}-12-15T12:00:00+00:00"},
    ]
    server.save_deliveries(orders)
    return year


def checks(port, year):
    subscriptions = server.admin_revenue_summary()
    assert subscriptions["monthly"][f"{year}-02"] == {"revenue": 100000, "riderPayments": 2400, "profit": 97600}
    assert f"{year}-01" not in subscriptions["monthly"]
    overview = server.admin_payment_overview()
    february = overview["monthly"][f"{year}-02"]
    assert february["subscriptionRevenue"] == 100000 and february["websiteRevenue"] == 8000
    assert february["totalRevenue"] == 108000 and february["paidWebsiteCount"] == 2
    assert february["riderCosts"] == 3200 and february["afterRiderCosts"] == 104800
    assert february["unpaidWebsiteAmount"] == 5000 and february["unpaidWebsiteCount"] == 2
    january = overview["monthly"][f"{year}-01"]
    assert january["websiteRevenue"] == 0 and january["websiteRiderCosts"] == 4800
    assert january["afterRiderCosts"] == -4800
    assert overview["yearly"]["totalRevenue"] == 108000
    assert overview["yearly"]["riderCosts"] == 8000 and overview["yearly"]["afterRiderCosts"] == 100000
    assert overview["outstandingWebsite"] == {"amount": 5000, "count": 2}
    assert server.revenue_month("bad date") is None
    assert server.revenue_month(f"{year}-01-31T23:30:00") == f"{year}-02"
    assert Client(port).request("/api/admin/finance/overview")[0] == 403
    for email in ["owner@example.test", "finance@example.test", "analyst@example.test"]:
        client = Client(port)
        assert client.request("/api/admin/login", {"email": email, "password": PASSWORD})[0] == 200
        status, summary = client.request("/api/admin/finance/overview")
        assert status == 200 and summary["monthly"] == overview["monthly"]
    admins = server.load_admin_credentials()
    admins.append({**admins[0], "id": 4, "email": "dispatcher@example.test", "role": "dispatcher"})
    server.save_admin_credentials(admins)
    dispatch = Client(port)
    assert dispatch.request("/api/admin/login", {"email": "dispatcher@example.test", "password": PASSWORD})[0] == 200
    assert dispatch.request("/api/admin/finance/overview")[0] == 403
    finance = Client(port)
    finance.request("/api/admin/login", {"email": "finance@example.test", "password": PASSWORD})
    # The existing receipt control must feed the overview immediately.
    status, _ = finance.request("/api/admin/orders/express-payment", {"orderId": 2, "amount": 4000, "method": "cash"})
    assert status == 200
    month = server.revenue_month(server.now_iso())
    updated = finance.request("/api/admin/finance/overview")[1]
    assert updated["monthly"][month]["websiteRevenue"] == overview["monthly"].get(month, {}).get("websiteRevenue", 0) + 4000
    assert updated["outstandingWebsite"] == {"amount": 1000, "count": 1}
    assert server.admin_revenue_summary() == subscriptions
    print("PASS: separate/combined revenue, paid-date recognition, Lagos month boundary, unpaid/cancelled exclusion, no gateway double count, stable completion costs, year totals, permissions and live receipt integration.", flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-payment-overview-") as directory:
        year = fixtures(directory)
        serve = "--serve" in sys.argv
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 8096 if serve else 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            checks(httpd.server_port, year)
            if serve:
                fixtures(directory)
                print("Isolated payments overview fixture: http://127.0.0.1:8096/admin.html", flush=True)
                threading.Event().wait()
        finally:
            httpd.shutdown()
            httpd.server_close()
