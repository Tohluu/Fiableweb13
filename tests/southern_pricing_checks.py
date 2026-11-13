"""Southern mainland rollout, saved-rate inheritance and customer pricing."""
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


def previous_settings():
    config = server.default_batch_routing()
    new_zones = server.SOUTH_MAINLAND_ZONE_SOURCES
    config['pricingZones'] = {key: label for key, label in config['pricingZones'].items() if key not in new_zones}
    config['zoneUnits'] = [route for route in config['zoneUnits']
                           if route['from'] not in new_zones and route['to'] not in new_zones]
    for location in config['locations']:
        move = server.SOUTH_MAINLAND_ZONE_MOVES.get(location['id'])
        if move:
            location['zone'] = move[0][0]
    config['locations'].append({'id': 'magodo', 'label': 'Magodo', 'zone': 'mainland-east'})
    next(area for area in config['areas'] if area['id'] == 'ikeja')['locations'].append('magodo')
    for area in config['areas']:
        area['locations'].sort()
    # Existing local settings also place these two standard locations in Central.
    for location in config['locations']:
        if location['id'] in ('surulere', 'shomolu'):
            location['zone'] = 'mainland-central'
    config['pickupRules']['ikeja'] = server.batch_routing_groups(config, 'ikeja')
    return config


def migration_checks():
    previous = previous_settings()
    before = copy.deepcopy(previous)
    server.atomic_write_json(server.BATCH_ROUTING_FILE, previous)
    raw = server.BATCH_ROUTING_FILE.read_bytes()
    upgraded = server.load_batch_routing()
    assert previous == before and server.BATCH_ROUTING_FILE.read_bytes() == raw
    assert len(upgraded['pricingZones']) == 13 and len(upgraded['zoneUnits']) == 91
    assert upgraded['areas'] == previous['areas'] and upgraded['pickupRules'] == previous['pickupRules']
    assert all(route in upgraded['zoneUnits'] for route in previous['zoneUnits'])
    zones = {location['id']: location['zone'] for location in previous['locations']}
    old_rates = {frozenset((route['from'], route['to'])): route['units'] for route in previous['zoneUnits']}
    for origin in zones:
        for destination in zones:
            units = server.estimate_delivery(origin, destination, 'Basic', routing=upgraded)['units']
            assert units >= old_rates[frozenset((zones[origin], zones[destination]))], (origin, destination)
    for origin, destination in [('gbagada', 'magodo'), ('surulere', 'yaba'), ('apapa', 'ojo'),
                                ('oshodi-isolo', 'ikeja'), ('bariga', 'magodo'), ('festac-town', 'ojo')]:
        assert server.estimate_delivery(origin, destination, 'Basic', routing=upgraded)['units'] == 2
        assert server.estimate_delivery(destination, origin, 'Basic', routing=upgraded)['units'] == 2
    custom = copy.deepcopy(previous)
    custom['pricingZones']['mainland-east'] = 'Custom dispatch east'
    set_units(custom, 'mainland-east', 'mainland-east', 4)
    set_units(custom, 'mainland-north-east', 'mainland-central', 6)
    next(item for item in custom['locations'] if item['id'] == 'ilupeju')['zone'] = 'extended'
    migrated = server.validate_batch_routing(custom)
    assert migrated['pricingZones']['mainland-east'] == 'Custom dispatch east'
    assert next(item for item in migrated['locations'] if item['id'] == 'ilupeju')['zone'] == 'extended'
    assert server.estimate_delivery('gbagada', 'magodo', 'Basic', routing=migrated)['units'] == 4
    assert server.estimate_delivery('agege', 'gbagada', 'Basic', routing=migrated)['units'] == 6
    modern = copy.deepcopy(upgraded)
    set_units(modern, 'mainland-south-east', 'mainland-east', 1)
    next(item for item in modern['locations'] if item['id'] == 'gbagada')['zone'] = 'mainland-east'
    assert server.validate_batch_routing(modern) == modern, 'Later admin changes must survive reads'
    broken = copy.deepcopy(previous); broken['zoneUnits'].pop()
    partial = copy.deepcopy(upgraded); del partial['pricingZones']['mainland-south']
    for invalid in (broken, partial):
        try:
            server.validate_batch_routing(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError('Incomplete pricing accepted')
    server.atomic_write_json(server.BATCH_ROUTING_FILE, previous)
    print('PASS: 13 zones, all legacy route prices preserved, corrected 1-unit routes, custom rates/assignments, idempotence and invalid-matrix rejection.', flush=True)


def api_checks(port):
    owner, vendor, guest = login(port, 'owner@example.test', admin=True), login(port), Client(port)
    status, initial = owner.request('/api/admin/batch-routing')
    assert status == 200 and set(server.SOUTH_MAINLAND_ZONE_SOURCES).issubset(initial['pricingZones'])
    _, catalog = guest.request('/api/locations')
    zones = {item['id']: item['zone'] for item in catalog['locations']}
    assert zones['gbagada'] == 'mainland-south-east' and zones['magodo'] == 'mainland-east'
    assert zones['surulere'] == 'mainland-south' and zones['apapa'] == 'mainland-south-west'
    for origin, destination in [('gbagada', 'magodo'), ('magodo', 'gbagada'), ('surulere', 'yaba'), ('apapa', 'ojo')]:
        status, quote = guest.request('/api/calculate', {'pickup': origin, 'dropoff': destination})
        assert status == 200 and quote['units'] == 2 and quote['cost'] == 4000
    _, quote = guest.request('/api/express/quote', {'pickup': 'gbagada', 'dropoff': 'magodo'})
    assert quote['units'] == 2 and quote['cost'] == 4000
    status, express = guest.request('/api/express/book', booking(pickup='gbagada', dropoff='magodo', quotedCost=4000))
    assert status == 201 and express['units'] == 2
    deliveries = requests(['magodo'] * 3, pickup='gbagada')
    _, batch_quote = vendor.request('/api/batch-delivery-quote', {'deliveries': deliveries})
    assert batch_quote['originalUnits'] == 6
    status, batch = vendor.request('/api/batch-delivery-request', {'deliveries': deliveries, 'quoteToken': batch_quote['quoteToken']})
    assert status == 201 and all(item['pricing']['originalUnits'] == 2 for item in batch['deliveries'])
    status, single = vendor.request('/api/delivery-request', deliveries[0])
    assert status == 201 and single['delivery']['units'] == 2
    orders = copy.deepcopy(server.load_deliveries())
    draft = copy.deepcopy(initial['config'])
    set_units(draft, 'mainland-south-east', 'mainland-east', 3)
    status, preview = owner.request('/api/admin/batch-routing/preview', {'config': draft, 'deliveries': deliveries})
    assert status == 200 and preview['originalUnits'] == 9
    assert guest.request('/api/calculate', {'pickup': 'gbagada', 'dropoff': 'magodo'})[1]['units'] == 2
    assert vendor.request('/api/admin/batch-routing', {'config': draft, 'version': initial['version']})[0] == 403
    status, saved = owner.request('/api/admin/batch-routing', {'config': draft, 'version': initial['version']})
    assert status == 200 and server.load_batch_routing() == saved['config'] == draft
    assert guest.request('/api/calculate', {'pickup': 'magodo', 'dropoff': 'gbagada'})[1]['units'] == 3
    assert server.load_deliveries() == orders
    assert vendor.request('/api/batch-delivery-request', {'deliveries': deliveries, 'quoteToken': batch_quote['quoteToken']})[0] == 409
    print('PASS: admin/public zones, public/express/single/batch prices, draft previews, permissions, saved edits, stale quotes and unchanged booking snapshots.', flush=True)


if __name__ == '__main__':
    server.DATABASE = None
    with tempfile.TemporaryDirectory(prefix='apexwings-south-check-') as directory:
        fixtures(directory)
        migration_checks()
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            api_checks(httpd.server_port)
        finally:
            httpd.shutdown(); httpd.server_close()
