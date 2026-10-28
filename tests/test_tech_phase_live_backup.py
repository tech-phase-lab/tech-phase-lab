"""PRO backups reject corruption, cross-product sources and connected restores."""
import datetime as dt
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('tech_phase_live_backup',
    Path(__file__).resolve().parents[1] / 'services/tech-phase-live-backup/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class TechPhaseLiveBackupTests(unittest.TestCase):
    def setUp(self):
        self.env = {'RAILWAY_GIT_BRANCH': 'codex/research-preview', 'TECH_PHASE_LIVE_BACKUP_ENABLED': 'true', 'TECH_PHASE_PAYPAL_ENV': 'live',
                    'TECH_PHASE_LIVE_BACKUP_BRANCH': 'codex/research-preview',
                    'TECH_PHASE_LIVE_BACKUP_MODE': 'restore-check'}
        self.key = bytes(range(32))
        self.object_key = backup.PREFIX + 'dumps/' + backup.stamp_now() + '.aesgcm'
        self.dump = b'PGDMP\x00test ledger with holds and periods'

    def manifest(self, cipher, object_key=None):
        return {'version': 1, 'key': object_key or self.object_key, 'bytes': len(cipher),
                'sha256': hashlib.sha256(cipher).hexdigest()}

    def test_cipher_roundtrip_random_nonce_and_no_plaintext(self):
        first = backup.seal(self.dump, self.key, self.object_key)
        second = backup.seal(self.dump, self.key, self.object_key)
        self.assertNotEqual(first, second)
        self.assertNotIn(self.dump, first)
        self.assertEqual(backup.unseal(first, self.key, self.manifest(first)), self.dump)

    def test_corruption_even_with_recomputed_digest_or_wrong_key_fails(self):
        cipher = backup.seal(self.dump, self.key, self.object_key)
        corrupt = cipher[:-1] + bytes([cipher[-1] ^ 1])
        for value, key, manifest in (
            (corrupt, self.key, self.manifest(cipher)),
            (corrupt, self.key, self.manifest(corrupt)),
            (cipher, bytes(32), self.manifest(cipher)),
            (cipher[:-1], self.key, self.manifest(cipher)),
        ):
            with self.assertRaises(Exception):
                backup.unseal(value, key, manifest)

    def test_archive_cannot_be_relabelled_as_fresh(self):
        old_key = backup.PREFIX + 'dumps/20200101T000000000000Z.aesgcm'
        cipher = backup.seal(self.dump, self.key, old_key)
        with self.assertRaises(Exception):
            backup.unseal(cipher, self.key, self.manifest(cipher))

    def test_manifest_scope_freshness_and_size(self):
        cipher = backup.seal(self.dump, self.key, self.object_key)
        for field, value in (
            ('key', 'resolute/v1/dumps/20200101T000000000000Z.aesgcm'),
            ('key', backup.PREFIX + 'dumps/20200101T000000000000Z.aesgcm'),
            ('key', backup.PREFIX + 'dumps/29990101T000000000000Z.aesgcm'),
            ('bytes', backup.MAX_BYTES + 29), ('bytes', True),
            ('sha256', 'z' * 64), ('version', 2),
        ):
            with self.subTest(field=field, value=value), self.assertRaises((RuntimeError, ValueError)):
                backup.validate_manifest({**self.manifest(cipher), field: value})

    def test_restore_rejects_source_credentials_before_any_commands(self):
        self.assertEqual(backup.validate_mode(self.env), 'restore-check')
        for name in ('PGHOST', 'PGSERVICE', 'PGPASSWORD', 'DATABASE_URL',
                     'TECH_PHASE_BILLING_SANDBOX_DATABASE_URL',
                     'TECH_PHASE_LIVE_BACKUP_DB_PASSWORD', 'TECH_PHASE_PAYPAL_CLIENT_SECRET'):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                backup.validate_mode({**self.env, name: 'source credential'})
        for name in ('TECH_PHASE_LIVE_BACKUP_ENABLED', 'TECH_PHASE_PAYPAL_ENV',
                     'TECH_PHASE_LIVE_BACKUP_BRANCH', 'TECH_PHASE_LIVE_BACKUP_MODE'):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                backup.validate_mode({**self.env, name: 'wrong'})

    def test_source_is_fixed_readonly_and_does_not_inherit_connection_overrides(self):
        env = backup.pg_env({'TECH_PHASE_LIVE_BACKUP_DB_PASSWORD': '01' * 32,
                             'TECH_PHASE_LIVE_BACKUP_DB_CA_FILE': __file__,
                             'PGHOST': 'other', 'PGDATABASE': 'resolute',
                             'PGSERVICE': 'another-service'})
        self.assertEqual(env['PGSSLMODE'], 'verify-full')
        self.assertEqual(env['PGSSLROOTCERT'], __file__)
        self.assertEqual(env['PGDATABASE'], 'tech_phase_billing_live')
        self.assertEqual(env['PGUSER'], 'tech_phase_billing_live_backup')
        self.assertNotIn('PGSERVICE', env)
        self.assertIn('default_transaction_read_only=on', env['PGOPTIONS'])
        with self.assertRaises(RuntimeError):
            backup.pg_env({})

    def test_stream_limit_and_close(self):
        body = io.BytesIO(b'x' * 20)
        client = Mock()
        client.get_object.return_value = {'Body': body, 'ContentLength': 20}
        with self.assertRaises(RuntimeError):
            backup.read_object(client, 'bucket', 'key', 10)
        self.assertTrue(body.closed)

    def test_retention_is_scoped_and_preserves_daily_and_weekly_history(self):
        now = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
        keys = [backup.PREFIX + 'dumps/' + (now - dt.timedelta(days=n)).strftime('%Y%m%dT%H%M%S%fZ')
                + '.aesgcm' for n in range(60)]
        keep = backup.retained_keys(keys + ['resolute/v1/a', 'unknown'])
        self.assertTrue(set(keys[:7]).issubset(keep))
        weeks = {dt.datetime.strptime(Path(k).name[:8], '%Y%m%d').isocalendar()[:2] for k in keep}
        self.assertEqual(len(weeks), 4)
        self.assertLessEqual(len(keep), 11)
        self.assertFalse(keep.intersection({'resolute/v1/a', 'unknown'}))

    def test_restore_constructs_local_target_and_stops_cluster_on_failure(self):
        calls = []
        def command(args, *, env=None):
            calls.append((args, env))
            return b''
        with tempfile.TemporaryDirectory() as temp, patch.object(backup, 'run', command), \
                patch.object(backup, 'verify_ledger', side_effect=RuntimeError('bad ledger')):
            root = Path(temp)
            with self.assertRaises(RuntimeError):
                backup.restore_check(root / 'snapshot.dump', root)
        restore = next((args, env) for args, env in calls if args[0] == 'pg_restore')
        self.assertEqual(restore[1]['PGDATABASE'], 'tech_phase_restore_check')
        self.assertNotIn('PGPASSWORD', restore[1])
        self.assertIn('--single-transaction', restore[0])
        self.assertTrue(any("listen_addresses=''" in arg for args, _ in calls for arg in args))
        self.assertEqual(calls[-1][0][-1], 'stop')

    def test_database_failure_never_includes_stderr(self):
        with patch.object(backup.subprocess, 'run', return_value=Mock(returncode=1, stderr=b'secret')):
            with self.assertRaisesRegex(RuntimeError, '^database command failed$'):
                backup.run(['psql'])

    def test_monitor_sends_empty_body_to_fixed_host_without_redirects(self):
        url = 'https://hc-ping.com/11111111-2222-3333-4444-555555555555'
        with patch.object(backup, 'build_opener') as factory:
            response = factory.return_value.open.return_value.__enter__.return_value
            response.status = 200
            for phase, suffix in [('start', '/start'), ('success', ''), ('fail', '/fail')]:
                self.assertEqual(backup.monitor_ping(url, phase), 'sent')
                args, kwargs = factory.return_value.open.call_args
                self.assertEqual(args[0].full_url, url + suffix)
                self.assertEqual(args[0].data, b'')
                self.assertEqual(args[0].method, 'POST')
                self.assertEqual(kwargs['timeout'], 5)
            self.assertIsInstance(factory.call_args.args[0], backup.NoMonitorRedirects)
        self.assertIsNone(backup.NoMonitorRedirects().redirect_request(
            None, None, 302, None, None, 'https://other.test'))

    def test_monitor_rejects_other_hosts_credentials_queries_and_paths(self):
        base = 'https://hc-ping.com/11111111-2222-3333-4444-555555555555'
        with patch.object(backup, 'build_opener') as factory:
            for url in [base.replace('https:', 'http:'), base + '?secret=value',
                        base + '/fail', base + '#fragment',
                        base.replace('hc-ping.com', 'hc-ping.com.evil.test'),
                        base.replace('hc-ping.com', 'user:secret@hc-ping.com')]:
                self.assertEqual(backup.monitor_ping(url, 'start'), 'failed')
            self.assertEqual(backup.monitor_ping('', 'start'), 'disabled')
            factory.assert_not_called()

    def test_monitor_network_error_is_masked(self):
        with patch.object(backup, 'build_opener', side_effect=OSError('secret')):
            self.assertEqual(backup.monitor_ping(
                'https://hc-ping.com/11111111-2222-3333-4444-555555555555', 'fail'), 'failed')

    def test_job_reports_failure_without_success_or_exception_details(self):
        output = io.StringIO()
        with patch.object(backup, 'monitor_ping', return_value='sent') as ping, \
                patch('sys.stdout', output):
            result = backup.run_job(self.env, Mock(side_effect=RuntimeError('buyer secret')))
        self.assertEqual(result, 1)
        self.assertEqual([c.args[1] for c in ping.call_args_list], ['start', 'fail'])
        self.assertNotIn('buyer secret', output.getvalue())

    def test_monitor_failure_does_not_skip_backup_and_returns_nonzero(self):
        job = Mock()
        with patch.object(backup, 'monitor_ping', side_effect=['failed', 'sent']), \
                patch('sys.stdout', io.StringIO()):
            self.assertEqual(backup.run_job(self.env, job), 1)
        job.assert_called_once_with()

    def test_disabled_monitor_keeps_existing_job_usable(self):
        job = Mock()
        with patch.object(backup, 'build_opener') as factory, patch('sys.stdout', io.StringIO()):
            self.assertEqual(backup.run_job(self.env, job), 0)
        factory.assert_not_called()
        job.assert_called_once_with()

    def test_invalid_environment_never_pings_or_runs_job(self):
        job = Mock()
        with patch.object(backup, 'monitor_ping') as ping, patch('sys.stdout', io.StringIO()):
            self.assertEqual(backup.run_job({**self.env, 'TECH_PHASE_PAYPAL_ENV': 'sandbox'}, job), 1)
        ping.assert_not_called()
        job.assert_not_called()

    def test_success_ping_waits_for_completed_job(self):
        order = []
        def ping(url, phase):
            order.append(phase)
            return 'sent'
        with patch.object(backup, 'monitor_ping', side_effect=ping), \
                patch('sys.stdout', io.StringIO()):
            self.assertEqual(backup.run_job(self.env, lambda: order.append('completed')), 0)
        self.assertEqual(order, ['start', 'completed', 'success'])

    def test_completion_ping_failure_surfaces_without_rerunning_job(self):
        job = Mock()
        with patch.object(backup, 'monitor_ping', side_effect=['sent', 'failed']) as ping, \
                patch('sys.stdout', io.StringIO()):
            self.assertEqual(backup.run_job(self.env, job), 1)
        job.assert_called_once_with()
        self.assertEqual([c.args[1] for c in ping.call_args_list], ['start', 'success'])
