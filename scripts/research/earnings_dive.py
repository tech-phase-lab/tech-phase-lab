"""決算の深掘り (Earnings Deep Dive): the structured numbers and the wording built from them (owner, Nov 6).

Two steps, so that the numbers can appear first and the summary after them:
  numbers(metrics)  - only values read from the issuer's release (nothing is guessed), stored with the snapshot;
  summary(numbers)  - Japanese and English text computed from those numbers with fixed templates. No model call, no
                      figure that was not read: every percentage is calculated from the stored values.
A card whose figures were not read is simply not built. No sentence recommends buying or selling or states the future.
"""
from decimal import Decimal, ROUND_HALF_UP

SEGMENT_NAMES = {
    'cloud': ('クラウド', 'Cloud'),
    'core': ('コア・データセンター', 'Core Data Center'),
    'client': ('モバイル・クライアント', 'Mobile and Client'),
    'auto': ('車載・組み込み', 'Automotive and Embedded'),
}
FLAT = Decimal('0.05')  # a margin change smaller than this many points is "about the same"


def _d(value):
    return Decimal(str(value))


def numbers(metrics):
    """The figures the cards need, or None when not even revenue and the prior quarter were read."""
    if 'revenueMillionUSD' not in metrics or 'previousRevenueMillionUSD' not in metrics:
        return None
    result = {
        'revenue': {'current': metrics['revenueMillionUSD'], 'previous': metrics['previousRevenueMillionUSD'],
                    'yearAgo': metrics.get('yearAgoRevenueMillionUSD')},
        'adjustedEPS': metrics.get('adjustedEPS'),
        'epsEstimate': None,  # only filled when an estimate has been read (Twelve Data / headline consensus), never guessed
        'grossMargin': ({'current': metrics['adjustedGrossMarginPercent'], 'previous': metrics['previousAdjustedGrossMarginPercent']}
                        if 'adjustedGrossMarginPercent' in metrics and 'previousAdjustedGrossMarginPercent' in metrics else None),
        'guidance': None,
        'segments': None,
    }
    if 'guidanceLowMillionUSD' in metrics and 'guidanceHighMillionUSD' in metrics:
        result['guidance'] = {'low': metrics['guidanceLowMillionUSD'], 'high': metrics['guidanceHighMillionUSD'],
                              'grossMarginPercent': metrics.get('guidanceAdjustedGrossMarginPercent')}
    segments = metrics.get('segments')
    if segments:
        result['segments'] = [{'key': key, 'nameJa': SEGMENT_NAMES.get(key, (key, key))[0], 'nameEn': SEGMENT_NAMES.get(key, (key, key))[1],
                               'revenue': s['revenueMillionUSD'], 'previous': s['previousRevenueMillionUSD'],
                               'operatingMargin': s['operatingMarginPercent'], 'previousOperatingMargin': s['previousOperatingMarginPercent']}
                              for key, s in segments.items()]
    return result


# ---- formatting -------------------------------------------------------------

def _norm(value, places=2):
    """85 -> '85', 84.90 -> '84.9', 86.25 -> '86.25'."""
    text = format(_d(value).quantize(Decimal(1).scaleb(-places), ROUND_HALF_UP), 'f')
    return text.rstrip('0').rstrip('.') if '.' in text else text


def oku(million):  # 11524 -> '115.24'
    return _norm(_d(million) / 100)


def billions(million, places=2):  # 54229 -> '54.23'
    return format((_d(million) / 1000).quantize(Decimal(1).scaleb(-places), ROUND_HALF_UP), 'f')


def pct(value, places=1, sign=True):
    text = format(_d(value).quantize(Decimal(1).scaleb(-places), ROUND_HALF_UP), 'f')
    return ('+' if sign and _d(value) > 0 else '−' if _d(value) < 0 else '') + text.lstrip('-') + '%' if sign else text + '%'


def points(delta):
    """-2 -> '−2pt', 0.75 -> '+0.75pt'."""
    value = _d(delta)
    text = _norm(abs(value), 2)
    return ('+' if value > 0 else '−') + text + 'pt'


def c(ja, en):
    return {'ja': ja, 'en': en}


def change_percent(current, previous):
    return (_d(current) / _d(previous) - 1) * 100 if _d(previous) > 0 else None


def rough(value):
    """'約3割' / 'about 30%' for a big change, '約12%' / 'about 12%' for a small one (sign dropped)."""
    size = abs(_d(value))
    if size >= 20:
        tenths = int((size / 10).quantize(Decimal(1), ROUND_HALF_UP))
        return f'約{tenths}割', f'about {tenths * 10}%'
    whole = int(size.quantize(Decimal(1), ROUND_HALF_UP))
    return f'約{whole}%', f'about {whole}%'


# ---- the summary ------------------------------------------------------------

def _biggest_segment(n):
    if not n['segments']:
        return None, None
    best = max(n['segments'], key=lambda s: abs(_d(s['revenue']) - _d(s['previous'])))
    delta = _d(best['revenue']) - _d(best['previous'])
    total = _d(n['revenue']['current']) - _d(n['revenue']['previous'])
    return best, (delta / total * 100 if total != 0 and delta * total > 0 else None)


def _gm_outlook(n):
    """-1 outlook below this quarter, 1 above, 0 same, None when either is unknown."""
    guide = (n['guidance'] or {}).get('grossMarginPercent')
    gm = n['grossMargin']
    if guide is None or not gm:
        return None
    return (_d(guide) > _d(gm['current'])) - (_d(guide) < _d(gm['current']))


def summary(n):
    """{'conclusion': [Copy...], 'cards': {...}} from the numbers. Raises ValueError when they are not usable."""
    if not n or not n.get('revenue'):
        raise ValueError('dive-numbers-missing')
    rev = n['revenue']
    growth = change_percent(rev['current'], rev['previous'])
    if growth is None:
        raise ValueError('dive-revenue-baseline-zero')
    up = growth >= 0
    cards = {}
    big, share = _biggest_segment(n)
    gm = n['grossMargin']
    outlook = _gm_outlook(n)
    guide = n['guidance']
    total_delta = _d(rev['current']) - _d(rev['previous'])

    # conclusion
    word_ja, word_en = rough(growth)
    first_ja = f"売上は前期から{word_ja}{'増え' if up else '減り'}"
    first_en = f"Revenue {'rose' if up else 'fell'} {word_en} from the previous quarter"
    if big and share is not None and up:
        first_ja += f"、{big['nameJa']}部門が伸びを引っ張りました。"
        first_en += f", led by the {big['nameEn']} segment."
    else:
        first_ja += '。'; first_en += '.'
    paragraphs = [c(first_ja, first_en)]
    if outlook is not None and outlook != 0:
        lead_ja, lead_en = ('一方で、', 'Meanwhile, ') if up else ('また、', 'Also, ')
        below = outlook < 0
        paragraphs.append(c(f"{lead_ja}次期の粗利益率の見通しは今回の実績を{'下回' if below else '上回'}ります。",
                            f"{lead_en}the gross margin outlook for next quarter is {'below' if below else 'above'} this quarter's result."))

    # 01 what drove growth (needs segments)
    if big:
        d_rev = _d(big['revenue']) - _d(big['previous'])
        seg_growth = change_percent(big['revenue'], big['previous'])
        m0, m1 = _d(big['previousOperatingMargin']), _d(big['operatingMargin'])
        m_delta = m1 - m0
        verb_ja = '上がって' if m_delta > FLAT else '下がって' if m_delta < -FLAT else 'ほぼ変わらず'
        verb_en = 'rose' if m_delta > FLAT else 'fell' if m_delta < -FLAT else 'was about the same'
        direction = 'rose' if d_rev >= 0 else 'fell'
        chips = []
        if seg_growth is not None:
            chips.append({'tone': 'up' if seg_growth >= 0 else 'down', 'text': c(f"部門売上 {pct(seg_growth)}", f"Segment revenue {pct(seg_growth)}")})
        chips.append({'tone': 'up' if m_delta > FLAT else 'down' if m_delta < -FLAT else 'gold',
                      'text': c(f"部門営業利益率 {_norm(m0)}% → {_norm(m1)}%", f"Segment operating margin {_norm(m0)}% → {_norm(m1)}%")})
        sections = [{'key': 'happened', 'text': c(
            f"{big['nameJa']}部門の売上は、{oku(big['previous'])}億ドルから{oku(big['revenue'])}億ドルへ、{oku(abs(d_rev))}億ドル{'増え' if d_rev >= 0 else '減り'}ました。"
            f"営業利益率は{_norm(m0)}%から{_norm(m1)}%に{'上がっています' if m_delta > FLAT else '下がっています' if m_delta < -FLAT else 'ほぼ変わっていません'}。",
            f"{big['nameEn']} revenue {direction} from ${billions(big['previous'])}B to ${billions(big['revenue'])}B, "
            f"{'up' if d_rev >= 0 else 'down'} ${billions(abs(d_rev))}B. Its operating margin {verb_en}, from {_norm(m0)}% to {_norm(m1)}%.")}]
        if share is not None and d_rev > 0:
            good_ja = f"会社全体の売上は、前期から{oku(abs(total_delta))}億ドル{'増え' if total_delta >= 0 else '減り'}ました。そのうちの約{int(share.quantize(Decimal(1), ROUND_HALF_UP))}%が、この部門の増加分です。"
            good_en = (f"Total revenue {'rose' if total_delta >= 0 else 'fell'} ${billions(abs(total_delta))}B from the previous quarter, "
                       f"and about {int(share.quantize(Decimal(1), ROUND_HALF_UP))}% of that change came from this segment.")
            if m_delta > FLAT:
                good_ja += '売上が増えながら利益率も上がっているので、増えた売上が利益として残りやすくなっています。'
                good_en += ' Because revenue grew while the margin also improved, more of the added revenue can stay as profit.'
            sections.append({'key': 'good', 'text': c(good_ja, good_en)})
        if share is not None and share >= 40:
            sections.append({'key': 'watch', 'text': c('伸びが1つの部門に偏っています。この部門の需要が落ちたときは、会社全体への影響も大きくなります。',
                                                     'Growth is concentrated in one segment. If demand there weakens, the impact on the whole company would be large.')})
        cards['growth'] = {'headline': c(f"{big['nameJa']}部門が最大の伸び" if d_rev >= 0 else f"{big['nameJa']}部門の売上が最も減少",
                                         f"{big['nameEn']} led the growth" if d_rev >= 0 else f"{big['nameEn']} had the largest decline"),
                           'chips': chips, 'sections': sections, 'segment': big['key']}

    # 02 change from last quarter
    chips = []
    sections = []
    title_ja = f"売上は前期比 {pct(growth)}"
    title_en = f"Revenue {'up' if up else 'down'} {pct(abs(growth), sign=False)} QoQ"
    happened_ja = f"売上は{oku(rev['previous'])}億ドルから{oku(rev['current'])}億ドルへ、{oku(abs(total_delta))}億ドル{'増え' if total_delta >= 0 else '減り'}ました。"
    happened_en = f"Revenue {'rose' if total_delta >= 0 else 'fell'} from ${billions(rev['previous'])}B to ${billions(rev['current'])}B, {'up' if total_delta >= 0 else 'down'} ${billions(abs(total_delta))}B."
    if gm:
        g_delta = _d(gm['current']) - _d(gm['previous'])
        g_state = 1 if g_delta > FLAT else -1 if g_delta < -FLAT else 0
        title_ja += ('、粗利益率も上昇' if g_state > 0 else '、粗利益率は低下' if g_state < 0 else '')
        title_en += (', gross margin also higher' if g_state > 0 else ', gross margin lower' if g_state < 0 else '')
        chips.append({'tone': 'up' if g_state > 0 else 'down' if g_state < 0 else 'gold',
                      'text': c(f"調整後粗利益率 {_norm(gm['previous'])}% → {_norm(gm['current'])}%", f"Adj. gross margin {_norm(gm['previous'])}% → {_norm(gm['current'])}%")})
        happened_ja += f"調整後粗利益率も{_norm(gm['previous'])}%から{_norm(gm['current'])}%に{'上がっています' if g_state > 0 else '下がっています' if g_state < 0 else 'ほぼ変わっていません'}。"
        happened_en += f" Adjusted gross margin {'also rose' if g_state > 0 else 'fell' if g_state < 0 else 'was about the same'}, from {_norm(gm['previous'])}% to {_norm(gm['current'])}%."
        if g_state > 0:
            sections_good = c('粗利益率が上がると、同じ売上でも手元に残る利益が増えます。' + ('売上の増加と重なるので、利益も伸びやすい状況です。' if up else ''),
                              'A higher gross margin means more of each sales dollar stays as profit, even at the same revenue.' + (' Combined with higher sales, profit can grow faster.' if up else ''))
        elif g_state < 0:
            sections_good = None
        else:
            sections_good = None
    else:
        sections_good = None
    sections.append({'key': 'happened', 'text': c(happened_ja, happened_en)})
    if sections_good:
        sections.append({'key': 'good', 'text': sections_good})
    if outlook is not None and outlook < 0 and gm and guide:
        sections.append({'key': 'watch', 'text': c(
            f"次期の調整後粗利益率の見通しは約{_norm(guide['grossMarginPercent'])}%で、今回の{_norm(gm['current'])}%を下回ります。上昇が続くかは、次の決算で確かめます。",
            f"The outlook for next quarter's adjusted gross margin is about {_norm(guide['grossMarginPercent'])}%, below this quarter's {_norm(gm['current'])}%. The next report will show whether the rise continues.")})
    elif not up:
        sections.append({'key': 'watch', 'text': c('減収が続くかは、次の決算で確かめます。', 'The next report will show whether the decline continues.')})
    if not gm:
        chips.insert(0, {'tone': 'up' if up else 'down', 'text': c(f"売上 前期比 {pct(growth)}", f"Revenue {pct(growth)} QoQ")})
    cards['change'] = {'headline': c(title_ja, title_en), 'chips': chips, 'sections': sections}

    # 03 points of caution: the segment whose margin fell most, else the gross margin outlook
    falling = [s for s in (n['segments'] or []) if _d(s['operatingMargin']) - _d(s['previousOperatingMargin']) < -FLAT]
    if falling:
        s = min(falling, key=lambda x: _d(x['operatingMargin']) - _d(x['previousOperatingMargin']))
        m0, m1 = _d(s['previousOperatingMargin']), _d(s['operatingMargin'])
        high = m1 >= 50
        view_ja = (f"利益率は、まだ{_norm(m1)}%と高い水準です。" if high else f"利益率は{_norm(m1)}%です。") + 'ただ、1四半期だけの低下では、傾向とは言えません。次の決算でも下がるかどうかが、見るところです。'
        view_en = (f"A {_norm(m1)}% margin is still high. " if high else f"The margin is {_norm(m1)}%. ") + "But one quarter's decline is not a trend. What matters is whether it falls again in the next report."
        if outlook is not None and outlook < 0 and gm and guide:
            view_ja += f"次期の調整後粗利益率の見通し(約{_norm(guide['grossMarginPercent'])}%)が今回の{_norm(gm['current'])}%を下回っている点も、同じ方向の材料です。"
            view_en += f" The outlook for next quarter's adjusted gross margin (about {_norm(guide['grossMarginPercent'])}%), below this quarter's {_norm(gm['current'])}%, points the same way."
        cards['caution'] = {
            'headline': c(f"{s['nameJa']}部門の営業利益率が低下", f"{s['nameEn']} segment operating margin fell"),
            'chips': [{'tone': 'down', 'text': c(f"部門営業利益率 {points(m1 - m0)}", f"Segment operating margin {points(m1 - m0)}")}],
            'sections': [
                {'key': 'happened', 'text': c(
                    f"{s['nameJa']}部門の営業利益率は、{_norm(m0)}%から{_norm(m1)}%に下がりました。売上100ドルあたりの営業利益が、{_norm(m0)}ドルから{_norm(m1)}ドルに減った計算です。",
                    f"{s['nameEn']} segment operating margin fell from {_norm(m0)}% to {_norm(m1)}%. Operating profit per $100 of sales dropped from ${_norm(m0)} to ${_norm(m1)}.")},
                {'key': 'means', 'text': c('同じ売上でも、手元に残る利益が少なくなります。この部門の売上が大きいほど、会社全体の利益への影響も大きくなります。',
                                         'Less profit is left from the same revenue. The larger this segment\'s sales, the bigger the effect on company-wide profit.')},
                {'key': 'view', 'text': c(view_ja, view_en)}],
            'segment': s['key']}
    elif outlook is not None and outlook < 0 and gm and guide:
        cur, out = _d(gm['current']), _d(guide['grossMarginPercent'])
        cards['caution'] = {
            'headline': c('次期の粗利益率の見通しは今回を下回る', "Next quarter's gross margin outlook is below this quarter"),
            'chips': [{'tone': 'down', 'text': c(f"粗利益率の見通し {points(out - cur)}", f"Gross margin outlook {points(out - cur)}")}],
            'sections': [
                {'key': 'happened', 'text': c(f"次期の調整後粗利益率の見通しは約{_norm(out)}%で、今回の{_norm(cur)}%を下回ります。",
                                              f"The outlook for next quarter's adjusted gross margin is about {_norm(out)}%, below this quarter's {_norm(cur)}%.")},
                {'key': 'means', 'text': c('売上が伸びても利益率が下がると、利益の伸びは小さくなります。', 'If revenue grows but the margin falls, profit growth will be smaller.')},
                {'key': 'view', 'text': c('見通しは会社の予定で、実績ではありません。次の決算で、実際の粗利益率を確かめます。',
                                          'The outlook is the company\'s plan, not a result. The next report will show the actual gross margin.')}],
            'segment': None}

    # 04 what to watch next
    if guide and _d(guide['low']) > 0 and _d(guide['high']) >= _d(guide['low']):
        low, high = _d(guide['low']), _d(guide['high'])
        low_change = change_percent(low, rev['current'])
        chips = [{'tone': 'gold', 'text': c(f"売上 {oku(low)}〜{oku(high)}億ドル", f"Revenue ${billions(low, 1)}–{billions(high, 1)}B")}]
        if guide.get('grossMarginPercent') is not None:
            chips.append({'tone': 'gold', 'text': c(f"調整後粗利益率 約{_norm(guide['grossMarginPercent'])}%", f"Adj. gross margin ~{_norm(guide['grossMarginPercent'])}%")})
        gm_text_ja = f"、調整後粗利益率を約{_norm(guide['grossMarginPercent'])}%" if guide.get('grossMarginPercent') is not None else ''
        gm_text_en = f" and an adjusted gross margin of about {_norm(guide['grossMarginPercent'])}%" if guide.get('grossMarginPercent') is not None else ''
        if low_change is not None and low_change >= 0:
            tail_ja = f"今回の売上は{oku(rev['current'])}億ドルなので、見通しの下限でも約{_norm(low_change, 1)}%の増加です。"
            tail_en = f"This quarter's revenue was ${billions(rev['current'])}B, so even the low end would be about {_norm(low_change, 1)}% higher."
        else:
            tail_ja = f"今回の売上は{oku(rev['current'])}億ドルで、見通しの下限はこれを下回ります。"
            tail_en = f"This quarter's revenue was ${billions(rev['current'])}B, and the low end is below it."
        sections = [
            {'key': 'happened', 'text': c(f"会社は、次期の売上を{oku(low)}億〜{oku(high)}億ドル{gm_text_ja}と見込んでいます。{tail_ja}",
                                          f"The company expects next quarter revenue of ${billions(low, 1)}B to ${billions(high, 1)}B{gm_text_en}. {tail_en}")},
            {'key': 'view', 'text': c('次の決算で、実績がこの幅のどこに入るかを見ます。', 'What matters is where actual results land within this range in the next report.')}]
        if outlook is not None and outlook < 0:
            sections.append({'key': 'watch', 'text': c('粗利益率の見通しは今回より低くなっています。売上が伸びても利益率が下がると、利益の伸びは小さくなります。',
                                                      'The margin outlook is below this quarter\'s result. If revenue grows but the margin falls, profit growth will be smaller.')})
        cards['next'] = {'headline': c('次期の会社見通しを追う', "Follow the company's outlook for next quarter"), 'chips': chips, 'sections': sections}

    return {'conclusion': paragraphs, 'cards': cards}
