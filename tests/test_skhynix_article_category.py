"""Offline, isolated checks of the current publisher header-category proof."""
from html import escape
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import article_document

URL = 'https://news.skhynix.com/en/a-new-article-with-no-allowlisted-slug/'
TITLE = 'SK hynix develops new semiconductor technology'
STORY = 'https://news.skhynix.com/en/category/story/'
MEDIA = 'https://news.skhynix.com/en/category/media-library/media/'


def category(term='STORY', href=STORY):
    return ('<div class="post-category-wrap"><a class="post-category" href="'
            + escape(href, quote=True) + '">' + escape(term) + '</a></div>')


def document(declaration=None, *, url=URL, title=TITLE):
    declaration = category() if declaration is None else declaration
    return (f'<html><head><link rel="canonical" href="{url}">'
            f'<meta property="og:url" content="{url}">'
            f'<meta property="og:title" content="{title} | SK hynix Newsroom">'
            '<meta property="og:site_name" content="SK hynix Newsroom"></head>'
            '<body><h1 class="logo"><img src="logo.svg"></h1>'
            '<nav>' + category('Media', MEDIA) + '</nav>'
            '<main id="main-content"><div class="post-wrap">'
            '<article class="post other-publisher-classes"><header class="post-header">'
            '<div class="post-inner">' + declaration
            + f'<h2 class="post-title">{title}</h2>'
            '<div class="post-header-right"><div class="post-ai-summary-wrap">'
            + category('Media', MEDIA) + '</div></div></div></header>'
            '<div class="post-inner"><div class="post-contents"><p>Article body.</p>'
            '</div></div></article></div>'
            '<aside><div class="post-inner">' + category('Media', MEDIA)
            + '</div></aside></main></body></html>')


class SkhynixArticleCategoryTests(unittest.TestCase):
    def evidence(self, html=None, **kwargs):
        return article_document.publisher_category(
            document() if html is None else html, kwargs.get('url', URL), kwargs.get('title', TITLE))

    def assert_invalid(self, html, state=None):
        result = self.evidence(html)
        self.assertTrue(result['state'].startswith('invalid-'), result)
        self.assertEqual(result['terms'], [])
        if state:
            self.assertEqual(result['state'], state)

    def test_story_uses_current_header_despite_three_post_inner_regions(self):
        html = document()
        self.assertEqual(html.count('class="post-inner"'), 3)
        self.assertEqual(self.evidence(html), {'state': 'valid', 'terms': ['STORY']})

    def test_media_is_explicit_valid_evidence(self):
        self.assertEqual(self.evidence(document(category('Media', MEDIA))),
                         {'state': 'valid', 'terms': ['Media']})

    def test_raw_label_case_and_spacing_are_preserved(self):
        self.assertEqual(self.evidence(document(category(' Story ', '/en/category/story/'))),
                         {'state': 'valid', 'terms': [' Story ']})

    def test_no_article_url_or_post_id_allowlist(self):
        for url in (URL, 'https://news.skhynix.com/en/entirely-different-release/',
                    'https://news.skhynix.com/arbitrary-current-page?edition=en'):
            with self.subTest(url=url):
                self.assertEqual(self.evidence(document(url=url), url=url)['state'], 'valid')

    def test_missing_declaration_cannot_borrow_nav_summary_body_or_related_categories(self):
        html = document('').replace('<p>Article body.</p>', category())
        self.assertEqual(self.evidence(html), {'state': 'missing', 'terms': []})

    def test_article_category_class_is_not_a_declaration(self):
        html = document('').replace('post other-publisher-classes', 'post category-story')
        self.assertEqual(self.evidence(html), {'state': 'missing', 'terms': []})

    def test_missing_category_wrapper_or_link_is_missing(self):
        for declaration in ('', '<div class="post-category-wrap"></div>',
                            '<a class="post-category" href="' + STORY + '">STORY</a>'):
            with self.subTest(declaration=declaration):
                self.assertEqual(self.evidence(document(declaration)), {'state': 'missing', 'terms': []})

    def test_unknown_category_and_taxonomy_are_explicitly_invalid(self):
        for term, href in (('TECH&AI', 'https://news.skhynix.com/en/category/tech-and-ai/'),
                           ('OTHER', 'https://news.skhynix.com/en/category/other/'),
                           ('STORY', 'https://news.skhynix.com/en/category/unknown/'),
                           ('Media', 'https://news.skhynix.com/en/category/media/')):
            with self.subTest(term=term, href=href):
                self.assert_invalid(document(category(term, href)), 'invalid-taxonomy')

    def test_label_and_taxonomy_disagreement_is_invalid(self):
        for term, href in (('Media', STORY), ('STORY', MEDIA), ('OTHER', STORY), ('STORY Media', STORY)):
            with self.subTest(term=term, href=href):
                self.assert_invalid(document(category(term, href)), 'invalid-category-mismatch')

    def test_taxonomy_href_identity_is_exact_and_has_no_credentials_query_or_fragment(self):
        for href in ('https://news.skhynix.com.evil.example/en/category/story/',
                     'https://other.example/en/category/story/',
                     'https://user@news.skhynix.com/en/category/story/',
                     'https://news.skhynix.com:444/en/category/story/',
                     STORY + '?type=media', STORY + '#media',
                     STORY.replace('https:', 'http:'), STORY.replace('/story/', '/st%6fry/'),
                     'https://[invalid', 'https://news.skhynix.com/en/category/sto\nry/', ''):
            with self.subTest(href=href):
                self.assert_invalid(document(category(href=href)), 'invalid-taxonomy')

    def test_duplicate_direct_or_nested_declarations_are_invalid(self):
        anchor = '<a class="post-category" href="' + MEDIA + '">Media</a>'
        for declaration in (category() + category('Media', MEDIA),
                            category().replace('</a>', '</a>' + anchor),
                            category().replace('STORY</a>', 'STORY' + anchor + '</a>'),
                            category().replace('</a>', '</a>' + category('Media', MEDIA)),
                            category().replace('STORY</a>', '<span>STORY</span></a>')):
            with self.subTest(declaration=declaration):
                self.assert_invalid(document(declaration))

    def test_extra_unclassified_category_cannot_be_dropped(self):
        for extra in ('<a href="' + MEDIA + '">Media</a>', '<span>Media</span>', 'Media'):
            with self.subTest(extra=extra):
                self.assert_invalid(document(category().replace('</a>', '</a>' + extra)),
                                    'invalid-declaration')

    def test_duplicate_attributes_in_link_or_any_selected_ancestor_are_invalid(self):
        for original, replacement in (
            ('id="main-content"', 'id="other" id="main-content"'),
            ('class="post-wrap"', 'class="other" class="post-wrap"'),
            ('class="post other-publisher-classes"', 'class="other" class="post"'),
            ('class="post-header"', 'class="post-header" class="other"'),
            ('class="post-inner"', 'class="post-inner" class="other"'),
            ('class="post-category-wrap"', 'class="other" class="post-category-wrap"'),
            ('class="post-category"', 'class="post-category" class="other"'),
            ('href="' + STORY + '"', 'href="' + STORY + '" href="' + MEDIA + '"')):
            # Mutate the selected declaration, not the deliberately untrusted nav.
            html = document().replace('<nav>' + category('Media', MEDIA) + '</nav>', '')
            with self.subTest(original=original):
                self.assert_invalid(html.replace(original, replacement, 1), 'invalid-attributes')

    def test_duplicate_current_post_scope_is_invalid(self):
        for original, replacement in (
            ('<main id="main-content">', '<main id="main-content"></main><main id="main-content">'),
            ('<div class="post-wrap">', '<div class="post-wrap"></div><div class="post-wrap">'),
            ('<article class="post other-publisher-classes">', '<article class="post"></article><article class="post">'),
            ('<header class="post-header">', '<header class="post-header"></header><header class="post-header">'),
            ('<div class="post-inner">', '<div class="post-inner"></div><div class="post-inner">')):
            with self.subTest(original=original):
                self.assert_invalid(document().replace(original, replacement, 1), 'invalid-ambiguous')

    def test_wrong_scope_element_tag_is_invalid(self):
        self.assert_invalid(document().replace('<div class="post-category-wrap">',
                                              '<section class="post-category-wrap">'), 'invalid-scope')

    def test_title_must_belong_to_the_same_header_inner(self):
        heading = '<h2 class="post-title">' + TITLE + '</h2>'
        html = document().replace(heading, '').replace('</header>', '</header>' + heading)
        self.assert_invalid(html, 'invalid-scope')

    def test_unclosed_or_misnested_declaration_is_invalid(self):
        for declaration in (category().replace('</a>', ''), category().replace('</div>', ''),
                            category().replace('</a>', '</span></a>')):
            with self.subTest(declaration=declaration):
                self.assert_invalid(document(declaration))

    def test_empty_oversized_or_control_character_label_is_bounded(self):
        for term in ('', ' ', 'x' * 257, '界' * 86, 'STORY\x00', 'STORY\n'):
            with self.subTest(term=repr(term[:20])):
                self.assert_invalid(document(category(term)), 'invalid-bound')

    def test_excessive_nesting_is_bounded(self):
        html = document().replace('<main id="main-content">', '<div>' * 129 + '<main id="main-content">')
        self.assert_invalid(html, 'invalid-bound')

    def test_foreign_or_invalid_requested_host_is_rejected(self):
        for url in ('https://other.example/en/article/', 'https://news.skhynix.com.evil.example/en/article/',
                    'https://user@news.skhynix.com/en/article/', 'not a URL'):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, 'article-response-identity-mismatch'):
                self.evidence(document(url=url), url=url)

    def test_wrong_or_missing_canonical_is_rejected(self):
        for html in (document().replace('href="' + URL + '"', 'href="' + URL + 'other"'),
                     document().replace('content="' + URL + '"', 'content="' + URL + 'other"'),
                     document().replace('<link rel="canonical" href="' + URL + '">', '')
                     .replace('<meta property="og:url" content="' + URL + '">', '')):
            with self.subTest(html=html[:100]), self.assertRaisesRegex(ValueError, 'article-response-(identity|title)-mismatch'):
                self.evidence(html)

    def test_wrong_missing_or_duplicate_title_is_rejected(self):
        heading = '<h2 class="post-title">' + TITLE + '</h2>'
        for html in (document().replace(heading, heading.replace(TITLE, 'Another story')),
                     document().replace(heading, ''), document().replace(heading, heading * 2),
                     document().replace(TITLE + ' | SK hynix Newsroom', 'Different title | SK hynix Newsroom')):
            with self.subTest(html=html[:100]), self.assertRaisesRegex(ValueError, 'article-response-title-mismatch'):
                self.evidence(html)
        for title in ('', None, 'Unrelated title'):
            with self.subTest(title=title), self.assertRaisesRegex(ValueError, 'article-response-title-mismatch'):
                self.evidence(title=title)

    def test_generic_identity_validation_is_not_relaxed(self):
        with self.assertRaisesRegex(ValueError, 'article-response-title-mismatch'):
            article_document.validate(document(), URL, TITLE)
        foreign = 'https://other.example/en/article/'
        with self.assertRaisesRegex(ValueError, 'article-response-title-mismatch'):
            article_document.validate(document(url=foreign), foreign, TITLE, publisher_template=True)


if __name__ == '__main__':
    unittest.main()
