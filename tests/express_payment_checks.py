"""Guest online checkout checks using a fake provider and temporary records.

No requests or charges are sent to Paystack. --serve exposes the fake fixture.
"""
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import hmac
import json
from pathlib import Path
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from express_delivery_checks import fixtures, booking, PASSWORD
from rider_portal_checks import Client


class FakeProvider(server.PaystackProvider):
    def __init__(self):
        super().__init__("sk_test_fixture_only")
        self.initialized = {}
        self.overrides = {}
        self.initialize_failed = False
        self.unsafe_url = False
        self.verify_counts = {}
        self.email_initializations = {}

    def initialize_transaction(self, **values):
        self.initialized[values["reference"]] = values
        email = values["email"]
        self.email_initializations[email] = self.email_initializations.get(email, 0) + 1
        browser_failure = email == "initialize-failure@example.test" and self.email_initializations[email] == 1
        return {"status": not (self.initialize_failed or browser_failure), "data": {"authorization_url":
                "https://untrusted.example/checkout" if self.unsafe_url else "https://checkout.paystack.com/" + values["reference"]}}

    def verify_transaction(self, reference):
        values = self.initialized.get(reference)
        if not values:
            return {"status": False}
        self.verify_counts[reference] = self.verify_counts.get(reference, 0) + 1
        simulated = "abandoned" if values["email"] == "cancelled@example.test" else (
            "pending" if values["email"] == "pending@example.test" and self.verify_counts[reference] == 1 else "success")
        return {"status": True, "data": {
            "status": simulated, "reference": reference, "amount": values["amount_kobo"],
            "currency": "NGN", "customer": {"email": values["email"]},
            "paid_at": server.now_iso(), "channel": "card", **self.overrides.get(reference, {}),
        }}


def webhook(port, provider, reference, signature=None):
    raw = json.dumps({"event": "charge.success", "data": {"reference": reference}}).encode()
    digest = hmac.new(provider.secret_key.encode(), raw, hashlib.sha512).hexdigest()
    request = urllib.request.Request(f"http://127.0.0.1:{port}/api/payments/paystack/webhook", data=raw,
                                     headers={"Content-Type": "application/json", "X-Paystack-Signature": signature or digest})
    try:
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


def checks(port, provider):
    guest = Client(port)
    accounts_before = copy.deepcopy(server.load_accounts())
    subscriptions_before = copy.deepcopy(server.load_subscriptions())
    payload = booking()
    status, order = guest.request("/api/express/book", payload)
    assert status == 201
    initialize = {"requestId": payload["requestId"], "email": "payer@example.test", "amount": 1}
    with patch.object(server, "get_payment_provider", return_value=None):
        assert guest.request("/api/express/payment-options")[1]["paymentsEnabled"] is False
        assert guest.request("/api/express/payments/initialize", initialize)[0] == 503
    assert guest.request("/api/express/payment-options")[1]["paymentsEnabled"] is True
    assert guest.request("/api/express/payments/initialize", {**initialize, "email": "bad"})[0] == 400
    assert guest.request("/api/express/payments/initialize", {**initialize, "requestId": "x" * 36})[0] == 404
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: Client(port).request("/api/express/payments/initialize", initialize), range(4)))
    assert all(status == 200 for status, _ in responses)
    assert len(provider.initialized) == len(server.load_payments()) == 1
    reference = responses[0][1]["reference"]
    assert len({response["reference"] for _, response in responses}) == 1
    call = provider.initialized[reference]
    assert call["amount_kobo"] == order["estimatedCost"] * 100
    assert "expressPayment=return" in call["callback_url"] and "get-started.html" in call["callback_url"]
    assert call["metadata"]["purpose"] == "express" and "expressPayment=cancelled" in call["metadata"]["cancel_action"]
    assert webhook(port, provider, reference, signature="invalid")[0] == 401
    for mismatch in [{"amount": 1}, {"currency": "USD"}, {"reference": "another"},
                     {"customer": {"email": "another@example.test"}}, {"status": "pending"}]:
        provider.overrides[reference] = mismatch
        status, result = guest.request("/api/express/payments/verify", {"reference": reference, "status": "success"})
        assert status == 200 and result["status"] != "successful", result
        assert server.load_deliveries()[0]["paymentStatus"] == "pending"
        assert server.admin_payment_overview()["yearly"]["websiteRevenue"] == 0
    provider.overrides[reference] = {"status": "abandoned"}
    assert guest.request("/api/express/payments/verify", {"reference": reference})[1]["status"] == "failed"
    assert len(server.load_deliveries()) == 1
    provider.overrides[reference] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        verified = list(pool.map(lambda _: Client(port).request("/api/express/payments/verify", {"reference": reference}), range(4)))
    assert all(status == 200 and result["status"] == "successful" for status, result in verified)
    result = verified[0][1]
    assert result["receiptNumber"] and result["booking"]["trackingCode"] == order["trackingCode"]
    assert "customerEmail" not in result and "details" not in result["booking"]
    paid_order = server.load_deliveries()[0]
    assert paid_order["paymentStatus"] == "paid" and paid_order["paymentMethod"] == "paystack"
    assert paid_order["paymentReference"] == reference and paid_order["amountPaid"] == order["estimatedCost"]
    assert webhook(port, provider, reference)[0] == 200
    assert len([entry for entry in server.load_json_list(server.AUDIT_LOG_FILE) if entry.get("action") == "express_payment_received"]) == 1
    assert guest.request("/api/express/payments/initialize", initialize)[0] == 409
    with patch.object(server, "get_payment_provider", return_value=None):
        assert guest.request("/api/express/payments/verify", {"reference": reference})[1]["status"] == "successful"
    assert server.admin_payment_overview()["yearly"]["websiteRevenue"] == order["estimatedCost"]
    assert server.load_accounts() == accounts_before and server.load_subscriptions() == subscriptions_before

    # A signed webhook can confirm payment even if the customer never returns.
    second_payload = booking()
    guest.request("/api/express/book", second_payload)
    second_init = {**initialize, "requestId": second_payload["requestId"]}
    second_ref = guest.request("/api/express/payments/initialize", second_init)[1]["reference"]
    assert webhook(port, provider, second_ref)[0] == 200
    assert server.load_deliveries()[1]["paymentStatus"] == "paid"

    # Provider initialization failures and unsafe URLs never redirect customers.
    third_payload = booking()
    guest.request("/api/express/book", third_payload)
    third_init = {**initialize, "requestId": third_payload["requestId"]}
    provider.unsafe_url = True
    assert guest.request("/api/express/payments/initialize", third_init)[0] == 502
    provider.unsafe_url = False
    third_ref = guest.request("/api/express/payments/initialize", third_init)[1]["reference"]
    provider.overrides[third_ref] = {"status": "abandoned"}
    assert guest.request("/api/express/payments/verify", {"reference": third_ref})[1]["status"] == "failed"
    retry_ref = guest.request("/api/express/payments/initialize", third_init)[1]["reference"]
    assert retry_ref != third_ref and len(server.load_deliveries()) == 3
    assert webhook(port, provider, retry_ref)[0] == 200
    # A late success on an older attempt is retained for review, never credited twice.
    provider.overrides[third_ref] = {}
    assert webhook(port, provider, third_ref)[0] == 200
    review = guest.request("/api/express/payments/verify", {"reference": third_ref})[1]
    assert review["reviewRequired"] and server.load_deliveries()[2]["paymentReviewRequired"]
    assert server.admin_payment_overview()["yearly"]["websiteRevenue"] == order["estimatedCost"] * 3

    # Existing subscription checkout still uses its original activation path.
    vendor = Client(port)
    assert vendor.request("/api/login", {"email": "batch@example.test", "password": PASSWORD})[0] == 200
    subscription_ref = vendor.request("/api/account/payments/initialize", {"plan": "Basic"})[1]["reference"]
    assert guest.request("/api/express/payments/verify", {"reference": subscription_ref})[0] == 404
    assert webhook(port, provider, subscription_ref)[0] == 200
    assert vendor.request("/api/account/payments/verify", {"reference": subscription_ref})[1]["status"] == "successful"
    assert server.load_subscriptions() and len(server.load_deliveries()) == 3
    print("PASS: disabled checkout, exact saved amount, concurrent checkout reuse, provider verification mismatches, cancellation/retry, callback/webhook idempotence, receipt privacy, automatic revenue, late duplicate review and subscription compatibility.", flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-express-payment-") as directory:
        fixtures(directory)
        provider = FakeProvider()
        serve = "--serve" in sys.argv
        with patch.object(server, "get_payment_provider", side_effect=lambda: provider), patch.object(server, "PAYSTACK_IS_TEST_MODE", True):
            httpd = server.ThreadingHTTPServer(("127.0.0.1", 8097 if serve else 0), server.FiableHandler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            try:
                checks(httpd.server_port, provider)
                if serve:
                    fixtures(directory)
                    provider = FakeProvider()
                    print("Fake checkout browser fixture (no real payments): http://127.0.0.1:8097/get-started.html#quick-express", flush=True)
                    threading.Event().wait()
            finally:
                httpd.shutdown()
                httpd.server_close()
