"""Exact-location pricing, migration and booking checks in isolated storage."""
import copy
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, login, requests
from express_delivery_checks import booking
from pricing_zone_checks import set_units
from rider_portal_checks import Client


def migration_and_pairs():
    legacy = server.default_batch_routing()
    legacy.pop('locationPricingVersion')
    set_units(legacy, 'mainland-east', 'mainland-east', 1)
    set_units(legacy, 'mainland-north', 'mainland-east', 1)
    set_units(legacy, 'mainland-north', 'mainland-north', 6)
    legacy['pricingZones']['mainland-east'] = 'Custom east label'
    legacy['locations'].append({'id': 'custom-town', 'label': 'Custom Town', 'zone': 'mainland-east'})
    next(area for area in legacy['areas'] if area['id'] == 'ikeja')['locations'].append('custom-town')
    for area in legacy['areas']:
        area['locations'].sort()
    legacy['pickupRules']['ikeja'] = server.batch_routing_groups(legacy, 'ikeja')
    before = copy.deepcopy(legacy)
    server.atomic_write_json(server.BATCH_ROUTING_FILE, legacy)
    old = server.create_delivery('batch@example.test', 'ikeja', 'opebi', 1, unit_price=1500,
                                pricing={'units': 1, 'cost': 1500, 'pricingVersion': 'legacy'})
    old_orders = server.DELIVERIES_FILE.read_bytes()
    raw = server.BATCH_ROUTING_FILE.read_bytes()
    config = server.load_batch_routing()
    assert legacy == before and server.BATCH_ROUTING_FILE.read_bytes() == raw
    assert server.DELIVERIES_FILE.read_bytes() == old_orders
    assert config['locationPricingVersion'] == server.LOCATION_PRICING_VERSION
    for field in ('locations', 'areas', 'pickupRules', 'pricingZones'):
        assert config[field] == legacy[field], field
    for previous, current in zip(legacy['zoneUnits'], config['zoneUnits']):
        assert current['units'] == max(2, previous['units'])
    assert server.upgrade_same_location_pricing(config) == config
    assert server.validate_batch_routing(config) == config
    from manage_database import load_source
    documents, _ = load_source(server.DATA_DIR)
    assert documents['batch_routing'] == config
    assert documents['deliveries'][0] == old
    assert server.BATCH_ROUTING_FILE.read_bytes() == raw
    zones = {item['id']: item['zone'] for item in config['locations']}
    rates = {frozenset((item['from'], item['to'])): item['units'] for item in config['zoneUnits']}
    pairs = 0
    for pickup in zones:
        for dropoff in zones:
            expected = 1 if pickup == dropoff else rates[frozenset((zones[pickup], zones[dropoff]))]
            for plan, price in server.PLAN_UNIT_PRICES.items():
                quote = server.estimate_delivery(pickup, dropoff, plan, routing=config)
                assert quote['units'] == expected, (pickup, dropoff, quote)
                assert quote['baseCost'] == quote['cost'] == expected * price
                assert quote['minimumUnits'] == (1 if pickup == dropoff else 2)
            pairs += 1
    assert server.estimate_delivery('egbeda', 'egbeda', 'Basic', routing=config)['units'] == 1
    assert server.estimate_delivery('egbeda', 'shasha', 'Basic', routing=config)['units'] == 6
    assert server.estimate_delivery('ikeja', 'opebi', 'Basic', routing=config)['units'] == 2
    # Even a direct caller providing a legacy matrix cannot bypass the floor.
    assert server.estimate_delivery('ikeja', 'opebi', 'Basic', routing=legacy)['units'] == 2
    for value in (1, 0, 8, True, 1.5):
        invalid = copy.deepcopy(config)
        invalid['zoneUnits'][0]['units'] = value
        try:
            server.validate_batch_routing(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid admin rate accepted')
    for version in (True, -1, 2, '1'):
        try:
            server.validate_batch_routing({**config, 'locationPricingVersion': version})
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid policy version accepted')
    # Keep strict validation of corrupt legacy files before migrating.
    broken = copy.deepcopy(legacy)
    broken['zoneUnits'][0]['units'] = 0
    server.atomic_write_json(server.BATCH_ROUTING_FILE, broken)
    try:
        server.load_batch_routing()
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid legacy data was silently repaired')
    server.atomic_write_json(server.BATCH_ROUTING_FILE, config)
    assert server.load_batch_routing() == config
    assert server.load_deliveries()[0] == old
    print(f'PASS: {pairs:,} ordered location pairs across all 3 plans; legacy 1-unit rates upgraded, higher rates and custom settings retained, exact-location override and old orders preserved.', flush=True)
    return config, old


def discount_checks(config):
    combined = copy.deepcopy(config)
    combined['pickupRules']['ikeja'] = [{'id': 'all-test', 'label': 'All destinations',
                                         'areas': [area['id'] for area in config['areas']]}]
    for count in (3, 5, 6, 10, 11, 100):
        for destinations in (['opebi'] * count, ['ikeja'] * count,
                             (['ikeja', 'opebi', 'epe'] * count)[:count]):
            for window in ('Next Day Delivery', 'Express'):
                quote = server.estimate_batch_deliveries(requests(destinations, pickup='ikeja', window=window), 'Basic', routing=combined)
                floor = sum(1 if destination == 'ikeja' else 2 for destination in destinations)
                percent = round(server.batch_discount_rate(count) * 100)
                expected = max(floor, (quote['originalUnits'] * (100 - percent) + 99) // 100)
                assert quote['chargedUnits'] == expected
                assert quote['chargedUnits'] == sum(item['units'] for item in quote['deliveries'])
                assert quote['vendorSaving'] == (quote['originalUnits'] - expected) * 1500
                for item in quote['deliveries']:
                    assert (1 if item['pickup'] == item['dropoff'] else 2) <= item['units'] <= item['originalUnits']
                    assert item['cost'] == item['units'] * 1500 + (2000 if window == 'Express' else 0)
                    assert item['riderPayout'] == round(item['originalCost'] * server.RIDER_PAYOUT_RATE)
    print('PASS: all discount tiers, mixed groups and 100-delivery batches enforce per-delivery floors, retain valid savings, surcharges and original rider payouts.', flush=True)


def api_checks(port, old):
    owner, vendor, guest = login(port, 'owner@example.test', admin=True), login(port), Client(port)
    status, initial = owner.request('/api/admin/batch-routing')
    assert status == 200 and all(route['units'] >= 2 for route in initial['config']['zoneUnits'])
    for pickup, dropoff, units in [('egbeda', 'egbeda', 1), ('egbeda', 'shasha', 6),
                                  ('ikeja', 'opebi', 2), ('opebi', 'ikeja', 2),
                                  ('ikeja', 'maryland', 2), ('ikeja', 'custom-town', 2)]:
        for client, account in ((guest, {}), (vendor, {'email': 'batch@example.test'})):
            status, quote = client.request('/api/calculate', dict(pickup=pickup, dropoff=dropoff, **account))
            assert status == 200 and quote['units'] == units
            assert quote['cost'] == units * (1500 if account else 2000)
        status, quote = guest.request('/api/express/quote', dict(pickup=pickup, dropoff=dropoff))
        assert status == 200 and quote['cost'] == units * 2000
    payload = booking(pickup='ikeja', dropoff='opebi', quotedCost=4000)
    status, express = guest.request('/api/express/book', payload)
    assert status == 201 and express['units'] == 2
    assert guest.request('/api/express/book', payload) == (200, express)
    same = booking(pickup='egbeda', dropoff='egbeda', quotedCost=2000)
    assert guest.request('/api/express/book', same)[1]['units'] == 1
    status, single = vendor.request('/api/delivery-request', requests(['opebi'], pickup='ikeja')[0])
    assert status == 201 and single['delivery']['units'] == 2
    deliveries = requests(['opebi'] * 11, pickup='ikeja')
    _, batch = vendor.request('/api/batch-delivery-quote', {'deliveries': deliveries})
    assert batch['chargedUnits'] == 22 and batch['unitsSaved'] == 0
    status, booked = vendor.request('/api/batch-delivery-request', {'deliveries': deliveries, 'quoteToken': batch['quoteToken']})
    assert status == 201 and all(item['units'] == 2 for item in booked['deliveries'])
    # A quote from the earlier pricing policy must be reviewed again.
    previous_version = server.PRICING_VERSION
    try:
        server.PRICING_VERSION = 'legacy-policy'
        _, stale = vendor.request('/api/batch-delivery-quote', {'deliveries': deliveries})
    finally:
        server.PRICING_VERSION = previous_version
    status, response = vendor.request('/api/batch-delivery-request', {'deliveries': deliveries, 'quoteToken': stale['quoteToken']})
    assert status == 409 and response['quoteChanged']
    saved_orders = copy.deepcopy(server.load_deliveries())
    for remove_version in (False, True):
        invalid = copy.deepcopy(initial['config'])
        set_units(invalid, 'mainland-east', 'mainland-east', 1)
        if remove_version:
            invalid.pop('locationPricingVersion')
        for endpoint in ('/api/admin/batch-routing', '/api/admin/batch-routing/preview'):
            assert owner.request(endpoint, {'config': invalid, 'version': initial['version'], 'deliveries': deliveries})[0] == 400
    updated = copy.deepcopy(initial['config'])
    set_units(updated, 'mainland-east', 'mainland-east', 5)
    status, preview = owner.request('/api/admin/batch-routing/preview', {'config': updated, 'deliveries': deliveries})
    assert status == 200 and preview['originalUnits'] == 55
    status, saved = owner.request('/api/admin/batch-routing', {'config': updated, 'version': initial['version']})
    assert status == 200 and server.load_batch_routing() == saved['config']
    assert guest.request('/api/calculate', {'pickup': 'ikeja', 'dropoff': 'ikeja'})[1]['units'] == 1
    assert guest.request('/api/calculate', {'pickup': 'ikeja', 'dropoff': 'opebi'})[1]['units'] == 5
    assert server.load_deliveries() == saved_orders and server.load_deliveries()[0] == old
    print('PASS: public, express, subscriber and batch quote/booking flows; invalid save/preview rejection, stale-policy quote review, custom rate edits and saved booking prices.', flush=True)


if __name__ == '__main__':
    server.DATABASE = None
    with tempfile.TemporaryDirectory(prefix='apexwings-same-location-') as directory:
        fixtures(directory)
        config, old = migration_and_pairs()
        discount_checks(config)
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            api_checks(httpd.server_port, old)
        finally:
            httpd.shutdown()
            httpd.server_close()
