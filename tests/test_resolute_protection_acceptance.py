import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('protection_acceptance', Path(__file__).resolve().parents[1] / 'scripts/resolute/protection_acceptance.py')
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class AcceptanceIsolationTests(unittest.TestCase):
    def test_disabled_entry_stops_before_optional_clients(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(RuntimeError, 'acceptance only'):
            acceptance.main()

    def test_all_connection_variants_rejected(self):
        for name in ('PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE',
                     'PGOPTIONS', 'DATABASE_URL', 'DATABASE_PRIVATE_URL',
                     'RESOLUTE_PLAN_DB_URL', 'RESOLUTE_NOTIFICATION_DB_URL',
                     'ENTITLEMENT_DB_URL', 'RESOLUTE_PROTECTION_DB_URL', 'SOURCE_DATABASE_URL'):
            with self.subTest(name=name):
                env = {'RESOLUTE_PROTECTION_ACCEPTANCE_ONLY': 'true', name: 'private-value'}
                with patch.dict(os.environ, env, clear=True), self.assertRaises(RuntimeError) as caught:
                    acceptance.main()
                self.assertNotIn('private-value', str(caught.exception))

    def test_synthetic_environment_allowed(self):
        acceptance.validate_environment({'RESOLUTE_PROTECTION_ACCEPTANCE_ONLY': 'true',
                                         'BACKUP_BUCKET': 'synthetic', 'DATABASE_URL': ''})

    def state(self, protected):
        return dict(plans=1, planPresent=not protected, planRevision=2 if protected else 1,
                    alertsEnabled=not protected, morningEnabled=not protected,
                    settingsRevision=2 if protected else 1, pending=0 if protected else 1)

    def verify(self, state, protected):
        def sql(query, database):
            self.assertEqual(database, 'resolute_restore_test')
            return json.dumps(state).encode()
        acceptance.verify_restore_state(sql, protected=protected)

    def test_stale_backup_and_protected_states(self):
        for protected in (False, True):
            self.verify(self.state(protected), protected)

    def test_already_clean_backup_is_not_restore_evidence(self):
        with self.assertRaises(RuntimeError):
            self.verify(self.state(True), False)

    def test_partial_replay_or_leftover_queue_fails(self):
        for field, value in self.state(False).items():
            if value == self.state(True)[field]:
                continue
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.verify(dict(self.state(True), **{field: value}), True)

    def test_missing_fixture_fails(self):
        for protected in (False, True):
            with self.assertRaises(RuntimeError):
                self.verify(dict(self.state(protected), plans=0, planPresent=None), protected)
