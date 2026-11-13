"""HTTP profile checks using temporary storage only."""
import os
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def checks():
    with tempfile.TemporaryDirectory(prefix='apex-profile-') as directory:
        os.environ['DATA_DIR'] = directory
        os.environ.pop('DATABASE_URL', None)
        import server
        from batch_delivery_checks import fixtures, PASSWORD
        from rider_portal_checks import Client
        fixtures(directory)
        server.save_submission('vendor', {
            'email': 'batch@example.test', 'phone': '08012345678',
            'businessName': 'Original Store', 'businessType': 'Retail',
            'businessAddress': '10 Old Street, Lagos',
        })
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.FiableHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            client = Client(httpd.server_port)
            payload = dict(name='Updated Vendor', phone='+234 801 234 5678',
                           businessName='Updated Store', businessType='Other',
                           otherBusinessType='Pet supplies', businessAddress='24 New Road\nIkeja, Lagos')
            assert client.request('/api/account/profile', payload)[0] == 401
            status, account = client.request('/api/login', {'email': 'batch@example.test', 'password': PASSWORD})
            assert status == 200 and account['businessName'] == 'Original Store'
            assert client.request('/api/account/summary')[1]['phone'] == '08012345678'
            before = server.load_accounts()
            for field in ('name', 'phone', 'businessName', 'businessType', 'businessAddress'):
                bad = dict(payload, **{field: '   '})
                assert client.request('/api/account/profile', bad)[0] == 400, field
            assert client.request('/api/account/profile', dict(payload, otherBusinessType=' '))[0] == 400
            assert client.request('/api/account/profile', dict(payload, phone='invalid'))[0] == 400
            assert server.load_accounts() == before
            status, updated = client.request('/api/account/profile', dict(payload, email='unpaid@example.test', plan='Business', paymentStatus='paid'))
            assert status == 200, updated
            assert updated['email'] == 'batch@example.test'
            assert updated['businessType'] == 'Pet supplies'
            for field in ('name', 'phone', 'businessName', 'businessAddress'):
                assert updated[field] == payload[field]
            assert 'passwordHash' not in updated and 'salt' not in updated
            after = server.load_accounts()
            for original, current in zip(before, after):
                if original['email'] != 'batch@example.test':
                    assert original == current
                else:
                    for field in ('email', 'plan', 'paymentStatus', 'subscriberId', 'passwordHash'):
                        assert original[field] == current[field]
            assert client.request('/api/account/summary')[1]['businessName'] == 'Updated Store'
            owner = Client(httpd.server_port)
            assert owner.request('/api/admin/login', {'email': 'owner@example.test', 'password': PASSWORD})[0] == 200
            vendors = owner.request('/api/admin/summary')[1]['vendors']['items']
            assert next(v for v in vendors if v['email'] == updated['email'])['businessAddress'] == payload['businessAddress']
            client.request('/api/logout', {})
            assert client.request('/api/account/profile', payload)[0] == 401
            print('PASS: legacy profile display, required fields, persistence, custom type, admin visibility, session isolation and protected account fields.')
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    checks()
