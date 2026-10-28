import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('inventory_audit', Path(__file__).resolve().parents[1] / 'scripts/tech-phase/audit_external_inventory.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def item(key='tech-phase/research/v1/dumps/private-user-identifier.aesgcm'):
    return {'Key': key, 'Size': 100, 'ETag': 'opaque-etag',
            'LastModified': datetime(2026, 10, 23, tzinfo=timezone.utc)}


class Store:
    def __init__(self, objects=()):
        self.objects = list(objects)
        self.calls = []

    def list_objects_v2(self, **args):
        self.calls.append(args)
        return {'IsTruncated': False, 'Contents': copy.deepcopy([
            x for x in self.objects if x['Key'].startswith(args['Prefix'])])}


class InventoryTests(unittest.TestCase):
    def test_presence_never_claims_restore_or_freshness_and_redacts_identifiers(self):
        store = Store([item()])
        result = audit.audit(store, 'fixture')
        self.assertEqual(len(store.calls), len(audit.PREFIXES) * 2)
        self.assertEqual(result['scopes']['research_database']['objects'], 1)
        self.assertEqual(result['scopes']['research_database']['bytes'], 100)
        for flag in ('restore_verified', 'manifest_verified', 'ciphertext_verified',
                     'source_data_freshness_verified', 'writer_fence_verified',
                     'saving_activation_allowed', 'whole_bucket_inventory'):
            self.assertIs(result[flag], False)
        self.assertNotIn('private-user-identifier', json.dumps(result))
        self.assertNotIn('opaque-etag', json.dumps(result))

    def test_empty_result_is_observation_not_successful_backup(self):
        result = audit.audit(Store(), 'fixture')
        self.assertEqual(result['listed_objects'], 0)
        self.assertTrue(all(x['presence'] == 'no-objects-in-listed-prefix' for x in result['scopes'].values()))
        self.assertFalse(result['restore_verified'])

    def test_non_data_images_do_not_count_as_database_objects(self):
        result = audit.audit(Store([item('tech-phase/runtime/v1/fixture/image.aesgcm'),
                                    item('tech-phase/source/v1/fixture/source.aesgcm')]), 'fixture')
        self.assertEqual(result['scopes']['runtime']['objects'], 1)
        for name in ('research_database', 'resolute_database', 'billing_sandbox_database', 'protection_history'):
            self.assertEqual(result['scopes'][name]['objects'], 0)

    def test_pagination_reads_every_page(self):
        store = Store()
        original = store.list_objects_v2
        prefix = audit.PREFIXES['research_database']
        def pages(**args):
            if args['Prefix'] != prefix:
                return original(**args)
            if 'ContinuationToken' not in args:
                return {'IsTruncated': True, 'NextContinuationToken': 'next', 'Contents': [item(prefix+'a')]}
            self.assertEqual(args['ContinuationToken'], 'next')
            return {'IsTruncated': False, 'Contents': [item(prefix+'b')]}
        store.list_objects_v2 = pages
        self.assertEqual(audit.audit(store, 'fixture')['scopes']['research_database']['objects'], 2)

    def test_mutation_between_passes_is_rejected(self):
        store = Store([item()])
        original = store.list_objects_v2
        def changing(**args):
            if len(store.calls) == len(audit.PREFIXES):
                store.objects[0]['ETag'] = 'changed'
            return original(**args)
        store.list_objects_v2 = changing
        with self.assertRaises(ValueError):
            audit.audit(store, 'fixture')

    def test_denied_list_is_not_empty_inventory(self):
        class Denied:
            def list_objects_v2(self, **args):
                raise PermissionError('fixture denied')
        with self.assertRaises(PermissionError):
            audit.audit(Denied(), 'fixture')

    def test_incomplete_repeated_or_unexpected_continuation_rejected(self):
        for page in ({}, {'IsTruncated': True},
                     {'IsTruncated': False, 'NextContinuationToken': 'unexpected'},
                     {'IsTruncated': True, 'NextContinuationToken': 'repeated'}):
            class Broken:
                def list_objects_v2(self, **args):
                    return page
            with self.subTest(page=page), self.assertRaises(ValueError):
                audit.audit(Broken(), 'fixture')

    def test_bad_duplicate_and_out_of_prefix_metadata_rejected(self):
        for change in ({'Size': True}, {'Size': -1}, {'ETag': ''},
                       {'LastModified': datetime(2026, 10, 23)}, {'Key': 'elsewhere/private'}):
            bad = item(); bad.update(change)
            class Broken:
                def list_objects_v2(self, **args):
                    return {'IsTruncated': False, 'Contents': [bad]}
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit.audit(Broken(), 'fixture')
        with self.assertRaises(ValueError):
            audit.audit(Store([item(), item()]), 'fixture')

    def test_caps_fail_instead_of_reporting_partial_results(self):
        with patch.object(audit, 'MAX_OBJECTS', 0), self.assertRaises(ValueError):
            audit.audit(Store([item()]), 'fixture')
        with patch.object(audit, 'MAX_PAGES', 0), self.assertRaises(ValueError):
            audit.audit(Store(), 'fixture')

    def test_explicit_r2_gate_without_encryption_key(self):
        env = {'TECH_PHASE_EXTERNAL_INVENTORY_ENABLED': 'true'}
        values = {'ENDPOINT': 'https://'+'a'*32+'.r2.cloudflarestorage.com',
                  'BUCKET': 'resolute-backup-external', 'REGION': 'auto',
                  'ACCESS_KEY_ID': 'fixture', 'SECRET_ACCESS_KEY': 'fixture'}
        env.update({'MIRROR_DESTINATION_'+k: v for k, v in values.items()})
        self.assertEqual(audit.configuration(env), values)
        for key, value in [('TECH_PHASE_EXTERNAL_INVENTORY_ENABLED', 'false'),
                           ('MIRROR_DESTINATION_BUCKET', 'other-bucket'),
                           ('MIRROR_DESTINATION_ENDPOINT', 'https://example.com'),
                           ('MIRROR_DESTINATION_ENDPOINT', values['ENDPOINT']+'/?credential=bad')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit.configuration({**env, key: value})


if __name__ == '__main__':
    unittest.main()
