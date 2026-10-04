"""Bounded article identity checks and explicit non-semantic body containers."""
from datetime import datetime
from html.parser import HTMLParser
import re
import json
from urllib.parse import urljoin, urlsplit

ARTICLE_TYPES = frozenset({'text/html', 'application/pdf'})
BODY_CLASSES = ('article', 'article-body', 'article-content', 'entry-content')
# Trusted publisher-template policy, independent of page-declared metadata.
# Unknown requested hosts retain strict source-title equality.
PUBLISHER_TITLE_BRANDS = {'blogs.microsoft.com': frozenset({'The Official Microsoft Blog'}),
                          'news.skhynix.com': frozenset({'SK hynix Newsroom'})}
# Verified publisher template: the visible article heading is h2.post-title;
# its sole h1.logo is empty. This never relaxes another host's heading rules.
PUBLISHER_HEADINGS = {'news.skhynix.com': ('h2', 'post-title')}
PUBLISHER_BODY_CLASSES = {'news.skhynix.com': 'post-contents'}
# Observed publisher taxonomy paths, not article slugs or post identifiers.
PUBLISHER_CATEGORY_PATHS = {'/en/category/story': 'story',
                            '/en/category/media-library/media': 'media'}


def identity(url):
    try:
        parsed = urlsplit(url)
        if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
                or parsed.username or parsed.password
                or parsed.port not in {None, 443 if parsed.scheme == 'https' else 80}):
            return None
        return parsed.scheme, parsed.hostname.lower(), parsed.path.rstrip('/'), parsed.query
    except (TypeError, ValueError):
        return None


def normalized_title(value):
    return ''.join(character for character in value.casefold() if character.isalnum())


class Identity(HTMLParser):
    def __init__(self, body_class=None):
        super().__init__(convert_charrefs=True)
        self.canonicals, self.titles, self.headings, self.dates, self.site_names = [], [], [], [], []
        self.body_classes = {name: 0 for name in (*BODY_CLASSES, *PUBLISHER_BODY_CLASSES.values(), body_class) if name}
        self.publisher_headings, self.h1_classes = [], []
        self.publisher_heading_count = 0
        self.body_class_tags = {name: [] for name in self.body_classes}
        self.ambiguous_body_classes = set()
        self.capture = None
        self.parts = []
        self.first_tag = None
        self.has_original_date_metadata = False
        self.ambiguous_identity_attributes = False
        self.heading_count = 0

    def handle_starttag(self, tag, attrs):
        if self.first_tag is None:
            self.first_tag = tag
        names = [name for name, _ in attrs]
        if tag in {'meta', 'link', 'h1', 'h2'} and len(names) != len(set(names)):
            self.ambiguous_identity_attributes = True
        class_values = {value for name, value in attrs if name == 'class' and value}
        for name in self.body_classes:
            if len(names) != len(set(names)) and any(name in value.split() for value in class_values):
                self.ambiguous_body_classes.add(name)
        attrs = dict(attrs)
        if tag == 'h1':
            self.heading_count += 1
        classes = (attrs.get('class') or '').split()
        if tag == 'h1':
            self.h1_classes.append(frozenset(classes))
        for name in self.body_classes:
            if name in classes:
                self.body_classes[name] += 1
                self.body_class_tags[name].append(tag)
        if tag == 'link' and 'canonical' in (attrs.get('rel') or '').lower().split():
            self.canonicals.append(attrs.get('href') or '')
        if tag == 'meta':
            if (attrs.get('property') and attrs.get('name')
                    and attrs['property'].lower() != attrs['name'].lower()):
                self.ambiguous_identity_attributes = True
            name = (attrs.get('property') or attrs.get('name') or '').lower()
            if name == 'og:url':
                self.canonicals.append(attrs.get('content') or '')
            if name == 'og:title':
                self.titles.append(attrs.get('content') or '')
            if name == 'og:site_name':
                self.site_names.append(attrs.get('content') or '')
            if name in {'article:published_time', 'sc:publication_date'}:
                self.has_original_date_metadata = True
        publisher_heading = any(tag == wanted_tag and wanted_class in classes
                                for wanted_tag, wanted_class in PUBLISHER_HEADINGS.values())
        if publisher_heading:
            self.publisher_heading_count += 1
        if self.capture is None and ((tag == 'h1' and not self.headings) or publisher_heading or 'article-date' in classes):
            self.capture = (tag, 'heading' if tag == 'h1' else 'publisher-heading' if publisher_heading else 'date')
            self.parts = []

    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if self.capture and self.capture[0] == tag:
            target = (self.headings if self.capture[1] == 'heading' else
                      self.publisher_headings if self.capture[1] == 'publisher-heading' else self.dates)
            target.append(' '.join(''.join(self.parts).split()))
            self.capture = None
            self.parts = []

    def original_visible_date(self):
        # This narrow publisher-template fallback is only available after the
        # current URL/title identity has been established by validate().
        if (not self.canonicals or self.has_original_date_metadata
                or self.body_classes['article'] != 1 or len(self.dates) != 1):
            return None
        try:
            return datetime.strptime(self.dates[0], '%B %d, %Y').date().isoformat()
        except ValueError:
            return None


def inspect(document, body_class=None):
    parsed = Identity(body_class)
    parsed.feed(document)
    parsed.close()
    if re.search(r'"datePublished"\s*:', document):
        parsed.has_original_date_metadata = True
    return parsed


def validate(document, url, title=None, *, publisher_template=False):
    # Even an HTTP 200 text/html can contain an XML feed or service error. Do
    # not transform its nodes into apparently successful article evidence.
    if re.search(r'^\s*(?:<\?xml[^>]*>\s*)?<(?:rss|feed|error|errorresponse|listbucketresult)\b',
                 document[:8192], re.I):
        raise ValueError('article-response-not-document')
    try:
        serialized = json.loads(document)
    except (ValueError, TypeError):
        serialized = None
    if isinstance(serialized, (dict, list)):
        raise ValueError('article-response-not-document')
    parsed = inspect(document)
    if ((document.lstrip().lower().startswith('<?xml') and parsed.first_tag != 'html')
            or parsed.first_tag in {'rss', 'feed', 'error', 'errorresponse', 'listbucketresult'}):
        raise ValueError('article-response-not-document')
    expected = identity(url)
    if not expected or any(identity(urljoin(url, candidate)) != expected for candidate in parsed.canonicals):
        raise ValueError('article-response-identity-mismatch')
    expected_title = normalized_title(title or '')
    if expected_title and publisher_template and expected[1] in PUBLISHER_HEADINGS:
        if (not parsed.canonicals or any(not value.strip() for value in parsed.canonicals)
                or parsed.ambiguous_identity_attributes or len(parsed.publisher_headings) != 1
                or parsed.publisher_heading_count != 1
                or parsed.heading_count > 1 or any(parsed.headings)
                or any(classes != frozenset({'logo'}) for classes in parsed.h1_classes)):
            raise ValueError('article-response-title-mismatch')
        parsed.headings = parsed.publisher_headings
        parsed.heading_count = 1
    if expected_title:
        if any(normalized_title(heading) != expected_title for heading in parsed.headings):
            raise ValueError('article-response-title-mismatch')
        # Publishers can append their site name to Open Graph titles. Accept
        # only configured, independently declared branding after a separator,
        # backed by an exact visible heading and the current canonical identity.
        # A matching prefix alone never licenses a different article title.
        brand_key = lambda value: ' '.join(value.split()).casefold()
        allowed_brands = {brand_key(name) for name in PUBLISHER_TITLE_BRANDS.get(expected[1], ())}
        site_names = {brand_key(name) for name in parsed.site_names}
        branded = bool(parsed.canonicals and all(value.strip() for value in parsed.canonicals)
                       and parsed.headings and parsed.heading_count == 1
                       and not parsed.ambiguous_identity_attributes
                       and len(site_names) == 1 and '' not in site_names
                       and site_names <= allowed_brands)
        for candidate in parsed.titles:
            if normalized_title(candidate) == expected_title:
                continue
            if branded and any(
                    normalized_title(candidate[:separator.start()]) == expected_title
                    and brand_key(candidate[separator.end():]) in site_names
                    for separator in re.finditer(r'\s+[-\u2013\u2014|]\s+', candidate)):
                continue
            raise ValueError('article-response-title-mismatch')
    return parsed


class _PublisherCategory(HTMLParser):
    """Read only the exact current-post header chain, with bounded evidence.

    post-inner also occurs in the body and related cards. It is deliberately
    counted only as a direct child of the selected article's post-header.
    """
    PATH = (('main', 'id', 'main-content'), ('div', 'class', 'post-wrap'),
            ('article', 'class', 'post'), ('header', 'class', 'post-header'),
            ('div', 'class', 'post-inner'), ('div', 'class', 'post-category-wrap'),
            ('a', 'class', 'post-category'))
    VOID = frozenset({'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                      'link', 'meta', 'param', 'source', 'track', 'wbr'})
    EXCLUDED = frozenset({'nav', 'aside', 'footer', 'template', 'script', 'style', 'noscript'})
    MAX_DEPTH, MAX_TERM_BYTES = 128, 256

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.parts = [], []
        self.counts = [0] * len(self.PATH)
        self.heading_count = self.term_bytes = 0
        self.href = ''
        self.invalid = None

    def handle_starttag(self, tag, attrs):
        if self.invalid:
            return
        if len(self.stack) >= self.MAX_DEPTH:
            self.invalid = 'invalid-bound'
            return
        names = [name for name, _ in attrs]
        classes = {part for name, value in attrs if name == 'class' and value for part in value.split()}
        parent = self.stack[-1][1] if self.stack else -1
        excluded = bool((self.stack and self.stack[-1][2]) or tag in self.EXCLUDED
                        or classes & {'post-ai-summary', 'post-ai-summary-wrap'})
        stage = -1
        if not excluded:
            for index, (wanted_tag, attr, value) in enumerate(self.PATH):
                matches = value in classes if attr == 'class' else (attr, value) in attrs
                if matches and (index == 0 or parent == index - 1):
                    if tag != wanted_tag:
                        self.invalid = 'invalid-scope'
                        return
                    stage = index
                    self.counts[index] += 1
                    if self.counts[index] > 1:
                        self.invalid = 'invalid-ambiguous'
                        return
                    if len(names) != len(set(names)):
                        self.invalid = 'invalid-attributes'
                        return
                    break
            if parent == 4 and tag == 'h2' and 'post-title' in classes:
                self.heading_count += 1
            if stage == 6:
                self.href = dict(attrs).get('href') or ''
        # The observed declaration is one plain-text anchor. Never flatten
        # nested declarations or ignore an additional category after STORY.
        if any(node[1] >= 5 for node in self.stack) and stage != 6:
            self.invalid = 'invalid-declaration'
            return
        if tag not in self.VOID:
            self.stack.append((tag, stage, excluded))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if self.invalid or not self.stack:
            return
        if self.stack[-1][1] == 6:
            self.term_bytes += len(data.encode('utf-8'))
            if self.term_bytes > self.MAX_TERM_BYTES:
                self.invalid = 'invalid-bound'
            else:
                self.parts.append(data)
        elif self.stack[-1][1] == 5 and data.strip():
            self.invalid = 'invalid-declaration'

    def handle_endtag(self, tag):
        if self.invalid or tag in self.VOID:
            return
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                if any(node[1] >= 0 for node in self.stack[index + 1:]):
                    self.invalid = 'invalid-structure'
                del self.stack[index:]
                return
        if any(node[1] >= 5 for node in self.stack):
            self.invalid = 'invalid-structure'

    def evidence(self, url):
        result = {'state': 'missing', 'terms': []}
        if self.invalid:
            return {**result, 'state': self.invalid}
        if any(node[1] >= 0 for node in self.stack):
            return {**result, 'state': 'invalid-structure'}
        if not all(self.counts):
            return result
        if self.heading_count != 1:
            return {**result, 'state': 'invalid-scope'}
        term = ''.join(self.parts)
        if not term.strip() or re.search(r'[\x00-\x1f\x7f]', term):
            return {**result, 'state': 'invalid-bound'}
        # Resolve only a category link inside the authoritative declaration.
        # Queries, fragments, credentials, foreign hosts and unknown paths
        # cannot lend credibility to a coincidentally matching label.
        if re.search(r'[\x00-\x20\x7f]', self.href):
            return {**result, 'state': 'invalid-taxonomy'}
        try:
            category_url = urljoin(url, self.href)
        except ValueError:
            return {**result, 'state': 'invalid-taxonomy'}
        parsed = identity(category_url)
        if (not self.href.strip() or not parsed or parsed[:2] != ('https', 'news.skhynix.com')
                or parsed[3] or urlsplit(category_url).fragment):
            return {**result, 'state': 'invalid-taxonomy'}
        expected = PUBLISHER_CATEGORY_PATHS.get(parsed[2])
        if not expected:
            return {**result, 'state': 'invalid-taxonomy'}
        if term.strip().casefold() != expected:
            return {**result, 'state': 'invalid-category-mismatch'}
        return {'state': 'valid', 'terms': [term]}


def publisher_category(document, url, title):
    """Return current SK hynix header-category evidence after identity checks.

    Missing/ambiguous declarations are explicit evidence states, not inferred
    from navigation, body text, AI summaries, article classes or related cards.
    Other publishers retain the existing strict generic identity behavior.
    """
    expected = identity(url)
    if not expected or expected[1] != 'news.skhynix.com':
        raise ValueError('article-response-identity-mismatch')
    if not normalized_title(title or ''):
        raise ValueError('article-response-title-mismatch')
    validate(document, url, title, publisher_template=True)
    parsed = _PublisherCategory()
    parsed.feed(document)
    parsed.close()
    return parsed.evidence(url)


def explicit_body(document):
    """Use only one explicitly named article region, not similarly named tiles."""
    parsed = inspect(document)
    from html_signals import NewsHTML
    if parsed.body_classes['article'] > 1:
        return None
    for name in BODY_CLASSES:
        if parsed.body_classes[name] == 1:
            body = NewsHTML(name)
            body.feed(document)
            body.close()
            return ''.join(body.selected)
    return None


def selected_body(document, url, configured_class=None):
    """Require the trusted publisher's one article region before related cards."""
    parsed_url = identity(url)
    trusted = PUBLISHER_BODY_CLASSES.get(parsed_url[1]) if parsed_url else None
    if trusted and configured_class not in (None, trusted):
        raise ValueError('article-body-container-mismatch')
    selected = trusted or configured_class
    if selected:
        parsed = inspect(document, selected)
        if (parsed.body_classes.get(selected) != 1 or selected in parsed.ambiguous_body_classes
                or (trusted and parsed.body_class_tags.get(selected) != ['div'])):
            raise ValueError('article-body-container-unavailable')
        from html_signals import NewsHTML
        body = NewsHTML(selected)
        body.feed(document)
        body.close()
        markup = ''.join(body.selected)
        if not markup.strip() or (trusted and body.selected_stack):
            raise ValueError('article-body-container-unavailable')
        return markup
    return explicit_body(document)
