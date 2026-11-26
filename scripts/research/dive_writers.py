"""Company dive writers: the same cards, sections and kinds of figures as each company's hand-made 決算の深掘り (Nov 25), from the
figures dive_figures reads out of the release. Fixed wording; every number is a read figure or plain arithmetic over read figures
(a change in percent, a ratio, a midpoint). No model call.

A writer returns {'tiles', 'numbers', 'summary', 'evidence'} or raises ValueError('missing:<figure>') when a figure it needs was not
read: nothing is then published for that release (the patrol alerts the owner).
"""
from decimal import Decimal, ROUND_HALF_UP


def _g():
    import earnings_dive_generate as g
    return g


def need(f, *names):
    missing = [n for n in names if n not in f]
    if missing:
        raise ValueError('missing:' + ','.join(missing))


def q(value, places=1):
    return Decimal(value).quantize(Decimal(1).scaleb(-places), ROUND_HALF_UP)


def change(a, b):
    """Percent change from b to a."""
    return (Decimal(a) / Decimal(b) - 1) * 100


def sign(value, places=1):
    v = q(value, places)
    return ('+' if v > 0 else '−' if v < 0 else '±') + format(abs(v), 'f') + '%'


def usd(million):
    return _g().money(million, 'USD')[0]


def ps(value):
    return _g().per_share(value, 'USD')


def pc(value):
    return format(q(value, 1), 'f') + '%'


def c(ja, en):
    return {'ja': ja, 'en': en}


class Evidence:
    def __init__(self, url):
        self.url, self.items = url, []

    def add(self, field, figure, index=None, calc=None, rnd=None):
        entry = {'field': field, 'url': self.url, 'quote': figure.quote}
        calc = calc if calc is not None else (figure.calc(index) if index is not None else None)
        if calc:
            entry['calc'] = calc
        if rnd is not None:
            entry['round'] = rnd
        self.items.append(entry)


def amount_calc(figure, index, unit):
    """calc from the printed cell to the tile's unit ($B or $M), and its rounding places."""
    base = figure.calc(index) or figure.raws[index]
    return (f'({base}) / 1000', 2) if unit == 'B' else (base, 1)


def money_tile(ev, i, figure, index, label):
    shown, places, scale = _g().money(figure.values[index], 'USD')
    calc, rnd = amount_calc(figure, index, scale)
    ev.add(f'tiles[{i}].value', figure, calc=calc, rnd=rnd)
    return shown


def growth_calc(figure, a, b):
    """The printed cells' percent change, as an evidence calc."""
    return f'({figure.raws[a]} / {figure.raws[b]} - 1) * 100'


def guidance_numbers(ev, figure, band=False, gm=None):
    """numbers.guidance from a range ("between $525 million and $535 million") or a band ("$3.150 billion +/- 5%")."""
    if band:
        mid, pct_ = figure.values
        low, high = mid * (100 - pct_) / 100, mid * (100 + pct_) / 100
        base = f'{figure.raws[0]} * {figure.muls[0]}' if figure.muls[0] else figure.raws[0]
        ev.add('numbers.guidance.low', figure, calc=f'{base} * (100 - {figure.raws[1]}) / 100')
        ev.add('numbers.guidance.high', figure, calc=f'{base} * (100 + {figure.raws[1]}) / 100')
    else:
        low, high = figure.values
        ev.add('numbers.guidance.low', figure, 0)
        ev.add('numbers.guidance.high', figure, 1)
    out = {'low': float(low), 'high': float(high), 'grossMarginPercent': None}
    if gm is not None:
        out['grossMarginPercent'] = float((gm.values[0] + gm.values[1]) / 2)
        ev.add('numbers.guidance.grossMarginPercent', gm, calc=f'({gm.raws[0]} + {gm.raws[1]}) / 2')
    return out, low, high


def base_numbers(ev, f):
    rev, gm, eps = f['revenue'], f['gm'], f['eps']
    ev.add('numbers.revenue.current', rev, 0)
    ev.add('numbers.revenue.previous', rev, 1)
    ev.add('numbers.revenue.yearAgo', rev, 2)
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    ev.add('numbers.adjustedEPS', eps)
    return {'revenue': {'current': float(rev.values[0]), 'previous': float(rev.values[1]), 'yearAgo': float(rev.values[2])},
            'adjustedEPS': float(eps.values[0]), 'epsEstimate': None,
            'grossMargin': {'current': float(gm.values[0]), 'previous': float(gm.values[1])}, 'segments': None}


# ---- Credo (CRDO): the Nov 25 file's cards and sections --------------------------------------------------------------------

def crdo(f, url, before_previous):
    """`before_previous`: revenue of the quarter before the previous one (the previous file's last history bar), for the growth trend."""
    need(f, 'revenue', 'gm', 'gmGaap', 'eps', 'epsGaap', 'netIncomeNonGaap', 'netMarginNonGaap', 'netMarginGaap', 'opMarginGaap',
         'operatingIncome', 'opex', 'opexNonGaap', 'sbc', 'cash', 'shortTerm', 'goodwill', 'guidanceRevenue', 'guidanceGm', 'guidanceOpex')
    ev = Evidence(url)
    rev, gm, gmg, eps, epsg = f['revenue'], f['gm'], f['gmGaap'], f['eps'], f['epsGaap']
    numbers = base_numbers(ev, f)
    guidance, low, high = guidance_numbers(ev, f['guidanceRevenue'], gm=f['guidanceGm'])
    numbers['guidance'] = guidance
    r0, r1, r2 = rev.values
    yoy, qoq = change(r0, r2), change(r0, r1)
    prior_qoq = change(r1, before_previous) if before_previous else None
    ni = f['netIncomeNonGaap']
    times = q(r0 / r2, 1)
    tiles = []
    tiles.append({'label': c('売上高', 'Revenue'), 'value': money_tile(ev, 0, rev, 0, None),
                  'note': c(f'前年同期比 {sign(yoy)}、前期比 {sign(qoq)}', f'{sign(yoy)} YoY, {sign(qoq)} QoQ')})
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 2), rnd=1)
    tiles.append({'label': c('調整後(non-GAAP)粗利益率', 'Non-GAAP gross margin'), 'value': c(pc(gm.values[0]), pc(gm.values[0])),
                  'note': c(f'前四半期 {pc(gm.values[1])}', f'Prior quarter {pc(gm.values[1])}')})
    ev.add('tiles[1].value', gm)
    ev.add('tiles[1].note', gm)
    tiles.append({'label': c('調整後(non-GAAP)純利益', 'Non-GAAP net income'), 'value': money_tile(ev, 2, ni, 0, None),
                  'note': c(f'売上に対する比率 {pc(f["netMarginNonGaap"].values[0])}', f'{pc(f["netMarginNonGaap"].values[0])} of revenue')})
    ev.add('tiles[2].note', f['netMarginNonGaap'])
    cash_now = f['cash'].values[0] + f['shortTerm'].values[0]
    cash_before = f['cash'].values[1] + f['shortTerm'].values[1]
    gw0, gw1 = f['goodwill'].values
    opex0, opex1 = f['opex'].values[0], f['opex'].values[1]
    growth = {
        'headline': c(f'売上は前年同期の約{times}倍', f'Revenue about {times}x a year earlier') if r0 >= Decimal('1.5') * r2 else
        c(f'売上は前年同期比 {sign(yoy)}', f'Revenue {sign(yoy)} year over year'),
        'chips': [{'tone': 'up' if yoy >= 0 else 'down', 'text': c(f'前年同期比 {sign(yoy)}', f'{sign(yoy)} YoY')},
                  {'tone': 'up', 'text': c(f'調整後純利益 {usd(ni.values[0])["ja"]}', f'Non-GAAP net income {usd(ni.values[0])["en"]}')}],
        'sections': [
            {'key': 'happened', 'text': c(f'売上は前年同期の{usd(r2)["ja"]}から{usd(r0)["ja"]}になりました。調整後(non-GAAP)純利益は{usd(ni.values[2])["ja"]}から{usd(ni.values[0])["ja"]}へ、約{q(ni.values[0] / ni.values[2], 1)}倍です。',
                                          f'Revenue rose from {usd(r2)["en"]} a year earlier to {usd(r0)["en"]}. Non-GAAP net income grew about {q(ni.values[0] / ni.values[2], 1)} times, from {usd(ni.values[2])["en"]} to {usd(ni.values[0])["en"]}.')},
            {'key': 'good', 'text': c(f'売上に対する調整後純利益の比率は{pc(f["netMarginNonGaap"].values[0])}で、前年同期は{pc(f["netMarginNonGaap"].values[2])}でした。売上の大きな部分が利益として残っています。',
                                      f'Non-GAAP net income was {pc(f["netMarginNonGaap"].values[0])} of revenue (a year earlier: {pc(f["netMarginNonGaap"].values[2])}), so a large part of revenue stays as profit.')},
            {'key': 'watch', 'text': c(f'GAAPの純利益率は{pc(f["netMarginGaap"].values[0])}で、調整後の{pc(f["netMarginNonGaap"].values[0])}との差が開いています。株式報酬などの費用を含めると、利益の見え方が変わります。',
                                       f'GAAP net margin was {pc(f["netMarginGaap"].values[0])}, well below the non-GAAP {pc(f["netMarginNonGaap"].values[0])}. Including costs such as stock compensation changes the profit picture.')}]}
    gaap_fell = f['opMarginGaap'].values[0] < f['opMarginGaap'].values[1]
    view_ja = (f'前期の増収率({sign(prior_qoq)})と比べて、今回は{sign(qoq)}でした。' if prior_qoq is not None else f'前期比は{sign(qoq)}でした。') + \
        ('売上の勢いは保たれています。' if qoq >= 0 else '売上は前期を下回りました。')
    view_en = (f'Quarterly growth was {sign(qoq)}, versus {sign(prior_qoq)} the quarter before. ' if prior_qoq is not None else f'Quarterly growth was {sign(qoq)}. ') + \
        ('Sales momentum held.' if qoq >= 0 else 'Revenue was below the previous quarter.')
    changes = {
        'headline': c(f'売上は前期比 {sign(qoq)}、GAAPの利益は{"減少" if gaap_fell else "増加"}', f'Revenue {sign(qoq)} QoQ; GAAP profit {"fell" if gaap_fell else "rose"}'),
        'chips': [{'tone': 'up' if qoq >= 0 else 'down', 'text': c(f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ')},
                  {'tone': 'gold' if gm.values[0] == gm.values[1] else 'up' if gm.values[0] > gm.values[1] else 'down',
                   'text': c(f'調整後粗利益率 {pc(gm.values[1])} → {pc(gm.values[0])}', f'Non-GAAP gross margin {pc(gm.values[1])} → {pc(gm.values[0])}')},
                  {'tone': 'down' if gaap_fell else 'up', 'text': c(f'GAAP営業利益率 {pc(f["opMarginGaap"].values[1])} → {pc(f["opMarginGaap"].values[0])}',
                                                                     f'GAAP operating margin {pc(f["opMarginGaap"].values[1])} → {pc(f["opMarginGaap"].values[0])}')}],
        'sections': [
            {'key': 'happened', 'text': c(f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(r0 - r1))["ja"]}{"増え" if r0 >= r1 else "減り"}ました。調整後EPSは{ps(eps.values[1])["ja"]}から{ps(eps.values[0])["ja"]}、GAAPのEPSは{ps(epsg.values[1])["ja"]}から{ps(epsg.values[0])["ja"]}です。',
                                          f'Revenue {"rose" if r0 >= r1 else "fell"} {usd(abs(r0 - r1))["en"]} from {usd(r1)["en"]} to {usd(r0)["en"]}. Non-GAAP EPS went from {ps(eps.values[1])["en"]} to {ps(eps.values[0])["en"]}, GAAP EPS from {ps(epsg.values[1])["en"]} to {ps(epsg.values[0])["en"]}.')},
            {'key': 'watch', 'text': c(f'GAAPの粗利益率は{pc(gmg.values[1])}から{pc(gmg.values[0])}になりました。株式報酬の合計は{usd(f["sbc"].values[1])["ja"]}から{usd(f["sbc"].values[0])["ja"]}です。',
                                       f'GAAP gross margin went from {pc(gmg.values[1])} to {pc(gmg.values[0])}. Total stock compensation went from {usd(f["sbc"].values[1])["en"]} to {usd(f["sbc"].values[0])["en"]}.')},
            {'key': 'means', 'text': c('調整後の数字は、買収関連や株式報酬の費用を除いたものです。株式報酬は株数の増加を通じて株主の負担になります。',
                                       'Non-GAAP figures exclude acquisition-related and stock-based costs. Stock compensation is still a real cost to shareholders through more shares.')},
            {'key': 'view', 'text': c(view_ja, view_en)}]}
    if gw1 > 0 and gw0 > gw1 * Decimal('1.2'):
        caution = {
            'headline': c('のれんが増え、手元資金が減った', 'Goodwill rose and cash fell' if cash_now < cash_before else 'Goodwill rose'),
            'chips': [{'tone': 'down' if cash_now < cash_before else 'gold', 'text': c(f'現金・短期投資 {usd(cash_before)["ja"]} → {usd(cash_now)["ja"]}', f'Cash & ST investments {usd(cash_before)["en"]} → {usd(cash_now)["en"]}')},
                      {'tone': 'gold', 'text': c(f'のれん {usd(gw1)["ja"]} → {usd(gw0)["ja"]}', f'Goodwill {usd(gw1)["en"]} → {usd(gw0)["en"]}')},
                      {'tone': 'down' if opex0 > opex1 else 'up', 'text': c(f'営業費用 前期比 {sign(change(opex0, opex1))}', f'Operating expenses {sign(change(opex0, opex1))} QoQ')}],
            'sections': [
                {'key': 'happened', 'text': c(f'現金と短期投資の合計は{usd(cash_before)["ja"]}から{usd(cash_now)["ja"]}になり、のれんは{usd(gw1)["ja"]}から{usd(gw0)["ja"]}に増えました。',
                                              f'Cash and short-term investments went from {usd(cash_before)["en"]} to {usd(cash_now)["en"]}, and goodwill rose from {usd(gw1)["en"]} to {usd(gw0)["en"]}.')},
                {'key': 'means', 'text': c(f'GAAPの営業費用は{usd(opex1)["ja"]}から{usd(opex0)["ja"]}へ、{sign(change(opex0, opex1))}でした。費用が先に増え、買収した事業の売上と利益は後から加わります。',
                                           f'GAAP operating expenses went from {usd(opex1)["en"]} to {usd(opex0)["en"]}, {sign(change(opex0, opex1))}. Costs come first; revenue and profit from acquired businesses come later.')},
                {'key': 'watch', 'text': c('のれんは、買収した事業が計画を下回ると減損(評価損)になることがあります。買収した事業の売上がどこまで伸びるかが、確かめどころです。',
                                           'Goodwill can be written down if an acquired business underperforms. How fast its sales ramp is the measure of the deal.')}]}
    else:
        caution = {
            'headline': c('株式報酬などの費用が利益を押し下げる', 'Stock compensation weighs on GAAP profit'),
            'chips': [{'tone': 'down', 'text': c(f'株式報酬 {usd(f["sbc"].values[1])["ja"]} → {usd(f["sbc"].values[0])["ja"]}', f'Stock comp {usd(f["sbc"].values[1])["en"]} → {usd(f["sbc"].values[0])["en"]}')},
                      {'tone': 'gold', 'text': c(f'GAAP営業利益率 {pc(f["opMarginGaap"].values[0])}', f'GAAP operating margin {pc(f["opMarginGaap"].values[0])}')}],
            'sections': [
                {'key': 'happened', 'text': c(f'株式報酬の合計は{usd(f["sbc"].values[1])["ja"]}から{usd(f["sbc"].values[0])["ja"]}になりました。GAAPの営業利益は{usd(f["operatingIncome"].values[1])["ja"]}から{usd(f["operatingIncome"].values[0])["ja"]}です。',
                                              f'Total stock compensation went from {usd(f["sbc"].values[1])["en"]} to {usd(f["sbc"].values[0])["en"]}. GAAP operating income went from {usd(f["operatingIncome"].values[1])["en"]} to {usd(f["operatingIncome"].values[0])["en"]}.')},
                {'key': 'means', 'text': c(f'GAAPの営業費用は{usd(opex1)["ja"]}から{usd(opex0)["ja"]}へ、{sign(change(opex0, opex1))}でした。',
                                           f'GAAP operating expenses went from {usd(opex1)["en"]} to {usd(opex0)["en"]}, {sign(change(opex0, opex1))}.')},
                {'key': 'watch', 'text': c('調整後の利益だけでなく、GAAPの利益がどう動くかも合わせて確かめたい点です。', 'Watch GAAP profit as well as non-GAAP profit.')}]}
    gm_mid = (f['guidanceGm'].values[0] + f['guidanceGm'].values[1]) / 2
    go = f['guidanceOpex'].values
    nxt = {
        'headline': c(f'次期の売上見通し {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Next quarter revenue outlook: {usd(low)["en"]}–{usd(high)["en"]}'),
        'chips': [{'tone': 'gold', 'text': c(f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue {usd(low)["en"]}–{usd(high)["en"]}')},
                  {'tone': 'gold', 'text': c(f'調整後粗利益率 {pc(f["guidanceGm"].values[0])}〜{pc(f["guidanceGm"].values[1])}', f'Non-GAAP gross margin {pc(f["guidanceGm"].values[0])}–{pc(f["guidanceGm"].values[1])}')}],
        'sections': [
            {'key': 'happened', 'text': c(f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}、調整後粗利益率を{pc(f["guidanceGm"].values[0])}〜{pc(f["guidanceGm"].values[1])}と見込んでいます。下限でも今回より{sign(change(low, r0))}です。',
                                          f'The company expects next-quarter revenue of {usd(low)["en"]}–{usd(high)["en"]} with a non-GAAP gross margin of {pc(f["guidanceGm"].values[0])}–{pc(f["guidanceGm"].values[1])}. Even the low end is {sign(change(low, r0))} versus this quarter.')},
            {'key': 'means', 'text': c(f'粗利益率の見通しの中央値は{pc(gm_mid)}で、今回は{pc(gm.values[0])}です。調整後の営業費用は{usd(go[0])["ja"]}〜{usd(go[1])["ja"]}の見通しで、今回は{usd(f["opexNonGaap"].values[0])["ja"]}でした。',
                                       f'The margin midpoint of {pc(gm_mid)} compares with {pc(gm.values[0])} this quarter. Non-GAAP operating expenses are guided at {usd(go[0])["en"]}–{usd(go[1])["en"]}, versus {usd(f["opexNonGaap"].values[0])["en"]} this quarter.')},
            {'key': 'view', 'text': c('次の決算で、売上が見通しの幅に入るか、粗利益率が中央値の近くに残るかを確かめます。',
                                      'At the next report, check whether revenue lands in the range and whether gross margin stays near the midpoint.')}]}
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前年同期の約{times}倍、前期比{sign(qoq)}でした。調整後粗利益率は{pc(gm.values[0])}です。',
          f'Revenue was {usd(r0)["en"]}, about {times} times a year earlier and {sign(qoq)} from the previous quarter. Non-GAAP gross margin was {pc(gm.values[0])}.'),
        c(f'GAAPの営業利益は{usd(f["operatingIncome"].values[1])["ja"]}から{usd(f["operatingIncome"].values[0])["ja"]}になりました。GAAPと調整後の利益の差に目を向けたい決算です。',
          f'GAAP operating income went from {usd(f["operatingIncome"].values[1])["en"]} to {usd(f["operatingIncome"].values[0])["en"]}; the gap between GAAP and non-GAAP profit is worth watching.')]
    return {'tiles': tiles, 'numbers': {**numbers, 'guidance': guidance}, 'evidence': ev.items,
            'summary': {'conclusion': conclusion, 'cards': {'growth': growth, 'change': changes, 'caution': caution, 'next': nxt}}}


# ---- Marvell (MRVL) ---------------------------------------------------------------------------------------------------------

def mrvl(f, url, before_previous):
    need(f, 'revenue', 'gm', 'gmGaap', 'eps', 'epsGaap', 'opMargin', 'netIncome', 'netIncomeNonGaap', 'dataCenter', 'communications',
         'dataCenterShare', 'guidanceRevenue', 'guidanceGm', 'guidanceEps')
    ev = Evidence(url)
    rev, gm, eps, epsg = f['revenue'], f['gm'], f['eps'], f['epsGaap']
    numbers = base_numbers(ev, f)
    guidance, low, high = guidance_numbers(ev, f['guidanceRevenue'], band=True, gm=f['guidanceGm'])
    numbers['guidance'] = guidance
    r0, r1, r2 = rev.values
    yoy, qoq = change(r0, r2), change(r0, r1)
    dc, co, share = f['dataCenter'], f['communications'], f['dataCenterShare']
    dc_yoy, dc_qoq, co_qoq = change(dc.values[0], dc.values[2]), change(dc.values[0], dc.values[1]), change(co.values[0], co.values[1])
    mid = f['guidanceRevenue'].values[0]
    gl, gh = f['guidanceGm'].values
    tiles = [{'label': c('売上高', 'Revenue'), 'value': money_tile(ev, 0, rev, 0, None),
              'note': c(f'前年同期比 {sign(yoy, 0)}', f'{sign(yoy, 0)} YoY')}]
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 2), rnd=0)
    tiles.append({'label': c('データセンター売上', 'Data Center revenue'), 'value': money_tile(ev, 1, dc, 0, None),
                  'note': c(f'前年同期比 {sign(dc_yoy, 0)}、売上の{q(share.values[0], 0)}%', f'{sign(dc_yoy, 0)} YoY, {q(share.values[0], 0)}% of revenue')})
    ev.add('tiles[1].note', dc, calc=growth_calc(dc, 0, 2), rnd=0)
    tiles.append({'label': c('調整後(non-GAAP)粗利益率', 'Non-GAAP gross margin'), 'value': c(pc(gm.values[0]), pc(gm.values[0])),
                  'note': c(f'前四半期 {pc(gm.values[1])}、次期見通し {pc(gl)}〜{pc(gh)}', f'Prior quarter {pc(gm.values[1])}; outlook {pc(gl)}–{pc(gh)}')})
    ev.add('tiles[2].value', gm)
    ev.add('tiles[2].note', gm)
    growth = {
        'headline': c(f'データセンター売上は前年同期比 {sign(dc_yoy, 0)}', f'Data Center revenue {sign(dc_yoy, 0)} year over year'),
        'chips': [{'tone': 'up' if dc_qoq >= 0 else 'down', 'text': c(f'データセンター 前期比 {sign(dc_qoq, 0)}', f'Data Center {sign(dc_qoq, 0)} QoQ')},
                  {'tone': 'gold', 'text': c(f'売上の{q(share.values[0], 0)}%', f'{q(share.values[0], 0)}% of revenue')},
                  {'tone': 'up' if co_qoq >= 0 else 'down', 'text': c(f'通信・その他 前期比 {sign(co_qoq, 0)}', f'Communications and other {sign(co_qoq, 0)} QoQ')}],
        'sections': [
            {'key': 'happened', 'text': c(f'データセンター売上は{usd(dc.values[0])["ja"]}で、前期の{usd(dc.values[1])["ja"]}から{sign(dc_qoq, 0)}、前年同期の{usd(dc.values[2])["ja"]}から{sign(dc_yoy, 0)}でした。通信・その他は{usd(co.values[0])["ja"]}で、前期比{sign(co_qoq, 0)}です。',
                                          f'Data Center revenue was {usd(dc.values[0])["en"]}, {sign(dc_qoq, 0)} from {usd(dc.values[1])["en"]} last quarter and {sign(dc_yoy, 0)} from {usd(dc.values[2])["en"]} a year earlier. Communications and other was {usd(co.values[0])["en"]}, {sign(co_qoq, 0)} QoQ.')},
            {'key': 'good', 'text': c(f'売上に占めるデータセンターの比率は、前年同期の{q(share.values[2], 0)}%、前期の{q(share.values[1], 0)}%から{q(share.values[0], 0)}%に上がりました。',
                                      f'Data Center rose to {q(share.values[0], 0)}% of revenue, from {q(share.values[1], 0)}% last quarter and {q(share.values[2], 0)}% a year earlier.')},
            {'key': 'watch', 'text': c('売上の大半がデータセンター向けなので、大手クラウド企業の投資計画に業績が大きく左右されます。' + ('通信・その他は前期から減っています。' if co_qoq < 0 else ''),
                                       'Most revenue comes from data centers, so results depend heavily on large cloud companies\' spending plans.' + (' Communications and other shrank from last quarter.' if co_qoq < 0 else ''))},
            {'key': 'means', 'text': c(f'会社の次期売上見通しの中央値は{usd(mid)["ja"]}で、今回の{usd(r0)["ja"]}から{sign(change(mid, r0), 0)}です。',
                                       f'The company\'s next-quarter revenue midpoint of {usd(mid)["en"]} is {sign(change(mid, r0), 0)} from this quarter\'s {usd(r0)["en"]}.')}]}
    gm_state = 'flat' if gm.values[0] == gm.values[1] else 'up' if gm.values[0] > gm.values[1] else 'down'
    om = f['opMargin'].values
    changes = {
        'headline': c(f'売上は前期比 {sign(qoq)}、粗利益率は{"横ばい" if gm_state == "flat" else "上昇" if gm_state == "up" else "低下"}',
                      f'Revenue {sign(qoq)} QoQ; gross margin {gm_state}'),
        'chips': [{'tone': 'up' if qoq >= 0 else 'down', 'text': c(f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ')},
                  {'tone': 'gold' if gm_state == 'flat' else gm_state, 'text': c(f'調整後粗利益率 {pc(gm.values[1])} → {pc(gm.values[0])}', f'Non-GAAP gross margin {pc(gm.values[1])} → {pc(gm.values[0])}')},
                  {'tone': 'up' if eps.values[0] >= eps.values[1] else 'down', 'text': c(f'調整後EPS {ps(eps.values[1])["ja"]} → {ps(eps.values[0])["ja"]}', f'Non-GAAP EPS {ps(eps.values[1])["en"]} → {ps(eps.values[0])["en"]}')}],
        'sections': [
            {'key': 'happened', 'text': c(f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(r0 - r1))["ja"]}{"増え" if r0 >= r1 else "減り"}ました。調整後EPSは{ps(eps.values[1])["ja"]}から{ps(eps.values[0])["ja"]}です。',
                                          f'Revenue {"rose" if r0 >= r1 else "fell"} {usd(abs(r0 - r1))["en"]} from {usd(r1)["en"]} to {usd(r0)["en"]}. Non-GAAP EPS went from {ps(eps.values[1])["en"]} to {ps(eps.values[0])["en"]}.')},
            {'key': 'good', 'text': c(f'調整後の営業利益率は{pc(om[1])}から{pc(om[0])}になりました。',
                                      f'Non-GAAP operating margin went from {pc(om[1])} to {pc(om[0])}.')},
            {'key': 'watch', 'text': c(f'GAAPのEPSは{ps(epsg.values[0])["ja"]}で、調整後EPS({ps(eps.values[0])["ja"]})を大きく下回ります。株式報酬や買収資産の償却を除くかどうかで、利益の見え方が変わります。',
                                       f'GAAP EPS was {ps(epsg.values[0])["en"]}, well below non-GAAP EPS of {ps(eps.values[0])["en"]}. Whether stock compensation and amortization of acquired assets are excluded changes the profit picture a lot.')},
            {'key': 'view', 'text': c(f'前期比の増収率は{sign(qoq)}で、粗利益率は{pc(gm.values[0])}です。', f'Quarterly growth was {sign(qoq)} with a gross margin of {pc(gm.values[0])}.')}]}
    gm_mid = (gl + gh) / 2
    ni, nin = f['netIncome'].values[0], f['netIncomeNonGaap'].values[0]
    caution = {
        'headline': c('次期の粗利益率の見通しは今回を下回る' if gm_mid < gm.values[0] else 'GAAPと調整後の利益の差',
                      "Next quarter's gross margin outlook is below this quarter" if gm_mid < gm.values[0] else 'The gap between GAAP and non-GAAP profit'),
        'chips': [{'tone': 'down' if gm_mid < gm.values[0] else 'gold', 'text': c(f'調整後粗利益率の見通し {pc(gl)}〜{pc(gh)}', f'Non-GAAP gross margin outlook {pc(gl)}–{pc(gh)}')},
                  {'tone': 'gold', 'text': c(f'GAAP純利益 {usd(ni)["ja"]}', f'GAAP net income {usd(ni)["en"]}')}],
        'sections': [
            {'key': 'watch', 'text': c(f'次期の調整後粗利益率は{pc(gl)}〜{pc(gh)}の見通しで、今回の{pc(gm.values[0])}を{"下回ります" if gm_mid < gm.values[0] else "上回ります" if gm_mid > gm.values[0] else "中央値で同じです"}。',
                                       f"Next quarter's non-GAAP gross margin is guided at {pc(gl)}–{pc(gh)}, {'below' if gm_mid < gm.values[0] else 'above' if gm_mid > gm.values[0] else 'level with'} this quarter's {pc(gm.values[0])} at the midpoint.")},
            {'key': 'happened', 'text': c(f'GAAPの純利益は{usd(ni)["ja"]}で、調整後の純利益{usd(nin)["ja"]}を大きく下回りました。', f'GAAP net income was {usd(ni)["en"]}, far below non-GAAP net income of {usd(nin)["en"]}.')},
            {'key': 'means', 'text': c('利益率の低い製品の比率が上がると、売上が伸びても粗利益率は下がることがあります。', 'When lower-margin products grow, margins can slip even as revenue rises.')},
            {'key': 'view', 'text': c('見通しは1四半期分の会社の計画です。次の決算で実際の粗利益率を確かめます。', "The outlook is one quarter's company plan; the next report shows the actual margin.")}]}
    eg = f['guidanceEps'].values
    nxt = {
        'headline': c(f'次期の売上見通し {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Next quarter revenue outlook: {usd(low)["en"]}–{usd(high)["en"]}'),
        'chips': [{'tone': 'gold', 'text': c(f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue {usd(low)["en"]}–{usd(high)["en"]}')},
                  {'tone': 'gold', 'text': c(f'調整後EPS {ps(eg[0])["ja"]} ± {ps(eg[1])["ja"]}', f'Non-GAAP EPS {ps(eg[0])["en"]} ± {ps(eg[1])["en"]}')}],
        'sections': [
            {'key': 'happened', 'text': c(f'会社は次期の売上を{usd(mid)["ja"]}±{q(f["guidanceRevenue"].values[1], 0)}%({usd(low)["ja"]}〜{usd(high)["ja"]})と見込んでいます。中央値は今回より{sign(change(mid, r0), 0)}です。',
                                          f'The company guided next-quarter revenue to {usd(mid)["en"]} ± {q(f["guidanceRevenue"].values[1], 0)}% ({usd(low)["en"]}–{usd(high)["en"]}), {sign(change(mid, r0), 0)} above this quarter at the midpoint.')},
            {'key': 'means', 'text': c(f'調整後EPSの見通しは{ps(eg[0])["ja"]}±{ps(eg[1])["ja"]}で、今回は{ps(eps.values[0])["ja"]}でした。',
                                       f'Non-GAAP EPS is guided at {ps(eg[0])["en"]} ± {ps(eg[1])["en"]}, versus {ps(eps.values[0])["en"]} this quarter.')},
            {'key': 'view', 'text': c('次の決算で、売上が見通しの幅に入るか、粗利益率が見通しの近くに収まるかを確かめます。',
                                      'At the next report, check revenue against the range and whether gross margin lands near the outlook.')}]}
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq)}、前年同期比{sign(yoy, 0)}でした。データセンターが売上の{q(share.values[0], 0)}%を占めます。',
          f'Revenue was {usd(r0)["en"]}, {sign(qoq)} from the previous quarter and {sign(yoy, 0)} from a year earlier. Data Center made up {q(share.values[0], 0)}% of revenue.'),
        c(f'調整後粗利益率は{pc(gm.values[0])}で、次期の見通しは{pc(gl)}〜{pc(gh)}です。GAAPの純利益は{usd(ni)["ja"]}で、調整後の{usd(nin)["ja"]}を大きく下回りました。',
          f'Non-GAAP gross margin was {pc(gm.values[0])}, with next quarter guided at {pc(gl)}–{pc(gh)}. GAAP net income was {usd(ni)["en"]}, far below non-GAAP net income of {usd(nin)["en"]}.'),
        c(f'通信・その他の売上は{usd(co.values[0])["ja"]}で、前期比{sign(co_qoq, 0)}でした。', f'Communications and other revenue was {usd(co.values[0])["en"]}, {sign(co_qoq, 0)} QoQ.')]
    return {'tiles': tiles, 'numbers': {**numbers, 'guidance': guidance}, 'evidence': ev.items,
            'summary': {'conclusion': conclusion, 'cards': {'growth': growth, 'change': changes, 'caution': caution, 'next': nxt}}}


WRITERS = {'CRDO': crdo, 'MRVL': mrvl}
