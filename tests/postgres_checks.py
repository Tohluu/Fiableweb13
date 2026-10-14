"""Integration tests against disposable databases on a local PostgreSQL server.

FIABLE_TEST_DATABASE_URL must point to a localhost postgres maintenance DB.
This script creates its own random database and never resets an existing one.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from urllib.parse import urlparse, urlunparse
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psycopg
from psycopg import sql
import server
from database import PostgresStore, DatabaseUnavailable
from manage_database import load_source, import_source, export_snapshot
import batch_delivery_checks
import rider_portal_checks
from rider_portal_checks import Client, PNG


@contextmanager
def test_database():
    url = os.environ.get('FIABLE_TEST_DATABASE_URL', '')
    parsed = urlparse(url)
    if parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or parsed.path != '/postgres':
        raise RuntimeError('Use a local PostgreSQL maintenance database in FIABLE_TEST_DATABASE_URL.')
    name = 'fiable_test_' + uuid.uuid4().hex
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    database_url = urlunparse(parsed._replace(path='/' + name))
    try:
        store = PostgresStore(database_url)
        store.initialize()
        yield store
    finally:
        with psycopg.connect(url, autocommit=True) as connection:
            # Only the random database created by this invocation is removed.
            assert name.startswith('fiable_test_') and len(name) == 44
            connection.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


@contextmanager
def http_server(handler=server.FiableHandler):
    httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown(); httpd.server_close()


def storage_checks(store):
    store.initialize()  # Additive schema is safe on subsequent boots.
    assert store.health() == {'reachable': True, 'writable': True}
    assert not store.exists('accounts.json')
    records = [{'email': 'one@example.test', 'name': 'One'}, {'email': 'two@example.test', 'name': 'Two'}]
    store.write('accounts.json', records)
    assert store.read('accounts.json') == records
    store.write('reset_tokens.json', {'reset-key': {'email': 'one@example.test', 'expiresAt': 'test'}})
    assert store.read('reset_tokens.json')['reset-key']['email'] == 'one@example.test'
    try:
        with store.transaction():
            store.write('accounts.json', [])
            store.write('riders.json', [{'id': 1}])
            raise RuntimeError('Rollback test')
    except RuntimeError:
        pass
    assert store.read('accounts.json') == records and not store.exists('riders.json')
    store.write('accounts.json', records[:1])
    assert store.read('accounts.json') == records[:1]
    store.write('accounts.json', [])
    assert store.exists('accounts.json') and store.read('accounts.json') == []
    store.write('batch_routing.json', {'counter': 0})
    def increment(_):
        independent = PostgresStore(store._url)
        for _ in range(5):
            with independent.transaction():
                value = independent.read('batch_routing.json')
                value['counter'] += 1
                independent.write('batch_routing.json', value)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(increment, range(8)))
    assert store.read('batch_routing.json')['counter'] == 40
    try:
        PostgresStore('postgresql://not_a_user:private-password@127.0.0.1:1/postgres').read('accounts.json')
    except DatabaseUnavailable as error:
        assert 'private-password' not in str(error)
    else:
        raise AssertionError('Unavailable database unexpectedly succeeded')
    print('PASS: PostgreSQL schema, list/map round trips, deletion, rollback, independent-connection concurrency and safe failure.', flush=True)


def migration_checks(store, directory):
    source = Path(directory) / 'source'; source.mkdir()
    fixtures = {
        'accounts': [{'email': 'import@example.test', 'name': 'Imported', 'salt': 'salt', 'passwordHash': 'hash', 'subscriberId': 'FL-SUB-0099'}],
        'admin_credentials': {'email': 'owner@example.test', 'salt': 'salt', 'passwordHash': 'hash'},
        'deliveries': [{'id': 9, 'trackingCode': 'KEEP-THIS', 'proofOfDelivery': {'photoPath': '9-photo-test.png'}}],
        'reset_tokens': {'key': {'email': 'import@example.test'}},
        'batch_routing': server.default_batch_routing(),
    }
    for name, value in fixtures.items():
        (source / (name + '.json')).write_text(json.dumps(value), encoding='utf-8')
    proof = __import__('base64').b64decode(PNG.split(',', 1)[1])
    (source / 'proof').mkdir(); (source / 'proof' / '9-photo-test.png').write_bytes(proof)
    documents, proofs = load_source(source)
    import_source(store, documents, proofs)
    for name, expected in fixtures.items():
        assert store.read(name + '.json') == expected
    assert store.read_blob('9-photo-test.png') == (proof, 'image/png')
    try:
        import_source(store, documents, proofs)
    except ValueError:
        pass
    else:
        raise AssertionError('Import overwrote a populated database')
    exported = Path(directory) / 'exported'
    assert export_snapshot(store, exported) == (len(fixtures), 1)
    exported_documents, exported_proofs = load_source(exported)
    assert exported_documents == documents and exported_proofs == proofs
    assert (exported / 'manifest.json').is_file()
    assert (source / 'accounts.json').read_text() == json.dumps(fixtures['accounts'])
    with test_database() as restored:
        import_source(restored, exported_documents, exported_proofs)
        assert restored.read('deliveries.json') == fixtures['deliveries']
    (exported / 'accounts.json').write_text('[]', encoding='utf-8')
    try:
        load_source(exported)
    except ValueError as error:
        assert 'checksum' in str(error)
    else:
        raise AssertionError('Tampered backup passed checksum verification')
    print('PASS: verified import/export/restore, legacy admin shape, passwords/IDs/tracking preservation, proof bytes and nonempty-target refusal.', flush=True)


def app_checks(store, directory):
    server.DATABASE = store
    batch_delivery_checks.fixtures(directory)
    batch_delivery_checks.pricing_checks()
    with http_server() as port:
        batch_delivery_checks.api_checks(port)
        assert Client(port).request('/api/health')[0] == 200
        owner = batch_delivery_checks.login(port, 'owner@example.test', admin=True)
        vendor = batch_delivery_checks.login(port)
        page = owner.opener.open(owner.base + '/admin.html')
        assert page.status == 200 and b'Fiable Admin Portal' in page.read()
        config = owner.request('/api/admin/batch-routing')[1]
        config['config']['locations'].append({'id': 'ogudu', 'label': 'Ogudu', 'zone': 'mainland-east'})
        next(area for area in config['config']['areas'] if area['id'] == 'ikeja')['locations'].append('ogudu')
        assert owner.request('/api/admin/batch-routing', {'config': config['config'], 'version': config['version']})[0] == 200
        assert any(location['id'] == 'ogudu' for location in vendor.request('/api/locations')[1]['locations'])
        assert vendor.request('/api/calculate', {'pickup': 'egbeda', 'dropoff': 'ogudu'})[1]['units'] == 3
        assert vendor.request('/api/delivery-request', batch_delivery_checks.requests(['ogudu'])[0])[0] == 201
        assert all(not path.exists() for path in Path(directory).glob('*.json'))
    rider_portal_checks.fixtures(directory)
    with http_server() as port:
        rider_portal_checks.checks(port)
        order = next(order for order in server.load_deliveries() if order['id'] == 1)
        filename = order['proofOfDelivery']['photoPath']
        content, mime = store.read_blob(filename)
        assert mime == 'image/png' and content == __import__('base64').b64decode(PNG.split(',', 1)[1])
        assert not (server.PROOF_DIR / filename).exists()
        owner = batch_delivery_checks.login(port, 'owner@example.test', admin=True)
        response = owner.opener.open(owner.base + '/api/proof/' + filename)
        assert response.status == 200 and response.read() == content
    # A fresh storage object sees all committed records after a simulated restart.
    fresh = PostgresStore(store._url)
    assert fresh.read('deliveries.json') == store.read('deliveries.json')
    assert fresh.read_blob(filename) == (content, mime)
    print('PASS: real database-backed customer/admin/rider APIs, concurrent balance checks, locations, proof retrieval and restart persistence.', flush=True)


def commit_failure_check(store):
    class CommitFailureHandler(server.FiableHandler):
        def _do_POST(self):
            server.atomic_write_json(server.DATA_FILE, [{'id': 1, 'type': 'test'}])
            self._json_response(201, {'message': 'Must not reach the client'})
    with store.transaction() as connection:
        connection.execute("CREATE FUNCTION fiable.reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test commit rejection'; END $$")
        connection.execute("CREATE CONSTRAINT TRIGGER reject_commit AFTER INSERT ON fiable.submissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fiable.reject_commit()")
    before = store.read('submissions.json') if store.exists('submissions.json') else None
    with http_server(CommitFailureHandler) as port:
        status, result = Client(port).request('/test-commit-failure', {})
        assert status == 503 and 'Must not reach' not in result.get('message', '')
    assert (store.read('submissions.json') if store.exists('submissions.json') else None) == before
    print('PASS: a failed commit rolls back changes and replaces the buffered success response with HTTP 503.', flush=True)


if __name__ == '__main__':
    original = server.DATABASE
    try:
        with tempfile.TemporaryDirectory(prefix='fiable-postgres-check-') as directory:
            with test_database() as store:
                storage_checks(store)
            with test_database() as store:
                migration_checks(store, directory)
            with test_database() as store:
                app_checks(store, directory)
                commit_failure_check(store)
    finally:
        server.DATABASE = original
