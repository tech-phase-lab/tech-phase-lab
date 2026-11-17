import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import editorial_posts as posts
import note_translation as translation
import questions

ENV = {'NOTE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'synthetic-test-key-only-1234',
       'NOTE_TRANSLATION_MODEL': 'synthetic-model', 'NOTE_TRANSLATION_DAILY_LIMIT': '20'}
JA = '今日は**決算**を見た。\n==売上==は[red]予想超え[/red]。\n・データセンター\n・ゲーム\n[audio](/api/research/desk-media/12345678-1234-4123-8123-123456789abc.m4a)'
GOOD = "I checked **earnings** today.\n==Revenue== came in [red]above estimates[/red].\n- Data center\n- Gaming\n[audio](/api/research/desk-media/12345678-1234-4123-8123-123456789abc.m4a)"
LOST = "I checked **earnings** today.\nRevenue came in above estimates.\n- Data center\n- Gaming\n[audio](/api/research/desk-media/12345678-1234-4123-8123-123456789abc.m4a)"


def provider(*bodies, calls=None):
    queue = list(bodies)

    def send(payload, key):
        if calls is not None:
            calls.append(payload)
        body = queue.pop(0) if len(queue) > 1 else queue[0]
        out = {'bodyEn': body}
        if 'titleEn' in payload['text']['format']['schema']['properties']:
            out['titleEn'] = 'A question'
        return {'status': 'completed', 'output_text': json.dumps(out), 'usage': {'input_tokens': 900, 'output_tokens': 300}}
    return send


def note(path, body, ident='synthetic-note-0001'):
    with posts.connect(path) as db:
        item = posts.save(db, {'id': ident, 'version': 0, 'kind': 'notes', 'bodyJa': body})['item']
        return posts.review(db, {'id': ident, 'version': item['version'], 'decision': 'published',
                                 'reviewer': 'owner', 'reason': 'Owner published'})['item']


def forget_policy(path):
    """Make every stored translation look like one made before policy version 2."""
    with translation.connect(path) as db:
        db.execute('DELETE FROM note_translation_policy')
        db.commit()


def body_en(path, ident='synthetic-note-0001'):
    with posts.connect(path) as db:
        return json.loads(db.execute('SELECT content FROM editorial_posts WHERE id=?', (ident,)).fetchone()['content'])['bodyEn']


class PolicyTests(unittest.TestCase):
    def test_policy_keeps_marks_bullets_and_media(self):
        for policy in (translation.POLICY, translation.QA_POLICY):
            for text in ('**...**', '==...==', '[red]...[/red]', 'same number', '「・」', '"• "', 'never "- "',
                         '[audio](...)', '[image](...)', '[video](...)', 'exactly unchanged'):
                self.assertIn(text, policy)
        self.assertIn('conversational', translation.POLICY)
        self.assertIn('Do not answer', translation.QA_POLICY)
        self.assertGreaterEqual(translation.POLICY_VERSION, 2)

    def test_bullets_become_dots_only_for_japanese_bullets(self):
        self.assertEqual(translation.bullets('・a\n・b', '- A\n* B\n•C\n**bold** stays'), '• A\n• B\n• C\n**bold** stays')
        self.assertEqual(translation.bullets('ふつうの文', '- A'), '- A')

    def test_marks_count_each_kind_and_media_lines(self):
        self.assertEqual(translation.marks(JA), translation.marks(GOOD))
        self.assertNotEqual(translation.marks(JA), translation.marks(LOST))
        self.assertNotEqual(translation.marks(JA), translation.marks(GOOD.replace('12345678', '87654321')))


class MarkupCheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'notes.sqlite'
        note(self.path, JA)

    def run_quiet(self, send, env=ENV):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            state = translation.run_once(self.path, send, env, now=1000)
        return state, out.getvalue()

    def test_kept_marks_need_one_call_and_bullets_become_dots(self):
        calls = []
        state, log = self.run_quiet(provider(GOOD, calls=calls))
        self.assertEqual((state, len(calls), log), ('done', 1, ''))
        self.assertIn('• Data center\n• Gaming', body_en(self.path))
        self.assertNotIn('- ', body_en(self.path))
        self.assertIn('[audio](/api/research/desk-media/12345678-1234-4123-8123-123456789abc.m4a)', body_en(self.path))

    def test_lost_marks_retranslate_once(self):
        calls = []
        state, log = self.run_quiet(provider(LOST, GOOD, calls=calls))
        self.assertEqual((state, len(calls), log), ('done', 2, ''))
        self.assertIn('[red]above estimates[/red]', body_en(self.path))
        with translation.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM note_translation_calls').fetchone()[0], 2)

    def test_second_mismatch_keeps_translation_and_logs_counts_only(self):
        calls = []
        state, log = self.run_quiet(provider(LOST, LOST, calls=calls))
        self.assertEqual((state, len(calls)), ('done', 2))
        self.assertEqual(body_en(self.path), LOST.replace('- ', '• '))
        self.assertIn('note-translation-markup-mismatch kind=notes retried=1', log)
        self.assertIn('ja=bold:2,highlight:2,red:1,redEnd:1,media:1', log)
        for private in ('Revenue', 'earnings', '売上', 'desk-media'):
            self.assertNotIn(private, log)

    def test_changed_media_line_counts_as_mismatch(self):
        calls = []
        state, _ = self.run_quiet(provider(GOOD.replace('12345678', '87654321'), GOOD, calls=calls))
        self.assertEqual((state, len(calls)), ('done', 2))

    def test_retry_stays_inside_daily_limit(self):
        calls = []
        state, log = self.run_quiet(provider(LOST, GOOD, calls=calls), {**ENV, 'NOTE_TRANSLATION_DAILY_LIMIT': '1'})
        self.assertEqual((state, len(calls)), ('done', 1))
        self.assertIn('retried=0', log)

    def test_answers_keep_marks_too(self):
        path = Path(self.tmp.name) / 'qa.sqlite'
        with posts.connect(path): pass
        with questions.connect(path) as db:
            q = questions.submit(db, {'ownerKey': 'a' * 64, 'body': '決算で何を見ますか？', 'audience': 'pro-board'})['item']
            questions.answer(db, {'id': q['id'], 'body': JA})
        calls = []
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(translation.run_once(path, provider(LOST, GOOD, calls=calls), ENV, now=1000), 'done')
        self.assertEqual(len(calls), 2)
        self.assertIn('[red]', calls[0]['instructions'])


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'notes.sqlite'
        note(self.path, JA, 'synthetic-note-0001')
        note(self.path, 'ふつうのひとりごと。', 'synthetic-note-0002')
        with contextlib.redirect_stdout(io.StringIO()):
            for now in (100, 101):  # Translations made under the old policy, marks lost.
                translation.run_once(self.path, provider(LOST, LOST), ENV, now=now)
        forget_policy(self.path)
        self.out = io.StringIO()

    def backfill(self, now, send=None, env=ENV):
        with contextlib.redirect_stdout(self.out):
            return translation.run_backfill_once(self.path, send or provider(GOOD), env, now=now)

    def test_selects_only_old_machine_translations_with_marks(self):
        with translation.connect(self.path) as db:
            self.assertEqual([r['id'] for r, _ in translation.backfill_candidates(db)], ['synthetic-note-0001'])
        self.assertEqual(self.backfill(100000), 'done')
        self.assertIn('[red]above estimates[/red]', body_en(self.path))
        self.assertIn('• Data center', body_en(self.path))
        self.assertEqual(body_en(self.path, 'synthetic-note-0002'), LOST)  # untouched: no marks in the Japanese
        self.assertIn('note-translation-backfill policy=2 kind=notes remaining=0', self.out.getvalue())

    def test_runs_once(self):
        self.assertEqual(self.backfill(100000), 'done')
        for now in (200000, 300000, 900000):
            self.assertEqual(self.backfill(now, lambda *a: self.fail('backfilled twice')), 'idle')

    def test_mismatch_after_backfill_is_not_repeated(self):
        self.assertEqual(self.backfill(100000, provider(LOST, LOST)), 'done')
        self.assertIn('note-translation-markup-mismatch', self.out.getvalue())
        self.assertEqual(self.backfill(900000, lambda *a: self.fail('backfilled twice')), 'idle')

    def test_failures_stop_after_two_attempts(self):
        def failed(*args): raise RuntimeError('provider body')
        self.assertEqual(self.backfill(100000, failed), 'retry')
        self.assertEqual(self.backfill(100100, lambda *a: self.fail('lease ignored')), 'idle')
        self.assertEqual(self.backfill(200000, failed), 'retry')
        self.assertEqual(self.backfill(300000, lambda *a: self.fail('third attempt')), 'idle')
        self.assertEqual(body_en(self.path), LOST.replace('- ', '• '))

    def test_owner_edit_or_manual_english_is_never_redone(self):
        with posts.connect(self.path) as db:
            current = posts.queue(db, post_id='synthetic-note-0001')['items'][0]
            posts.review(db, {'id': current['id'], 'version': current['version'], 'decision': 'corrected',
                              'bodyJa': JA + '\n追記', 'reviewer': 'owner', 'reason': 'Owner corrected'})
        self.assertEqual(self.backfill(100000, lambda *a: self.fail('manual revision redone')), 'idle')

    def test_new_translations_are_stamped_and_not_redone(self):
        note(self.path, JA, 'synthetic-note-0003')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(translation.run_once(self.path, provider(GOOD), ENV, now=100000), 'done')
        with translation.connect(self.path) as db:
            self.assertEqual([r['id'] for r, _ in translation.backfill_candidates(db)], ['synthetic-note-0001'])

    def test_respects_interval_and_daily_share(self):
        note(self.path, JA, 'synthetic-note-0003')
        with contextlib.redirect_stdout(io.StringIO()):
            translation.run_once(self.path, provider(LOST, LOST), ENV, now=102)
        forget_policy(self.path)
        two = {**ENV, 'NOTE_TRANSLATION_DAILY_LIMIT': '2'}
        # Limit 2 → one backfill call a day; the 1st-day calls above are outside the window.
        self.assertEqual(self.backfill(100000, env=two), 'done')
        self.assertEqual(self.backfill(100000 + translation.BACKFILL_INTERVAL + 1, env=two), 'idle')
        self.assertEqual(self.backfill(100000 + 86401, env=two), 'done')
        # The interval holds even with plenty of daily budget.
        note(self.path, JA, 'synthetic-note-0004')
        with contextlib.redirect_stdout(io.StringIO()):
            translation.run_once(self.path, provider(LOST, LOST), ENV, now=200000)
        forget_policy(self.path)
        self.assertEqual(self.backfill(186401 + 60), 'idle')
        self.assertEqual(self.backfill(186401 + translation.BACKFILL_INTERVAL + 1), 'done')

    def test_shared_daily_limit_blocks_backfill(self):
        with translation.connect(self.path) as db:
            for i in range(20):
                db.execute("INSERT INTO note_translation_calls VALUES(?,?,?,?,?,?,?)",
                           (99990, 'x', 1, 'synthetic-model', 'done', '{}', f'lease-{i}'))
            db.commit()
        self.assertEqual(self.backfill(100000, lambda *a: self.fail('over the daily limit')), 'idle')

    def test_backfill_cost_is_recorded(self):
        self.backfill(100000)
        with translation.connect(self.path) as db:
            lanes = [r[0] for r in db.execute('SELECT lane FROM llm_usage')]
        self.assertIn('note-translation-backfill', lanes)
        self.assertIn('note-translation', lanes)

    def test_disabled_does_nothing(self):
        self.assertEqual(translation.run_backfill_once(self.path, lambda *a: self.fail('called'), {}), 'disabled')


if __name__ == '__main__':
    unittest.main()
