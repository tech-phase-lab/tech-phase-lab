import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('nonempty', Path(__file__).parents[1] / 'scripts/resolute/nonempty_restore_acceptance.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class NonemptyAcceptanceTests(unittest.TestCase):
    def test_synthetic_identity_and_exact_ledger(self):
        user = 'user_acceptance' + 'a' * 32
        self.assertEqual(m.checked_user(user), user)
        for value in ['user_customer', user + "'", None, 'user_acceptance']:
            with self.assertRaises(RuntimeError):
                m.checked_user(value)
        ledger = dict(deletions=[dict(userId=user, revision=1)], suppressions=[dict(userId=user, revision=2, kind='alerts'), dict(userId=user, revision=3, kind='morning')])
        m.validate_ledger(ledger, user)
        ledger['suppressions'].reverse()
        m.validate_ledger(ledger, user)
        ledger['suppressions'].pop()
        with self.assertRaises(RuntimeError):
            m.validate_ledger(ledger, user)

    def test_both_stops_and_pending_must_be_checked(self):
        protected = dict(planPresent=False, planRevision=1, alertsEnabled=False, morningEnabled=False, settingsRevision=3, deletions=1, suppressions=2, pending=0)
        m.verify_state(protected, True)
        for field, value in [('planPresent', True), ('alertsEnabled', True), ('morningEnabled', True), ('pending', 1), ('deletions', 0), ('suppressions', 1)]:
            with self.assertRaises(RuntimeError):
                m.verify_state(dict(protected, **{field: value}), True)
        m.verify_state(dict(planPresent=True, planRevision=1, alertsEnabled=True, morningEnabled=True, settingsRevision=1, deletions=0, suppressions=0, pending=1), False)
