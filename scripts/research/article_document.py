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
PUBLISHER_TITLE_BRANDS = {'blogs.microsoft.com': frozenset({'The Official Microsoft Blog'})}


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
        self.canonicals, self.titles, self.headings, self.dates, self.site_names = [], [], [], [], []
        self.body_classes = {name: 0 for name in BODY_CLASSES}
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
        if tag in {'meta', 'link', 'h1'} and len(names) != len(set(names)):
            self.ambiguous_identity_attributes = True
        attrs = dict(attrs)
        if tag == 'h1':
            self.heading_count += 1
        classes = (attrs.get('class') or '').split()
        for name in BODY_CLASSES:
            if name in classes:
                self.body_classes[name] += 1
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
