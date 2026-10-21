"""Haulage deposits, balances and finance permissions in isolated storage."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import tempfile
import threading
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from express_delivery_checks import fixtures, PASSWORD
from rider_portal_checks import Client


def booking(**changes):
    return {"customerName": "Test haulage business", "phone": "08000000000",
            "pickup": "Warehouse, Apapa", "dropoff": "Factory, Ikeja", "description": "20 cartons, 500 kg",
            "quoteAmount": 100000, "quoteDate": "2026-01-01", "scheduledDate": "2026-02-10",
            "notes": "Loading access confirmed", "requestId": str(uuid.uuid4()), **changes}


def receipt(booking_id, **changes):
    return {"bookingId": booking_id, "amount": 40000, "paidDate": "2026-01-31", "method": "bank_transfer",
            "reference": "BANK-HAUL-1", "requestId": str(uuid.uuid4()), **changes}


def expense(booking_id, **changes):
    return {"bookingId": booking_id, "amount": 60000, "paidDate": "2026-01-31", "method": "bank_transfer",
            "reference": "VAN-HAUL-1", "category": "van_payment", "paidTo": "Test van operator",
            "description": "Van hire for Apapa to Ikeja", "requestId": str(uuid.uuid4()), **changes}


def checks(port):
    clients = {}
    for role in ["owner", "finance", "analyst"]:
        client = Client(port)
        assert client.request('/api/admin/login', {"email": f"{role}@example.test", "password": PASSWORD})[0] == 200
        clients[role] = client
    guest, owner, finance, analyst = Client(port), clients['owner'], clients['finance'], clients['analyst']
    baseline = owner.request('/api/admin/finance/overview')[1]
    assert guest.request('/api/admin/haulage')[0] == 403
    assert guest.request('/api/admin/haulage', booking())[0] == 403
    assert analyst.request('/api/admin/haulage', booking())[0] == 403
    assert analyst.request('/api/admin/haulage')[1]['canManage'] is False
    assert not server.HAULAGE_BOOKINGS_FILE.exists()
    for bad in [booking(quoteAmount=0), booking(quoteAmount=True), booking(quoteAmount=1.5),
                booking(quoteAmount=1000000001), booking(customerName=" "), booking(quoteDate="2026-02-30"),
                booking(quoteDate="2999-01-01"), booking(scheduledDate=False), booking(requestId="bad")]:
        assert owner.request('/api/admin/haulage', bad)[0] == 400
    payload = booking()
    status, created = finance.request('/api/admin/haulage', payload)
    assert status == 201, created
    row = created['booking']
    assert row['outstanding'] == 100000 and row['amountPaid'] == 0 and row['paymentStatus'] == 'unpaid'
    assert finance.request('/api/admin/haulage', payload)[0] == 200
    assert owner.request('/api/admin/haulage', {**payload, 'quoteAmount': 200000})[0] == 409
    deposit = receipt(row['id'])
    assert analyst.request('/api/admin/haulage/receipt', deposit)[0] == 403
    for bad in [receipt(row['id'], amount=-1), receipt(row['id'], amount=True), receipt(row['id'], amount=0.5),
                receipt(row['id'], paidDate="2999-01-01"), receipt(row['id'], paidDate="invalid"),
                receipt(row['id'], method="unknown")]:
        assert owner.request('/api/admin/haulage/receipt', bad)[0] == 400
    assert owner.request('/api/admin/haulage/receipt', receipt('missing'))[0] == 404
    status, received = owner.request('/api/admin/haulage/receipt', deposit)
    assert status == 201 and received['booking']['outstanding'] == 60000
    assert received['booking']['paymentStatus'] == 'part_paid'
    assert owner.request('/api/admin/haulage/receipt', deposit)[0] == 200
    assert owner.request('/api/admin/haulage/receipt', {**deposit, 'amount': 50000})[0] == 409
    assert owner.request('/api/admin/haulage/receipt', receipt(row['id']))[0] == 409, 'Duplicate bank reference'
    assert owner.request('/api/admin/haulage/receipt', receipt(row['id'], amount=60001, reference='TOO-MUCH'))[0] == 409
    second = receipt(row['id'], amount=60000, paidDate='2026-02-01', reference='BANK-HAUL-2')
    assert finance.request('/api/admin/haulage/receipt', second)[1]['booking']['paymentStatus'] == 'paid'
    assert len(server.load_haulage_bookings()) == 1
    assert len(server.load_haulage_bookings()[0]['receipts']) == 2
    _, overview = owner.request('/api/admin/finance/overview')
    assert overview['monthly']['2026-01']['haulageRevenue'] == 40000
    assert overview['monthly']['2026-02']['haulageRevenue'] == 60000
    assert overview['monthly']['2026-01']['totalRevenue'] == 40000
    assert overview['outstandingHaulage'] == {'amount': 0, 'count': 0}
    assert overview['yearly']['haulageRevenue'] == 100000
    assert overview['yearly']['totalRevenue'] == baseline['yearly']['totalRevenue'] + 100000
    assert overview['monthly']['2026-01']['riderCosts'] == 0, 'Haulage must not create an automatic 80% rider cost'
    # Existing bookings without expense lists remain readable without writes.
    legacy = server.load_haulage_bookings()
    del legacy[0]['expenses']
    server.atomic_write_json(server.HAULAGE_BOOKINGS_FILE, legacy)
    before = server.HAULAGE_BOOKINGS_FILE.read_bytes()
    _, unchanged = owner.request('/api/admin/haulage')
    assert unchanged['bookings'][0]['totalExpenses'] == 0
    assert unchanged['bookings'][0]['netReceived'] == 100000
    assert server.HAULAGE_BOOKINGS_FILE.read_bytes() == before
    van = expense(row['id'])
    assert guest.request('/api/admin/haulage/expense', van)[0] == 403
    assert analyst.request('/api/admin/haulage/expense', van)[0] == 403
    for bad in [expense(row['id'], amount=0), expense(row['id'], amount=True), expense(row['id'], amount=0.5),
                expense(row['id'], category=[]), expense(row['id'], category='invalid'),
                expense(row['id'], paidTo=' '), expense(row['id'], description=' '),
                expense(row['id'], paidDate='2999-01-01'), expense(row['id'], method='invalid')]:
        assert owner.request('/api/admin/haulage/expense', bad)[0] == 400
    assert owner.request('/api/admin/haulage/expense', expense('missing'))[0] == 404
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: finance.request('/api/admin/haulage/expense', van)[0], range(2))) == [200, 201]
    assert owner.request('/api/admin/haulage/expense', {**van, 'amount': 50000})[0] == 409
    assert owner.request('/api/admin/haulage/expense', expense(row['id']))[0] == 409
    assert owner.request('/api/admin/haulage/expense', expense(row['id'], requestId=deposit['requestId'], reference='CROSS-TYPE'))[0] == 409
    for category, amount, date in [('fuel', 5000, '2026-02-01'), ('loading', 2000, '2026-02-01'),
                                   ('tolls', 1000, '2026-02-01'), ('other', 3000, '2026-01-31')]:
        status, cost = owner.request('/api/admin/haulage/expense', expense(row['id'], category=category,
            amount=amount, paidDate=date, reference=f'EXPENSE-{category}'))
        assert status == 201, cost
    cost = cost['booking']
    assert cost['vanPayments'] == 60000 and cost['otherExpenses'] == 11000
    assert cost['totalExpenses'] == 71000 and cost['netReceived'] == 29000
    assert cost['outstanding'] == 0 and cost['paymentStatus'] == 'paid'
    assert len(cost['receipts']) == 2 and len(cost['expenses']) == 5
    _, updated = owner.request('/api/admin/finance/overview')
    jan, feb = updated['monthly']['2026-01'], updated['monthly']['2026-02']
    assert jan['haulageVanPayments'] == 60000 and jan['haulageOtherExpenses'] == 3000
    assert jan['haulageExpenses'] == 63000 and jan['haulageNetReceived'] == -23000
    assert jan['afterRecordedCosts'] == jan['afterRiderCosts'] - 63000
    assert feb['haulageExpenses'] == 8000 and feb['haulageNetReceived'] == 52000
    assert updated['yearly']['haulageExpenses'] == 71000 and updated['yearly']['haulageNetReceived'] == 29000
    assert updated['yearly']['totalRevenue'] == overview['yearly']['totalRevenue']
    assert updated['yearly']['riderCosts'] == overview['yearly']['riderCosts']
    # Two independently submitted payments cannot jointly exceed the balance.
    _, other = owner.request('/api/admin/haulage', booking(quoteAmount=50000))
    other_id = other['booking']['id']
    status, advance = owner.request('/api/admin/haulage/expense', expense(other_id, amount=80000, reference='VAN-ADVANCE'))
    assert status == 201 and advance['booking']['netReceived'] == -80000, 'Allow costs before receipts and above the customer quote'
    assert advance['booking']['outstanding'] == 50000
    def concurrent_payment(index):
        session = Client(port)
        session.request('/api/admin/login', {'email': 'finance@example.test', 'password': PASSWORD})
        return session.request('/api/admin/haulage/receipt', receipt(other_id, amount=40000, reference=f'CONCURRENT-{index}'))[0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(concurrent_payment, range(2))) == [201, 409]
    _, data = analyst.request('/api/admin/haulage')
    assert data['canManage'] is False and len(data['bookings']) == 2
    assert next(item for item in data['bookings'] if item['id'] == other_id)['outstanding'] == 10000
    # Same-request retries are atomic as well.
    final = receipt(other_id, amount=10000, method='cash', reference='')
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: owner.request('/api/admin/haulage/receipt', final)[0], range(2)))
    assert sorted(statuses) == [200, 201]
    saved = server.HAULAGE_BOOKINGS_FILE.read_bytes()
    assert server.load_haulage_bookings() == json.loads(saved)
    assert any(item.get('action') == 'haulage_payment_received' for item in server.read_stored_json(server.AUDIT_LOG_FILE))
    assert any(item.get('action') == 'haulage_expense_recorded' for item in server.read_stored_json(server.AUDIT_LOG_FILE))
    broken = json.loads(saved)
    broken[0]['expenses'][0]['category'] = {}
    server.atomic_write_json(server.HAULAGE_BOOKINGS_FILE, broken)
    assert owner.request('/api/admin/haulage')[0] == 503
    server.HAULAGE_BOOKINGS_FILE.write_text('{broken', encoding='utf-8')
    assert owner.request('/api/admin/haulage')[0] == owner.request('/api/admin/finance/overview')[0] == 503
    assert owner.request('/api/admin/haulage', booking())[0] == 400
    assert server.HAULAGE_BOOKINGS_FILE.read_text() == '{broken'
    server.HAULAGE_BOOKINGS_FILE.write_bytes(saved)
    print('PASS: quotes, deposits, van payments, all expense categories, negative net receipts, Lagos expense dates, preserved customer balances, legacy records, permissions, replay/concurrency protection, monthly/annual totals, audit and corrupt-storage protection.', flush=True)


if __name__ == '__main__':
    server.DATABASE = None
    with tempfile.TemporaryDirectory(prefix='apexwings-haulage-payments-') as directory:
        fixtures(directory)
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            checks(httpd.server_port)
        finally:
            httpd.shutdown()
            httpd.server_close()
