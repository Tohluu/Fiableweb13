"""Check the actual admin summary path without loading or modifying app state."""
import ast
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class VendorContactChecks(unittest.TestCase):
    def test_business_address_is_required(self):
        tree = ast.parse((ROOT / 'server.py').read_text(encoding='utf-8'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name == 'registration_business_address']
        scope = {}
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<address>', 'exec'), scope)
        resolve = scope['registration_business_address']
        for value in (None, '', '   ', 'x' * 501):
            with self.assertRaises(ValueError):
                resolve({'businessAddress': value})
        self.assertEqual(resolve({'businessAddress': '  12 Example Street\nIkeja, Lagos  '}),
                         '12 Example Street\nIkeja, Lagos')

    def test_other_business_type_requires_specific_answer(self):
        tree = ast.parse((ROOT / 'server.py').read_text(encoding='utf-8'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name == 'registration_business_type']
        scope = {'clean': lambda value, limit: str(value or '').strip()[:limit]}
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<registration>', 'exec'), scope)
        resolve = scope['registration_business_type']
        for answer in ('', '   ', 'Other', 'Others'):
            with self.assertRaises(ValueError):
                resolve({'businessType': 'Other', 'otherBusinessType': answer})
        self.assertEqual(resolve({'businessType': 'Other', 'otherBusinessType': '  Pet supplies  '}), 'Pet supplies')
        self.assertEqual(resolve({'businessType': 'Fashion', 'otherBusinessType': 'Old answer'}), 'Fashion')

    def test_admin_summary_recovers_saved_signup_phones(self):
        tree = ast.parse((ROOT / 'server.py').read_text(encoding='utf-8'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in {'admin_summary', 'admin_vendor_summaries', 'vendor_profile_details_for_accounts'}]
        submissions = json.loads((ROOT / 'data/submissions.json').read_text(encoding='utf-8-sig'))
        phones = {}
        business_types = {}
        business_names = {}
        for item in submissions:
            details = item.get('data') or {}
            if item.get('type') == 'vendor' and details.get('businessName'):
                business_names[details['email'].strip().lower()] = details['businessName'].strip()[:160]
            if item.get('type') == 'vendor' and details.get('businessType'):
                business_types[details['email'].strip().lower()] = details['businessType'].strip()[:120]
            if item.get('type') == 'vendor' and details.get('phone'):
                phones[details['email'].strip().lower()] = details['phone'].strip()[:40]
        self.assertTrue(phones, 'Expected saved signup phone numbers for regression check')
        accounts = [{'email': email} for email in phones]
        submissions += [{'type': 'vendor', 'data': {'email': 'legacy-address@example.test', 'businessAddress': '12 Example Street, Lagos'}}]
        accounts += [{'email': 'legacy-address@example.test'}]
        accounts += [{'email': 'missing@example.test'},
                     {'email': 'priority@example.test', 'phone': '+2348011111111', 'businessType': 'Fashion', 'businessName': 'Example Store', 'businessAddress': '24 Example Road, Lagos'}]
        scope = {
            'load_accounts': lambda: accounts,
            'load_deliveries': lambda: [],
            'DATA_FILE': 'unused',
            'load_json_list': lambda _: submissions,
            'clean': lambda value, limit: str(value or '').strip()[:limit],
            'summary_for_account': lambda account, profile: dict(profile,
                email=account['email'], subscriptionState='no_plan',
                unitsAllocated=0, unitsUsed=0, unitsRemaining=0),
        }
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<admin summary>', 'exec'), scope)
        result = scope['admin_summary']()
        actual = {row['email']: row['phone'] for row in result['vendors']['items']}
        for email, phone in phones.items():
            self.assertEqual(actual[email], phone)
        self.assertEqual(actual['missing@example.test'], '')
        self.assertEqual(actual['priority@example.test'], '+2348011111111')
        actual_types = {row['email']: row['businessType'] for row in result['vendors']['items']}
        for email in phones:
            self.assertEqual(actual_types[email], business_types.get(email, ''))
        self.assertEqual(actual_types['missing@example.test'], '')
        self.assertEqual(actual_types['priority@example.test'], 'Fashion')
        actual_names = {row['email']: row['businessName'] for row in result['vendors']['items']}
        for email in phones:
            self.assertEqual(actual_names[email], business_names.get(email, ''))
        self.assertEqual(actual_names['missing@example.test'], '')
        self.assertEqual(actual_names['priority@example.test'], 'Example Store')
        actual_addresses = {row['email']: row['businessAddress'] for row in result['vendors']['items']}
        self.assertEqual(actual_addresses['legacy-address@example.test'], '12 Example Street, Lagos')
        self.assertEqual(actual_addresses['priority@example.test'], '24 Example Road, Lagos')
        self.assertEqual(actual_addresses['missing@example.test'], '')
        self.assertEqual(result['vendors']['total'], len(accounts))


if __name__ == '__main__':
    unittest.main()
