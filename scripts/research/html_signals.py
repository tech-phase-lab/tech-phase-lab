"""Bounded official-news index discovery; no browser or access-control bypass."""
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit


class NewsHTML(HTMLParser):
    def __init__(self, body_class=None, title_class=None):
        super().__init__(convert_charrefs=True)
        self.links, self.title, self.published = [], [], None
        self.link_classes = {}
        self.in_h1 = False
        self.article, self.main = [], []
        self.capture = None
        self.depth = 0
        self.in_next_data = False
        self.next_data = []
        self.body_class = body_class
        self.title_class = title_class
        self.selected = []
        self.selected_depth = 0

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'script' and values.get('id') == '__NEXT_DATA__':
            self.in_next_data = True
        if tag == 'a' and values.get('href'):
            self.links.append(values['href'])
            self.link_classes[values['href']] = values.get('class', '')
        if tag == 'h1' and not self.title and (not self.title_class or self.title_class in values.get('class', '').split()):
            self.in_h1 = True
        void = tag in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
        if self.selected_depth:
            if not void:
                self.selected_depth += 1
            self.selected.append(self.get_starttag_text())
        elif self.body_class and not self.selected and self.body_class in values.get('class', '').split() and not void:
            self.selected_depth = 1
            self.selected.append(self.get_starttag_text())
        if tag == 'meta' and (values.get('property') or values.get('name')) == 'article:published_time':
            self.published = values.get('content')
        if tag in {'article', 'main'} and not self.capture:
            self.capture, self.depth = tag, 1
        elif self.capture and tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.depth += 1
        if self.capture:
            getattr(self, self.capture).append(self.get_starttag_text())

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.selected_depth:
            self.selected.append(f'</{tag}>')
            self.selected_depth -= 1
        if tag == 'script':
            self.in_next_data = False
        if tag == 'h1':
            self.in_h1 = False
        if self.capture:
            getattr(self, self.capture).append(f'</{tag}>')
            self.depth -= 1
            if self.depth <= 0:
                self.capture = None

    def handle_data(self, value):
        if self.selected_depth:
            from html import escape
            self.selected.append(escape(value))
        if self.in_next_data:
            self.next_data.append(value)
        if self.in_h1:
            self.title.append(value)
        if self.capture:
            # Preserve literal angle brackets as text, not new markup.
            from html import escape
            getattr(self, self.capture).append(escape(value))


def collect(source, previous, tickers, request):
    # Local import avoids a module initialization cycle.
    import signals
    import monitor
    from datetime import datetime, timedelta
    import json

    sitemap = source.get('indexFormat') == 'sitemap'
    capacity = 1000 if sitemap else 100
    response = request({**source, 'format': 'feed' if sitemap else 'document'}, {})
    parser = NewsHTML()
    if sitemap:
        import re
        import xml.etree.ElementTree as ET
        if re.search(br'<!\s*(DOCTYPE|ENTITY)\b', response['body'], re.I):
            raise ValueError('unsafe-signal-xml')
        root = ET.fromstring(response['body'])
        if signals.local_name(root) != 'urlset' or len(root) > 10000:
            raise ValueError('signal-index-invalid-sitemap')
        parser.links = [signals.child_text(node, 'loc') for node in root
                        if signals.local_name(node) == 'url']
    else:
        parser.feed(response['body'].decode('utf-8', errors='replace'))
    # Some publishers render the article listing from public Next.js page data,
    # with no article anchors in the initial HTML. Read only the configured path;
    # do not crawl arbitrary hydration state or execute publisher JavaScript.
    if source.get('nextDataListingPath'):
        listing = json.loads(''.join(parser.next_data))
        for key in source['nextDataListingPath']:
            listing = listing[key]
        if not isinstance(listing, list) or len(listing) > 100:
            raise ValueError('signal-index-invalid-listing')
        parser.links.extend(item['url'] for item in listing
                            if isinstance(item, dict) and isinstance(item.get('url'), str))
    urls = []
    for href in parser.links:
        try:
            url = signals.safe_url(urljoin(source['url'], href), source)
        except ValueError:
            continue
        is_article = any(urlsplit(url).path.startswith(prefix) for prefix in source['articlePrefixes'])
        is_feature = any(marker in parser.link_classes.get(href, '') for marker in source.get('articleLinkClasses', []))
        excluded = any(urlsplit(url).path.startswith(prefix) for prefix in source.get('excludeArticlePrefixes', []))
        excluded = excluded or len(urlsplit(url).path.strip('/').split('/')) < source.get('minArticlePathSegments', 0)
        if (is_article or is_feature) and not excluded and url not in urls:
            urls.append(url)
    if not urls:
        raise ValueError('signal-index-no-articles')
    if len(urls) > capacity:
        raise ValueError('signal-index-article-limit')

    state = json.loads(previous.get('index_state') or '{}')
    children = state.get('children', {})
    initial = not state.get('initialized')
    checked = signals.stamp()
    # Retain a bounded set of recently discovered articles even after index rotation.
    for url in urls:
        children.setdefault(url, {'baseline': initial})
    keep = list(dict.fromkeys(urls + list(children)))[:capacity]
    children = {url: children[url] for url in keep}
    pending = [url for url in keep if children[url].get('next_check', '') <= checked]
    pending.sort(key=lambda url: (children[url].get('checked', ''), keep.index(url)))
    # Retry newly discovered news before unfinished historical imports. Otherwise
    # a temporary failure pushes a new story behind every unchecked baseline.
    # Reserve one slot for history/revisions so a busy publisher cannot starve them.
    fresh = [url for url in pending if not children[url].get('baseline')
             and not children[url].get('succeeded')]
    maintenance = [url for url in pending if url not in fresh]
    selected = fresh[:2] + maintenance[:1]
    selected += [url for url in pending if url not in selected][:3 - len(selected)]
    items = []
    for url in selected:
        entry = children[url]
        try:
            fetched = request({**source, 'url': url, 'format': 'document'}, entry)
            if fetched.get('not_modified'):
                if not entry.get('succeeded'):
                    raise ValueError('signal-304-without-article')
            else:
                article = NewsHTML(source.get('articleBodyClass'), source.get('articleTitleClass'))
                article.feed(fetched['body'].decode('utf-8', errors='replace'))
                title = ' '.join(' '.join(article.title).split())[:500]
                content = ''.join(article.selected if source.get('articleBodyClass') else article.article or article.main)
                text = monitor.extract_html_text(content.encode())
                if not title or len(text) < 120 or len(text) >= signals.MAX_TEXT:
                    raise ValueError('signal-article-body-limit')
                matches = signals.match_companies(title + '\n' + text, tickers)
                for ticker in source.get('tickers', []):
                    if ticker in tickers:
                        matches.setdefault(ticker, ['publisher-company'])
                items.append({'url': url, 'title': title, 'text': text,
                              'publishedAt': signals.date_value(article.published or ''),
                              'matches': matches,
                              'truncated': False, 'baseline': entry['baseline'] and not entry.get('succeeded')})
                entry.update(etag=fetched.get('etag'), last_modified=fetched.get('last_modified'))
            entry.update(succeeded=checked, error=None, failures=0)
            delay = 3600
        except Exception as exc:
            failures = min(10, entry.get('failures', 0) + 1)
            entry.update(error=monitor.source_error_code(exc), failures=failures)
            delay = min(3600, 120 * 2 ** failures)
            if getattr(exc, 'code', None) == 429:
                delay = 86400
        entry.update(checked=checked, next_check=(datetime.fromisoformat(checked) + timedelta(seconds=delay)).isoformat())
    errors = sum(bool(value.get('error')) for value in children.values())
    waiting = sum(not value.get('succeeded') for value in children.values())
    return {'_items': items, 'index_state': json.dumps({'initialized': True, 'children': children}),
            'article_errors': errors, 'article_pending': waiting}
