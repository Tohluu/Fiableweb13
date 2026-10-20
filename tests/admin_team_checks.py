"""Admin team lifecycle and recovery checks; temporary records and mocked email only."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from batch_delivery_checks import fixtures, login, PASSWORD
from rider_portal_checks import Client


def token_from(message):
    url = re.search(r'https://example.test/admin-login.html#\S+', message[2]).group()
    return parse_qs(urlparse(url).fragment)['reset'][0]


def reset(client, token, password='New-admin-password-2026'):
    return client.request('/api/admin/reset-password', {
        'token': token, 'password': password, 'confirmPassword': password,
    })


def smtp_checks():
    settings = {'SMTP_HOST': 'smtp.example.test', 'EMAIL_FROM': 'accounts@example.test',
                'SMTP_USERNAME': 'test', 'SMTP_PASSWORD': 'test', 'SMTP_SECURITY': 'starttls',
                'SMTP_PORT': '587', 'APP_BASE_URL': 'https://example.test'}
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.send_message.return_value = {}
    with patch.dict(os.environ, settings), patch.object(server, 'EMAIL_PROVIDER', 'smtp'):
        with patch.object(server.smtplib, 'SMTP', return_value=connection) as factory:
            assert server.admin_email_ready()
            assert server.NotificationService._send_email('test@example.test', 'Test', 'Body')['sent']
            factory.assert_called_once_with('smtp.example.test', 587, timeout=15)
            connection.starttls.assert_called_once()
            connection.login.assert_called_once_with('test', 'test')
        with patch.dict(os.environ, {'SMTP_SECURITY': 'ssl', 'SMTP_PORT': '465'}):
            with patch.object(server.smtplib, 'SMTP_SSL', return_value=connection) as factory:
                assert server.NotificationService._send_email('test@example.test', 'Test', 'Body')['sent']
                assert factory.call_args.kwargs['context'].check_hostname
        with patch.object(server.smtplib, 'SMTP', side_effect=OSError('Test failure')):
            assert not server.NotificationService._send_email('test@example.test', 'Test', 'Body')['sent']
        for invalid in [{'SMTP_SECURITY': 'none'}, {'APP_BASE_URL': 'http://example.test'},
                        {'APP_BASE_URL': 'https://example.test/?next=bad'}, {'SMTP_PORT': 'bad'}]:
            with patch.dict(os.environ, invalid):
                assert not server.admin_email_ready()
    print('PASS: SMTP STARTTLS/SSL transport, verified TLS, configuration validation and delivery failure.', flush=True)


def checks(port, messages):
    owner = login(port, 'owner@example.test', admin=True)
    guest = Client(port)
    status, initial = owner.request('/api/admin/team')
    assert status == 200 and initial['emailReady'] and initial['roles']['staff']['permissions']
    assert initial['admins'][0]['lastLoginAt']
    assert guest.request('/api/admin/team')[0] == 403
    role_changes = {'email': 'member@example.test', 'name': 'Test member', 'role': 'dispatcher', 'password': PASSWORD}
    assert owner.request('/api/admin/team/add', role_changes)[0] == 201
    member = login(port, 'member@example.test', admin=True)
    assert member.request('/api/admin/orders')[0] == 403, 'Temporary-password gate must apply'
    assert member.request('/api/admin/change-password', {'currentPassword': PASSWORD, 'newPassword': 'Changed-member-password'})[0] == 200
    assert member.request('/api/admin/account')[0] == 200, 'Password change rotates the current session'
    assert member.request('/api/admin/team/add', {**role_changes, 'email': 'denied@example.test'})[0] == 403
    assert owner.request('/api/admin/team/role', {'email': 'member@example.test', 'role': 'super_admin'})[0] == 200
    assert member.request('/api/admin/account')[0] == 401
    assert owner.request('/api/admin/team/role', {'email': 'member@example.test', 'role': 'finance'})[0] == 200
    audit = [event for event in server.load_json_list(server.AUDIT_LOG_FILE) if event['action'] == 'admin_role_changed']
    assert (audit[-1]['previousValue'], audit[-1]['newValue']) == ('super_admin', 'finance')
    for action in ['role', 'revoke', 'delete']:
        assert owner.request('/api/admin/team/' + action, {'email': 'owner@example.test', 'role': 'finance'})[0] == 400
    assert owner.request('/api/admin/team/add', {**role_changes, 'email': 'other-super@example.test', 'role': 'super_admin'})[0] == 201
    other = login(port, 'other-super@example.test', admin=True)
    assert other.request('/api/admin/change-password', {'currentPassword': PASSWORD, 'newPassword': 'Other-super-password'})[0] == 200
    assert other.request('/api/admin/team/delete', {'email': 'owner@example.test'})[0] == 400
    assert owner.request('/api/admin/team/revoke', {'email': 'other-super@example.test'})[0] == 200
    assert other.request('/api/admin/account')[0] == 401
    assert owner.request('/api/admin/team/restore', {'email': 'other-super@example.test'})[0] == 200
    assert owner.request('/api/admin/team/delete', {'email': 'other-super@example.test'})[0] == 200

    # Public recovery never discloses a link, even in production or without email.
    server.LOGIN_ATTEMPTS.clear()
    existing = guest.request('/api/admin/forgot-password', {'email': 'member@example.test'})
    missing = guest.request('/api/admin/forgot-password', {'email': 'missing@example.test'})
    assert existing == missing and existing[0] == 202
    assert 'resetLink' not in existing[1]
    token = token_from(messages[-1])
    stored = server.load_reset_tokens()
    assert token not in json.dumps(stored)
    assert 'admin:' + hashlib.sha256(token.encode()).hexdigest() in stored
    assert server.verify_reset_token(token) is None, 'Admin links must not work as customer/rider reset links'
    legacy = server.create_reset_token('member@example.test')
    assert reset(guest, legacy)[0] == 400, 'Legacy shared tokens must not reset admins'
    member = Client(port)
    assert member.request('/api/admin/login', {'email': 'member@example.test', 'password': 'Changed-member-password'})[0] == 200
    challenge = server.create_mfa_challenge('member@example.test')
    assert reset(guest, token)[0] == 200
    assert reset(guest, token)[0] == 400
    assert member.request('/api/admin/account')[0] == 401
    assert challenge not in server.ADMIN_MFA_CHALLENGES
    assert guest.request('/api/admin/login', {'email': 'member@example.test', 'password': 'New-admin-password-2026'})[0] == 200
    assert guest.request('/api/admin/account')[1]['mfaEnabled'] is False

    # Recovery changes the password, while preserving the second factor.
    admins = server.load_admin_credentials()
    secret = server.generate_totp_secret()
    admins.append({'id': 99, 'email': 'mfa@example.test', 'name': 'MFA fixture', 'role': 'analyst',
                   'status': 'active', 'salt': 'test-salt', 'passwordHash': server.password_hash(PASSWORD, 'test-salt'),
                   'mfaEnabled': True, 'mfaSecret': secret})
    server.save_admin_credentials(admins)
    mfa = Client(port)
    status, challenge = mfa.request('/api/admin/login', {'email': 'mfa@example.test', 'password': PASSWORD})
    assert status == 200 and challenge['mfaRequired'] and mfa.request('/api/admin/account')[0] == 401
    code = server._totp_code_at(secret, time.time())
    assert mfa.request('/api/admin/mfa/verify-login', {'challengeToken': challenge['challengeToken'], 'code': code})[0] == 200
    assert mfa.request('/api/admin/account')[0] == 200
    assert next(admin for admin in server.load_admin_credentials() if admin['email'] == 'mfa@example.test')['lastLoginAt']
    assert owner.request('/api/admin/team/reset-password', {'email': 'mfa@example.test'})[0] == 200
    assert reset(Client(port), token_from(messages[-1]))[0] == 200
    assert mfa.request('/api/admin/account')[0] == 401
    mfa_after = Client(port)
    assert mfa_after.request('/api/admin/login', {'email': 'mfa@example.test', 'password': 'New-admin-password-2026'})[1]['mfaRequired']
    assert mfa_after.request('/api/admin/account')[0] == 401

    invite = {'email': 'invite@example.test', 'name': 'Invited member', 'role': 'operations_manager', 'invite': True}
    assert owner.request('/api/admin/team/add', invite)[0] == 201
    token1 = token_from(messages[-1])
    assert next(admin for admin in server.load_admin_credentials() if admin['email'] == invite['email'])['status'] == 'invited'
    assert owner.request('/api/admin/team/resend-invitation', {'email': invite['email']})[0] == 200
    token2 = token_from(messages[-1])
    server.LOGIN_ATTEMPTS.clear()
    assert reset(Client(port), token1)[0] == 400
    assert reset(Client(port), token2, 'Invited-admin-password')[0] == 200
    invited = Client(port)
    assert invited.request('/api/admin/login', {'email': invite['email'], 'password': 'Invited-admin-password'})[0] == 200
    assert invited.request('/api/admin/account')[1]['mustChangePassword'] is False
    assert owner.request('/api/admin/team/reset-password', {'email': invite['email']})[0] == 200
    expired = token_from(messages[-1]); tokens = server.load_reset_tokens()
    tokens['admin:' + hashlib.sha256(expired.encode()).hexdigest()]['expiresAt'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    server.save_reset_tokens(tokens)
    assert reset(Client(port), expired)[0] == 400
    assert owner.request('/api/admin/team/reset-password', {'email': invite['email']})[0] == 200
    revoked = token_from(messages[-1])
    assert owner.request('/api/admin/team/revoke', {'email': invite['email']})[0] == 200
    assert reset(Client(port), revoked)[0] == 400
    assert invited.request('/api/admin/account')[0] == 401

    with patch.object(server, 'admin_email_ready', return_value=False):
        before = copy.deepcopy(server.load_admin_credentials())
        assert owner.request('/api/admin/team/add', {**invite, 'email': 'unavailable@example.test'})[0] == 503
        assert server.load_admin_credentials() == before
        assert owner.request('/api/admin/team/reset-password', {'email': 'member@example.test'})[0] == 503
        assert Client(port).request('/api/admin/forgot-password', {'email': 'member@example.test'}) == existing
    with patch.object(server.NotificationService, '_send_email', return_value={'sent': False, 'reason': 'test_failure'}):
        assert owner.request('/api/admin/team/add', {**invite, 'email': 'failed@example.test'})[0] == 201
        failed = next(admin for admin in server.load_admin_credentials() if admin['email'] == 'failed@example.test')
        assert failed['status'] == 'invited' and failed['invitationStatus'] == 'failed'
        assert not any(data.get('email') == failed['email'] for data in server.load_reset_tokens().values())

    def add(_):
        actor = login(port, 'owner@example.test', admin=True)
        return actor.request('/api/admin/team/add', {**role_changes, 'email': 'concurrent@example.test'})[0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(add, range(2))) == [201, 400]
    assert sum(admin['email'] == 'concurrent@example.test' for admin in server.load_admin_credentials()) == 1
    server.LOGIN_ATTEMPTS.clear()
    for _ in range(server.LOGIN_ATTEMPT_MAX + 2):
        assert Client(port).request('/api/admin/forgot-password', {'email': 'unknown@example.test'}) == existing
    safe = owner.request('/api/admin/team')[1]
    assert all(not {'passwordHash', 'salt', 'mfaSecret', 'credentialVersion'}.intersection(admin) for admin in safe['admins'])
    print('PASS: roles and owner protections, audit history, password/session rotation, generic recovery, purpose-bound hashed tokens, one use/expiry/revocation, invitations/resend, SMTP failures, rate limits, concurrent creation and safe team responses.', flush=True)


if __name__ == '__main__':
    server.DATABASE = None
    server.APP_ENV = 'production'
    smtp_checks()
    messages = []
    def email(to, subject, body):
        messages.append((to, subject, body))
        return {'sent': True, 'reason': 'test_accepted'}
    class QuietHandler(server.FiableHandler):
        def log_message(self, *args):
            pass
    with tempfile.TemporaryDirectory(prefix='apexwings-team-check-') as directory:
        fixtures(directory)
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            with patch.dict(os.environ, {'APP_BASE_URL': 'https://example.test'}), patch.object(server, 'admin_email_ready', return_value=True), patch.object(server.NotificationService, '_send_email', side_effect=email):
                checks(httpd.server_port, messages)
        finally:
            httpd.shutdown(); httpd.server_close()
