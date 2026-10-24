"""Offline publisher-branding identity regression; no network/provider calls."""
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import article_document
import official_research as research
import signals

TITLE = 'Microsoft announces a platform update'
URL = 'https://blogs.microsoft.com/blog/2026/10/01/synthetic-platform-update/'
BRAND = 'The Official Microsoft Blog'
PUBLISHED = '2026-10-01T15:03:27+00:00'
OBSERVED = '2026-10-01T15:05:14+00:00'
NOW = datetime(2026, 10, 4, 14, tzinfo=timezone.utc)
BODY = ('Microsoft announced a platform update for business customers. '
        'The update supports developers building software for their organizations. '
        'The company aims to help customers manage their work.')


def document(title=TITLE, og_title=None, brand=BRAND, url=URL):
    og_title = f'{title} - {brand}' if og_title is None else og_title
    return (f'<html><head><link rel="canonical" href="{url}">'
            f'<meta property="og:url" content="{url}">'
            f'<meta property="og:title" content="{og_title}">'
            f'<meta property="og:site_name" content="{brand}">'
            f'<meta property="article:published_time" content="{PUBLISHED}"></head>'
            f'<body><nav>Not evidence</nav><article><h1>{title}</h1>'
            f'<div class="entry-content"><p>{BODY}</p></div></article>'
            '<article>Unrelated related-news tile</article></body></html>')


class ArticleTitleBrandingTests(unittest.TestCase):
    def test_generic_declared_brand_suffix_needs_exact_visible_title_and_identity(self):
        for brand in (BRAND, 'the official microsoft blog'):
            for separator in (' - ', ' | ', ' \u2013 ', ' \u2014 '):
                with self.subTest(brand=brand, separator=separator):
                    parsed = article_document.validate(
                        document(og_title=TITLE + separator + brand, brand=brand), URL, TITLE)
                    self.assertEqual(parsed.headings, [TITLE])
        for host in ('unapproved.example', 'blogs.microsoft.com.example', 'microsoft.com'):
            unknown_url = URL.replace('blogs.microsoft.com', host)
            with self.subTest(host=host), self.assertRaisesRegex(ValueError, 'article-response-title-mismatch'):
                article_document.validate(document(url=unknown_url), unknown_url, TITLE)
        # Existing exact-metadata/heading behavior is unchanged.
        article_document.validate(document(og_title=TITLE), URL, TITLE)

    def test_branding_never_masks_another_title_or_conflicting_metadata(self):
        good = document()
        cases = {
            'wrong-canonical': good.replace(f'href="{URL}"', f'href="{URL}other/"'),
            'wrong-og-url': good.replace(f'content="{URL}"', f'content="{URL}other/"'),
            'wrong-heading': good.replace(f'<h1>{TITLE}</h1>', '<h1>Another announcement</h1>'),
            'missing-heading': good.replace(f'<h1>{TITLE}</h1>', ''),
            'missing-identity': good.replace(f'<link rel="canonical" href="{URL}">', '').replace(
                f'<meta property="og:url" content="{URL}">', ''),
            'empty-identity': good.replace(f'href="{URL}"', 'href=""').replace(f'content="{URL}"', 'content=""'),
            'wrong-brand': document(og_title=TITLE + ' - Unrelated Site'),
            'altered-brand-punctuation': document(brand=BRAND + '!'),
            'missing-brand': good.replace(f'<meta property="og:site_name" content="{BRAND}">', ''),
            'empty-brand': document(og_title=TITLE + ' - ' + BRAND, brand=''),
            'claim-after-title': document(og_title=TITLE + ' and acquires a competitor - ' + BRAND),
            'title-prefix-only': document(og_title=TITLE + ' for another business'),
            'wrong-og-title': document(og_title='Different announcement - ' + BRAND),
            'brand-before-title': document(og_title=BRAND + ' - ' + TITLE),
            'unseparated-brand': document(og_title=TITLE + BRAND),
            'conflicting-og-title': good.replace('</head>', '<meta property="og:title" content="Different announcement"></head>'),
            'conflicting-brand': good.replace('</head>', '<meta property="og:site_name" content="Another Site"></head>'),
            'material-self-declared-brand': document(og_title=TITLE + ' - acquires a competitor for $10 billion in 2028',
                                                    brand='acquires a competitor for $10 billion in 2028'),
            'second-heading': good.replace('</body>', '<h1>Different announcement</h1></body>'),
            'duplicate-brand-content': good.replace(f'content="{BRAND}"', f'content="Wrong Publisher" content="{BRAND}"'),
            'duplicate-brand-content-same': good.replace(f'content="{BRAND}"', f'content="{BRAND}" content="{BRAND}"'),
            'duplicate-brand-property': good.replace('property="og:site_name"', 'property="og:description" property="og:site_name"'),
            'duplicate-brand-name': good.replace('property="og:site_name"', 'name="og:description" name="og:site_name"'),
            'conflicting-property-and-name': good.replace('property="og:site_name"', 'name="og:description" property="og:site_name"'),
            'duplicate-canonical-href': good.replace(f'href="{URL}"', f'href="{URL}other/" href="{URL}"'),
            'duplicate-canonical-rel': good.replace('rel="canonical"', 'rel="alternate" rel="canonical"'),
            'duplicate-og-url-content': good.replace(f'content="{URL}"', f'content="{URL}other/" content="{URL}"'),
            'duplicate-og-title-content': good.replace(f'content="{TITLE} - {BRAND}"',
                                                      f'content="Different release" content="{TITLE} - {BRAND}"'),
        }
        for name, body in cases.items():
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'article-response-(identity|title)-mismatch'):
                article_document.validate(body, URL, TITLE)

    def test_feed_retention_and_fetched_article_proof_are_separate(self):
        self.enterContext(patch.dict(sys.modules, {'signals': signals}))
        self.enterContext(patch.object(signals, 'fetch', side_effect=AssertionError('network forbidden')))
        self.enterContext(patch.object(research.brief_generator, 'request_response', side_effect=AssertionError('provider forbidden')))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.sqlite'
            with research.connect(path) as db:
                source_sha = hashlib.sha256((TITLE + '\nRetained feed introduction').encode()).hexdigest()
                db.execute('''INSERT INTO signal_events(id,source_id,url,sha,previous_sha,title,
                  tickers_json,matches_json,event_kind,published_at,observed_at,excerpt,diff,truncated)
                  VALUES(1113,'microsoft-blog',?,?,'',?,'["MSFT"]','{}','new',?,?,'','',0)''',
                           (URL, source_sha, TITLE, PUBLISHED, OBSERVED))
                db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                           ('microsoft-blog', URL, source_sha, TITLE, 'Retained feed introduction', OBSERVED, OBSERVED))
                db.commit()
                self.assertEqual(research.candidates(db, NOW, read_only=True), [])
                # Wrong branded metadata cannot create evidence or a paid job.
                wrong = document(og_title='Another announcement - ' + BRAND).encode()
                self.assertEqual(research.prepare_story_body(path, NOW, lambda *_: {'body': wrong}), 'retry')
                cached = db.execute('SELECT * FROM official_story_bodies').fetchone()
                self.assertEqual((cached['body'], cached['error']), ('', 'invalid-source-response'))
                self.assertEqual(cached['next_at'], NOW.timestamp() + 300)
                self.assertEqual(db.execute('SELECT count(*) FROM official_story_body_proofs').fetchone()[0], 0)
                db.execute('UPDATE official_story_bodies SET next_at=0'); db.commit()
                html = document().encode()
                self.assertEqual(research.prepare_story_body(path, NOW, lambda *_: {'body': html}), 'ready')
                row = research.candidates(db, NOW, read_only=True)[0]
                self.assertEqual((row['id'], row['sha'], row['body']), (1113, source_sha, BODY))
                proof = db.execute('SELECT * FROM official_story_body_proofs').fetchone()
                self.assertEqual((proof['sha'], proof['body_sha'], proof['raw_sha']),
                                 (source_sha, hashlib.sha256(BODY.encode()).hexdigest(), hashlib.sha256(html).hexdigest()))
                self.assertEqual(proof['published_on'], '2026-10-01')
                self.assertEqual(db.execute('SELECT text FROM signal_documents').fetchone()[0], 'Retained feed introduction')
                self.assertEqual(db.execute('SELECT count(*) FROM official_research_jobs').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
                self.assertEqual(len(signals.public_official_updates(db, reference=NOW, read_only=True)), 1)
                self.assertNotIn('bodyJa', signals.public_official_updates(db, reference=NOW, read_only=True)[0])
                # The date guard still runs after a branded title is accepted.
                db.execute('UPDATE official_story_bodies SET next_at=0'); db.commit()
                wrong_date = document().replace(PUBLISHED, '2026-10-02T15:03:27+00:00').encode()
                self.assertEqual(research.prepare_story_body(path, NOW, lambda *_: {'body': wrong_date}), 'retry')
                self.assertEqual(db.execute('SELECT raw_sha FROM official_story_body_proofs').fetchone()[0], proof['raw_sha'])


if __name__ == '__main__':
    unittest.main()
