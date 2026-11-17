"""Live calculator price comparisons with temporary records and no bookings."""
import copy
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, login
from pricing_zone_checks import set_units
from rider_portal_checks import Client


def checks(port):
    guest = Client(port)
    config = server.default_batch_routing()
    orders_before = server.DELIVERIES_FILE.read_bytes()
    accounts_before = server.ACCOUNTS_FILE.read_bytes()
    prices = {'Basic': (1500, 67500, 45), 'Growth': (1400, 105000, 75), 'Business': (1300, 143000, 110)}
    for units in range(1, 8):
        changed = copy.deepcopy(config)
        set_units(changed, 'mainland-north', 'mainland-east', max(2, units))
        server.atomic_write_json(server.BATCH_ROUTING_FILE, changed)
        pickup, dropoff = ('egbeda', 'egbeda') if units == 1 else ('egbeda', 'ikeja')
        status, quote = guest.request('/api/calculate', {'pickup': pickup, 'dropoff': dropoff})
        assert status == 200 and quote['units'] == units
        plan = 'Basic' if units <= 2 else 'Growth' if units <= 4 else 'Business'
        unit_price, monthly_price, monthly_units = prices[plan]
        comparison = quote['planComparison']
        assert quote['recommendedPlan'] == comparison['plan'] == plan
        assert quote['cost'] == comparison['expressCost'] == units * 2000
        assert comparison['unitPrice'] == unit_price
        assert comparison['deliveryCost'] == units * unit_price
        assert comparison['savingPerDelivery'] == quote['cost'] - comparison['deliveryCost']
        assert comparison['monthlyPrice'] == monthly_price
        assert comparison['monthlyUnits'] == monthly_units
    # Account-specific prices keep their existing meaning; comparison remains
    # a separate recommendation using the same route's units.
    vendor = login(port)
    status, quote = vendor.request('/api/calculate', {'pickup': 'egbeda', 'dropoff': 'ikeja', 'email': 'batch@example.test'})
    assert status == 200 and quote['plan'] == 'Basic' and quote['cost'] == 10500
    assert quote['planComparison']['plan'] == 'Business'
    assert quote['planComparison']['deliveryCost'] == 9100
    assert quote['planComparison']['expressCost'] == 14000
    assert guest.request('/api/calculate', {'pickup': 'missing', 'dropoff': 'ikeja'})[0] == 400
    assert server.DELIVERIES_FILE.read_bytes() == orders_before
    assert server.ACCOUNTS_FILE.read_bytes() == accounts_before
    print('PASS: all 1–7-unit routes, three recommended plans, exact monthly prices/allocations, route savings, account-price compatibility and read-only estimates.')


if __name__ == '__main__':
    server.DATABASE = None
    with tempfile.TemporaryDirectory(prefix='apexwings-calculator-plans-') as directory:
        fixtures(directory)
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            checks(httpd.server_port)
        finally:
            httpd.shutdown()
            httpd.server_close()
