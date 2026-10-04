"""Bounded article identity checks and explicit non-semantic body containers."""
from datetime import datetime
from html.parser import HTMLParser
import re
import json
from urllib.parse import urljoin, urlsplit

ARTICLE_TYPES = frozenset({'text/html', 'application/pdf'})
BODY_CLASSES = ('article', 'article-body', 'article-content', 'entry-content')


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
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonicals, self.titles, self.headings, self.dates = [], [], [], []
        self.body_classes = {name: 0 for name in BODY_CLASSES}
        self.capture = None
        self.parts = []
        self.first_tag = None
        self.has_original_date_metadata = False

    def handle_starttag(self, tag, attrs):
        if self.first_tag is None:
            self.first_tag = tag
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        for name in BODY_CLASSES:
            if name in classes:
                self.body_classes[name] += 1
        if tag == 'link' and 'canonical' in (attrs.get('rel') or '').lower().split():
            self.canonicals.append(attrs.get('href') or '')
        if tag == 'meta':
            name = (attrs.get('property') or attrs.get('name') or '').lower()
            if name == 'og:url':
                self.canonicals.append(attrs.get('content') or '')
            if name == 'og:title':
                self.titles.append(attrs.get('content') or '')
            if name in {'article:published_time', 'sc:publication_date'}:
                self.has_original_date_metadata = True
        if self.capture is None and ((tag == 'h1' and not self.headings) or 'article-date' in classes):
            self.capture = (tag, 'heading' if tag == 'h1' else 'date')
            self.parts = []

    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if self.capture and self.capture[0] == tag:
            (self.headings if self.capture[1] == 'heading' else self.dates).append(' '.join(''.join(self.parts).split()))
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


def inspect(document):
    parsed = Identity()
    parsed.feed(document)
    parsed.close()
    if re.search(r'"datePublished"\s*:', document):
        parsed.has_original_date_metadata = True
    return parsed


def validate(document, url, title=None):
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
    candidates = parsed.titles + parsed.headings
    if expected_title and candidates and any(normalized_title(candidate) != expected_title for candidate in candidates):
        raise ValueError('article-response-title-mismatch')
    return parsed


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
