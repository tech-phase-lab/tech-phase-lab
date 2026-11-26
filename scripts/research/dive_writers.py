"""Company dive writers: the same cards, sections and kinds of figures as each company's hand-made 決算の深掘り (Nov 25), from the
figures dive_figures reads out of the release. Fixed wording; every number is a read figure or plain arithmetic over read figures
(a change in percent, a ratio, a midpoint). No model call.

A writer returns {'tiles', 'numbers', 'summary', 'evidence'} or raises ValueError('missing:<figure>') when a figure it needs was not
read: nothing is then published for that release (the patrol alerts the owner).
"""
from datetime import datetime
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

    def add(self, field, figure, index=None, calc=None, rnd=None, url=None):
        entry = {'field': field, 'url': url or getattr(figure, 'url', None) or self.url, 'quote': figure.quote}
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


def money_tile(ev, i, figure, index, label, currency='USD'):
    shown, places, scale = _g().money(figure.values[index], currency)
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

def crdo(f, url, before_previous, report=None, events=None, previous=None):
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
    report = report or {}
    if 'customerA' in report and 'customerB' in report:  # the 10-Q: the hand-made file's tile
        a, b = report['customerA'], report['customerB']
        tiles.append({'label': c('最大顧客の売上比率', 'Largest customer share of revenue'), 'value': c(f'{q(a.values[0], 0)}%', f'{q(a.values[0], 0)}%'),
                      'note': c(f'2番目の顧客 {q(b.values[0], 0)}%', f'Second-largest: {q(b.values[0], 0)}%')})
        ev.add('tiles[2].value', a)
        ev.add('tiles[2].note', b)
    else:  # at the release, before the 10-Q
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
            ({'key': 'watch', 'text': c(f'10-Qによると、今期の最大顧客は売上の{q(report["customerA"].values[0], 0)}%、2番目は{q(report["customerB"].values[0], 0)}%でした。2社で約{q(report["customerA"].values[0] + report["customerB"].values[0], 0)}%を占めるため、どちらかの発注が減ると業績が大きく動きます。',
                                        f'Per the 10-Q, the largest customer was {q(report["customerA"].values[0], 0)}% of revenue this quarter and the second-largest {q(report["customerB"].values[0], 0)}%. Together they make up about {q(report["customerA"].values[0] + report["customerB"].values[0], 0)}%, so an order cut from either would move results sharply.')}
             if 'customerA' in report and 'customerB' in report else
             {'key': 'watch', 'text': c(f'GAAPの純利益率は{pc(f["netMarginGaap"].values[0])}で、調整後の{pc(f["netMarginNonGaap"].values[0])}との差が開いています。株式報酬などの費用を含めると、利益の見え方が変わります。',
                                        f'GAAP net margin was {pc(f["netMarginGaap"].values[0])}, well below the non-GAAP {pc(f["netMarginNonGaap"].values[0])}. Including costs such as stock compensation changes the profit picture.')})]}
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
    deal_ja = deal_en = ''
    if 'acquisition' in report:  # the 10-Q's business-combination note: who was bought, when, for how much
        when, name, amount, unit = report['acquisition'].values
        day = datetime.strptime(when, '%B %d %Y')
        size_ja = f'{Decimal(amount) * (10 if unit == "billion" else Decimal("0.01")):f}'.rstrip('0').rstrip('.') + '億ドル'
        deal_ja = f'10-Qによると、{day.month}月{day.day}日に{name}を{size_ja}で買収しました。'
        deal_en = f'Per the 10-Q, on {day.strftime("%B")} {day.day} the company bought {name} for ${amount} {unit}. '
    if 'customerA' in report and 'customerB' in report:
        ev.add('summary.cards.growth.sections[2]', report['customerA'])
    if 'acquisition' in report and gw1 > 0 and gw0 > gw1 * Decimal('1.2'):
        ev.add('summary.cards.caution.sections[0]', report['acquisition'])
    if gw1 > 0 and gw0 > gw1 * Decimal('1.2'):
        caution = {
            'headline': c('のれんが増え、手元資金が減った', 'Goodwill rose and cash fell' if cash_now < cash_before else 'Goodwill rose'),
            'chips': [{'tone': 'down' if cash_now < cash_before else 'gold', 'text': c(f'現金・短期投資 {usd(cash_before)["ja"]} → {usd(cash_now)["ja"]}', f'Cash & ST investments {usd(cash_before)["en"]} → {usd(cash_now)["en"]}')},
                      {'tone': 'gold', 'text': c(f'のれん {usd(gw1)["ja"]} → {usd(gw0)["ja"]}', f'Goodwill {usd(gw1)["en"]} → {usd(gw0)["en"]}')},
                      {'tone': 'down' if opex0 > opex1 else 'up', 'text': c(f'営業費用 前期比 {sign(change(opex0, opex1))}', f'Operating expenses {sign(change(opex0, opex1))} QoQ')}],
            'sections': [
                {'key': 'happened', 'text': c(deal_ja + f'現金と短期投資の合計は{usd(cash_before)["ja"]}から{usd(cash_now)["ja"]}になり、のれんは{usd(gw1)["ja"]}から{usd(gw0)["ja"]}に増えました。',
                                              deal_en + f'Cash and short-term investments went from {usd(cash_before)["en"]} to {usd(cash_now)["en"]}, and goodwill rose from {usd(gw1)["en"]} to {usd(gw0)["en"]}.')},
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

def mrvl(f, url, before_previous, report=None, events=None, previous=None):
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
    deal = next((e for e in (events or []) if 'exchangeRatio' in e['figures'] or 'allStock' in e['figures']), None)
    prelim = next((e for e in (events or []) if 'preliminary' in e['figures']), None)
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
    if deal:  # an 8-K of the quarter (Item 1.01): the hand-made file's caution card
        caution = deal_caution(deal, gl, gh, gm.values[0], gm_mid, ni)
        for fig in deal['figures'].values():
            if fig is not deal['figures'].get('preliminary'):
                ev.add('summary.cards.caution.sections[1]', fig)
    if prelim:
        ev.add('summary.cards.next.sections[0]', prelim['figures']['preliminary'])
    eg = f['guidanceEps'].values
    nxt = {
        'headline': c(f'次期の売上見通し {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Next quarter revenue outlook: {usd(low)["en"]}–{usd(high)["en"]}'),
        'chips': [{'tone': 'gold', 'text': c(f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue {usd(low)["en"]}–{usd(high)["en"]}')},
                  {'tone': 'gold', 'text': c(f'調整後EPS {ps(eg[0])["ja"]} ± {ps(eg[1])["ja"]}', f'Non-GAAP EPS {ps(eg[0])["en"]} ± {ps(eg[1])["en"]}')}]
        + ([{'tone': 'gold', 'text': c('速報値:見通しどおり', 'Preliminary: in line')}] if prelim else []),
        'sections': [
            {'key': 'happened', 'text': c(f'会社は次期の売上を{usd(mid)["ja"]}±{q(f["guidanceRevenue"].values[1], 0)}%({usd(low)["ja"]}〜{usd(high)["ja"]})と見込んでいます。中央値は今回より{sign(change(mid, r0), 0)}です。'
                                          + (f'{prelim["date"]}には、売上の速報値が見通しどおりだったとして、幅を±{prelim["figures"]["preliminary"].values[2]}%に狭めました。' if prelim else ''),
                                          f'The company guided next-quarter revenue to {usd(mid)["en"]} ± {q(f["guidanceRevenue"].values[1], 0)}% ({usd(low)["en"]}–{usd(high)["en"]}), {sign(change(mid, r0), 0)} above this quarter at the midpoint.'
                                          + (f' On {prelim["dateEn"]} it said preliminary revenue was in line, narrowing the range to ± {prelim["figures"]["preliminary"].values[2]}%.' if prelim else ''))},
            {'key': 'means', 'text': c(f'調整後EPSの見通しは{ps(eg[0])["ja"]}±{ps(eg[1])["ja"]}で、今回は{ps(eps.values[0])["ja"]}でした。',
                                       f'Non-GAAP EPS is guided at {ps(eg[0])["en"]} ± {ps(eg[1])["en"]}, versus {ps(eps.values[0])["en"]} this quarter.')},
            {'key': 'view', 'text': c('次の決算で、売上が見通しの幅に入るか、粗利益率が見通しの近くに収まるかを確かめます。',
                                      'At the next report, check revenue against the range and whether gross margin lands near the outlook.')}]}
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq)}、前年同期比{sign(yoy, 0)}でした。データセンターが売上の{q(share.values[0], 0)}%を占めます。',
          f'Revenue was {usd(r0)["en"]}, {sign(qoq)} from the previous quarter and {sign(yoy, 0)} from a year earlier. Data Center made up {q(share.values[0], 0)}% of revenue.'),
        c(f'調整後粗利益率は{pc(gm.values[0])}で、次期の見通しは{pc(gl)}〜{pc(gh)}です。GAAPの純利益は{usd(ni)["ja"]}で、調整後の{usd(nin)["ja"]}を大きく下回りました。',
          f'Non-GAAP gross margin was {pc(gm.values[0])}, with next quarter guided at {pc(gl)}–{pc(gh)}. GAAP net income was {usd(ni)["en"]}, far below non-GAAP net income of {usd(nin)["en"]}.'),
        (c(f'{deal["date"]}、{deal["figures"]["exchangeRatio"].values[2] if "exchangeRatio" in deal["figures"] else "相手先"}の買収に合意しました。'
           + ('次の四半期の売上の速報値は見通しどおりとしています。' if prelim else ''),
           f'On {deal["dateEn"]}, the company agreed to acquire {deal["figures"]["exchangeRatio"].values[2] if "exchangeRatio" in deal["figures"] else "another company"}.'
           + (' It also said preliminary revenue for the next quarter was in line with guidance.' if prelim else ''))
         if deal else
         c(f'通信・その他の売上は{usd(co.values[0])["ja"]}で、前期比{sign(co_qoq, 0)}でした。', f'Communications and other revenue was {usd(co.values[0])["en"]}, {sign(co_qoq, 0)} QoQ.'))]
    return {'tiles': tiles, 'numbers': {**numbers, 'guidance': guidance}, 'evidence': ev.items,
            'summary': {'conclusion': conclusion, 'cards': {'growth': growth, 'change': changes, 'caution': caution, 'next': nxt}}}


def deal_caution(deal, gl, gh, gm_now, gm_mid, ni):
    """The caution card of a quarter with a merger agreement: the margin outlook, then the deal's own terms, each read from its 8-K."""
    d = deal['figures']
    terms_ja, terms_en = [], []
    if 'exchangeRatio' in d:
        ratio, buyer, target = d['exchangeRatio'].values
        terms_ja.append(f'{target}株1株につき{buyer}株{ratio}株を交付します。')
        terms_en.append(f'{buyer} pays {ratio} {buyer} shares per {target} share.')
    if 'ownership' in d:
        a, pa, b, pb = d['ownership'].values
        terms_ja.append(f'統合後は現{a}株主が約{pa}%、{b}株主が約{pb}%を保有します。')
        terms_en.append(f'After closing, current {a} holders would own about {pa}% and {b} holders about {pb}%.')
    if 'close' in d:
        half, year = d['close'].values
        terms_ja.append(f'完了は{year}年{"前" if half == "first" else "後"}半の見込みです。')
        terms_en.append(f'Closing is expected in the {half} half of {year}.')
    name = d['exchangeRatio'].values[2] if 'exchangeRatio' in d else '相手先'
    stock = 'allStock' in d
    return {
        'headline': c('次期の粗利益率の見通しは今回を下回る' if gm_mid < gm_now else '買収の合意', "Next quarter's gross margin outlook is below this quarter" if gm_mid < gm_now else 'A merger agreement'),
        'chips': [{'tone': 'down' if gm_mid < gm_now else 'gold', 'text': c(f'調整後粗利益率の見通し {pc(gl)}〜{pc(gh)}', f'Non-GAAP gross margin outlook {pc(gl)}–{pc(gh)}')},
                  {'tone': 'gold', 'text': c(f'GAAP純利益 {usd(ni)["ja"]}', f'GAAP net income {usd(ni)["en"]}')},
                  {'tone': 'gold', 'text': c(f'{name}買収:{"全額株式" if stock else "合意"}', f'{name} deal{": all-stock" if stock else ""}')}],
        'sections': [
            {'key': 'watch', 'text': c(f'次期の調整後粗利益率は{pc(gl)}〜{pc(gh)}の見通しで、今回の{pc(gm_now)}を{"下回ります" if gm_mid < gm_now else "上回ります" if gm_mid > gm_now else "中央値で同じです"}。',
                                       f"Next quarter's non-GAAP gross margin is guided at {pc(gl)}–{pc(gh)}, {'below' if gm_mid < gm_now else 'above' if gm_mid > gm_now else 'level with'} this quarter's {pc(gm_now)} at the midpoint.")},
            {'key': 'happened', 'text': c(f'{deal["date"]}、{name}の買収に合意しました。' + ''.join(terms_ja), f'On {deal["dateEn"]}, the company agreed to acquire {name}. ' + ' '.join(terms_en))},
            {'key': 'means', 'text': c(('株式で支払うため、利益がより多くの株数に分けられます。' if stock else '買収の対価と条件は、会社の資料で確かめる必要があります。')
                                       + ('会社は、完了後1年目から調整後EPSを押し上げると見込んでいます。' if 'accretive' in d else '') + '承認や統合には時間がかかります。',
                                       ('Because it is paid in stock, earnings are spread over more shares. ' if stock else '')
                                       + ('The company expects the deal to add to non-GAAP EPS in year one. ' if 'accretive' in d else '') + 'Approvals and integration take time.')},
            {'key': 'view', 'text': c('粗利益率の見通しは1四半期分の計画です。買収は完了まで時間がかかるため、本業の決算と承認の進み具合を分けて追います。',
                                      "The margin outlook is one quarter's plan. The deal takes time to close, so track the core results and the approval process separately.")}]}


# ---- Broadcom (AVGO) --------------------------------------------------------------------------------------------------------

def ratio_calc(top, bottom, i):
    return f'{top.raws[i]} / {bottom.raws[i]} * 100'


def avgo(f, url, before_previous, report=None, events=None, previous=None):
    """Release figures, the previous file's segment figures, and (once filed) the 10-Q's segment margins and customer concentration."""
    need(f, 'revenue', 'grossProfitNonGaap', 'opIncomeNonGaap', 'epsBoth', 'fcf', 'semis', 'software', 'ai', 'guidanceRevenue', 'guidanceAi', 'guidanceOpMargin')
    report = report or {}
    ev = Evidence(url)
    rev, gp, op, fcf = f['revenue'], f['grossProfitNonGaap'], f['opIncomeNonGaap'], f['fcf']
    r0, r1, r2 = rev.values
    yoy, qoq = change(r0, r2), change(r0, r1)
    gm0, gm1 = q(gp.values[0] / r0 * 100, 1), q(gp.values[1] / r1 * 100, 1)
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.previous', rev)
    ev.add('numbers.revenue.yearAgo', rev)
    eps = f['epsBoth']
    ev.add('numbers.adjustedEPS', eps)
    for field, i, val in (('current', 0, gm0), ('previous', 1, gm1)):
        ev.add(f'numbers.grossMargin.{field}', gp)
        ev.add(f'numbers.grossMargin.{field}', rev, calc=ratio_calc(gp, rev, i), rnd=1)
    g = f['guidanceRevenue']
    ev.add('numbers.guidance.low', g, calc=g.calc(0))
    ev.add('numbers.guidance.high', g, calc=g.calc(0))
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(eps.values[2]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm0), 'previous': float(gm1)},
               'guidance': {'low': float(g.values[0]), 'high': float(g.values[0]), 'grossMarginPercent': None}, 'segments': None}
    semis, soft, ai = f['semis'], f['software'], f['ai']
    prev_segments = {s['key']: s for s in ((previous or {}).get('numbers') or {}).get('segments') or []}
    prev_quotes = {e['field']: e for e in (previous or {}).get('evidence') or []}
    seg_prev = {k: Decimal(str(v['revenue'])) for k, v in prev_segments.items()}
    have_report = all(k in report for k in ('semisOpIncome', 'softwareOpIncome', 'semisReport', 'softwareReport'))
    margins = {}
    if have_report and set(prev_segments) == {'semis', 'software'}:
        segments = []
        for i, (key, ja, en, rel, opi, rep) in enumerate((('semis', '半導体', 'Semiconductor solutions', semis, report['semisOpIncome'], report['semisReport']),
                                                         ('software', 'インフラ・ソフトウェア', 'Infrastructure software', soft, report['softwareOpIncome'], report['softwareReport']))):
            margin = q(opi.values[0] / rep.values[0] * 100, 1)
            margins[key] = (margin, Decimal(str(prev_segments[key]['operatingMargin'])))
            ev.add(f'numbers.segments[{i}].revenue', rep, url=rep.url)
            ev.add(f'numbers.segments[{i}].operatingMargin', opi, url=opi.url)
            ev.add(f'numbers.segments[{i}].operatingMargin', rep, calc=f'{opi.raws[0]} / {rep.raws[0]} * 100', rnd=1, url=rep.url)
            for old, new in (('revenue', 'previous'), ('operatingMargin', 'previousOperatingMargin')):
                for e in [x for x in previous['evidence'] if x['field'] in (f'numbers.segments[{i}].{old}', f'numbers.segments.{key}.{old}')]:
                    ev.items.append({**e, 'field': f'numbers.segments[{i}].{new}'})
            segments.append({'key': key, 'nameJa': ja, 'nameEn': en, 'revenue': float(rep.values[0]), 'previous': float(seg_prev[key]),
                             'operatingMargin': float(margin), 'previousOperatingMargin': prev_segments[key]['operatingMargin']})
        numbers['segments'] = segments
    tiles = [{'label': c('売上高', 'Revenue'), 'value': money_tile(ev, 0, rev, 0, None), 'note': c(f'前年同期比 {sign(yoy, 0)}', f'{sign(yoy, 0)} YoY')}]
    ev.add('tiles[0].note', rev, calc=f'({rev.raws[0]} / {rev.raws[2]} - 1) * 100', rnd=0)
    shown, places, scale = _g().money(ai.values[0], 'USD')
    tiles.append({'label': c('AI半導体の売上', 'AI semiconductor revenue'), 'value': shown, 'note': c(f'前年同期比 +{ai.raws[1]}%', f'+{ai.raws[1]}% YoY')})
    ev.add('tiles[1].value', ai, calc=f'{ai.raws[0]} * 1000 / 1000', rnd=places)
    ev.add('tiles[1].note', ai)
    if 'topFive' in report:
        t5 = report['topFive']
        tiles.append({'label': c('上位5社への売上比率', 'Top five end customers'), 'value': c(f'約{t5.values[0]}%', f'~{t5.values[0]}% of revenue'),
                      'note': c(f'前年同期は約{t5.values[2]}%', f'About {t5.values[2]}% a year earlier')})
        ev.add('tiles[2].value', t5, url=t5.url)
        ev.add('tiles[2].note', t5, url=t5.url)
    else:
        tiles.append({'label': c('フリーキャッシュフロー', 'Free cash flow'), 'value': money_tile(ev, 2, fcf, 0, None),
                      'note': c(f'売上の{q(fcf.values[0] / r0 * 100, 0)}%', f'{q(fcf.values[0] / r0 * 100, 0)}% of revenue')})
        if 'fcfShare' in f:
            ev.add('tiles[2].note', f['fcfShare'])
        else:
            raise ValueError('missing:fcfShare')
    sp = seg_prev.get('semis')
    s0 = semis.values[0]
    share0, share1 = q(s0 / r0 * 100, 0), (q(sp / r1 * 100, 0) if sp else None)
    d_total = r0 - r1
    growth_sections = [
        {'key': 'happened', 'text': c((f'半導体部門の売上は{usd(sp)["ja"]}から{usd(s0)["ja"]}へ、{usd(s0 - sp)["ja"]}増えました。' if sp else f'半導体部門の売上は{usd(s0)["ja"]}でした。')
                                      + f'そのうちAI半導体の売上は{usd(ai.values[0])["ja"]}で、前期比+{ai.raws[2]}%です。'
                                      + (f'部門の営業利益率は{margins["semis"][1]}%から{margins["semis"][0]}%になりました。' if margins else ''),
                                      (f'Semiconductor solutions revenue rose from {usd(sp)["en"]} to {usd(s0)["en"]}, up {usd(s0 - sp)["en"]}. ' if sp else f'Semiconductor solutions revenue was {usd(s0)["en"]}. ')
                                      + f'AI semiconductor revenue within it was {usd(ai.values[0])["en"]}, up {ai.raws[2]}% from the previous quarter.'
                                      + (f' The segment operating margin went from {margins["semis"][1]}% to {margins["semis"][0]}%.' if margins else ''))}]
    soft_prev = seg_prev.get('software')
    if sp and d_total > 0:
        part = q((s0 - sp) / d_total * 100, 0)
        growth_sections.append({'key': 'good', 'text': c(f'会社全体の売上は前期から{usd(d_total)["ja"]}増え、そのうち約{part}%がこの部門の増加分です。'
                                                         + (f'インフラ・ソフトウェアも{usd(soft_prev)["ja"]}から{usd(soft.values[0])["ja"]}に増えました。' if soft_prev else '')
                                                         + (f'その営業利益率は{margins["software"][1]}%から{margins["software"][0]}%です。' if margins else ''),
                                                         f'Total revenue rose {usd(d_total)["en"]} from the previous quarter, and about {part}% of that came from this segment.'
                                                         + (f' Infrastructure software also grew from {usd(soft_prev)["en"]} to {usd(soft.values[0])["en"]}' if soft_prev else '')
                                                         + (f', with its operating margin going from {margins["software"][1]}% to {margins["software"][0]}%.' if margins and soft_prev else '.' if soft_prev else ''))})
    growth_sections.append({'key': 'watch', 'text': c('伸びはAI向けの専用チップとネットワーク製品に集中しています。' + ('売上が大きく増えても、部門の利益率は' + ('少し下がりました。' if margins and margins['semis'][0] < margins['semis'][1] else '大きくは変わっていません。') if margins else ''),
                                                      'Growth is concentrated in custom AI accelerators and networking.' + (' Even with much higher sales, the segment margin ' + ('edged down.' if margins and margins['semis'][0] < margins['semis'][1] else 'held roughly steady.') if margins else ''))})
    growth = {'headline': c('半導体部門が伸びを主導', 'Semiconductor solutions led the growth'),
              'chips': [{'tone': 'up', 'text': c(f'部門売上 {sign(change(s0, sp))}', f'Segment revenue {sign(change(s0, sp))}')} if sp else
                        {'tone': 'up', 'text': c(f'部門売上 前年同期比 {sign(change(s0, semis.values[2]))}', f'Segment revenue {sign(change(s0, semis.values[2]))} YoY')}]
                       + ([{'tone': 'down' if margins['semis'][0] < margins['semis'][1] else 'up', 'text': c(f'部門営業利益率 {margins["semis"][1]}% → {margins["semis"][0]}%', f'Segment operating margin {margins["semis"][1]}% → {margins["semis"][0]}%')}]
                          if margins else [{'tone': 'gold', 'text': c(f'AI半導体 前期比 +{ai.raws[2]}%', f'AI semiconductors +{ai.raws[2]}% QoQ')}]),
              'sections': growth_sections}
    om0, om1 = q(op.values[0] / r0 * 100, 1), q(op.values[1] / r1 * 100, 1)
    changes = {
        'headline': c(f'売上は前期比 {sign(qoq)}、粗利益率は{"低下" if gm0 < gm1 else "上昇" if gm0 > gm1 else "横ばい"}', f'Revenue {"up" if qoq >= 0 else "down"} {format(abs(q(qoq)), "f")}% QoQ, gross margin {"lower" if gm0 < gm1 else "higher" if gm0 > gm1 else "flat"}'),
        'chips': [{'tone': 'up' if qoq >= 0 else 'down', 'text': c(f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ')},
                  {'tone': 'down' if gm0 < gm1 else 'up' if gm0 > gm1 else 'gold', 'text': c(f'調整後粗利益率 {gm1}% → {gm0}%', f'Non-GAAP gross margin {gm1}% → {gm0}%')}],
        'sections': [
            {'key': 'happened', 'text': c(f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d_total))["ja"]}{"増え" if d_total >= 0 else "減り"}ました。調整後粗利益率は{gm1}%から{gm0}%になりました。',
                                          f'Revenue {"rose" if d_total >= 0 else "fell"} from {usd(r1)["en"]} to {usd(r0)["en"]}, {"up" if d_total >= 0 else "down"} {usd(abs(d_total))["en"]}. Non-GAAP gross margin went from {gm1}% to {gm0}%.')},
            {'key': 'good', 'text': c(f'調整後の営業利益は{usd(op.values[1])["ja"]}から{usd(op.values[0])["ja"]}へ、約{q(change(op.values[0], op.values[1]), 0)}%増えました。フリーキャッシュフローは{usd(fcf.values[0])["ja"]}で、売上の{q(fcf.values[0] / r0 * 100, 0)}%です。',
                                      f'Non-GAAP operating income rose about {q(change(op.values[0], op.values[1]), 0)}%, from {usd(op.values[1])["en"]} to {usd(op.values[0])["en"]}. Free cash flow was {usd(fcf.values[0])["en"]}, or {q(fcf.values[0] / r0 * 100, 0)}% of revenue.')},
            {'key': 'watch', 'text': c(f'会社は理由を説明していませんが、売上に占める半導体の比率は{share1}%から{share0}%に上がりました。利益率の低い半導体が、利益率の高いソフトウェアより速く伸びると、全体の粗利益率は下がりやすくなります。' if share1 is not None else
                                       f'売上に占める半導体の比率は{share0}%です。利益率の低い半導体の比率が上がると、全体の粗利益率は下がりやすくなります。',
                                       f'The company did not explain the change, but semiconductors went from {share1}% to {share0}% of revenue. When lower-margin semiconductors grow faster than higher-margin software, the overall gross margin tends to fall.' if share1 is not None else
                                       f'Semiconductors were {share0}% of revenue. When lower-margin semiconductors grow faster, the overall gross margin tends to fall.')},
            {'key': 'view', 'text': c('売上と利益の金額は大きく伸びていますが、利益率は下がる方向なので、金額と率は分けて読む必要があります。' if gm0 < gm1 else '売上と利益の金額、利益率の両方を追います。',
                                      'Revenue and profit dollars grew strongly, but margins are moving down, so amounts and rates need to be read separately.' if gm0 < gm1 else 'Track both the amounts and the margins.')}]}
    if 'topFive' in report:
        t5 = report['topFive']
        dist = report.get('distributor')
        ev.add('summary.cards.caution.sections[0]', t5)
        if dist:
            ev.add('summary.cards.caution.sections[0]', dist)
        caution = {
            'headline': c(f'売上の約{t5.values[0]}%が上位5社', f'About {t5.values[0]}% of revenue comes from the top five customers'),
            'chips': [{'tone': 'down', 'text': c(f'上位5社 約{t5.values[2]}% → 約{t5.values[0]}%', f'Top five ~{t5.values[2]}% → ~{t5.values[0]}%')}]
                     + ([{'tone': 'gold', 'text': c(f'1社の代理店:売上の{dist.values[0]}%', f'One distributor: {dist.values[0]}% of revenue')}] if dist else []),
            'sections': [
                {'key': 'happened', 'text': c(f'10-Qによると、上位5社の最終顧客が売上の約{t5.values[0]}%を占め、前年同期の約{t5.values[2]}%から上がりました。' + (f'1社の代理店への直接販売が売上の{dist.values[0]}%で、前年同期は{dist.values[2]}%でした。' if dist else ''),
                                              f'According to the quarterly report, the top five end customers made up about {t5.values[0]}% of revenue, up from about {t5.values[2]}% a year earlier.' + (f' Direct sales to one distributor accounted for {dist.values[0]}% of revenue ({dist.values[2]}% a year earlier).' if dist else ''))},
                {'key': 'watch', 'text': c('少数の大口顧客の発注計画が変わると、売上は大きく動きます。会社自身も、この集中が四半期ごとの業績の振れを大きくするとしています。',
                                           'A change in the ordering plans of a few large customers can move revenue sharply. The company itself says this concentration increases the risk of quarterly swings in its results.')},
                {'key': 'means', 'text': c('成長は力強い一方、伸びるほど集中も高まっています。', 'Growth is strong, but the more it grows, the higher the concentration becomes.')},
                {'key': 'view', 'text': c('次の決算で、上位顧客の比率がさらに上がるかを確かめます。', 'Check in the next report whether the top-customer share rises further.')}]}
    else:
        ai_share = q(ai.values[0] / r0 * 100, 0)
        caution = {
            'headline': c(f'売上の約{ai_share}%がAI半導体', f'About {ai_share}% of revenue is AI semiconductors'),
            'chips': [{'tone': 'gold', 'text': c(f'AI半導体 売上の約{ai_share}%', f'AI semiconductors ~{ai_share}% of revenue')},
                      {'tone': 'gold', 'text': c(f'半導体部門 売上の{share0}%', f'Semiconductors {share0}% of revenue')}],
            'sections': [
                {'key': 'happened', 'text': c(f'AI半導体の売上は{usd(ai.values[0])["ja"]}で、売上全体の約{ai_share}%です。', f'AI semiconductor revenue was {usd(ai.values[0])["en"]}, about {ai_share}% of total revenue.')},
                {'key': 'watch', 'text': c('AI向けの大口顧客は少数で、その発注計画が変わると売上は大きく動きます。顧客の集中度は、翌日以降に出る10-Qで確かめます。',
                                           'AI customers are few, so a change in their ordering plans can move revenue sharply. The 10-Q, filed after the release, shows the customer concentration.')},
                {'key': 'means', 'text': c('成長は力強い一方、伸びるほど一部の事業への依存も高まります。', 'Growth is strong, but the more it grows, the more it depends on one business.')},
                {'key': 'view', 'text': c('次の決算で、AI半導体の比率と利益率の動きを確かめます。', 'Check the AI share and the margins in the next report.')}]}
    go = f['guidanceOpMargin'].values[0]
    gai = f['guidanceAi'].values[0]
    nxt = {
        'headline': c('次期の会社見通しを追う', "Follow the company's outlook for next quarter"),
        'chips': [{'tone': 'gold', 'text': c(f'売上 約{usd(g.values[0])["ja"]}', f'Revenue ~{usd(g.values[0])["en"]}')},
                  {'tone': 'gold', 'text': c(f'AI半導体 {usd(gai)["ja"]}', f'AI semiconductors {usd(gai)["en"]}')},
                  {'tone': 'gold', 'text': c(f'調整後営業利益率 約{go}%', f'Non-GAAP operating margin ~{go}%')}],
        'sections': [
            {'key': 'happened', 'text': c(f'会社は次期の売上を約{usd(g.values[0])["ja"]}と見込み、そのうちAI半導体は{usd(gai)["ja"]}です。今回の売上は{usd(r0)["ja"]}なので、約{q(change(g.values[0], r0), 1)}%の増加になります。',
                                          f"The company expects next-quarter revenue of about {usd(g.values[0])['en']}, including {usd(gai)['en']} of AI semiconductor revenue. This quarter's revenue was {usd(r0)['en']}, so that would be about {q(change(g.values[0], r0), 1)}% higher.")},
            {'key': 'watch', 'text': c(f'調整後営業利益率の見通しは約{go}%で、今回の約{om0}%を{"下回り" if go < om0 else "上回り"}ます。粗利益率の見通しは示されていません。',
                                       f"The non-GAAP operating margin outlook is about {go}%, {'below' if go < om0 else 'above'} this quarter's roughly {om0}%. No gross margin outlook was given.")},
            {'key': 'view', 'text': c('次の決算で、売上とAI半導体の売上が見通しに届くかを確かめます。', 'The next report will show whether revenue and AI semiconductor revenue meet the outlook.')}]}
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期から約{q(qoq, 0)}%増えました。けん引したのはAI半導体({usd(ai.values[0])["ja"]}、前期比+{ai.raws[2]}%)です。',
          f'Revenue was {usd(r0)["en"]}, up about {q(qoq, 0)}% from the previous quarter, led by AI semiconductors ({usd(ai.values[0])["en"]}, up {ai.raws[2]}% QoQ).'),
        c(f'一方、調整後粗利益率は{gm1}%から{gm0}%になりました。' + (f'売上の約{report["topFive"].values[0]}%は上位5社の最終顧客です。' if 'topFive' in report else ''),
          f'Meanwhile, non-GAAP gross margin went from {gm1}% to {gm0}%.' + (f' About {report["topFive"].values[0]}% of revenue came from the top five end customers.' if 'topFive' in report else '')),
        c(f'会社は次期の売上を約{usd(g.values[0])["ja"]}、そのうちAI半導体を{usd(gai)["ja"]}と見込んでいます。', f'The company expects next-quarter revenue of about {usd(g.values[0])["en"]}, including {usd(gai)["en"]} of AI semiconductor revenue.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items,
            'summary': {'conclusion': conclusion, 'cards': {'growth': growth, 'change': changes, 'caution': caution, 'next': nxt}}}


# ---- TSMC (TSM): NT$ millions; its US-dollar figures and guidance are shown in US dollars, as the company states them ----------

def twd(million):
    return _g().money(million, 'TWD')[0]


def pt(delta):
    v = q(delta, 1)
    return ('+' if v > 0 else '−' if v < 0 else '±') + format(abs(v), 'f') + 'pt'


def tsm(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'netIncome', 'eps', 'usd', 'nodes', 'advanced', 'guidance', 'guidanceMargins', 'gm', 'om', 'nonOperating', 'netMargin',
         'shipments', 'ocf', 'capex', 'fcf', 'fullYear')
    ev = Evidence(url)
    rev, gm, om = f['revenue'], f['gm'], f['om']
    r0, r2, r1 = rev.values[0], rev.values[1], rev.values[3]
    yoy, qoq = rev.values[2], rev.values[4]
    for field, i in (('current', 0), ('yearAgo', 1), ('previous', 3)):
        ev.add(f'numbers.revenue.{field}', rev)
    ev.add('numbers.adjustedEPS', f['eps'])
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    g = f['guidance']
    lo_us, hi_us, rate = (Decimal(x) for x in g.values)
    gml, gmh, oml, omh = f['guidanceMargins'].values
    ev.add('numbers.guidance.low', g, calc=f'{g.raws[0]} * 1000 * {g.raws[2]}')
    ev.add('numbers.guidance.high', g, calc=f'{g.raws[1]} * 1000 * {g.raws[2]}')
    ev.add('numbers.guidance.grossMarginPercent', f['guidanceMargins'], calc=f'({gml} + {gmh}) / 2')
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(f['eps'].values[0]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm.values[0]), 'previous': float(gm.values[3])},
               'guidance': {'low': float(lo_us * 1000 * rate), 'high': float(hi_us * 1000 * rate), 'grossMarginPercent': float((gml + gmh) / 2)}, 'segments': None}
    usd_ = f['usd']
    n2, n3, n5, n7 = f['nodes'].values
    adv = f['advanced'].values[0]
    tiles = [{'label': c('売上高(台湾ドル)', 'Revenue (NT$)'), 'value': money_tile(ev, 0, rev, 0, None, 'TWD'), 'note': c(f'前年同期比 +{rev.raws[2]}%', f'+{rev.raws[2]}% YoY')},
             {'label': c('売上高(ドル換算)', 'Revenue (US$)'), 'value': usd(usd_.values[0]), 'note': c(f'前年同期比 +{usd_.raws[1]}%', f'+{usd_.raws[1]}% YoY')},
             {'label': c('7nm以下の先端品の比率', 'Advanced nodes (7nm and below)'), 'value': c(f'ウエハー売上の{adv}%', f'{adv}% of wafer revenue'),
              'note': c(f'2nmが{n2}%', f'{n2}% from 2-nanometer')}]
    ev.add('tiles[0].note', rev)
    ev.add('tiles[1].value', usd_, calc=f'{usd_.raws[0]} * 1000 / 1000', rnd=2)
    ev.add('tiles[1].note', usd_)
    ev.add('tiles[2].value', f['advanced'])
    ev.add('tiles[2].note', f['nodes'])
    ship = f['shipments'].values
    growth = {'headline': c(f'先端品がウエハー売上の{adv}%に', f'Advanced nodes reached {adv}% of wafer revenue'),
              'chips': [{'tone': 'up', 'text': c(f'3nm {n3}%・5nm {n5}%・2nm {n2}%', f'3nm {n3}% · 5nm {n5}% · 2nm {n2}%')},
                        {'tone': 'up' if Decimal(ship[3]) >= 0 else 'down', 'text': c(f'ウエハー出荷 前期比 {sign(Decimal(ship[3]))}', f'Wafer shipments {sign(Decimal(ship[3]))} QoQ')}],
              'sections': [
                  {'key': 'happened', 'text': c(f'7nm以下の先端品がウエハー売上の{adv}%を占めました。内訳は3nmが{n3}%、5nmが{n5}%、7nmが{n7}%で、最新の2nmは{n2}%です。',
                                                f'Advanced nodes (7nm and below) made up {adv}% of wafer revenue: 3nm {n3}%, 5nm {n5}%, 7nm {n7}%, and the newest 2nm reached {n2}%.')},
                  {'key': 'good', 'text': c(f'ウエハー出荷は前期比{sign(Decimal(ship[3]))}でしたが、売上は{sign(qoq)}でした。1枚あたりの売上が大きい先端品の比率が高まったことを示しています。',
                                            f'Wafer shipments rose {sign(Decimal(ship[3]))} from the previous quarter, but revenue rose {sign(qoq)}. That points to a higher share of advanced wafers that bring in more revenue per wafer.')},
                  {'key': 'watch', 'text': c('成長は最先端の工程への需要に支えられています。AI向けなど最先端の半導体の需要が弱まると、成長は鈍ります。',
                                             'Growth depends on demand for leading-edge processes. If demand for leading-edge chips such as AI processors weakens, growth would slow.')}]}
    ni = f['netIncome']
    nonop, nm = f['nonOperating'].values, f['netMargin'].values
    ocf0, capex0, fcf0, fcf1 = f['ocf'].values[0] * 1000, abs(f['capex'].values[0]) * 1000, f['fcf'].values[0] * 1000, f['fcf'].values[1] * 1000
    changes = {'headline': c(f'売上は前期比 {sign(qoq)}、粗利益率は{"低下" if gm.values[0] < gm.values[3] else "上昇"}', f'Revenue {"up" if qoq >= 0 else "down"} {abs(qoq)}% QoQ, gross margin {"lower" if gm.values[0] < gm.values[3] else "higher"}'),
               'chips': [{'tone': 'up' if qoq >= 0 else 'down', 'text': c(f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ')},
                         {'tone': 'down' if gm.values[0] < gm.values[3] else 'up', 'text': c(f'粗利益率 {gm.values[3]}% → {gm.values[0]}%', f'Gross margin {gm.values[3]}% → {gm.values[0]}%')}],
               'sections': [
                   {'key': 'happened', 'text': c(f'売上は{twd(r1)["ja"]}から{twd(r0)["ja"]}へ、{twd(r0 - r1)["ja"]}増えました。粗利益率は{gm.values[3]}%から{gm.values[0]}%になりました。',
                                                 f'Revenue rose from {twd(r1)["en"]} to {twd(r0)["en"]}, up {twd(r0 - r1)["en"]}. Gross margin went from {gm.values[3]}% to {gm.values[0]}%.')},
                   {'key': 'good', 'text': c(f'営業キャッシュフローは{twd(ocf0)["ja"]}で、設備投資{twd(capex0)["ja"]}を差し引いたフリーキャッシュフローは{twd(fcf0)["ja"]}でした。前期は{twd(fcf1)["ja"]}です。',
                                             f'Operating cash flow was {twd(ocf0)["en"]}, and after capex of {twd(capex0)["en"]}, free cash flow was {twd(fcf0)["en"]}, versus {twd(fcf1)["en"]} last quarter.')},
                   {'key': 'watch', 'text': c(f'純利益は前期比+{ni.raws[4]}%で、売上の伸び{sign(qoq)}より小さくなりました。営業外の損益は{twd(nonop[1] * 1000)["ja"]}から{twd(nonop[0] * 1000)["ja"]}になり、純利益率は{nm[1]}%から{nm[0]}%です。',
                                              f'Net income rose only {ni.raws[4]}%, less than revenue ({sign(qoq)}). Non-operating items went from NT${nonop[1]}B to NT${nonop[0]}B, and net profit margin from {nm[1]}% to {nm[0]}%.')},
                   {'key': 'view', 'text': c('本業の売上は大きく伸びました。純利益の伸びが小さいのは主に営業外の利益が減ったためなので、本業と営業外を分けて読みます。',
                                             'Core revenue grew strongly. Net income lagged mainly because non-operating gains shrank, so read core operations and non-operating items separately.')}]}
    gl_prev, gh_prev, ol_prev, oh_prev = gm.values[1], gm.values[2], om.values[1], om.values[2]
    caution = {'headline': c('粗利益率と営業利益率がともに前期から低下' if gm.values[0] < gm.values[3] and om.values[0] < om.values[3] else '利益率の動き',
                             'Gross and operating margins both fell from last quarter' if gm.values[0] < gm.values[3] and om.values[0] < om.values[3] else 'How the margins moved'),
               'chips': [{'tone': 'down' if gm.values[0] < gm.values[3] else 'up', 'text': c(f'粗利益率 {pt(gm.values[0] - gm.values[3])}', f'Gross margin {pt(gm.values[0] - gm.values[3])}')},
                         {'tone': 'down' if om.values[0] < om.values[3] else 'up', 'text': c(f'営業利益率 {om.values[3]}% → {om.values[0]}%', f'Operating margin {om.values[3]}% → {om.values[0]}%')}],
               'sections': [
                   {'key': 'happened', 'text': c(f'粗利益率は{gm.values[3]}%から{gm.values[0]}%、営業利益率は{om.values[3]}%から{om.values[0]}%になりました。会社の事前の見通しは粗利益率{gl_prev}〜{gh_prev}%、営業利益率{ol_prev}〜{oh_prev}%でした。',
                                                 f"Gross margin went from {gm.values[3]}% to {gm.values[0]}% and operating margin from {om.values[3]}% to {om.values[0]}%. The company's earlier guidance was gross {gl_prev}–{gh_prev}% and operating {ol_prev}–{oh_prev}%.")},
                   {'key': 'watch', 'text': c(f'次期の見通しは粗利益率{gml}〜{gmh}%、営業利益率{oml}〜{omh}%です。今回は粗利益率{gm.values[0]}%、営業利益率{om.values[0]}%でした。',
                                              f"Next quarter's guidance is {gml}–{gmh}% gross margin and {oml}–{omh}% operating margin, versus {gm.values[0]}% and {om.values[0]}% this quarter.")},
                   {'key': 'means', 'text': c(f'見通しは1ドル={rate}台湾ドルを前提にしています。台湾ドル高になると、台湾ドル建ての売上と利益率は下がります。',
                                              f'The guidance assumes 1 US dollar = {rate} NT dollars. A stronger NT dollar would lower revenue and margins in NT dollar terms.')},
                   {'key': 'view', 'text': c('利益率は高い水準にあります。次の四半期に新しい工程の立ち上げが進むなかで、どこまで保てるかを確かめます。',
                                             'Margins remain high. Check how well they hold as new processes ramp next quarter.')}]}
    lo_change = q(change(lo_us * 1000, usd_.values[0]), 0)
    fy, fy_growth = f['fullYear'].values
    nxt = {'headline': c('次期の会社見通しを追う', "Follow the company's outlook for next quarter"),
           'chips': [{'tone': 'gold', 'text': c(f'売上 {usd(lo_us * 1000)["ja"]}〜{usd(hi_us * 1000)["ja"]}', f'Revenue US${lo_us}–{hi_us}B')},
                     {'tone': 'gold', 'text': c(f'粗利益率 {gml}〜{gmh}%', f'Gross margin {gml}–{gmh}%')}],
           'sections': [
               {'key': 'happened', 'text': c(f'会社は次期の売上を{usd(lo_us * 1000)["ja"]}〜{usd(hi_us * 1000)["ja"]}と見込んでいます。1ドル={rate}台湾ドルで約{twd(lo_us * 1000 * rate)["ja"]}〜{twd(hi_us * 1000 * rate)["ja"]}です。今回の{usd(usd_.values[0])["ja"]}と比べ、下限でも約{lo_change}%多くなります。',
                                             f"The company expects next-quarter revenue of US${lo_us}B to US${hi_us}B (about {twd(lo_us * 1000 * rate)['en']} to {twd(hi_us * 1000 * rate)['en']} at {rate} NT dollars per US dollar). Compared with this quarter's {usd(usd_.values[0])['en']}, even the low end would be about {lo_change}% higher.")},
               {'key': 'means', 'text': c(f'会社は{fy}年の売上がドル建てで約{fy_growth}%増えると見込んでいます。', f'It expects {fy} revenue to grow about {fy_growth}% in US dollar terms.')},
               {'key': 'view', 'text': c(f'次の決算で、売上が見通しの幅のどこに入るか、粗利益率が{gml}〜{gmh}%のどこに収まるかを確かめます。',
                                         f'In the next report, check where revenue lands in this range and where gross margin ends up within {gml}–{gmh}%.')}]}
    conclusion = [c(f'売上は{twd(r0)["ja"]}で、前期比{sign(qoq)}、前年同期比+{rev.raws[2]}%でした。ドル換算では{usd(usd_.values[0])["ja"]}です。',
                    f'Revenue was {twd(r0)["en"]}, up {qoq}% from the previous quarter and {rev.raws[2]}% from a year ago. In US dollars it was {usd(usd_.values[0])["en"]}.'),
                  c(f'一方、粗利益率は{gm.values[3]}%から{gm.values[0]}%になり、純利益は前期比+{ni.raws[4]}%にとどまりました。',
                    f'Meanwhile, gross margin went from {gm.values[3]}% to {gm.values[0]}%, and net income rose only {ni.raws[4]}% from the previous quarter.'),
                  c(f'会社は次期の売上を{usd(lo_us * 1000)["ja"]}〜{usd(hi_us * 1000)["ja"]}、粗利益率を{gml}〜{gmh}%と見込んでいます。',
                    f'The company expects next-quarter revenue of US${lo_us}B to US${hi_us}B with a gross margin of {gml}–{gmh}%.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items,
            'summary': {'conclusion': conclusion, 'cards': {'growth': growth, 'change': changes, 'caution': caution, 'next': nxt}}}


# ---- ASML: € millions ------------------------------------------------------------------------------------------------------

def eur(million):
    return _g().money(million, 'EUR')[0]


def asml(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'ibm', 'systems', 'gm', 'netIncome', 'eps', 'guidance', 'fullYear', 'history', 'om', 'equityGain', 'contractLiabilities')
    ev = Evidence(url)
    rev, gm, hist = f['revenue'], f['gm'], f['history']
    r1, r0 = rev.values
    r2 = hist.values[0]
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.previous', rev)
    ev.add('numbers.revenue.yearAgo', hist)
    ev.add('numbers.adjustedEPS', f['eps'])
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    g = f['guidance']
    _, glo, ghi, ggm = g.values
    ev.add('numbers.guidance.low', g, calc=f'{glo} * 1000')
    ev.add('numbers.guidance.high', g, calc=f'{ghi} * 1000')
    ev.add('numbers.guidance.grossMarginPercent', g)
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(f['eps'].values[1]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm.values[1]), 'previous': float(gm.values[0])},
               'guidance': {'low': float(Decimal(glo) * 1000), 'high': float(Decimal(ghi) * 1000), 'grossMarginPercent': float(ggm)}, 'segments': None}
    ni1, ni0 = f['netIncome'].values
    gain = f['equityGain'].values[1]
    tiles = [{'label': c('売上高', 'Total net sales'), 'value': eur(r0), 'note': c(f'前年同期比 {sign(yoy, 0)}', f'{sign(yoy, 0)} YoY')},
             {'label': c('粗利益率', 'Gross margin'), 'value': c(f'{gm.values[1]}%', f'{gm.values[1]}%'), 'note': c(f'前四半期 {gm.values[0]}%', f'{gm.values[0]}% last quarter')},
             {'label': c('純利益', 'Net income'), 'value': eur(ni0), 'note': c(f'持分投資の利益 {eur(gain)["ja"]}を含む', f'Includes a €{format(q(gain / 1000, 2), "f")}B equity investment gain')}]
    ev.add('tiles[0].value', hist, calc=f'{hist.raws[4]} / 1000', rnd=2)
    ev.add('tiles[0].note', hist, calc=f'({hist.raws[4]} / {hist.raws[0]} - 1) * 100', rnd=0)
    ev.add('tiles[1].value', gm)
    ev.add('tiles[1].note', gm)
    ev.add('tiles[2].value', f['netIncome'], calc=f'{f["netIncome"].raws[1]} / 1000', rnd=2)
    ev.add('tiles[2].note', f['equityGain'], calc=f'{f["equityGain"].raws[1]} / 1000', rnd=2)
    s1, s0 = f['systems'].values
    i1, i0 = f['ibm'].values
    h = hist.values
    growth = {'headline': c(f'新しい露光装置の販売台数が{s1}台から{s0}台に', f'New systems sold rose from {s1} to {s0}' if s0 >= s1 else f'New systems sold went from {s1} to {s0}'),
              'chips': [{'tone': 'up' if s0 >= s1 else 'down', 'text': c(f'新規露光装置 {s1} → {s0}台', f'New lithography systems {s1} → {s0}')},
                        {'tone': 'up' if i0 >= i1 else 'down', 'text': c(f'保守・アップグレード {eur(i1)["ja"]} → {eur(i0)["ja"]}', f'Installed Base {eur(i1)["en"]} → {eur(i0)["en"]}')}],
              'sections': [
                  {'key': 'happened', 'text': c(f'新しい露光装置の販売台数は{s1}台から{s0}台になりました。保守・アップグレード(Installed Base Management)の売上は{eur(i1)["ja"]}から{eur(i0)["ja"]}です。',
                                                f'New lithography systems sold went from {s1} to {s0}. Installed Base Management sales (service and upgrades) went from {eur(i1)["en"]} to {eur(i0)["en"]}.')},
                  {'key': 'good', 'text': c('新しい装置と、設置済みの装置向けのサービスの両方が伸びました。', 'Both new systems and service on installed machines grew.') if s0 >= s1 and i0 >= i1 else
                   c('装置とサービスの動きが分かれました。', 'Systems and service moved in different directions.')},
                  {'key': 'watch', 'text': c(f'装置の売上は出荷の台数と時期で大きく動きます。この1年の売上は{eur(h[0])["ja"]}、{eur(h[1])["ja"]}、{eur(h[2])["ja"]}、{eur(h[3])["ja"]}と上下しています。',
                                             f'System sales move a lot with the number and timing of shipments. Over the past year sales went {eur(h[0])["en"]}, {eur(h[1])["en"]}, {eur(h[2])["en"]} and {eur(h[3])["en"]}.')}]}
    om = f['om'].values
    changes = {'headline': c(f'売上は前期比 {sign(qoq)}、粗利益率は{"上昇" if gm.values[1] > gm.values[0] else "低下"}', f'Revenue {"up" if qoq >= 0 else "down"} {format(abs(q(qoq)), "f")}% QoQ, gross margin {"also higher" if gm.values[1] > gm.values[0] else "lower"}'),
               'chips': [{'tone': 'up' if qoq >= 0 else 'down', 'text': c(f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ')},
                         {'tone': 'up' if gm.values[1] > gm.values[0] else 'down', 'text': c(f'粗利益率 {gm.values[0]}% → {gm.values[1]}%', f'Gross margin {gm.values[0]}% → {gm.values[1]}%')}],
               'sections': [
                   {'key': 'happened', 'text': c(f'売上は{eur(r1)["ja"]}から{eur(r0)["ja"]}へ、{eur(abs(r0 - r1))["ja"]}{"増え" if r0 >= r1 else "減り"}ました。粗利益率は{gm.values[0]}%から{gm.values[1]}%です。',
                                                 f'Total net sales went from {eur(r1)["en"]} to {eur(r0)["en"]}, {"up" if r0 >= r1 else "down"} {eur(abs(r0 - r1))["en"]}. Gross margin went from {gm.values[0]}% to {gm.values[1]}%.')},
                   {'key': 'good', 'text': c(f'営業利益率は{om[3]}%から{om[4]}%になりました。', f'Operating margin went from {om[3]}% to {om[4]}%.')},
                   {'key': 'watch', 'text': c(f'純利益は{eur(ni1)["ja"]}から{eur(ni0)["ja"]}になりましたが、持分投資の利益約{eur(gain)["ja"]}を含みます。毎四半期続くものではありません。' if gain else f'純利益は{eur(ni1)["ja"]}から{eur(ni0)["ja"]}になりました。',
                                              f'Net income went from {eur(ni1)["en"]} to {eur(ni0)["en"]}, but that includes a gain of about {eur(gain)["en"]} on equity investments, which does not recur every quarter.' if gain else f'Net income went from {eur(ni1)["en"]} to {eur(ni0)["en"]}.')},
                   {'key': 'view', 'text': c('本業の伸びは営業利益とあわせて読みます。', 'Read net income growth alongside operating profit.')}]}
    cl0, cl1 = f['contractLiabilities'].values
    if 'supply' in f:
        y1, y2 = f['supply'].values
        cap = f.get('capacity')
        caution = {'headline': c(f'{y1}年と{y2}年の供給は需要に届かない見込み', f'Supply for {y1} and {y2} is not expected to meet demand'),
                   'chips': [{'tone': 'gold', 'text': c(f'{y1}〜{y2}年の計画供給は需要に届かず', f'Planned {y1}–{y2[2:]} supply short of demand')},
                             {'tone': 'gold', 'text': c(f'長期の前受金 {eur(cl0)["ja"]} → {eur(cl1)["ja"]}', f'Contract liabilities {eur(cl0)["en"]} → {eur(cl1)["en"]}')}],
                   'sections': [
                       {'key': 'happened', 'text': c(f'会社は、現在計画している{y1}年と{y2}年の供給では顧客の需要を満たしきれないとしています。' + (f'{cap.values[0]}年の生産能力について、以前に示した{cap.values[1]}%増を超える増強を検討しています。' if cap else ''),
                                                     f'The company said its currently planned supply for {y1} and {y2} will not fully meet customer demand' + (f', and it is investigating capacity for {cap.values[0]} beyond the {cap.values[1]}% increase announced earlier.' if cap else '.'))},
                       {'key': 'watch', 'text': c(f'需要があっても、売上は作れる台数で上限が決まり、増産には時間と投資がかかります。長期の前受金(契約負債)は昨年末の{eur(cl0)["ja"]}から{eur(cl1)["ja"]}に増えました。',
                                                  f'Even with demand, revenue is capped by how many machines can be built, and adding capacity takes time and investment. Long-term contract liabilities rose from {eur(cl0)["en"]} at the end of last year to {eur(cl1)["en"]}.')},
                       {'key': 'means', 'text': c('前受金は装置の引き渡しより前に受け取るため、四半期のキャッシュフローはその時期で大きく動きます。',
                                                  'Prepayments are received before machines are delivered, so quarterly cash flow swings with their timing.')},
                       {'key': 'view', 'text': c('需要は強い一方、売上にできるかは生産能力しだいです。次の決算で増産計画がどう具体化するかを確かめます。',
                                                 'Demand is strong, but turning it into sales depends on capacity. Check in the next report how the capacity plans take shape.')}]}
        ev.add('summary.cards.caution.sections[0]', f['supply'])
    else:
        raise ValueError('missing:supply')
    fy = f['fullYear'].values
    lo_up = q(change(Decimal(glo) * 1000, r0), 0)
    nxt = {'headline': c('次期の会社見通しを追う', "Follow the company's outlook for next quarter"),
           'chips': [{'tone': 'gold', 'text': c(f'売上 {eur(Decimal(glo) * 1000)["ja"]}〜{eur(Decimal(ghi) * 1000)["ja"]}', f'Sales €{glo}–{ghi}B')},
                     {'tone': 'gold', 'text': c(f'粗利益率 約{ggm}%', f'Gross margin ~{ggm}%')}],
           'sections': [
               {'key': 'happened', 'text': c(f'会社は次期の売上を{eur(Decimal(glo) * 1000)["ja"]}〜{eur(Decimal(ghi) * 1000)["ja"]}、粗利益率を約{ggm}%と見込んでいます。下限でも今回の{eur(r0)["ja"]}より約{lo_up}%多くなります。',
                                             f"The company expects next-quarter sales of €{glo}B to €{ghi}B and a gross margin of about {ggm}%. Even the low end is about {lo_up}% above this quarter's {eur(r0)['en']}.")},
               {'key': 'watch', 'text': c(f'粗利益率の見通しは約{ggm}%で、今回は{gm.values[1]}%でした。{fy[0]}年通期の粗利益率の見通しは約{fy[3]}%です。',
                                          f"The margin outlook (about {ggm}%) compares with this quarter's {gm.values[1]}%. The full-year {fy[0]} gross margin outlook is about {fy[3]}%.")},
               {'key': 'view', 'text': c(f'次の決算で、売上がこの幅のどこに入るか、通期の見通し{eur(Decimal(fy[1]) * 1000)["ja"]}〜{eur(Decimal(fy[2]) * 1000)["ja"]}に届くかを確かめます。',
                                         f'In the next report, check where sales land in this range and whether the full-year outlook of €{fy[1]}B to €{fy[2]}B is met.')}]}
    conclusion = [c(f'売上は{eur(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期比{sign(yoy, 0)}でした。粗利益率は{gm.values[0]}%から{gm.values[1]}%になりました。',
                    f'Total net sales were {eur(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and {sign(yoy, 0)} from a year ago. Gross margin went from {gm.values[0]}% to {gm.values[1]}%.'),
                  c(f'ただし純利益{eur(ni0)["ja"]}には、持分投資の利益約{eur(gain)["ja"]}が含まれます。' if gain else f'純利益は{eur(ni0)["ja"]}でした。',
                    f'However, net income of {eur(ni0)["en"]} includes a gain of about {eur(gain)["en"]} on equity investments.' if gain else f'Net income was {eur(ni0)["en"]}.'),
                  c(f'会社は、現在計画している{f["supply"].values[0]}年と{f["supply"].values[1]}年の供給では顧客の需要を満たしきれないとしています。',
                    f'The company says its currently planned supply for {f["supply"].values[0]} and {f["supply"].values[1]} will not fully meet customer demand.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items,
            'summary': {'conclusion': conclusion, 'cards': {'growth': growth, 'change': changes, 'caution': caution, 'next': nxt}}}


WRITERS = {'CRDO': crdo, 'MRVL': mrvl, 'AVGO': avgo, 'TSM': tsm, 'ASML': asml}

# the rest of the roster (AMD, ANET, PLTR, ...): dive_company_writers, on the same helpers
from dive_company_writers import WRITERS as _MORE  # noqa: E402

WRITERS.update(_MORE)
