"""More company dive writers (AMD, ANET, PLTR, ALAB, LITE, SNDK, VRT, GEV, BE, SKHY, ARM, CRWV, NBIS, MSFT, GOOGL, NVDA): the same cards,
sections, chips, conclusions, tiles and kinds of figures as each company's hand-made 決算の深掘り (Nov 25), from the figures dive_figures
reads out of the company's own filings. Fixed wording; every number is a read figure or plain arithmetic over read figures. No model call.

Like dive_writers: a writer returns {'tiles', 'numbers', 'summary', 'evidence'} or raises ValueError('missing:<figure>') when a figure
it needs was not read, and nothing is then published for that release (the patrol alerts the owner).
"""
from datetime import datetime
from decimal import Decimal

from dive_writers import Evidence, amount_calc, c, change, growth_calc, money_tile, need, pc, ps, q, sign, usd


# ---- small builders -----------------------------------------------------------------------------------------------------------

def chip(tone, ja, en):
    return {'tone': tone, 'text': c(ja, en)}


def sec(key, ja, en):
    return {'key': key, 'text': c(ja, en)}


def card(ja, en, chips, sections, segment=None):
    return {'headline': c(ja, en), 'chips': chips, 'sections': sections, 'segment': segment}


def tone(delta):
    return 'up' if delta > 0 else 'down' if delta < 0 else 'gold'


def rose(delta, ja=False):
    if ja:
        return '増え' if delta > 0 else '減り' if delta < 0 else '変わりませんでし'
    return 'rose' if delta > 0 else 'fell' if delta < 0 else 'was unchanged'


def signed(figure, index):
    """The printed cell with its sign, for a calc: (1,076) is -1076."""
    return ('-' if figure.values[index] < 0 else '') + figure.raws[index]


def margin_calc(top, bottom, i, j=None):
    return f'{signed(top, i)} / {bottom.raws[i if j is None else j]} * 100'


def tile(label_ja, label_en, value, note_ja, note_en):
    return {'label': c(label_ja, label_en), 'value': value, 'note': c(note_ja, note_en)}


def text_tile(label_ja, label_en, value_ja, value_en, note_ja, note_en):
    return {'label': c(label_ja, label_en), 'value': c(value_ja, value_en), 'note': c(note_ja, note_en)}


def summary(conclusion, growth, changes, caution, nxt):
    return {'conclusion': conclusion, 'cards': {'growth': growth, 'change': changes, 'caution': caution, 'next': nxt}}


def revenue_numbers(ev, rev, cur=0, prev=1, ago=2):
    ev.add('numbers.revenue.current', rev, cur)
    ev.add('numbers.revenue.previous', rev, prev)
    if ago is not None:
        ev.add('numbers.revenue.yearAgo', rev, ago)
    return {'current': float(rev.values[cur]), 'previous': float(rev.values[prev]), 'yearAgo': float(rev.values[ago]) if ago is not None else None}


def band_guidance(ev, g):
    """numbers.guidance low/high from "approximately $17 billion, plus or minus 3%"."""
    mid, pct_ = g.values
    base = f'{g.raws[0]} * {g.muls[0]}' if g.muls[0] else g.raws[0]
    ev.add('numbers.guidance.low', g, calc=f'{base} * (100 - {g.raws[1]}) / 100')
    ev.add('numbers.guidance.high', g, calc=f'{base} * (100 + {g.raws[1]}) / 100')
    return mid * (100 - pct_) / 100, mid * (100 + pct_) / 100


def range_guidance(ev, g, i=0, j=1):
    lo, hi = g.values[i], g.values[j]
    ev.add('numbers.guidance.low', g, calc=g.calc(i))
    ev.add('numbers.guidance.high', g, calc=g.calc(j))
    return lo, hi


# ---- AMD ------------------------------------------------------------------------------------------------------------------------

def amd(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'gm', 'opIncomeNonGaap', 'eps', 'epsGaap', 'dataCenter', 'clientGaming', 'embedded', 'dataCenterOp', 'clientGamingOp',
         'embeddedOp', 'gaming', 'fcf', 'fcfMargin', 'debt', 'receivables', 'inventories', 'guidanceRevenue', 'guidanceGm')
    ev = Evidence(url)
    rev, gm, op, eps, epsg = f['revenue'], f['gm'], f['opIncomeNonGaap'], f['eps'], f['epsGaap']
    r0, r1, r2 = rev.values
    yoy, qoq = change(r0, r2), change(r0, r1)
    numbers = {'revenue': revenue_numbers(ev, rev), 'adjustedEPS': float(eps.values[0]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm.values[0]), 'previous': float(gm.values[2])}}
    ev.add('numbers.adjustedEPS', eps)
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    g, ggm = f['guidanceRevenue'], f['guidanceGm']
    low, high = band_guidance(ev, g)
    ev.add('numbers.guidance.grossMarginPercent', ggm)
    numbers['guidance'] = {'low': float(low), 'high': float(high), 'grossMarginPercent': float(ggm.values[0])}
    segs = []
    for i, (key, ja, en, sr, so) in enumerate((('datacenter', 'データセンター', 'Data Center', f['dataCenter'], f['dataCenterOp']),
                                                ('clientgaming', 'クライアント・ゲーム', 'Client and Gaming', f['clientGaming'], f['clientGamingOp']),
                                                ('embedded', '組み込み', 'Embedded', f['embedded'], f['embeddedOp']))):
        ev.add(f'numbers.segments[{i}].revenue', sr)
        ev.add(f'numbers.segments[{i}].previous', sr)
        for field, k in (('operatingMargin', 0), ('previousOperatingMargin', 1)):
            ev.add(f'numbers.segments[{i}].{field}', so)
            ev.add(f'numbers.segments[{i}].{field}', sr, calc=margin_calc(so, sr, k), rnd=1)
        segs.append({'key': key, 'nameJa': ja, 'nameEn': en, 'revenue': float(sr.values[0]), 'previous': float(sr.values[1]),
                     'operatingMargin': float(q(so.values[0] / sr.values[0] * 100)), 'previousOperatingMargin': float(q(so.values[1] / sr.values[1] * 100)),
                     '_rev': sr, '_ja': ja, '_en': en})
    lead = max(segs, key=lambda s: s['_rev'].values[0] - s['_rev'].values[1])
    numbers['segments'] = [{k: v for k, v in s.items() if not k.startswith('_')} for s in segs]
    dc = f['dataCenter']
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前年同期比 {sign(yoy, 0)}', f'{sign(yoy, 0)} YoY'),
             tile('データセンター部門売上', 'Data Center segment revenue', money_tile(ev, 1, dc, 0, None),
                  f'前年同期比 {sign(change(dc.values[0], dc.values[2]), 0)}', f'{sign(change(dc.values[0], dc.values[2]), 0)} YoY'),
             text_tile('非GAAP 1株利益', 'Non-GAAP EPS', ps(eps.values[0])['ja'], ps(eps.values[0])['en'],
                       f'前年同期比 {sign(change(eps.values[0], eps.values[1]), 0)}', f'{sign(change(eps.values[0], eps.values[1]), 0)} YoY')]
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 2), rnd=0)
    ev.add('tiles[1].note', dc, calc=growth_calc(dc, 0, 2), rnd=0)
    ev.add('tiles[2].value', eps)
    ev.add('tiles[2].note', eps, calc=growth_calc(eps, 0, 1), rnd=0)

    lr = lead['_rev'].values
    d_total, d_lead = r0 - r1, lr[0] - lr[1]
    lm0, lm1 = Decimal(str(lead['operatingMargin'])), Decimal(str(lead['previousOperatingMargin']))
    share = q(d_lead / d_total * 100, 0) if d_total > 0 and d_lead > 0 else None
    cg = f['clientGaming'].values
    gaming = f['gaming']
    gy = f.get('gamingYoy')
    ev.add('summary.cards.growth.sections[2]', gaming)
    growth = card(f'{lead["_ja"]}部門が最大の伸び', f'{lead["_en"]} led the growth', [
        chip(tone(d_lead), f'部門売上 {sign(change(lr[0], lr[1]))}', f'Segment revenue {sign(change(lr[0], lr[1]))}'),
        chip(tone(lm0 - lm1), f'部門営業利益率 {pc(lm1)} → {pc(lm0)}', f'Segment operating margin {pc(lm1)} → {pc(lm0)}')], [
        sec('happened', f'{lead["_ja"]}部門の売上は、{usd(lr[1])["ja"]}から{usd(lr[0])["ja"]}へ、{usd(abs(d_lead))["ja"]}{rose(d_lead, True)}ました。営業利益率は{pc(lm1)}から{pc(lm0)}になっています。',
            f'{lead["_en"]} revenue {rose(d_lead)} from {usd(lr[1])["en"]} to {usd(lr[0])["en"]}, a change of {usd(abs(d_lead))["en"]}. Its operating margin went from {pc(lm1)} to {pc(lm0)}.'),
        sec('good', f'会社全体の売上は前期から{usd(abs(d_total))["ja"]}{rose(d_total, True)}ました。' + (f'そのうち約{share}%がこの部門の増加分です。' if share is not None else ''),
            f'Total revenue {rose(d_total)} {usd(abs(d_total))["en"]} from the previous quarter.' + (f' About {share}% of that came from this segment.' if share is not None else '')),
        sec('watch', f'伸びが{lead["_ja"]}部門に偏っています。ゲーム事業の売上は{usd(gaming.values[0])["ja"]}'
            + (f'(前年同期比{"−" if gy.values[1] == "down" else "+"}{gy.values[2]}%)' if gy else f'(前年同期は{usd(gaming.values[2])["ja"]})')
            + f'で、クライアント・ゲーム部門の売上は前期の{usd(cg[1])["ja"]}から{usd(cg[0])["ja"]}になりました。',
            f'Growth is concentrated in {lead["_en"]}. Gaming revenue was {usd(gaming.values[0])["en"]}'
            + (f' ({"down" if gy.values[1] == "down" else "up"} {gy.values[2]}% from a year ago)' if gy else f' ({usd(gaming.values[2])["en"]} a year ago)')
            + f', and Client and Gaming revenue went from {usd(cg[1])["en"]} to {usd(cg[0])["en"]}.'),
        sec('means', f'次期の見通し(中央値で前期比{sign(change(g.values[0], r0), 0)})も、この部門の伸びが前提になります。',
            f'The outlook for next quarter ({sign(change(g.values[0], r0), 0)} at the midpoint) also depends on this segment.')], lead['key'])

    gp0, gp1 = gm.raws[0] + '%', gm.raws[2] + '%'   # as printed (whole percent)
    gm_word = ('横ばい', 'flat') if gm.values[0] == gm.values[2] else ('上昇', 'higher') if gm.values[0] > gm.values[2] else ('低下', 'lower')
    op_up = change(op.values[0], op.values[2])
    warrant = f.get('warrant')
    if warrant:
        ev.add('summary.cards.change.sections[2]', warrant)
    ev.add('summary.cards.change.sections[1]', op)
    changes = card(f'売上は前期比 {sign(qoq)}、非GAAP粗利益率は{gp0}で{gm_word[0]}', f'Revenue {sign(qoq)} QoQ, non-GAAP gross margin {gm_word[1]} at {gp0}', [
        chip(tone(qoq), f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ'),
        chip(tone(gm.values[0] - gm.values[2]), f'非GAAP粗利益率 {gp1} → {gp0}', f'Non-GAAP gross margin {gp1} → {gp0}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d_total))["ja"]}{rose(d_total, True)}ました。'
            + (f'非GAAP粗利益率は{gp0}のままです。' if gp0 == gp1 else f'非GAAP粗利益率は{gp1}から{gp0}です。'),
            f'Revenue {rose(d_total)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d_total))["en"]}. '
            + (f'Non-GAAP gross margin stayed at {gp0}.' if gp0 == gp1 else f'Non-GAAP gross margin went from {gp1} to {gp0}.')),
        sec('good', f'非GAAP営業利益は{usd(op.values[2])["ja"]}から{usd(op.values[0])["ja"]}へ{sign(op_up, 0)}で、売上の伸び({sign(qoq, 0)})'
            + ('を上回りました。売上が増えるほど利益が大きく増える形になっています。' if op_up > qoq else 'を下回りました。'),
            f'Non-GAAP operating income went from {usd(op.values[2])["en"]} to {usd(op.values[0])["en"]}, {sign(op_up, 0)}, '
            + ('faster than revenue (' + sign(qoq, 0) + '). Profit is growing faster than sales.' if op_up > qoq else 'slower than revenue (' + sign(qoq, 0) + ').')),
        sec('watch', f'GAAPの1株利益は{ps(epsg.values[0])["ja"]}で、非GAAP({ps(eps.values[0])["ja"]})との差があります。'
            + (f'一部の顧客に発行したワラント(株を買う権利)の評価替えで{usd(warrant.values[0])["ja"]}の費用が出ており、この費用はAMDの株価などで変わります。' if warrant else ''),
            f'GAAP EPS was {ps(epsg.values[0])["en"]}, versus non-GAAP EPS of {ps(eps.values[0])["en"]}.'
            + (f" Remeasuring warrants issued to certain customers cost {usd(warrant.values[0])['en']}, and that charge moves with AMD's share price." if warrant else '')),
        sec('view', '本業の利益の動きと、GAAPと非GAAPの差がどこから来ているかを、四半期ごとに確かめます。',
            'Track core profit, and check every quarter where the gap between GAAP and non-GAAP results comes from.')])

    fcf, fm, debt, ar, inv = f['fcf'], f['fcfMargin'], f['debt'], f['receivables'], f['inventories']
    fd = fcf.values[0] - fcf.values[1]
    ev.add('summary.cards.caution.sections[0]', fcf)
    ev.add('summary.cards.caution.sections[0]', fm)
    ev.add('summary.cards.caution.sections[0]', ar)
    ev.add('summary.cards.caution.sections[1]', debt)
    inv_up, ar_up = -inv.values[0], -ar.values[0]   # a cash-flow use (printed in parentheses) is an increase in the balance
    caution = card(f'フリーキャッシュフローが{usd(fcf.values[0])["ja"]}に{"減少" if fd < 0 else "増加"}', f'Free cash flow {"fell" if fd < 0 else "rose"} to {usd(fcf.values[0])["en"]}', [
        chip(tone(fd), f'FCF {usd(fcf.values[1])["ja"]} → {usd(fcf.values[0])["ja"]}', f'FCF {usd(fcf.values[1])["en"]} → {usd(fcf.values[0])["en"]}'),
        chip('down' if inv_up > 0 else 'up', f'在庫の{"増加" if inv_up > 0 else "減少"} {usd(abs(inv_up))["ja"]}(3か月)', f'Inventory {"up" if inv_up > 0 else "down"} {usd(abs(inv_up))["en"]} in the quarter')], [
        sec('happened', f'フリーキャッシュフローは前期の{usd(fcf.values[1])["ja"]}から{usd(fcf.values[0])["ja"]}になり、売上に対する割合は{fm.raws[1]}%から{fm.raws[0]}%になりました。'
            f'3か月で在庫が{usd(abs(inv_up))["ja"]}{"増え" if inv_up > 0 else "減り"}、売掛金が{usd(abs(ar_up))["ja"]}{"増え" if ar_up > 0 else "減り"}ました。',
            f'Free cash flow went from {usd(fcf.values[1])["en"]} to {usd(fcf.values[0])["en"]}, and its share of revenue from {fm.raws[1]}% to {fm.raws[0]}%. '
            f'In the quarter, inventory {"rose" if inv_up > 0 else "fell"} {usd(abs(inv_up))["en"]} and receivables {"rose" if ar_up > 0 else "fell"} {usd(abs(ar_up))["en"]}.'),
        sec('watch', f'利益が出ていても、在庫や売掛金にお金がとどまると手元の現金は増えません。借入金は{usd(debt.values[1])["ja"]}から{usd(debt.values[0])["ja"]}になっています。',
            f'Even with profits, cash tied up in inventory and receivables does not reach the bank. Total debt went from {usd(debt.values[1])["en"]} to {usd(debt.values[0])["en"]}.'),
        sec('means', '次期は売上の伸びが見込まれているため、積み上がった在庫が計画どおり売上に変わるかが焦点です。',
            'With revenue expected to grow next quarter, the key is whether the inventory built up turns into sales as planned.'),
        sec('view', '新製品の立ち上げに向けた在庫なら、後の販売で現金として戻るはずです。次の決算で在庫とフリーキャッシュフローを確かめます。',
            'If this is inventory for new product ramps, it should come back as cash through later sales. Check inventory and free cash flow in the next report.')])

    mid = g.values[0]
    lo_up = change(low, r0)
    nxt = card('次期の会社見通しを追う', "Follow the company's outlook for next quarter", [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue {usd(low)["en"]}–{usd(high)["en"]}'),
        chip('gold', f'非GAAP粗利益率 約{ggm.raws[0]}%', f'Non-GAAP gross margin ~{ggm.raws[0]}%')], [
        sec('happened', f'会社は次期の売上を約{usd(mid)["ja"]}(±{g.raws[1]}%、{usd(low)["ja"]}〜{usd(high)["ja"]})と見込み、非GAAP粗利益率は約{ggm.raws[0]}%の見通しです。今回の売上は{usd(r0)["ja"]}なので、下限でも{sign(lo_up, 0)}です。',
            f"The company expects next-quarter revenue of about {usd(mid)['en']} plus or minus {g.raws[1]}% ({usd(low)['en']} to {usd(high)['en']}) and a non-GAAP gross margin of about {ggm.raws[0]}%. This quarter's revenue was {usd(r0)['en']}, so even the low end would be {sign(lo_up, 0)}."),
        sec('watch', f'粗利益率の見通し(約{ggm.raws[0]}%)は、今回の{gp0}' + ('を下回ります。売上が伸びても利益率が下がれば、利益の伸びは小さくなります。' if ggm.values[0] < gm.values[0] else 'と比べて下がってはいません。'),
            f"The margin outlook (about {ggm.raws[0]}%) is " + ("below this quarter's " + gp0 + '. If revenue grows but the margin falls, profit growth will be smaller.' if ggm.values[0] < gm.values[0] else "not below this quarter's " + gp0 + '.')),
        sec('view', '次の決算で、結果がこの幅のどこに入るか、伸びを引っ張る部門がどこかを確かめます。', 'In the next report, check where results land in this range and which segment drives the growth.')])
    if 'guidanceGrowth' in f:
        ev.add('summary.cards.next.sections[0]', f['guidanceGrowth'])
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期比{sign(yoy, 0)}でした。伸びの中心は{lead["_ja"]}部門です。',
          f'Revenue was {usd(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and {sign(yoy, 0)} from a year ago. Most of the growth came from the {lead["_en"]} segment.'),
        c(f'一方で、フリーキャッシュフローは{usd(fcf.values[1])["ja"]}から{usd(fcf.values[0])["ja"]}になりました。3か月で在庫が{usd(abs(inv_up))["ja"]}、売掛金が{usd(abs(ar_up))["ja"]}動いています。',
          f'Meanwhile, free cash flow went from {usd(fcf.values[1])["en"]} to {usd(fcf.values[0])["en"]}, as inventory moved {usd(abs(inv_up))["en"]} and receivables {usd(abs(ar_up))["en"]} in the quarter.'),
        c(f'会社は次期の売上を約{usd(mid)["ja"]}(±{g.raws[1]}%)と、今回より{sign(change(mid, r0), 0)}と見込んでいます。粗利益率の見通しは約{ggm.raws[0]}%です。',
          f'The company expects next-quarter revenue of about {usd(mid)["en"]} (plus or minus {g.raws[1]}%), {sign(change(mid, r0), 0)} from this quarter, with a gross margin of about {ggm.raws[0]}%.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}

# ---- the previous file: figures a release prints without the previous quarter (Arista, ...) -------------------------------------

def carried(ev, previous, src, dst):
    """The previous file's own figure at `src` (e.g. numbers.grossMargin.current), with its quoted evidence re-filed under `dst`."""
    value = previous
    for part in src.split('.'):
        value = (value or {}).get(part) if isinstance(value, dict) else None
    entries = [e for e in (previous or {}).get('evidence') or [] if e['field'] == src]
    if value is None or not entries:
        raise ValueError(f'missing:previous {src}')
    for e in entries:
        ev.items.append({**e, 'field': dst})
    return Decimal(str(value))


def bn(million):
    """'$3.9' style billions as the company prints a range ($3.9 - $4.0 billion)."""
    return format(q(Decimal(million) / 1000, 1), 'f')


# ---- Arista (ANET) ----------------------------------------------------------------------------------------------------------------

def anet(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'product', 'service', 'nineMonths', 'gm', 'opMargin', 'eps', 'epsGaap', 'inventories', 'deferred', 'deferredLong',
         'guidanceRevenue', 'guidanceOpMargin', 'guidanceEps')
    report = report or {}
    ev = Evidence(url)
    rev, gm, om, eps, epsg = f['revenue'], f['gm'], f['opMargin'], f['eps'], f['epsGaap']
    r0, r2 = rev.values
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.yearAgo', rev)
    r1 = carried(ev, previous, 'numbers.revenue.current', 'numbers.revenue.previous')
    gm1 = carried(ev, previous, 'numbers.grossMargin.current', 'numbers.grossMargin.previous')
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.adjustedEPS', eps)
    g = f['guidanceRevenue']
    low, high = range_guidance(ev, g)
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(eps.values[0]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm.values[0]), 'previous': float(gm1)},
               'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': None}, 'segments': None}
    yoy, qoq = change(r0, r2), change(r0, r1)
    record = f.get('record')
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前年同期比 {sign(yoy)}' + ('、上場以来最高の伸び' if record else ''),
                  f'{sign(yoy)} YoY' + (', fastest since IPO' if record else ''))]
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 1), rnd=1)
    if record:
        ev.add('tiles[0].note', record)
    tiles.append(text_tile('調整後(non-GAAP)営業利益率', 'Non-GAAP operating margin', pc(om.values[0]), pc(om.values[0]),
                           f'前年同期 {pc(om.values[1])}', f'Prior-year quarter {pc(om.values[1])}'))
    ev.add('tiles[1].value', om)
    ev.add('tiles[1].note', om)
    inv = f['inventories']
    com = report.get('commitments')
    if com:  # the 10-Q: the hand-made file's tile
        day = datetime.strptime(com.values[0], '%B %d %Y')
        tiles.append(text_tile('解約できない購入契約', 'Non-cancellable purchase commitments', f'{q(Decimal(com.values[1]) * 10, 0)}億ドル', f'${com.values[1]}B',
                               f'{day.month}月{day.day}日時点、うち12か月以内 {q(Decimal(com.values[2]) * 10, 0)}億ドル',
                               f'{day.strftime("%b")}. {day.day}; ${com.values[2]}B due within 12 months'))
        ev.add('tiles[2].value', com)
        ev.add('tiles[2].note', com)
    else:  # at the release, before the 10-Q
        tiles.append(tile('在庫', 'Inventories', money_tile(ev, 2, inv, 0, None), f'前年度末 {usd(inv.values[1])["ja"]}', f'Prior year-end {usd(inv.values[1])["en"]}'))
        ev.add('tiles[2].note', inv, calc=amount_calc(inv, 1, 'B')[0], rnd=2)

    pr, sv = f['product'], f['service']
    dr = f['deferred'].values[0] + f['deferredLong'].values[0]
    dr1 = f['deferred'].values[1] + f['deferredLong'].values[1]
    cust = report.get('customers')
    ev.add('summary.cards.growth.sections[0]', pr)
    ev.add('summary.cards.growth.sections[1]', f['deferred'])
    ev.add('summary.cards.growth.sections[1]', f['deferredLong'])
    if cust:
        ev.add('summary.cards.growth.sections[2]', cust)
    growth = card(f'製品の売上は前年同期比 {sign(change(pr.values[0], pr.values[1]), 0)}', f'Product revenue {sign(change(pr.values[0], pr.values[1]), 0)} year over year', [
        chip(tone(pr.values[0] - pr.values[1]), f'製品 {usd(pr.values[0])["ja"]}', f'Product {usd(pr.values[0])["en"]}'),
        chip(tone(sv.values[0] - sv.values[1]), f'サービス {usd(sv.values[0])["ja"]}', f'Service {usd(sv.values[0])["en"]}'),
        chip('gold', f'繰延収益 合計{usd(dr)["ja"]}', f'Deferred revenue {usd(dr)["en"]} total')], [
        sec('happened', f'製品の売上は{usd(pr.values[0])["ja"]}で、前年同期の{usd(pr.values[1])["ja"]}から{sign(change(pr.values[0], pr.values[1]), 0)}でした。保守契約などのサービス売上は{usd(sv.values[0])["ja"]}で、{usd(sv.values[1])["ja"]}から{sign(change(sv.values[0], sv.values[1]), 0)}です。',
            f'Product revenue was {usd(pr.values[0])["en"]}, {sign(change(pr.values[0], pr.values[1]), 0)} from {usd(pr.values[1])["en"]} a year earlier. Service revenue, mostly support contracts, was {usd(sv.values[0])["en"]}, {sign(change(sv.values[0], sv.values[1]), 0)} from {usd(sv.values[1])["en"]}.'),
        sec('good', f'代金は受け取ったがまだ売上にしていない繰延収益は、期末に{usd(dr)["ja"]}で、前年度末の{usd(dr1)["ja"]}から{"増え" if dr > dr1 else "減り"}ました。',
            f'Deferred revenue, cash collected but not yet booked as revenue, was {usd(dr)["en"]} at quarter end, {"up" if dr > dr1 else "down"} from {usd(dr1)["en"]} at the prior year-end.'),
        sec('watch', (f'少数の大口顧客が売上の多くを占めます。10-Qによると、{cust.values[2]}年は2社がそれぞれ売上の{cust.values[1]}%と{cust.values[0]}%でした。その投資が減ると影響は大きくなります。' if cust else
                      '少数の大口顧客が売上の多くを占めます。顧客ごとの比率は、決算発表の後に出る10-Qで確かめます。'),
            (f'A few large customers account for much of revenue. Per the 10-Q, in {cust.values[2]} two customers made up {cust.values[1]}% and {cust.values[0]}% of revenue. If they cut spending, the impact would be large.' if cust else
             'A few large customers account for much of revenue. The 10-Q, filed after the release, shows each one\'s share.'))])

    gains = f.get('gains')
    d = r0 - r1
    if gains and gains.values[0] < 0:
        ev.add('summary.cards.change.sections[2]', gains)
    beat = record and Decimal(record.values[0]) * 1000 < r0
    changes = card(f'売上は前期比 {sign(qoq)}、粗利益率は{"上昇" if gm.values[0] > gm1 else "低下" if gm.values[0] < gm1 else "横ばい"}',
                   f'Revenue {sign(qoq)} QoQ; gross margin {"higher" if gm.values[0] > gm1 else "lower" if gm.values[0] < gm1 else "flat"}', [
        chip(tone(qoq), f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ'),
        chip(tone(gm.values[0] - gm1), f'調整後粗利益率 {pc(gm1)} → {pc(gm.values[0])}', f'Non-GAAP gross margin {pc(gm1)} → {pc(gm.values[0])}'),
        chip('gold', f'調整後EPS {ps(eps.values[0])["ja"]}', f'Non-GAAP EPS {ps(eps.values[0])["en"]}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。' + (f'会社の見通し({usd(Decimal(record.values[0]) * 1000)["ja"]})を上回っています。' if beat else '')
            + f'調整後粗利益率は{pc(gm1)}から{pc(gm.values[0])}になりました。',
            f'Revenue {rose(d)} {usd(abs(d))["en"]} from {usd(r1)["en"]} to {usd(r0)["en"]}' + (f', above the ${record.values[0]}B guidance' if beat else '') + f'. Non-GAAP gross margin went from {pc(gm1)} to {pc(gm.values[0])}.'),
        sec('good', f'調整後の営業利益率は{pc(om.values[0])}で、売上100ドルのうち約{q(om.values[0], 0)}ドルが営業利益として残る計算です。前年同期は{pc(om.values[1])}でした。',
            f'Non-GAAP operating margin was {pc(om.values[0])}, so about ${q(om.values[0], 0)} of every $100 of sales stays as operating profit ({pc(om.values[1])} a year earlier).'),
        sec('watch', f'GAAPのEPSは{ps(epsg.values[0])["ja"]}、調整後EPSは{ps(eps.values[0])["ja"]}でした。'
            + (f'戦略投資の評価益{usd(-gains.values[0])["ja"]}がGAAPの利益を押し上げており、本業とは分けて見る必要があります。' if gains and gains.values[0] < 0 else '株式報酬などを含めるかどうかで、利益の見え方が変わります。'),
            f'GAAP EPS was {ps(epsg.values[0])["en"]} and non-GAAP EPS {ps(eps.values[0])["en"]}.'
            + (f' A {usd(-gains.values[0])["en"]} gain on strategic investments lifted GAAP profit; keep that separate from the core business.' if gains and gains.values[0] < 0 else ' Whether stock compensation is included changes the profit picture.')),
        sec('view', f'粗利益率は前年同期の{pc(gm.values[1])}' + ('をまだ下回っています。' if gm.values[0] < gm.values[1] else 'を上回っています。') + '速い成長と利益率の回復を両立できるかが、これからの焦点です。',
            f'Gross margin is {"still below" if gm.values[0] < gm.values[1] else "above"} the {pc(gm.values[1])} of a year earlier. Whether fast growth and margin can go together is the question ahead.')])

    ev.add('summary.cards.caution.sections[0]', inv)
    if com:
        ev.add('summary.cards.caution.sections[0]', com)
    risk = report.get('inventoryRisk')
    if risk:
        ev.add('summary.cards.caution.sections[1]', risk)
    gom = f['guidanceOpMargin']
    ev.add('summary.cards.caution.sections[2]', gom)
    inv_up = change(inv.values[0], inv.values[1])
    gom_mid = (gom.values[0] + gom.values[1]) / 2
    caution = card('在庫と購入契約が大きく増加' if com else '在庫が大きく増加', 'Inventory and purchase commitments are much higher' if com else 'Inventory is much higher', [
        chip(tone(-(inv.values[0] - inv.values[1])), f'在庫 {usd(inv.values[1])["ja"]} → {usd(inv.values[0])["ja"]}', f'Inventory {usd(inv.values[1])["en"]} → {usd(inv.values[0])["en"]}'),
        (chip('down', f'購入契約 {q(Decimal(com.values[1]) * 10, 0)}億ドル', f'Purchase commitments ${com.values[1]}B') if com else
         chip('down', f'在庫 前年度末比 {sign(inv_up, 0)}', f'Inventory {sign(inv_up, 0)} since year-end')),
        chip('gold', f'次期の営業利益率 {gom.raws[0]}〜{gom.raws[1]}%', f'Next quarter op. margin {gom.raws[0]}–{gom.raws[1]}%')], [
        sec('happened', f'在庫は前年度末の{usd(inv.values[1])["ja"]}から{usd(inv.values[0])["ja"]}へ、約{q(inv_up, 0)}%{"増え" if inv_up > 0 else "減り"}ました。'
            + (f'さらに、解約できない購入契約が{q(Decimal(com.values[1]) * 10, 0)}億ドルあり、そのうち{q(Decimal(com.values[2]) * 10, 0)}億ドルは12か月以内に受け取る予定です。' if com else ''),
            f'Inventory went from {usd(inv.values[1])["en"]} at the prior year-end to {usd(inv.values[0])["en"]}, about {sign(inv_up, 0)}.'
            + (f' On top of that, the company has ${com.values[1]}B of non-cancellable purchase commitments, ${com.values[2]}B of them due within 12 months.' if com else '')),
        sec('means', '一部は部品不足に備えた積み増しです。ただ、需要が弱まれば在庫が余り、評価損につながるおそれがあると会社自身が書いています。' if risk else
            '一部は部品不足に備えた積み増しとみられます。需要が弱まれば在庫が余り、評価損につながるおそれがあります。',
            'Part of this is stocking up against component shortages. But the company itself warns that weaker demand could leave excess inventory and lead to write-downs.' if risk else
            'Part of this is likely stocking up against component shortages. Weaker demand could leave excess inventory and lead to write-downs.'),
        sec('watch', f'次期の調整後営業利益率の見通しは{gom.raws[0]}〜{gom.raws[1]}%で、今回の{pc(om.values[0])}' + ('を少し下回ります。' if gom_mid < om.values[0] else 'と同じ水準です。'),
            f"Next quarter's non-GAAP operating margin is guided at {gom.raws[0]}–{gom.raws[1]}%, " + ("slightly below" if gom_mid < om.values[0] else "in line with") + f" this quarter's {pc(om.values[0])}."),
        sec('view', '需要が強い間は、成長への備えと読めます。在庫が売上より速く増え続けていないかを、四半期ごとに確かめます。',
            'With strong demand, the build can be read as preparing for growth. Check each quarter that inventory does not keep growing faster than sales.')])

    ge = f['guidanceEps']
    nm = f['nineMonths'].values[2]
    ev.add('summary.cards.next.chips[1]', ge)
    ev.add('summary.cards.next.sections[1]', f['nineMonths'])
    nxt = card(f'次期の売上見通し {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Next quarter revenue outlook: ${bn(low)}–{bn(high)}B', [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue ${bn(low)}–{bn(high)}B'),
        chip('gold', f'調整後EPS {ps(ge.values[0])["ja"]}〜{ps(ge.values[1])["ja"]}', f'Non-GAAP EPS {ps(ge.values[0])["en"]}–{ge.raws[1]}')], [
        sec('happened', f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}と見込んでいます。今回より下限で{sign(change(low, r0))}、上限で{sign(change(high, r0))}です。',
            f'The company expects next-quarter revenue of ${bn(low)}B–${bn(high)}B, {sign(change(low, r0))} versus this quarter at the low end and {sign(change(high, r0))} at the high end.'),
        sec('means', f'見通しどおりなら、通年の売上は約{usd(nm + low)["ja"]}〜{usd(nm + high)["ja"]}になります。ただ、前期比の伸びは今回の{sign(qoq)}より小さくなる見込みです。' if change(high, r0) < qoq else
            f'見通しどおりなら、通年の売上は約{usd(nm + low)["ja"]}〜{usd(nm + high)["ja"]}になります。',
            f'If met, full-year revenue would be about {usd(nm + low)["en"]}–{usd(nm + high)["en"]}.' + (f" Quarter-over-quarter growth, though, would be smaller than this quarter's {sign(qoq)}." if change(high, r0) < qoq else '')),
        sec('view', '次の決算で、売上が見通しの幅のどこに入るかを、在庫や購入契約の動きと合わせて確かめます。',
            'Next time, watch where revenue lands in the range together with inventory and purchase commitments.')])
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq)}、前年同期比{sign(yoy)}でした。' + ('前年同期比の伸びは上場以来最高です。' if record else ''),
          f'Revenue was {usd(r0)["en"]}, {sign(qoq)} from the previous quarter and {sign(yoy)} from a year earlier' + (', the fastest year-over-year growth since the IPO.' if record else '.')),
        c(f'調整後粗利益率は{pc(gm1)}から{pc(gm.values[0])}になり、調整後営業利益率は{pc(om.values[0])}でした。在庫' + ('と購入契約' if com else '') + 'が大きく積み上がっており、需要の読み違いがあれば響きます。',
          f'Non-GAAP gross margin went from {pc(gm1)} to {pc(gm.values[0])}, and non-GAAP operating margin was {pc(om.values[0])}. Inventory' + (' and purchase commitments have' if com else ' has') + ' built up a lot, so a demand misjudgment would hurt.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}


# ---- amounts written in a sentence ("$2.313 billion", "$984 million") ---------------------------------------------------------

def amt(figure, i):
    """(millions, en as printed, ja) of the amount at raws[i] with its unit word at raws[i + 1]."""
    raw, unit = figure.values[i], figure.values[i + 1]
    million = Decimal(raw) * (1000 if unit == 'billion' else 1)
    return million, f'${raw}{"B" if unit == "billion" else "M"}', usd(million)['ja']


def pct_sign(direction, value):
    return ('−' if direction == 'down' else '+') + str(value) + '%'


# ---- Palantir (PLTR) -------------------------------------------------------------------------------------------------------------

def pltr(f, url, before_previous, report=None, events=None, previous=None, prior=None):
    need(f, 'revenue', 'grossProfit', 'sbc', 'eps', 'total', 'us', 'usCommercial', 'usGovernment', 'deals', 'tcv', 'rdv', 'gaapOp', 'adjOp', 'cfo', 'fcf',
         'cash', 'guidanceRevenue', 'guidanceAdjOp')
    ev = Evidence(url)
    rev, gp, eps = f['revenue'], f['grossProfit'], f['eps']
    r0, r2 = rev.values
    ev.add('numbers.revenue.current', rev, 0)
    ev.add('numbers.revenue.yearAgo', rev, 1)
    r1 = carried(ev, previous, 'numbers.revenue.current', 'numbers.revenue.previous')
    gm0 = q(gp.values[0] / r0 * 100)
    ev.add('numbers.grossMargin.current', rev, calc=f'{gp.raws[0]} / {rev.raws[0]} * 100', rnd=1)
    ev.add('numbers.grossMargin.current', gp)
    gm1 = carried(ev, previous, 'numbers.grossMargin.current', 'numbers.grossMargin.previous')
    ev.add('numbers.adjustedEPS', eps)
    g, gop = f['guidanceRevenue'], f['guidanceAdjOp']
    low, high = range_guidance(ev, g)
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(eps.values[0]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm0), 'previous': float(gm1)},
               'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': None}, 'segments': None}
    total, us, uc, ug = f['total'], f['us'], f['usCommercial'], f['usGovernment']
    tm, ten, tja = amt(total, 2)
    ucm, ucen, ucja = amt(uc, 2)
    ugm, ugen, ugja = amt(ug, 2)
    usm, usen, usja = amt(us, 2)
    gop_m, gop_en, gop_ja = amt(f['gaapOp'], 0)
    aop_m, aop_en, aop_ja = amt(f['adjOp'], 0)
    gom, aom = f['gaapOp'].values[2], f['adjOp'].values[2]
    tiles = [text_tile('売上高', 'Revenue', tja, ten, f'前年同期比 +{total.values[0]}%、前期比 +{total.values[1]}%', f'YoY +{total.values[0]}%, QoQ +{total.values[1]}%'),
             text_tile('米国の民間企業向け売上', 'U.S. commercial revenue', ucja, ucen, f'前年同期比 +{uc.values[0]}%', f'YoY +{uc.values[0]}%'),
             text_tile('調整後の営業利益', 'Adjusted operating income', aop_ja, aop_en, f'利益率 {aom}%(GAAPは{gom}%)', f'{aom}% margin (GAAP {gom}%)')]
    for i, fig in enumerate((total, uc, f['adjOp'])):
        ev.add(f'tiles[{i}].value', fig)
        ev.add(f'tiles[{i}].note', fig)
    times = q(Decimal(1) + Decimal(uc.values[0]) / 100, 1)
    us_share = q(usm / r0 * 100, 0)
    rest = r0 - usm
    deals = f['deals'].values
    ev.add('summary.cards.growth.sections[0]', us)
    ev.add('summary.cards.growth.sections[0]', ug)
    ev.add('summary.cards.growth.sections[1]', f['deals'])
    passed = ucm > ugm
    if passed and f.get('firstTime'):
        ev.add('summary.conclusion[0]', f['firstTime'])
    growth = card(f'米国の民間企業向け売上は前年同期の約{times}倍', f'U.S. commercial revenue about {times} times a year ago', [
        chip('up', f'米国民間 前年同期比 +{uc.values[0]}%', f'U.S. commercial +{uc.values[0]}% YoY'),
        chip('up', f'米国民間 前期比 +{uc.values[1]}%', f'U.S. commercial +{uc.values[1]}% QoQ'),
        chip('up', f'米国政府 前年同期比 +{ug.values[0]}%', f'U.S. government +{ug.values[0]}% YoY')], [
        sec('happened', f'米国の民間企業向け売上は{ucja}で、前年同期比+{uc.values[0]}%、前期比+{uc.values[1]}%でした。米国政府向けは+{ug.values[0]}%の{ugja}です。'
            + (f'民間企業向けが政府向けを上回りました。' if passed else '') + f'米国全体の売上は{usja}で、会社全体の約{us_share}%です。',
            f'U.S. commercial revenue was {ucen}, up {uc.values[0]}% YoY and {uc.values[1]}% QoQ. U.S. government revenue rose {ug.values[0]}% to {ugen}.'
            + (' Commercial now exceeds government.' if passed else '') + f' Total U.S. revenue was {usen}, about {us_share}% of the company total.'),
        sec('good', f'大型契約も増えています。この四半期に100万ドル以上の契約を{deals[0]}件、1,000万ドル以上を{deals[2]}件結びました。',
            f'Large deals are growing too: the company closed {deals[0]} deals of at least $1M and {deals[2]} of at least $10M in the quarter.'),
        sec('watch', f'米国以外の売上は約{usd(rest)["ja"]}(全体{tja}−米国{usja})で、伸びは米国に集中しています。',
            f'Revenue outside the U.S. was about {usd(rest)["en"]} ({ten} total minus {usen} U.S.), so growth is concentrated in the U.S.'),
        sec('view', '売上の大半が米国なので、米国の企業や政府の予算の変化が業績にそのまま響きます。',
            'With most revenue in the U.S., shifts in U.S. corporate and government budgets feed straight into results.')])

    qoq = change(r0, r1)
    d = r0 - r1
    sbc = f['sbc']
    cfo_m, cfo_en, cfo_ja = amt(f['cfo'], 0)
    fcf_m, fcf_en, fcf_ja = amt(f['fcf'], 0)
    cash_m, cash_en, cash_ja = amt(f['cash'], 0)
    ev.add('summary.cards.change.sections[0]', f['adjOp'])
    ev.add('summary.cards.change.sections[1]', f['cfo'])
    ev.add('summary.cards.change.sections[1]', f['fcf'])
    ev.add('summary.cards.change.sections[2]', sbc)
    pa = (prior or {}).get('adjOp')   # the previous quarter's release: its adjusted operating margin
    if pa:
        ev.add('summary.cards.change.chips[1]', pa)
        pa = pa.values[2]
    gm_word = ('やや低下', 'slightly lower') if gm0 < gm1 else ('上昇', 'higher') if gm0 > gm1 else ('横ばい', 'flat')
    changes = card(f'売上は前期比 {sign(qoq)}、粗利益率は{gm_word[0]}', f'Revenue {sign(qoq)} QoQ, gross margin {gm_word[1]}', [
        chip(tone(gm0 - gm1), f'粗利益率 {pc(gm1)} → {pc(gm0)}', f'Gross margin {pc(gm1)} → {pc(gm0)}'),
        (chip('gold' if pa == aom else tone(int(aom) - int(pa)), f'調整後営業利益率 {aom}%(前期は{pa}%)', f'Adj. operating margin {aom}% ({"also " if pa == aom else ""}{pa}% last quarter)') if pa else
         chip('gold', f'調整後営業利益率 {aom}%(GAAPは{gom}%)', f'Adj. operating margin {aom}% (GAAP {gom}%)'))], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。GAAPの粗利益率は{pc(gm1)}から{pc(gm0)}になりました。調整後の営業利益は{aop_ja}で、利益率は{aom}%です。' + (f'前期と同じ水準です。' if pa == aom else ''),
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}. GAAP gross margin went from {pc(gm1)} to {pc(gm0)}. Adjusted operating income was {aop_en}, a {aom}% margin' + (', the same as last quarter.' if pa == aom else '.')),
        sec('good', f'現金を生む力は強く、営業キャッシュフローは{cfo_ja}、調整後フリーキャッシュフローは{fcf_ja}(売上の{f["fcf"].values[2]}%)でした。現金と米国債の合計は{cash_ja}です。',
            f'Cash conversion is strong: operating cash flow was {cfo_en} and adjusted free cash flow {fcf_en} ({f["fcf"].values[2]}% of revenue). Cash and U.S. Treasuries total {cash_en}.'),
        sec('watch', f'株式報酬は前年同期の{usd(sbc.values[1])["ja"]}から{usd(sbc.values[0])["ja"]}になり、売上の約{q(sbc.values[0] / r0 * 100, 0)}%です。調整後の利益はこの費用を除いています。',
            f'Stock-based compensation went from {usd(sbc.values[1])["en"]} a year earlier to {usd(sbc.values[0])["en"]}, about {q(sbc.values[0] / r0 * 100, 0)}% of revenue. Adjusted profit excludes this cost.'),
        sec('means', f'GAAPの営業利益率({gom}%)と調整後({aom}%)の差の多くは株式報酬で、株主は株数の増加という形で負担します。',
            f'Most of the gap between the GAAP ({gom}%) and adjusted ({aom}%) operating margins is stock compensation, which shareholders bear through dilution.')])

    tcv, rdv = f['tcv'], f['rdv']
    tcv_m, tcv_en, tcv_ja = amt(tcv, 0)
    rdv_m, rdv_en, rdv_ja = amt(rdv, 0)
    tg = pct_sign(tcv.values[2], tcv.values[3])
    ev.add('summary.cards.caution.sections[0]', tcv)
    ev.add('summary.cards.caution.sections[0]', rdv)
    slow = int(tcv.values[3]) < int(total.values[0]) or tcv.values[2] == 'down'
    caution = card(f'契約総額の伸びは前年同期比 {tg}', f'Total contract value {tg} YoY', [
        chip('down' if slow else 'up', f'TCV {tcv_ja}({tg})', f'TCV {tcv_en} ({tg})'),
        chip('gold', f'米国民間RDV 前期比 +{rdv.values[4]}%', f'U.S. commercial RDV +{rdv.values[4]}% QoQ')], [
        sec('happened', f'この四半期に結んだ契約の総額(TCV)は{tcv_ja}で、前年同期比{tg}でした。米国の民間企業向けの残りの契約額(RDV)は{rdv_ja}で、前年同期比{pct_sign(rdv.values[2], rdv.values[3])}、前期比+{rdv.values[4]}%です。',
            f'Total contract value signed in the quarter was {tcv_en}, {tg} YoY. U.S. commercial remaining deal value was {rdv_en}, {pct_sign(rdv.values[2], rdv.values[3])} YoY and +{rdv.values[4]}% QoQ.'),
        sec('means', f'売上は+{total.values[0]}%伸びましたが、将来の売上のもとになる新しい契約は' + ('それほど伸びていません。契約の伸びが低いままだと、いずれ売上の伸びも鈍る可能性があります。' if slow else 'それ以上に伸びています。'),
            f'Revenue grew {total.values[0]}%, but new contracts that feed future revenue grew ' + ('far less. If contract growth stays slow, revenue growth could eventually slow too.' if slow else 'even faster.')),
        sec('watch', f'米国民間のRDVは前年同期比では{pct_sign(rdv.values[2], rdv.values[3])}ですが、前期比では+{rdv.values[4]}%で、米国民間の売上の前期比+{uc.values[1]}%と比べてください。',
            f'U.S. commercial remaining deal value is {pct_sign(rdv.values[2], rdv.values[3])} from a year ago and +{rdv.values[4]}% from last quarter, versus +{uc.values[1]}% sequential growth in U.S. commercial revenue.'),
        sec('view', 'TCVは大型契約の時期で振れやすく、1四半期だけでは傾向とは言えません。次の決算で、契約の伸びがどうなるかを確かめます。',
            'TCV swings with the timing of large deals, so one quarter is not a trend. The next report will show where contract growth goes.')])

    gm_lo, gm_hi = gop.values
    ev.add('summary.cards.next.chips[1]', gop)
    next_margin = q((gm_lo + gm_hi) / (low + high) * 100, 0)
    nxt = card('次期の会社見通しを追う', "Follow the company's outlook for next quarter", [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue ${g.raws[0]}–{g.raws[1]}B'),
        chip('gold', f'調整後営業利益 {usd(gm_lo)["ja"]}〜{usd(gm_hi)["ja"]}', f'Adj. operating income ${gop.raws[0]}–{gop.raws[1]}B')], [
        sec('happened', f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}、調整後の営業利益を{usd(gm_lo)["ja"]}〜{usd(gm_hi)["ja"]}と見込んでいます。今回の{tja}と比べると、下限でも約{q(change(low, r0), 1)}%の増加です。',
            f'The company expects next-quarter revenue of ${g.raws[0]}–{g.raws[1]}B and adjusted operating income of ${gop.raws[0]}–{gop.raws[1]}B. Against {ten} this quarter, even the low end would be about {q(change(low, r0), 1)}% higher.'),
        sec('means', f'見通しどおりなら、調整後の営業利益率は約{next_margin}%で、今回の{aom}%と比べられます。前期比の伸び(今回は約{total.values[1]}%)は'
            + ('やや鈍る見込みです。' if change(high, r0) < Decimal(total.values[1]) else '保たれる見込みです。'),
            f'If met, the adjusted operating margin would be about {next_margin}%, versus {aom}% now. Sequential growth (about {total.values[1]}% this quarter) would '
            + ('slow somewhat.' if change(high, r0) < Decimal(total.values[1]) else 'hold.')),
        sec('view', '見通しは会社の計画で、実績ではありません。結果がこの幅に入るか、TCVの伸びが戻るかを確かめます。',
            "The outlook is the company's plan, not a result. Watch whether results land in this range and how TCV growth develops.")])
    conclusion = [
        c(f'売上は{tja}で、前年同期比+{total.values[0]}%、前期比+{total.values[1]}%でした。米国の民間企業向け売上は{ucja}で、' + (('初めて' if f.get('firstTime') else '') + '米国政府向けを上回りました。' if passed else f'米国政府向けは{ugja}でした。'),
          f'Revenue was {ten}, up {total.values[0]}% from a year ago and {total.values[1]}% from the previous quarter. U.S. commercial revenue reached {ucen}' + (' and exceeded U.S. government revenue' + (' for the first time.' if f.get('firstTime') else '.') if passed else f'; U.S. government revenue was {ugen}.')),
        c(f'利益率は高く、GAAPの営業利益率は{gom}%、調整後は{aom}%です。', f'Margins are high: {gom}% GAAP operating margin and {aom}% adjusted.'),
        c(f'ただし、この四半期に結んだ契約の総額は{tcv_ja}で、前年同期比{tg}' + ('にとどまり、売上の伸びを大きく下回りました。' if slow else 'でした。'),
          f'Total contract value signed in the quarter, however, was {tcv_en}, {tg} from a year ago' + (', well below revenue growth.' if slow else '.'))]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- Astera Labs (ALAB) ------------------------------------------------------------------------------------------------------------

def alab(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'opIncome', 'netIncome', 'gm', 'opIncomeNonGaap', 'opMarginGaap', 'opMargin', 'epsGaap', 'eps', 'sbc', 'receivables', 'inventory', 'cfo',
         'guidanceRevenue', 'guidanceGm', 'guidanceEps')
    ev = Evidence(url)
    rev, gm, eps, epsg = f['revenue'], f['gm'], f['eps'], f['epsGaap']
    r0, r1, r2 = rev.values
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.adjustedEPS', eps)
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    g, ggm = f['guidanceRevenue'], f['guidanceGm']
    low, high = range_guidance(ev, g)
    ev.add('numbers.guidance.grossMarginPercent', ggm)
    numbers = {'revenue': revenue_numbers(ev, rev), 'adjustedEPS': float(eps.values[0]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm.values[0]), 'previous': float(gm.values[1])},
               'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': float(ggm.values[0])}, 'segments': None}
    om, omg = f['opMargin'], f['opMarginGaap']
    lo_up, hi_up = change(low, r0), change(high, r0)
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前期比 {sign(qoq, 0)}、前年同期比 {sign(yoy, 0)}', f'QoQ {sign(qoq, 0)}, YoY {sign(yoy, 0)}'),
             text_tile('調整後(non-GAAP)営業利益率', 'Non-GAAP operating margin', pc(om.values[0]), pc(om.values[0]), f'GAAPは{pc(omg.values[0])}', f'GAAP {pc(omg.values[0])}'),
             text_tile('次期の売上見通し', 'Next-quarter revenue outlook', f'{usd(low)["ja"]}〜{usd(high)["ja"]}', f'${g.raws[0]}–{g.raws[1]}M',
                       f'今回より約{sign(lo_up, 0)}〜{sign(hi_up, 0)}', f'About {sign(lo_up, 0)}–{format(q(hi_up, 0), "f")}% vs. this quarter')]
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 1), rnd=0)
    ev.add('tiles[1].value', om)
    ev.add('tiles[1].note', omg)
    ev.add('tiles[2].value', g)
    ev.add('tiles[2].note', g, calc=f'({g.raws[0]} * 1000 / {rev.raws[0]} - 1) * 100', rnd=0)
    ev.add('tiles[2].note', rev)
    d = r0 - r1
    oin, opi, ni = f['opIncomeNonGaap'], f['opIncome'], f['netIncome']
    leader = f.get('leader')
    if leader:
        ev.add('summary.cards.growth.sections[0]', leader)
    new = [x for x in (('ariesSampling', 'Aries 7は{}にサンプル出荷を始め', 'Aries 7 begins sampling in {}'), ('orion', 'Orionは{}から提供が始まります', 'Orion becomes available from {}')) if x[0] in f]
    for k, _, _ in new:
        ev.add('summary.cards.growth.sections[3]', f[k])
    growth = card(f'{leader.values[0]}が最大の製品群に' if leader else f'売上は前期比 {sign(qoq, 0)}', f'{leader.values[0]} switches became the largest product family' if leader else f'Revenue {sign(qoq, 0)} QoQ', [
        chip(tone(qoq), f'売上 前期比 {sign(qoq, 0)}', f'Revenue {sign(qoq, 0)} QoQ'),
        chip(tone(yoy), f'売上 前年同期比 {sign(yoy, 0)}', f'Revenue {sign(yoy, 0)} YoY')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。' + (f'会社は、{leader.values[0]}が売上で最大の製品群になったとしています。' if leader else ''),
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}.' + (f' The company says {leader.values[0]} became its largest product family by revenue.' if leader else '')),
        sec('good', f'利益も出ています。調整後の営業利益は{usd(oin.values[0])["ja"]}で利益率は{pc(om.values[0])}、GAAPでも営業利益は{usd(opi.values[0])["ja"]}で利益率{pc(omg.values[0])}、純利益は{usd(ni.values[0])["ja"]}でした。',
            f'Profit is solid: non-GAAP operating income was {usd(oin.values[0])["en"]} ({pc(om.values[0])} margin), and on a GAAP basis operating income was {usd(opi.values[0])["en"]} ({pc(omg.values[0])}) and net income {usd(ni.values[0])["en"]}.'),
        sec('watch', '決算発表には、製品別・顧客別の売上の内訳がありません。少数の大口AI顧客にどこまで頼っているかは、10-Qで確かめる必要があります。',
            'The release gives no revenue split by product or customer. How much the company relies on a few large AI customers needs to be checked in the 10-Q.'),
        sec('view', ('新製品では、' + '、'.join(ja.format(f[k].values[0]) for k, ja, _ in new) + '。' if new else '') + '今の伸びは主に既存製品の量産によるものとみられます。',
            ('Among the new products, ' + ' and '.join(en.format(f[k].values[0]) for k, _, en in new) + '. ' if new else '') + 'Current growth appears to come largely from the existing products ramping.')])
    g0, g1, g2 = gm.values
    gm_word = ('低下', 'lower') if g0 < g1 else ('上昇', 'higher') if g0 > g1 else ('横ばい', 'flat')
    changes = card(f'売上は前期比 {sign(qoq)}、粗利益率は{gm_word[0]}', f'Revenue {sign(qoq)} QoQ, gross margin {gm_word[1]}', [
        chip(tone(g0 - g1), f'調整後粗利益率 {pc(g1)} → {pc(g0)}', f'Adj. gross margin {pc(g1)} → {pc(g0)}'),
        chip(tone(eps.values[0] - eps.values[1]), f'調整後EPS {ps(eps.values[0])["ja"]}', f'Adj. EPS {ps(eps.values[0])["en"]}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。調整後粗利益率は{pc(g1)}から{pc(g0)}になりました。',
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}. Non-GAAP gross margin went from {pc(g1)} to {pc(g0)}.'),
        sec('good', f'GAAPのEPSは{ps(epsg.values[0])["ja"]}、調整後EPSは{ps(eps.values[0])["ja"]}で、前期の{ps(eps.values[1])["ja"]}から{"増え" if eps.values[0] > eps.values[1] else "減り"}ました。',
            f'GAAP EPS was {ps(epsg.values[0])["en"]} and non-GAAP EPS {ps(eps.values[0])["en"]}, {"up" if eps.values[0] > eps.values[1] else "down"} from {ps(eps.values[1])["en"]} last quarter.'),
        sec('watch', f'調整後粗利益率は前年同期の{pc(g2)}から{pc(g0)}になりました。決算発表は理由を説明していません。',
            f'Non-GAAP gross margin went from {pc(g2)} a year ago to {pc(g0)}. The release does not explain why.'),
        sec('means', f'次期の粗利益率の見通しも約{ggm.raws[0]}%で、会社はこの水準での推移を見込んでいます。',
            f'The outlook for next quarter is also about {ggm.raws[0]}%, so the company expects the margin to settle around this level.')])
    ar, inv, sbc, cfo = f['receivables'], f['inventory'], f['sbc'], f['cfo']
    sbc_share = q(sbc.values[0] / r0 * 100)
    ev.add('summary.cards.caution.sections[0]', ar)
    ev.add('summary.cards.caution.sections[0]', inv)
    ev.add('summary.cards.caution.sections[0]', cfo)
    ev.add('summary.cards.caution.sections[2]', sbc)
    caution = card('売掛金と在庫が急増', 'Receivables and inventory jumped', [
        chip(tone(ar.values[1] - ar.values[0]), f'売掛金 {usd(ar.values[1])["ja"]} → {usd(ar.values[0])["ja"]}', f'Receivables {usd(ar.values[1])["en"]} → {usd(ar.values[0])["en"]}'),
        chip(tone(inv.values[1] - inv.values[0]), f'在庫 {usd(inv.values[1])["ja"]} → {usd(inv.values[0])["ja"]}', f'Inventory {usd(inv.values[1])["en"]} → {usd(inv.values[0])["en"]}'),
        chip('gold', f'株式報酬 売上の{pc(sbc_share)}', f'Stock compensation {pc(sbc_share)} of revenue')], [
        sec('happened', f'前年度末から今期末にかけて、売掛金は{usd(ar.values[1])["ja"]}から{usd(ar.values[0])["ja"]}、在庫は{usd(inv.values[1])["ja"]}から{usd(inv.values[0])["ja"]}になりました。9か月間の営業キャッシュフローは{usd(cfo.values[0])["ja"]}です。',
            f'From the prior year-end to quarter end, receivables went from {usd(ar.values[1])["en"]} to {usd(ar.values[0])["en"]} and inventory from {usd(inv.values[1])["en"]} to {usd(inv.values[0])["en"]}. Operating cash flow for the nine months was {usd(cfo.values[0])["en"]}.'),
        sec('means', '売上が急に伸びると、売掛金や在庫も増えるのは自然です。ただ、売上より速く増え続けると、現金の回収が遅れます。',
            'Fast sales growth naturally raises receivables and inventory. But if they keep growing faster than sales, cash collection suffers.'),
        sec('watch', f'株式報酬は今期{usd(sbc.values[0])["ja"]}で、売上の{pc(sbc_share)}です。GAAPと調整後の営業利益の差の大部分を占め、株数の増加にもつながります。',
            f'Stock-based compensation was {usd(sbc.values[0])["en"]} this quarter, {pc(sbc_share)} of revenue, and accounts for most of the gap between GAAP and non-GAAP operating income. It also adds to the share count.'),
        sec('view', '次の決算で、売掛金と在庫が売上に見合った水準に落ち着くかを確かめます。', 'The next report will show whether receivables and inventory settle in line with sales.')])
    ge = f['guidanceEps']
    ev.add('summary.cards.next.chips[2]', ge)
    nxt = card('次期の会社見通しを追う', "Follow the company's outlook for next quarter", [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue ${g.raws[0]}–{g.raws[1]}M'),
        chip('gold', f'調整後粗利益率 約{ggm.raws[0]}%', f'Adj. gross margin ~{ggm.raws[0]}%'),
        chip('gold', f'調整後EPS {ps(ge.values[0])["ja"]}〜{ps(ge.values[1])["ja"]}', f'Adj. EPS {ps(ge.values[0])["en"]}–{ge.raws[1]}')], [
        sec('happened', f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}、調整後粗利益率を約{ggm.raws[0]}%と見込んでいます。今回の{usd(r0)["ja"]}と比べると、下限でも約{q(lo_up, 1)}%の増加です。',
            f'The company expects next-quarter revenue of ${g.raws[0]}–{g.raws[1]}M and a non-GAAP gross margin of about {ggm.raws[0]}%. Against {usd(r0)["en"]} this quarter, even the low end would be about {q(lo_up, 1)}% higher.'),
        sec('watch', f'粗利益率の見通し(約{ggm.raws[0]}%)は、今回の{pc(g0)}' + ('をわずかに下回ります。利益率が下がり続けると、利益の伸びは売上より小さくなります。' if ggm.values[0] < g0 else 'を下回っていません。'),
            f"The margin outlook (about {ggm.raws[0]}%) is " + (f"slightly below this quarter's {pc(g0)}. If the margin keeps slipping, profit will grow more slowly than sales." if ggm.values[0] < g0 else f"not below this quarter's {pc(g0)}.")),
        sec('view', '次の決算で、実際の結果がこの幅のどこに入るかを確かめます。', 'What matters is where actual results land within this range in the next report.')])
    times = q(r0 / r2, 1)
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期の約{times}倍でした。' + (f'{leader.values[0]}が最大の製品群になりました。' if leader else ''),
          f'Revenue was {usd(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and about {times} times a year ago.' + (f' {leader.values[0]} became the largest product family.' if leader else '')),
        c(f'調整後粗利益率は{pc(g0)}で、前期の{pc(g1)}、前年同期の{pc(g2)}と比べられます。', f'Non-GAAP gross margin was {pc(g0)}, versus {pc(g1)} last quarter and {pc(g2)} a year ago.'),
        c(f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}、調整後粗利益率を約{ggm.raws[0]}%と見込んでいます。',
          f'The company expects next-quarter revenue of ${g.raws[0]}–{g.raws[1]}M with a non-GAAP gross margin of about {ggm.raws[0]}%.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- Lumentum (LITE) ---------------------------------------------------------------------------------------------------------------

def lite(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'gmGaap', 'opMarginGaap', 'gm', 'opMargin', 'components', 'systems', 'eps', 'netIncome', 'cashChange', 'ppe', 'inventories',
         'receivables', 'debtCurrent', 'guidanceRevenue', 'guidanceOpMargin', 'guidanceEps')
    ev = Evidence(url)
    rev, gm, om, eps = f['revenue'], f['gm'], f['opMargin'], f['eps']
    r0, r1, r2 = rev.values
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.adjustedEPS', eps)
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    g = f['guidanceRevenue']
    low, high = range_guidance(ev, g)
    numbers = {'revenue': revenue_numbers(ev, rev), 'adjustedEPS': float(eps.values[0]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm.values[0]), 'previous': float(gm.values[1])},
               'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': None}, 'segments': None}
    lo_up, hi_up = change(low, r0), change(high, r0)
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前年同期比 {sign(yoy)}、前期比 {sign(qoq)}', f'YoY {sign(yoy)}, QoQ {sign(qoq)}'),
             text_tile('調整後(non-GAAP)営業利益率', 'Non-GAAP operating margin', pc(om.values[0]), pc(om.values[0]),
                       f'前期 {pc(om.values[1])}、前年同期 {pc(om.values[2])}', f'Prior quarter {pc(om.values[1])}, year ago {pc(om.values[2])}'),
             text_tile('次期の売上見通し', 'Next-quarter revenue outlook', f'{usd(low)["ja"]}〜{usd(high)["ja"]}', f'${g.raws[0]}–{g.raws[1]}B',
                       f'今回より約{sign(lo_up, 0)}〜{sign(hi_up, 0)}', f'About {sign(lo_up, 0)}–{format(q(hi_up, 0), "f")}% vs. this quarter')]
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 2), rnd=1)
    ev.add('tiles[1].value', om)
    ev.add('tiles[1].note', om)
    ev.add('tiles[2].value', g)
    ev.add('tiles[2].note', g, calc=f'({g.raws[0]} * 1000 / {rev.raws[0]} - 1) * 100', rnd=0)
    ev.add('tiles[2].note', rev)
    comp, syst = f['components'].values, f['systems'].values
    parts = [('Components', 'コンポーネント', comp), ('Systems', 'システム', syst)]
    fast = max(parts, key=lambda x: change(x[2][0], x[2][2]))
    slow = [x for x in parts if x is not fast][0]
    d = r0 - r1
    fd = fast[2][0] - fast[2][2]
    leaders, win = f.get('leaders'), f.get('win')
    ev.add('summary.cards.growth.sections[0]', f['components'])
    ev.add('summary.cards.growth.sections[0]', f['systems'])
    if leaders:
        ev.add('summary.cards.growth.sections[0]', leaders)
    if win:
        ev.add('summary.cards.growth.sections[1]', win)
    growth = card(f'{fast[1]}の売上が前期比 {sign(change(fast[2][0], fast[2][2]), 0)}', f'{fast[0]} revenue {sign(change(fast[2][0], fast[2][2]), 0)} QoQ', [
        chip(tone(fd), f'{fast[1]} 前期比 {sign(change(fast[2][0], fast[2][2]))}', f'{fast[0]} {sign(change(fast[2][0], fast[2][2]))} QoQ'),
        chip(tone(slow[2][0] - slow[2][2]), f'{slow[1]} 前期比 {sign(change(slow[2][0], slow[2][2]))}', f'{slow[0]} {sign(change(slow[2][0], slow[2][2]))} QoQ')], [
        sec('happened', f'{fast[1]}の売上は{usd(fast[2][2])["ja"]}から{usd(fast[2][0])["ja"]}へ{sign(change(fast[2][0], fast[2][2]))}、{slow[1]}は{usd(slow[2][2])["ja"]}から{usd(slow[2][0])["ja"]}へ{sign(change(slow[2][0], slow[2][2]))}でした。'
            + (f'CEOは、{leaders.values[0]}と光回線スイッチ({leaders.values[2]})が伸びを主導したとしています。' if leaders else ''),
            f'{fast[0]} revenue went from {usd(fast[2][2])["en"]} to {usd(fast[2][0])["en"]}, {sign(change(fast[2][0], fast[2][2]))}, and {slow[0]} from {usd(slow[2][2])["en"]} to {usd(slow[2][0])["en"]}, {sign(change(slow[2][0], slow[2][2]))}.'
            + (f' The CEO named {leaders.values[0]} and {leaders.values[1]} ({leaders.values[2]}) as the leading contributors.' if leaders else '')),
        sec('good', (f'前期からの増加{usd(d)["ja"]}のうち、約{q(fd / d * 100, 0)}%({usd(fd)["ja"]})が{fast[1]}です。' if d > 0 and fd > 0 else f'売上は前期から{usd(abs(d))["ja"]}{rose(d, True)}ました。')
            + (f'CEOは、{win.values[1]}の大型案件を新たに獲得し、{usd(Decimal(win.values[2]) * 1000)["ja"]}超の購入契約の裏付けがあるとも述べています。' if win else ''),
            (f'About {q(fd / d * 100, 0)}% ({usd(fd)["en"]}) of the {usd(d)["en"]} sequential increase came from {fast[0]}.' if d > 0 and fd > 0 else f'Revenue {rose(d)} {usd(abs(d))["en"]} from the previous quarter.')
            + (f' The CEO also said the company won a {win.values[0]} major {win.values[1]} program, backed by purchase commitments of more than ${win.values[2]}B.' if win else '')),
        sec('watch', '伸びはAIデータセンター向けに集中しています。会社自身も、利益率を動かす製品構成の変化や、顧客の発注の延期・取り消しをリスクとして挙げています。',
            'Growth is concentrated in AI data centers. The company itself lists product-mix swings, which move margins, and customer order delays or cancellations as risks.'),
        sec('view', f'売上の約{q(comp[1], 0)}%がコンポーネント、約{q(syst[1], 0)}%がシステムです。どちらが伸び続けるかで、利益率の行方も変わります。',
            f'About {q(comp[1], 0)}% of revenue is Components and {q(syst[1], 0)}% Systems. Which of the two keeps growing will also shape where margins go.')])
    g0, g1 = gm.values[0], gm.values[1]
    omg, ni, dl = f['opMarginGaap'], f['netIncome'], f.get('debtLoss')
    ev.add('summary.cards.change.sections[1]', eps)
    ev.add('summary.cards.change.sections[2]', omg)
    ev.add('summary.cards.change.sections[3]', ni)
    if dl:
        ev.add('summary.cards.change.sections[3]', dl)
    loss_note = ni.values[1] < 0 and dl and dl.values[1] > 0
    changes = card(f'売上は前期比 {sign(qoq)}、調整後粗利益率も{"上昇" if g0 > g1 else "低下" if g0 < g1 else "横ばい"}', f'Revenue {sign(qoq)} QoQ, adjusted gross margin {"also higher" if g0 > g1 else "lower" if g0 < g1 else "flat"}', [
        chip(tone(g0 - g1), f'調整後粗利益率 {pc(g1)} → {pc(g0)}', f'Adj. gross margin {pc(g1)} → {pc(g0)}'),
        chip(tone(om.values[0] - om.values[1]), f'調整後営業利益率 {pc(om.values[1])} → {pc(om.values[0])}', f'Adj. operating margin {pc(om.values[1])} → {pc(om.values[0])}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。調整後粗利益率は{pc(g1)}から{pc(g0)}、調整後営業利益率は{pc(om.values[1])}から{pc(om.values[0])}になりました。',
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}. Non-GAAP gross margin went from {pc(g1)} to {pc(g0)} and non-GAAP operating margin from {pc(om.values[1])} to {pc(om.values[0])}.'),
        sec('good', f'調整後EPSは{ps(eps.values[0])["ja"]}で、前期の{ps(eps.values[1])["ja"]}から{"増え" if eps.values[0] > eps.values[1] else "減り"}ました。' + ('売上とともに利益率も上がったため、利益は売上より大きく伸びています。' if om.values[0] > om.values[1] and d > 0 else ''),
            f'Non-GAAP EPS was {ps(eps.values[0])["en"]}, {"up" if eps.values[0] > eps.values[1] else "down"} from {ps(eps.values[1])["en"]} last quarter.' + (' Because margins rose with sales, profit grew faster than revenue.' if om.values[0] > om.values[1] and d > 0 else '')),
        sec('watch', f'GAAPの営業利益率は{pc(omg.values[0])}で、調整後の{pc(om.values[0])}より約{q(om.values[0] - omg.values[0], 0)}ポイント低くなっています。差には株式報酬や買収関連の費用が含まれます。',
            f'The GAAP operating margin was {pc(omg.values[0])}, about {q(om.values[0] - omg.values[0], 0)} points below the adjusted {pc(om.values[0])}. The gap includes stock-based compensation and acquisition-related costs.'),
        sec('means', (f'前期のGAAPの純損失{usd(-ni.values[1])["ja"]}は、社債の転換に伴う一時的な損失{usd(dl.values[1])["ja"]}(現金の支出はなし)によるものです。今期のGAAPの純利益は{usd(ni.values[0])["ja"]}でした。' if loss_note else
                      f'GAAPの純利益は前期の{usd(ni.values[1])["ja"]}から{usd(ni.values[0])["ja"]}になりました。'),
            (f"Last quarter's {usd(-ni.values[1])['en']} GAAP net loss came from a one-time {usd(dl.values[1])['en']} loss on debt extinguishment. This quarter GAAP net income was {usd(ni.values[0])['en']}." if loss_note else
             f'GAAP net income went from {usd(ni.values[1])["en"]} to {usd(ni.values[0])["en"]}.'))])
    cc, ppe, inv, ar, dc = f['cashChange'], f['ppe'], f['inventories'], f['receivables'], f['debtCurrent']
    cash_bn, way, delta = cc.values
    down = way == 'decrease'
    for k in ('cashChange', 'ppe', 'inventories', 'receivables', 'debtCurrent'):
        ev.add('summary.cards.caution.sections[0]', f[k])
    caution = card(f'手元資金が前期末から{usd(Decimal(delta))["ja"]}{"減少" if down else "増加"}', f'Cash {"fell" if down else "rose"} {usd(Decimal(delta))["en"]} from last quarter', [
        chip('down' if down else 'up', f'現金・短期投資 {"−" if down else "+"}{usd(Decimal(delta))["ja"]}', f'Cash & investments {"−" if down else "+"}{usd(Decimal(delta))["en"]}'),
        chip('gold', f'1年以内に返す借入 {usd(dc.values[0])["ja"]}', f'Current debt {usd(dc.values[0])["en"]}'),
        chip('gold', f'設備 {usd(ppe.values[1])["ja"]} → {usd(ppe.values[0])["ja"]}', f'PP&E {usd(ppe.values[1])["en"]} → {usd(ppe.values[0])["en"]}')], [
        sec('happened', f'現金・現金同等物・短期投資の合計は{usd(Decimal(cash_bn) * 1000)["ja"]}で、前期末から{usd(Decimal(delta))["ja"]}{"減り" if down else "増え"}ました。同じ期間に、設備は{usd(ppe.values[1])["ja"]}から{usd(ppe.values[0])["ja"]}、在庫は{usd(inv.values[1])["ja"]}から{usd(inv.values[0])["ja"]}、売掛金は{usd(ar.values[1])["ja"]}から{usd(ar.values[0])["ja"]}になり、1年以内に返す借入は{usd(dc.values[1])["ja"]}から{usd(dc.values[0])["ja"]}になりました。',
            f'Cash, equivalents and short-term investments ended at ${cash_bn}B, {"down" if down else "up"} {usd(Decimal(delta))["en"]}. Over the same period PP&E went from {usd(ppe.values[1])["en"]} to {usd(ppe.values[0])["en"]}, inventory from {usd(inv.values[1])["en"]} to {usd(inv.values[0])["en"]} and receivables from {usd(ar.values[1])["en"]} to {usd(ar.values[0])["en"]}, while the current portion of debt went from {usd(dc.values[1])["en"]} to {usd(dc.values[0])["en"]}.'),
        sec('means', '現金は設備の増強、在庫、借入の返済に回っているとみられます。利益が大きくても、これだけ速く成長していると手元の現金が減ることがあります。',
            'Cash appears to be going into capacity, inventory and debt repayment. Even with strong profit, cash can shrink while the company grows this fast.'),
        sec('watch', f'決算発表には四半期のキャッシュフロー計算書がなく、減少の内訳はこの資料だけでは確かめられません。1年以内に返す借入も{usd(dc.values[0])["ja"]}あります。',
            f'The release has no quarterly cash flow statement, so the exact reasons for the change cannot be confirmed from it. {usd(dc.values[0])["en"]} of debt is also due within a year.'),
        sec('view', f'手元には{usd(Decimal(cash_bn) * 1000)["ja"]}あり、すぐに資金が足りなくなる状況ではありません。次の決算で、減少が止まるかを確かめます。',
            f'With ${cash_bn}B of cash there is no near-term shortage. The next report will show where cash goes next.')])
    gom, ge, sq = f['guidanceOpMargin'], f['guidanceEps'], f.get('sequential')
    ev.add('summary.cards.next.chips[1]', gom)
    ev.add('summary.cards.next.chips[2]', ge)
    if sq:
        ev.add('summary.cards.next.sections[1]', sq)
    nxt = card('次期の会社見通しを追う', "Follow the company's outlook for next quarter", [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue ${g.raws[0]}–{g.raws[1]}B'),
        chip('gold', f'調整後営業利益率 {gom.raws[0]}〜{gom.raws[1]}%', f'Adj. operating margin {gom.raws[0]}–{gom.raws[1]}%'),
        chip('gold', f'調整後EPS {ps(ge.values[0])["ja"]}〜{ps(ge.values[1])["ja"]}', f'Adj. EPS {ps(ge.values[0])["en"]}–{ge.raws[1]}')], [
        sec('happened', f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}、調整後営業利益率を{gom.raws[0]}〜{gom.raws[1]}%と見込んでいます。今回の{usd(r0)["ja"]}と比べると、下限でも約{q(lo_up, 1)}%の増加です。',
            f'The company expects next-quarter revenue of ${g.raws[0]}–{g.raws[1]}B and a non-GAAP operating margin of {gom.raws[0]}–{gom.raws[1]}%. Against {usd(r0)["en"]} this quarter, even the low end would be about {q(lo_up, 1)}% higher.'),
        sec('means', (f'CEOは前期比で約{usd(Decimal(sq.values[0]))["ja"]}の増収を見込むとしています。' if sq else '') + f'営業利益率の見通しは今回の{pc(om.values[0])}' + ('を上回り、売上と利益率の両方が上がる計画です。' if gom.values[0] > om.values[0] else 'と比べられます。'),
            (f'The CEO expects about {usd(Decimal(sq.values[0]))["en"]} of sequential growth. ' if sq else '') + f"The margin outlook compares with this quarter's {pc(om.values[0])}" + (', so both sales and margin are guided higher.' if gom.values[0] > om.values[0] else '.')),
        sec('view', '見通しは会社の計画で、実績ではありません。実際の結果がこの幅のどこに入るか、現金がどう動くかを確かめます。',
            "The outlook is the company's plan, not a result. Watch where actual results land in this range, and how cash moves.")])
    times = q(r0 / r2, 1)
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq)}、前年同期の約{times}倍でした。コンポーネントとシステムの両方が' + ('伸びました。' if comp[0] > comp[2] and syst[0] > syst[2] else '動きました。'),
          f'Revenue was {usd(r0)["en"]}, {sign(qoq)} from the previous quarter and about {times} times a year ago.' + (' Both Components and Systems grew.' if comp[0] > comp[2] and syst[0] > syst[2] else '')),
        c(f'調整後粗利益率は{pc(g0)}、調整後営業利益率は{pc(om.values[0])}になりました。前期はそれぞれ{pc(g1)}と{pc(om.values[1])}でした。', f'Non-GAAP gross margin was {pc(g0)} and non-GAAP operating margin {pc(om.values[0])} (last quarter {pc(g1)} and {pc(om.values[1])}).'),
        c(f'一方、現金と短期投資は前期末から{usd(Decimal(delta))["ja"]}{"減って" if down else "増えて"}{usd(Decimal(cash_bn) * 1000)["ja"]}になりました。会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}と見込んでいます。',
          f'Cash and short-term investments, however, {"fell" if down else "rose"} {usd(Decimal(delta))["en"]} from last quarter to ${cash_bn}B. The company expects next-quarter revenue of ${g.raws[0]}–{g.raws[1]}B.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- Sandisk (SNDK) -----------------------------------------------------------------------------------------------------------------

def sndk(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'revenueYoy', 'gm', 'gmYoy', 'opex', 'opIncome', 'netIncome', 'eps', 'datacenter', 'edge', 'consumer', 'cfo', 'cfoMargin',
         'receivables', 'cash', 'buyback', 'guidanceRevenue', 'guidanceGm', 'guidanceOpex', 'guidanceEps')
    ev = Evidence(url)
    rq, ry, gm, gy, eps = f['revenue'], f['revenueYoy'], f['gm'], f['gmYoy'], f['eps']
    r0, r1, r2 = rq.values[0], rq.values[1], ry.values[1]
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.revenue.current', rq)
    ev.add('numbers.revenue.previous', rq)
    ev.add('numbers.revenue.yearAgo', ry)
    ev.add('numbers.adjustedEPS', eps)
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    g, ggm = f['guidanceRevenue'], f['guidanceGm']
    low, high = range_guidance(ev, g)
    gmid = (ggm.values[0] + ggm.values[1]) / 2
    ev.add('numbers.guidance.grossMarginPercent', ggm, calc=f'({ggm.raws[0]} + {ggm.raws[1]}) / 2')
    g0, g1, g2 = gm.values[2], gm.values[3], gy.values[3]
    e0, e1 = eps.values[2], eps.values[3]
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(e0), 'epsEstimate': None,
               'grossMargin': {'current': float(g0), 'previous': float(g1)},
               'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': float(gmid)}, 'segments': None}
    dcf, edf, cof = f['datacenter'], f['edge'], f['consumer']
    dc, ed, co = dcf.values, edf.values, cof.values
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rq, 0, None), f'前年同期比 {sign(yoy, 0)}、前期比 {sign(qoq, 0)}', f'{sign(yoy, 0)} YoY, {sign(qoq, 0)} QoQ'),
             text_tile('調整後(non-GAAP)粗利益率', 'Non-GAAP gross margin', pc(g0), pc(g0), f'前期 {pc(g1)}、前年同期 {pc(g2)}', f'Prior quarter {pc(g1)}; year ago {pc(g2)}'),
             tile('データセンター向け売上', 'Datacenter revenue', money_tile(ev, 2, dcf, 0, None), f'前期比 {sign(change(dc[0], dc[1]), 0)}', f'{sign(change(dc[0], dc[1]), 0)} QoQ')]
    ev.add('tiles[0].note', ry, calc=growth_calc(ry, 0, 1), rnd=0)
    ev.add('tiles[1].value', gm)
    ev.add('tiles[1].note', gm)
    ev.add('tiles[2].note', dcf, calc=growth_calc(dcf, 0, 1), rnd=0)
    d = r0 - r1
    dcd = dc[0] - dc[1]
    demand = f.get('dataCenterDemand')
    ev.add('summary.cards.growth.sections[0]', edf)
    ev.add('summary.cards.growth.sections[0]', cof)
    if demand:
        ev.add('summary.cards.growth.sections[1]', demand)
    growth = card(f'データセンター向け売上が前期比 {sign(change(dc[0], dc[1]), 0)}', f'Datacenter revenue {sign(change(dc[0], dc[1]), 0)} QoQ', [
        chip(tone(dcd), f'データセンター {usd(dc[0])["ja"]}', f'Datacenter {usd(dc[0])["en"]}'),
        chip(tone(ed[0] - ed[1]), f'エッジ 前期比 {sign(change(ed[0], ed[1]), 0)}', f'Edge {sign(change(ed[0], ed[1]), 0)} QoQ'),
        chip(tone(co[0] - co[1]), f'コンシューマー 前期比 {sign(change(co[0], co[1]), 0)}', f'Consumer {sign(change(co[0], co[1]), 0)} QoQ')], [
        sec('happened', f'データセンター向け売上は{usd(dc[1])["ja"]}から{usd(dc[0])["ja"]}へ{sign(change(dc[0], dc[1]), 0)}で、全体の約{q(dc[0] / r0 * 100, 0)}%です。PCやスマートフォン向けのエッジは{usd(ed[0])["ja"]}で前期比{sign(change(ed[0], ed[1]), 0)}、コンシューマーは{usd(co[0])["ja"]}で前期比{sign(change(co[0], co[1]), 0)}でした。',
            f'Datacenter revenue went from {usd(dc[1])["en"]} to {usd(dc[0])["en"]}, {sign(change(dc[0], dc[1]), 0)}, about {q(dc[0] / r0 * 100, 0)}% of the total. Edge (PCs and phones) was {usd(ed[0])["en"]} ({sign(change(ed[0], ed[1]), 0)}), and Consumer was {usd(co[0])["en"]} ({sign(change(co[0], co[1]), 0)}).'),
        sec('good', ('AIデータセンター向けの大容量SSDの需要が強く、会社はデータセンター事業がほかより速く伸びたとしています。' if demand else '')
            + (f'売上の増加分{usd(d)["ja"]}のうち約{q(dcd / d * 100, 0)}%がデータセンター向けです。' if d > 0 and dcd > 0 else f'売上は前期から{usd(abs(d))["ja"]}{rose(d, True)}ました。'),
            ('Demand for high-capacity SSDs in AI data centers is strong; the company said its data center business outgrew the rest. ' if demand else '')
            + (f'About {q(dcd / d * 100, 0)}% of the {usd(d)["en"]} revenue increase came from Datacenter.' if d > 0 and dcd > 0 else f'Revenue {rose(d)} {usd(abs(d))["en"]} from the previous quarter.')),
        sec('watch', f'コンシューマー(メモリーカードやUSBメモリーなど)は前年同期比{sign(change(co[0], co[2]), 0)}です。データセンター向けの比率が高まるほど、業績はAI投資の動きに左右されます。',
            f'Consumer (memory cards, USB drives and similar) is {sign(change(co[0], co[2]), 0)} from a year earlier. The more the mix tilts to data centers, the more results depend on AI spending.')])
    oi, ni, gain = f['opIncome'], f['netIncome'], f.get('equityGain')
    ev.add('summary.cards.change.chips[2]', eps)
    ev.add('summary.cards.change.sections[1]', oi)
    if gain:
        ev.add('summary.cards.change.sections[2]', gain)
    changes = card(f'売上は前期比 {sign(qoq, 0)}、粗利益率は{pc(g0)}', f'Revenue {sign(qoq, 0)} QoQ; gross margin {pc(g0)}', [
        chip(tone(qoq), f'売上 前期比 {sign(qoq, 0)}', f'Revenue {sign(qoq, 0)} QoQ'),
        chip(tone(g0 - g1), f'調整後粗利益率 {pc(g1)} → {pc(g0)}', f'Non-GAAP gross margin {pc(g1)} → {pc(g0)}'),
        chip(tone(e0 - e1), f'調整後EPS {ps(e1)["ja"]} → {ps(e0)["ja"]}', f'Non-GAAP EPS {ps(e1)["en"]} → {ps(e0)["en"]}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。調整後EPSは{ps(e1)["ja"]}から{ps(e0)["ja"]}になりました。',
            f'Revenue {rose(d)} {usd(abs(d))["en"]} from {usd(r1)["en"]} to {usd(r0)["en"]}. Non-GAAP EPS went from {ps(e1)["en"]} to {ps(e0)["en"]}.'),
        sec('good', f'売上100ドルのうち約{q(g0, 0)}ドルが粗利益として残ります。調整後の営業利益は{usd(oi.values[2])["ja"]}で、売上の約{q(oi.values[2] / r0 * 100, 0)}%です。',
            f'About ${q(g0, 0)} of every $100 of sales stays as gross profit. Non-GAAP operating income was {usd(oi.values[2])["en"]}, about {q(oi.values[2] / r0 * 100, 0)}% of revenue.'),
        sec('watch', f'GAAPの純利益{usd(ni.values[0])["ja"]}には、' + (f'保有株式の評価益など{usd(gain.values[0])["ja"]}が含まれます。営業による利益とは分けて見る必要があります。' if gain and gain.values[0] > 0 else '本業以外の損益も含まれます。'),
            f'GAAP net income of {usd(ni.values[0])["en"]} includes ' + (f'a {usd(gain.values[0])["en"]} net gain on equity securities. Keep that separate from operating profit.' if gain and gain.values[0] > 0 else 'items outside operations.')),
        sec('view', f'前年同期は売上{usd(r2)["ja"]}、粗利益率{pc(g2)}でした。メモリー価格の変化で、利益の水準が大きく変わっています。',
            f'A year ago revenue was {usd(r2)["en"]} with a gross margin of {pc(g2)}. Memory prices have changed the profit level a lot.')])
    cfo, cm, ar, cash, bb = f['cfo'], f['cfoMargin'], f['receivables'], f['cash'], f['buyback']
    ev.add('summary.cards.caution.chips[0]', ggm)
    for k in ('cfo', 'cfoMargin', 'receivables'):
        ev.add('summary.cards.caution.sections[1]', f[k])
    ev.add('summary.cards.caution.sections[2]', bb)
    ev.add('summary.cards.caution.sections[2]', cash)
    caution = card('利益率は異例の高さで、価格しだい', 'Margins are at unusual highs and depend on prices', [
        chip('gold', f'粗利益率の見通し {ggm.raws[0]}〜{ggm.raws[1]}%', f'Gross margin outlook {ggm.raws[0]}–{ggm.raws[1]}%'),
        chip(tone(cm.values[0] - cm.values[1]), f'営業CFの売上比 {pc(cm.values[1])} → {pc(cm.values[0])}', f'Operating cash flow margin {pc(cm.values[1])} → {pc(cm.values[0])}'),
        chip('gold', f'自社株買い {usd(Decimal(bb.values[0]) * 1000)["ja"]}', f'Buybacks ${bb.values[0]}B')], [
        sec('watch', f'前年同期の粗利益率は{pc(g2)}でした。メモリーの価格は需給で大きく動き、今の約{q(g0, 0)}%は価格が非常に高いことを反映しています。価格が下がれば、利益率も大きく下がる可能性があります。',
            f"A year ago gross margin was {pc(g2)}. Memory prices swing with supply and demand, and today's ~{q(g0, 0)}% reflects very high prices. If prices fall, margins could drop sharply."),
        sec('happened', f'営業キャッシュフローは{usd(cfo.values[0])["ja"]}で、売上に対する比率は{pc(cm.values[1])}から{pc(cm.values[0])}になりました。売掛金は{usd(ar.values[1])["ja"]}から{usd(ar.values[0])["ja"]}になっています。',
            f'Operating cash flow was {usd(cfo.values[0])["en"]}, going from {pc(cm.values[1])} to {pc(cm.values[0])} of revenue, as accounts receivable went from {usd(ar.values[1])["en"]} to {usd(ar.values[0])["en"]}.'),
        sec('means', f'この四半期に約{usd(Decimal(bb.values[0]) * 1000)["ja"]}の自社株買いもしました。稼いだ現金の多くを株主に返したため、現金は{usd(cash.values[1])["ja"]}から{usd(cash.values[0])["ja"]}になりました。',
            f'It also bought back about ${bb.values[0]}B of stock in the quarter. Much of the cash earned went back to shareholders, so cash went from {usd(cash.values[1])["en"]} to {usd(cash.values[0])["en"]}.'),
        sec('view', f'大事なのは利益率の高さより、それがどれだけ続くかです。次の決算で、見通しの約{pc(gmid)}近くを保てるかを確かめます。',
            f'What matters is not how high margins are but how long they last. The next report will show whether margins hold near the guided {pc(gmid)}.')])
    go, ge, split = f['guidanceOpex'], f['guidanceEps'], f.get('split')
    ev.add('summary.cards.next.chips[2]', ge)
    ev.add('summary.cards.next.sections[1]', go)
    ev.add('summary.cards.next.sections[1]', f['opex'])
    pre = '(分割前)' if split else ''
    nxt = card(f'次期の売上見通し {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Next quarter revenue outlook: ${bn(low)}–{bn(high)}B', [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue ${bn(low)}–{bn(high)}B'),
        chip('gold', f'調整後粗利益率 {ggm.raws[0]}〜{ggm.raws[1]}%', f'Non-GAAP gross margin {ggm.raws[0]}–{ggm.raws[1]}%'),
        chip('gold', f'調整後EPS {ps(ge.values[0])["ja"]}〜{ps(ge.values[1])["ja"]}{pre}', f'Non-GAAP EPS ${q(ge.values[0], 0)}–{q(ge.values[1], 0)}' + (' (pre-split)' if split else ''))], [
        sec('happened', f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}、調整後粗利益率を{ggm.raws[0]}〜{ggm.raws[1]}%と見込んでいます。下限でも今回の{usd(r0)["ja"]}より約{q(change(low, r0), 1)}%多くなります。',
            f"The company expects next-quarter revenue of ${bn(low)}B–${bn(high)}B with a non-GAAP gross margin of {ggm.raws[0]}–{ggm.raws[1]}%. Even the low end is about {q(change(low, r0), 1)}% above this quarter's {usd(r0)['en']}."),
        sec('means', f'粗利益率の見通しの中央値{pc(gmid)}は、今回の{pc(g0)}とほぼ同じです。調整後の営業費用は{usd(go.values[0])["ja"]}〜{usd(go.values[1])["ja"]}の見通しで、今回は{usd(f["opex"].values[2])["ja"]}でした。',
            f"The margin midpoint of {pc(gmid)} compares with this quarter's {pc(g0)}. Non-GAAP operating expenses are guided at {usd(go.values[0])['en']}–{usd(go.values[1])['en']}, versus {usd(f['opex'].values[2])['en']} this quarter."),
        sec('view', '次の決算で、売上が見通しの幅に入るか、データセンター向けが伸び続けるか、利益率が見通しの近くに残るかを確かめます。' + ('株式分割の後は、1株あたりの数字は分割前の約8分の1になります。' if split and split.values[0] == 'eight' else ''),
            'Next time, check whether revenue lands in the range, Datacenter keeps growing, and margins stay near the outlook.' + (' After the split, EPS figures will be about one-eighth of the pre-split numbers.' if split and split.values[0] == 'eight' else ''))])
    times = q(r0 / r2, 1)
    if split:
        ev.add('summary.conclusion[2]', split)
        day = datetime.strptime(f'{split.values[1]} {split.values[2]}', '%B %d %Y')
        n = {'two': 2, 'three': 3, 'four': 4, 'five': 5, 'ten': 10, 'eight': 8}.get(split.values[0], split.values[0])
        last = c(f'1株あたりの数字は、{day.month}月{day.day}日付の1株を{n}株にする株式分割の前の基準です。', f'Per-share figures are before the {n}-for-1 stock split effective {day.strftime("%B")} {day.day}.')
    else:
        last = c(f'調整後EPSは{ps(e0)["ja"]}で、前期の{ps(e1)["ja"]}から{"増え" if e0 > e1 else "減り"}ました。', f'Non-GAAP EPS was {ps(e0)["en"]}, {"up" if e0 > e1 else "down"} from {ps(e1)["en"]}.')
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期の約{times}倍でした。データセンター向けが前期比{sign(change(dc[0], dc[1]), 0)}と伸びをけん引しました。',
          f'Revenue was {usd(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and about {times} times a year earlier. Datacenter led, {sign(change(dc[0], dc[1]), 0)} from the previous quarter.'),
        c(f'調整後粗利益率は{pc(g0)}で、前年同期の{pc(g2)}から大きく変わりました。メモリー価格が高い時期の数字で、次期の見通しも{ggm.raws[0]}〜{ggm.raws[1]}%です。',
          f'Non-GAAP gross margin was {pc(g0)}, versus {pc(g2)} a year earlier. These are numbers from a period of high memory prices, and next quarter is guided at {ggm.raws[0]}–{ggm.raws[1]}%.'),
        last]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- Vertiv (VRT): the previous quarter's figures come from the previous quarter's own release ------------------------------------

def need_prior(prior, *names):
    missing = [n for n in names if n not in (prior or {})]
    if missing:
        raise ValueError('missing:prior ' + ','.join(missing))


def vrt(f, url, before_previous, report=None, events=None, previous=None, prior=None):
    need(f, 'revenue', 'amer', 'apac', 'emea', 'amerMargin', 'apacMargin', 'emeaMargin', 'margin', 'sales', 'eps', 'cash', 'deferred', 'cashBalance', 'debt',
         'guidanceRevenue', 'guidanceMargin', 'guidanceEps')
    need_prior(prior, 'revenue', 'amer', 'apac', 'emea', 'amerMargin', 'apacMargin', 'emeaMargin', 'margin', 'eps', 'cash')
    ev = Evidence(url)
    rev, prev_rev = f['revenue'], prior['revenue']
    r0, r2 = rev.values
    r1 = prev_rev.values[0]
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.yearAgo', rev)
    ev.add('numbers.revenue.previous', prev_rev)
    eps, peps = f['eps'], prior['eps']
    e0, e1 = Decimal(eps.values[3]), Decimal(peps.values[3])
    ev.add('numbers.adjustedEPS', eps)
    g = f['guidanceRevenue']
    low, high = range_guidance(ev, g)
    segs = []
    for i, (key, ja, en) in enumerate((('amer', '米州', 'Americas'), ('apac', 'アジア太平洋', 'Asia Pacific'), ('emea', '欧州・中東・アフリカ', 'EMEA'))):
        cur, old, m, pm = f[key], prior[key], f[key + 'Margin'], prior[key + 'Margin']
        ev.add(f'numbers.segments[{i}].revenue', cur)
        ev.add(f'numbers.segments[{i}].previous', old)
        ev.add(f'numbers.segments[{i}].operatingMargin', m)
        ev.add(f'numbers.segments[{i}].previousOperatingMargin', pm)
        segs.append({'key': key, 'nameJa': ja, 'nameEn': en, 'revenue': float(cur.values[0]), 'previous': float(old.values[0]),
                     'operatingMargin': float(m.values[0]), 'previousOperatingMargin': float(pm.values[0])})
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(e0), 'epsEstimate': None,
               'grossMargin': None, 'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': None}, 'segments': segs}
    sales, mg, pmg, orders = f['sales'], f['margin'], prior['margin'], f.get('orders')
    tiles = [tile('売上高', 'Net sales', money_tile(ev, 0, rev, 0, None), f'前年同期比 +{sales.values[2]}%(既存事業 +{sales.values[3]}%)', f'+{sales.values[2]}% YoY (+{sales.values[3]}% organic)'),
             text_tile('調整後営業利益率', 'Adjusted operating margin', pc(mg.values[0]), pc(mg.values[0]), f'前年同期 {pc(mg.values[1])}、前期 {pc(pmg.values[0])}',
                       f'Year ago {pc(mg.values[1])}; prior quarter {pc(pmg.values[0])}')]
    ev.add('tiles[0].note', sales)
    ev.add('tiles[1].value', mg)
    ev.add('tiles[1].note', mg)
    ev.add('tiles[1].note', pmg)
    if orders:
        tiles.append(text_tile('既存事業の受注の伸び', 'Organic orders growth', f'{orders.values[0]}%超', f'over {orders.values[0]}%', '前年同期比', 'Year over year'))
        ev.add('tiles[2].value', orders)
    else:
        tiles.append(text_tile('調整後EPS', 'Adjusted diluted EPS', ps(e0)['ja'], ps(e0)['en'], f'前年同期比 +{eps.values[2]}%', f'+{eps.values[2]}% YoY'))
        ev.add('tiles[2].value', eps)
        ev.add('tiles[2].note', eps)
    lead_i = max(range(3), key=lambda i: segs[i]['revenue'] - segs[i]['previous'])
    lead = segs[lead_i]
    ld = Decimal(str(lead['revenue'])) - Decimal(str(lead['previous']))
    d = r0 - r1
    reg = f.get('regions')
    if reg:
        ev.add('summary.cards.growth.sections[2]', reg)
    lchg = change(Decimal(str(lead['revenue'])), Decimal(str(lead['previous'])))
    growth = card(f'{lead["nameJa"]}の売上が前期比 {sign(lchg, 0)}', f'{lead["nameEn"]} sales {sign(lchg, 0)} QoQ', [
        chip(tone(ld), f'{lead["nameJa"]} 前期比 {sign(lchg)}', f'{lead["nameEn"]} {sign(lchg)} QoQ'),
        chip(tone(Decimal(str(lead['operatingMargin'])) - Decimal(str(lead['previousOperatingMargin']))), f'{lead["nameJa"]}の利益率 {pc(lead["previousOperatingMargin"])} → {pc(lead["operatingMargin"])}',
             f'{lead["nameEn"]} margin {pc(lead["previousOperatingMargin"])} → {pc(lead["operatingMargin"])}')], [
        sec('happened', f'{lead["nameJa"]}の売上は{usd(Decimal(str(lead["previous"])))["ja"]}から{usd(Decimal(str(lead["revenue"])))["ja"]}へ、{usd(abs(ld))["ja"]}{rose(ld, True)}ました。調整後営業利益率は{pc(lead["previousOperatingMargin"])}から{pc(lead["operatingMargin"])}になりました。',
            f'{lead["nameEn"]} sales {rose(ld)} {usd(abs(ld))["en"]} from {usd(Decimal(str(lead["previous"])))["en"]} to {usd(Decimal(str(lead["revenue"])))["en"]}. Its adjusted operating margin went from {pc(lead["previousOperatingMargin"])} to {pc(lead["operatingMargin"])}.'),
        sec('good', (f'会社全体の売上は前期から{usd(d)["ja"]}増え、そのうち約{q(ld / d * 100, 0)}%が{lead["nameJa"]}の増加分です。' if d > 0 and ld > 0 else f'会社全体の売上は前期から{usd(abs(d))["ja"]}{rose(d, True)}ました。')
            + 'データセンター向けの電源・冷却装置の需要が、売上と利益率の両方を押し上げています。',
            (f'Total sales rose {usd(d)["en"]} from the previous quarter, and about {q(ld / d * 100, 0)}% of that came from {lead["nameEn"]}.' if d > 0 and ld > 0 else f'Total sales {rose(d)} {usd(abs(d))["en"]} from the previous quarter.')
            + ' Demand for data-center power and cooling gear lifted both sales and margin.'),
        sec('watch', (f'伸びは{lead["nameJa"]}に集中しています。前年同期比で、米州は+{reg.values[0]}%、アジア太平洋は+{reg.values[2]}%、欧州・中東・アフリカは+{reg.values[4]}%でした。' if reg else
                      f'伸びは{lead["nameJa"]}に集中しています。'),
            (f'Growth is concentrated in {lead["nameEn"]}. Year over year, the Americas grew {reg.values[0]}%, APAC {reg.values[2]}% and EMEA {reg.values[4]}%.' if reg else
             f'Growth is concentrated in {lead["nameEn"]}.'))], lead['key'])
    all_up = all(x['operatingMargin'] > x['previousOperatingMargin'] for x in segs)
    driver = f.get('driver')
    if driver:
        ev.add('summary.cards.change.sections[1]', driver)
    ev.add('summary.cards.change.chips[2]', peps)
    ev.add('summary.cards.change.sections[2]', sales)
    trend_ja = trend_en = ''
    if before_previous:
        trend_ja = f'売上は2四半期前の{usd(before_previous)["ja"]}、前期の{usd(r1)["ja"]}、今期の{usd(r0)["ja"]}と推移しています。'
        trend_en = f'Sales went from {usd(before_previous)["en"]} two quarters ago to {usd(r1)["en"]} last quarter and {usd(r0)["en"]} now.'
    changes = card(f'売上は前期比 {sign(qoq)}' + ('、3地域すべてで利益率が上昇' if all_up else ''), f'Sales {sign(qoq)} QoQ' + ('; margins up in all three regions' if all_up else ''), [
        chip(tone(qoq), f'売上 前期比 {sign(qoq)}', f'Sales {sign(qoq)} QoQ'),
        chip(tone(mg.values[0] - pmg.values[0]), f'調整後営業利益率 {pc(pmg.values[0])} → {pc(mg.values[0])}', f'Adj. operating margin {pc(pmg.values[0])} → {pc(mg.values[0])}'),
        chip(tone(e0 - e1), f'調整後EPS {ps(e1)["ja"]} → {ps(e0)["ja"]}', f'Adj. EPS {ps(e1)["en"]} → {ps(e0)["en"]}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。調整後営業利益率は{pc(pmg.values[0])}から{pc(mg.values[0])}、調整後EPSは{ps(e1)["ja"]}から{ps(e0)["ja"]}になりました。',
            f'Net sales {rose(d)} {usd(abs(d))["en"]} from {usd(r1)["en"]} to {usd(r0)["en"]}. Adjusted operating margin went from {pc(pmg.values[0])} to {pc(mg.values[0])}, and adjusted EPS from {ps(e1)["en"]} to {ps(e0)["en"]}.'),
        sec('good', ('調整後営業利益率は、前期と比べて3地域すべてで上がりました。' if all_up else '地域ごとの調整後営業利益率は、上がったところと下がったところがあります。') + ('会社は、売上増による固定費の吸収と生産性の改善を理由に挙げています。' if driver else ''),
            ('Adjusted operating margins rose in all three regions from the previous quarter.' if all_up else 'Regional adjusted operating margins moved in different directions.') + (' The company cited operating leverage on higher sales and better manufacturing productivity.' if driver else '')),
        sec('watch', f'前年同期比+{sales.values[2]}%のうち、約{sales.values[4]}ポイントは買収による上乗せで、既存事業の伸びは+{sales.values[3]}%です。',
            f'About {sales.values[4]} points of the {sales.values[2]}% year-over-year growth came from acquisitions; organic growth was {sales.values[3]}%.'),
        sec('view', trend_ja + '強い受注が売上に表れ始めています。' if trend_ja else '強い受注が売上に表れ始めています。', (trend_en + ' Strong orders are now showing up in revenue.') if trend_en else 'Strong orders are now showing up in revenue.')])
    cash, pcash, dr, cb, debt = f['cash'], prior['cash'], f['deferred'], f['cashBalance'], f['debt']
    ocf, fcf = Decimal(cash.values[0]), Decimal(cash.values[1])
    pocf, pfcf = Decimal(pcash.values[0]), Decimal(pcash.values[1])
    deal = next((e for e in (events or []) if 'completed' in e['figures']), None)
    ev.add('summary.cards.caution.sections[0]', cash)
    ev.add('summary.cards.caution.sections[0]', pcash)
    ev.add('summary.cards.caution.sections[1]', dr)
    ev.add('summary.cards.caution.sections[2]', cb)
    ev.add('summary.cards.caution.sections[2]', debt)
    chips = [chip(tone(fcf - pfcf), f'調整後FCF {usd(pfcf)["ja"]} → {usd(fcf)["ja"]}', f'Adj. free cash flow {usd(pfcf)["en"]} → {usd(fcf)["en"]}'),
             chip('gold', f'繰延収益 {usd(dr.values[1])["ja"]} → {usd(dr.values[0])["ja"]}', f'Deferred revenue {usd(dr.values[1])["en"]} → {usd(dr.values[0])["en"]}')]
    deal_ja = deal_en = ''
    if deal:
        cp = deal['figures']['completed'].values
        up_m = Decimal(cp[3]) * (1000 if cp[4] == 'billion' else 1)
        cont = deal['figures'].get('contingent')
        cont_m = Decimal(cont.values[0]) * (1000 if cont.values[1] == 'billion' else 1) if cont else None
        for fig in deal['figures'].values():
            ev.add('summary.cards.caution.sections[2]', fig)
        chips.append(chip('gold', f'{cp[2]}買収 {usd(up_m)["ja"]}' + (f'+最大{usd(cont_m)["ja"]}' if cont else ''), f'{cp[2]} deal {usd(up_m)["en"]}' + (f' + up to {usd(cont_m)["en"]}' if cont else '')))
        deal_ja = f'{deal["date"]}、{cp[0]}({cp[2]})の買収を約{usd(up_m)["ja"]}の現金で完了しました。' + (f'目標を達成すれば、さらに最大{usd(cont_m)["ja"]}を支払います。' if cont else '')
        deal_en = f'On {deal["dateEn"]} the company closed the purchase of {cp[0]} ({cp[2]}) for about {usd(up_m)["en"]} in cash' + (f', plus up to {usd(cont_m)["en"]} more if targets are met. ' if cont else '. ')
    else:
        chips.append(chip('gold', f'長期借入 {usd(debt.values[0])["ja"]}', f'Long-term debt {usd(debt.values[0])["en"]}'))
    caution = card('現金を生む勢いが鈍り、買収で支出も増える' if deal else '現金を生む勢いが鈍った', 'Cash generation slowed, and an acquisition adds spending' if deal else 'Cash generation slowed', chips, [
        sec('happened', f'営業キャッシュフローは{usd(ocf)["ja"]}、調整後フリーキャッシュフローは{usd(fcf)["ja"]}で、前期の{usd(pocf)["ja"]}と{usd(pfcf)["ja"]}から{"減りました" if fcf < pfcf else "増えました"}。',
            f'Operating cash flow was {usd(ocf)["en"]} and adjusted free cash flow {usd(fcf)["en"]}, {"down" if fcf < pfcf else "up"} from {usd(pocf)["en"]} and {usd(pfcf)["en"]} last quarter.'),
        sec('means', f'顧客から前もって受け取った繰延収益は、前年度末の{usd(dr.values[1])["ja"]}から{usd(dr.values[0])["ja"]}になりました。将来の売上の裏付けですが、まだ納めていない約束でもあります。',
            f'Deferred revenue, cash received from customers in advance, went from {usd(dr.values[1])["en"]} at the prior year-end to {usd(dr.values[0])["en"]}. It supports future sales, but it is also a promise not yet delivered.'),
        sec('watch', deal_ja + f'期末の現金は{usd(cb.values[0])["ja"]}、長期借入は{usd(debt.values[0])["ja"]}でした。',
            deal_en + f'At quarter end it had {usd(cb.values[0])["en"]} of cash and {usd(debt.values[0])["en"]} of long-term debt.'),
        sec('view', '受注と前受けは強い一方、設備投資や買収で現金も多く使います。売上と合わせて、利益がどれだけ現金になるかを追います。',
            'Orders and advances are strong, but capacity spending and acquisitions also use more cash. Track how much profit turns into cash, alongside sales.')])
    gm_, ge, yr, raise_ = f['guidanceMargin'], f['guidanceEps'], f.get('yearRevenue'), f.get('raise')
    ev.add('summary.cards.next.sections[0]', gm_)
    ev.add('summary.cards.next.chips[2]', ge)
    if yr:
        ev.add('summary.cards.next.sections[1]', yr)
    nxt = card(f'次期の売上見通し {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Next quarter sales outlook: {usd(low)["en"]}–{usd(high)["en"]}', [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Sales {usd(low)["en"]}–{usd(high)["en"]}'),
        chip('gold', f'調整後営業利益率 {gm_.raws[0]}〜{gm_.raws[1]}%', f'Adj. operating margin {gm_.raws[0]}–{gm_.raws[1]}%'),
        chip('gold', f'調整後EPS {ps(ge.values[0])["ja"]}〜{ps(ge.values[1])["ja"]}', f'Adj. EPS {ps(ge.values[0])["en"]}–{ge.raws[1]}')], [
        sec('happened', f'会社は次期の売上を{usd(low)["ja"]}〜{usd(high)["ja"]}、調整後営業利益率を{gm_.raws[0]}〜{gm_.raws[1]}%と見込んでいます。今回の売上と比べると、下限で{sign(change(low, r0))}、上限で{sign(change(high, r0))}です。',
            f'The company expects next-quarter sales of {usd(low)["en"]}–{usd(high)["en"]} with an adjusted operating margin of {gm_.raws[0]}–{gm_.raws[1]}%, {sign(change(low, r0))} to {sign(change(high, r0))} versus this quarter.'),
        sec('means', (f'前期比の伸びは今回の{sign(qoq)}から大きく鈍る見込みです。' if change(high, r0) < qoq / 2 else f'前期比の伸びは今回の{sign(qoq)}と比べられます。')
            + (f'通年の売上見通しは{usd(yr.values[0])["ja"]}〜{usd(yr.values[1])["ja"]}です。' if yr else ''),
            (f'Sequential growth is set to slow sharply from {sign(qoq)}.' if change(high, r0) < qoq / 2 else f'Sequential growth compares with {sign(qoq)} this quarter.')
            + (f' The full-year sales outlook is {usd(yr.values[0])["en"]}–{usd(yr.values[1])["en"]}.' if yr else '')),
        sec('view', '次の決算で、売上が見通しの幅のどこに入るか、受注がいつ売上になるか' + ('、買収がどう費用に表れるか' if deal else '') + 'を確かめます。',
            'Next time, check where sales land in the range and when orders turn into revenue' + (', and how the acquisition shows up in costs.' if deal else '.'))])
    if raise_:
        ev.add('summary.conclusion[1]', raise_)
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq)}、前年同期比+{sales.values[2]}%でした。{lead["nameJa"]}が伸びを主導し、売上の約{q(Decimal(str(lead["revenue"])) / r0 * 100, 0)}%を占めます。調整後営業利益率は{pc(mg.values[0])}です。',
          f'Net sales were {usd(r0)["en"]}, {sign(qoq)} from the previous quarter and {sales.values[2]}% from a year earlier. {lead["nameEn"]} led and made up about {q(Decimal(str(lead["revenue"])) / r0 * 100, 0)}% of sales. Adjusted operating margin was {pc(mg.values[0])}.'),
        c((f'既存事業の受注は前年同期の2倍を超え、' if orders and int(orders.values[0]) >= 100 else '') + (f'会社は通年の売上見通しを{usd(Decimal(raise_.values[0]))["ja"]}引き上げました。' if raise_ else '会社は通年の見通しを示しています。')
          + (f'ただ、次期の見通しの下限は今回の売上とほぼ同じで、前期比の伸びは鈍る見込みです。' if abs(change(low, r0)) < 1 else ''),
          ('Organic orders more than doubled year over year, and ' if orders and int(orders.values[0]) >= 100 else '') + (f'the company raised its full-year sales outlook by {usd(Decimal(raise_.values[0]))["en"]}.' if raise_ else 'the company gave a full-year outlook.')
          + (" But the low end of next quarter's outlook is about this quarter's sales, so sequential growth is set to slow." if abs(change(low, r0)) < 1 else ''))]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- GE Vernova (GEV): no EPS, margin or quarterly guidance in the numbers; segment EBITDA margins; the previous release for last quarter -

def bn_range(lo, hi):
    return f'${lo}–{hi}B', f'{usd(Decimal(lo) * 1000)["ja"]}〜{usd(Decimal(hi) * 1000)["ja"]}'


def gev(f, url, before_previous, report=None, events=None, previous=None, prior=None):
    need(f, 'revenue', 'organic', 'margin', 'cfo', 'fcf', 'power', 'electrification', 'wind', 'windYtd', 'orders', 'powerOrders', 'cash', 'guidance')
    need_prior(prior, 'revenue', 'margin', 'power', 'electrification', 'wind')
    ev = Evidence(url)
    rev, prev_rev = f['revenue'], prior['revenue']
    r0, r2, r1 = rev.values[0], rev.values[1], prev_rev.values[0]
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.yearAgo', rev)
    ev.add('numbers.revenue.previous', prev_rev)
    names = (('power', 'パワー', 'Power'), ('electrification', '電化', 'Electrification'), ('wind', '風力', 'Wind'))
    segs = []
    for i, (key, ja, en) in enumerate(names):
        cur, old = f[key], prior[key]
        ev.add(f'numbers.segments[{i}].revenue', cur)
        ev.add(f'numbers.segments[{i}].operatingMargin', cur)
        ev.add(f'numbers.segments[{i}].previous', old)
        ev.add(f'numbers.segments[{i}].previousOperatingMargin', old)
        segs.append({'key': key, 'nameJa': ja, 'nameEn': en, 'revenue': float(cur.values[0]), 'previous': float(old.values[0]),
                     'operatingMargin': float(cur.values[6]), 'previousOperatingMargin': float(old.values[6])})
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': None, 'epsEstimate': None,
               'grossMargin': None, 'guidance': None, 'segments': segs}
    org, mg, pmg, orders = f['organic'], f['margin'], prior['margin'], f['orders']
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前年同期比 +{rev.raws[2]}%(既存事業 +{org.raws[2]}%)', f'YoY +{rev.raws[2]}% (organic +{org.raws[2]}%)'),
             text_tile('受注額', 'Orders', f'{usd(Decimal(orders.values[0]) * 1000)["ja"]}', f'${orders.values[0]}B', f'既存事業ベースで前年同期比 +{orders.values[1]}%', f'Up {orders.values[1]}% YoY organically'),
             text_tile('調整後EBITDAマージン', 'Adjusted EBITDA margin', pc(mg.values[0]), pc(mg.values[0]), f'前年同期 {pc(mg.values[1])}', f'Prior-year quarter {pc(mg.values[1])}')]
    ev.add('tiles[0].note', rev)
    ev.add('tiles[0].note', org)
    ev.add('tiles[1].value', orders)
    ev.add('tiles[1].note', orders)
    ev.add('tiles[2].value', mg)
    ev.add('tiles[2].note', mg)
    lead_i = max(range(3), key=lambda i: f[names[i][0]].values[3] - f[names[i][0]].values[4])
    key, ja, en = names[lead_i]
    lf, lp = f[key], prior[key]
    po, pdrv = f['powerOrders'] if key == 'power' else None, f.get('powerDriver') if key == 'power' else None
    if po:
        ev.add('summary.cards.growth.sections[0]', po)
    if pdrv:
        ev.add('summary.cards.growth.sections[1]', pdrv)
    lm0, lm1, lmy = lf.values[6], lp.values[6], lf.values[7]
    growth = card(f'{ja}が伸びを主導', f'{en} led the growth', [
        chip(tone(lf.values[2]), f'{ja}の売上 前年同期比 {sign(lf.values[2], 0)}', f'{en} revenue {sign(lf.values[2], 0)} YoY'),
        chip(tone(lm0 - lm1), f'部門EBITDAマージン {pc(lm1)} → {pc(lm0)}', f'Segment EBITDA margin {pc(lm1)} → {pc(lm0)}')]
        + ([chip('up', f'{ja}の受注 既存事業 +{po.values[1]}%', f'{en} orders +{po.values[1]}% organic')] if po else []), [
        sec('happened', f'{ja}部門の売上は{usd(lf.values[0])["ja"]}で、前期の{usd(lp.values[0])["ja"]}から{"増え" if lf.values[0] > lp.values[0] else "減り"}、前年同期比{sign(lf.values[2], 0)}でした。'
            + (f'受注は{usd(Decimal(po.values[0]) * 1000)["ja"]}で、既存事業ベースで+{po.values[1]}%です。' if po else ''),
            f'{en} revenue was {usd(lf.values[0])["en"]}, {"up" if lf.values[0] > lp.values[0] else "down"} from {usd(lp.values[0])["en"]} last quarter and {sign(lf.values[2], 0)} from a year ago.'
            + (f' Orders reached ${po.values[0]}B, up {po.values[1]}% organically.' if po else '')),
        sec('good', f'部門EBITDAマージンは{pc(lm0)}で、前期の{pc(lm1)}、前年同期の{pc(lmy)}から{"上がりました" if lm0 > lm1 else "動きました"}。' + ('会社は価格の上昇と数量の増加を理由に挙げています。' if pdrv else ''),
            f'The segment EBITDA margin was {pc(lm0)}, versus {pc(lm1)} last quarter and {pc(lmy)} a year ago.' + (' The company credits higher prices and volume.' if pdrv else '')),
        sec('watch', ('伸びはガス発電設備に大きく頼っています。会社はインフレの影響も挙げており、コストが価格より速く上がれば利益率は下がりえます。' if pdrv else f'伸びは{ja}部門に大きく頼っています。'),
            ('Growth depends heavily on gas power equipment. The company also cites inflation; if costs rise faster than prices, the margin could fall.' if pdrv else f'Growth depends heavily on {en}.')),
        sec('view', '受注が売上を大きく上回っており、受注残が将来の売上を支えます。受注がどの速さで売上に変わるかを追います。',
            'Orders far exceed revenue, so backlog underpins future sales. The pace at which orders turn into revenue is what to follow.')], key)
    d = r0 - r1
    cfo, fcf, cash, acq = f['cfo'], f['fcf'], f['cash'], f.get('acquired')
    top_i = max(range(3), key=lambda i: f[names[i][0]].values[0] - prior[names[i][0]].values[0])
    tk, tja, ten = names[top_i]
    td = f[tk].values[0] - prior[tk].values[0]
    ev.add('summary.cards.change.sections[1]', cfo)
    ev.add('summary.cards.change.sections[1]', fcf)
    ev.add('summary.cards.change.sections[1]', cash)
    ev.add('summary.cards.change.sections[2]', org)
    if acq:
        ev.add('summary.cards.change.sections[2]', acq)
    thin = f[tk].values[6] < mg.values[0]
    changes = card(f'売上は前期比 {sign(qoq)}、調整後EBITDAマージンは{pc(mg.values[0])}', f'Revenue {sign(qoq)} QoQ, adjusted EBITDA margin {pc(mg.values[0])}', [
        chip(tone(qoq), f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ'),
        chip(tone(mg.values[0] - pmg.values[0]), f'調整後EBITDAマージン {pc(pmg.values[0])} → {pc(mg.values[0])}', f'Adj. EBITDA margin {pc(pmg.values[0])} → {pc(mg.values[0])}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。調整後EBITDAマージンは前期の{pc(pmg.values[0])}から{pc(mg.values[0])}になりました。',
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}. Adjusted EBITDA margin went from {pc(pmg.values[0])} last quarter to {pc(mg.values[0])}.'),
        sec('good', f'営業キャッシュフローは{usd(cfo.values[0])["ja"]}、フリーキャッシュフローは{usd(fcf.values[0])["ja"]}でした。手元の現金は約{usd(Decimal(cash.values[0]) * 1000)["ja"]}です。',
            f'Operating cash flow was {usd(cfo.values[0])["en"]} and free cash flow {usd(fcf.values[0])["en"]}. Cash on hand is about ${cash.values[0]}B.'),
        sec('watch', f'前年同期比+{rev.raws[2]}%のうち、買収や為替を除いた既存事業の伸びは+{org.raws[2]}%です。' + (f'差の多くは、電化部門で買収した事業の売上{usd(acq.values[0])["ja"]}です。' if acq else ''),
            f'Of the {rev.raws[2]}% YoY growth, organic growth (excluding acquisitions and currency) was {org.raws[2]}%.' + (f' Much of the gap is the {usd(acq.values[0])["en"]} of revenue from acquired businesses in Electrification.' if acq else '')),
        sec('means', f'前期からの増加{usd(abs(d))["ja"]}のうち、{usd(td)["ja"]}が{tja}部門です。' + (f'{tja}部門の利益率は低いため、利益は売上ほどには伸びません。' if thin else ''),
            f'Of the {usd(abs(d))["en"]} sequential change, {usd(td)["en"]} came from {ten}.' + (f' Because {ten} earns a thin margin, profit does not rise as fast as revenue.' if thin else ''))])
    weak_i = min(range(3), key=lambda i: f[names[i][0]].values[6])
    wk, wja, wen = names[weak_i]
    wf, ytd = f[wk], f['windYtd'] if wk == 'wind' else None
    wo, wd = (f.get('windOutlook'), f.get('windDriver')) if wk == 'wind' else (None, None)
    ev.add('summary.cards.caution.sections[0]', wf)
    if ytd:
        ev.add('summary.cards.caution.sections[0]', ytd)
    if wd:
        ev.add('summary.cards.caution.sections[1]', wd)
    if wo:
        ev.add('summary.cards.caution.sections[1]', wo)
    loss_ytd = ytd.values[3] if ytd else None
    caution = card(f'{wja}のマージンは{pc(wf.values[6])}' + ('、年初来は赤字' if loss_ytd is not None and loss_ytd < 0 else ''), f'{wen} margin {pc(wf.values[6])}' + (', loss-making year to date' if loss_ytd is not None and loss_ytd < 0 else ''), [
        chip('gold', f'{wja}の部門EBITDAマージン {pc(wf.values[6])}', f'{wen} segment EBITDA margin {pc(wf.values[6])}')]
        + ([chip(tone(loss_ytd), f'{wja} 年初来EBITDA {usd(loss_ytd)["ja"]}', f'{wen} year-to-date EBITDA {usd(loss_ytd)["en"]}')] if ytd else [])
        + ([chip('down', f'{wja}の通年損失見通し {usd(Decimal(wo.values[0]))["ja"]}〜{usd(Decimal(wo.values[1]))["ja"]}',
                     f'2026 {wen} loss outlook ${wo.values[0]}–{wo.values[1]}M')] if wo else []), [
        sec('happened', f'{wja}部門の売上は{usd(wf.values[0])["ja"]}、部門EBITDAマージンは{pc(wf.values[6])}でした。前年同期の{pc(wf.values[7])}から改善しましたが、' + (f'年初からの合計は{usd(loss_ytd)["ja"]}です。' if ytd else '利益はまだ小さい水準です。'),
            f'{wen} revenue was {usd(wf.values[0])["en"]} with a {pc(wf.values[6])} segment EBITDA margin, versus {pc(wf.values[7])} a year ago' + (f'; year to date it totals {usd(loss_ytd)["en"]}.' if ytd else '.')),
        sec('watch', ('今期の改善には、洋上風力の案件コストの減少と関税の回収が含まれます。' if wd else '') + (f'会社は通年の{wja}の損失見通しを約{usd(Decimal(wo.values[2]))["ja"]}から{usd(Decimal(wo.values[0]))["ja"]}〜{usd(Decimal(wo.values[1]))["ja"]}に広げました。' if wo else ''),
            ("This quarter's improvement included lower offshore project costs and tariff recoveries." if wd else '') + (f' The company widened its {wen} loss outlook from about ${wo.values[2]}M to ${wo.values[0]}–{wo.values[1]}M.' if wo else '')
            if (wd or wo) else f'{wen} margins remain thin.'),
        sec('means', (f'年初からの損失がすでに{usd(-loss_ytd)["ja"]}あるので、通年の損失が{usd(Decimal(wo.values[0]))["ja"]}〜{usd(Decimal(wo.values[1]))["ja"]}に収まるには、第4四半期に黒字になる必要があります。'
                      if wo and loss_ytd is not None and -loss_ytd > Decimal(wo.values[1]) else f'{wja}部門は売上の約{q(wf.values[0] / r0 * 100, 0)}%ですが、利益への貢献は小さいままです。'),
            (f'With {usd(-loss_ytd)["en"]} already lost year to date, a full-year loss of ${wo.values[0]}–{wo.values[1]}M assumes {wen} turns profitable in the fourth quarter.'
             if wo and loss_ytd is not None and -loss_ytd > Decimal(wo.values[1]) else f'{wen} is about {q(wf.values[0] / r0 * 100, 0)}% of revenue but contributes little profit.')),
        sec('view', f'{wja}は売上の約{q(wf.values[0] / r0 * 100, 0)}%を占めますが、利益への貢献は小さい部門です。次の決算で、実際に利益が出るかを確かめます。',
            f'{wen} is about {q(wf.values[0] / r0 * 100, 0)}% of revenue but contributes little profit. Whether it actually turns profitable is the point to check in the next report.')], wk)
    gd = f['guidance'].values
    deal, bb = f.get('deal'), f.get('buyback')
    ev.add('summary.cards.next.sections[0]', f['guidance'])
    ev.add('summary.cards.next.sections[1]', rev)
    if deal:
        ev.add('summary.cards.next.sections[2]', deal)
    if bb:
        ev.add('summary.cards.next.sections[2]', bb)
    rng_en, rng_ja = bn_range(gd[0], gd[1])
    fcf_en, fcf_ja = bn_range(gd[8], gd[9])
    ytd_rev = rev.values[3]
    q4lo, q4hi = Decimal(gd[0]) * 1000 - ytd_rev, Decimal(gd[1]) * 1000 - ytd_rev
    nxt = card('会社が通年の見通しを引き上げ', 'Company raised its full-year outlook', [
        chip('gold', f'通年の売上 {rng_ja}', f'Full-year revenue {rng_en}'),
        chip('gold', f'調整後EBITDAマージン {gd[4]}〜{gd[5]}%', f'Adj. EBITDA margin {gd[4]}–{gd[5]}%'),
        chip('gold', f'フリーキャッシュフロー {fcf_ja}', f'Free cash flow {fcf_en}')], [
        sec('happened', f'会社は通年の売上見通しを{bn_range(gd[2], gd[3])[1]}から{rng_ja}に、フリーキャッシュフローを{bn_range(gd[10], gd[11])[1]}から{fcf_ja}に引き上げました。四半期ごとの売上見通しは出していません。',
            f'The company raised full-year revenue guidance from {bn_range(gd[2], gd[3])[0]} to {rng_en} and free cash flow from {bn_range(gd[10], gd[11])[0]} to {fcf_en}. It does not give a quarterly revenue outlook.'),
        sec('means', f'年初からの売上は{usd(ytd_rev)["ja"]}なので、見通しから逆算すると第4四半期の売上は約{usd(q4lo)["ja"]}〜{usd(q4hi)["ja"]}になります。',
            f'Year-to-date revenue was {usd(ytd_rev)["en"]}, so the outlook implies fourth-quarter revenue of roughly {usd(q4lo)["en"]}–{usd(q4hi)["en"]}.'),
        sec('watch', (f'{deal.values[0]}を{usd(Decimal(deal.values[1]) * 1000)["ja"]}で買収することでも合意しました。完了は{deal.values[3]}年{"後半" if deal.values[2] == "late" else "前半" if deal.values[2] == "early" else "半ば"}の見込みです。' if deal else '')
            + (f'自社株買いの枠も{usd(Decimal(bb.values[0]) * 1000)["ja"]}に広げています。' if bb else '') + '大きな現金の使い道として追う価値があります。',
            (f'It agreed to acquire {deal.values[0]} for ${deal.values[1]}B (closing expected in {deal.values[2]} {deal.values[3]}). ' if deal else '')
            + (f'It raised its buyback authorization to ${bb.values[0]}B. ' if bb else '') + 'These large uses of cash are worth tracking.'),
        sec('view', f'見通しは会社の計画で、実績ではありません。第4四半期の売上がこの幅に入るか、{wja}部門が利益を出せるかを確かめます。',
            f"The outlook is the company's plan, not a result. Watch whether Q4 revenue lands in this range and whether {wen} turns a profit.")])
    bl = f.get('backlog')
    if bl:
        ev.add('summary.conclusion[0]', bl)
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期比+{rev.raws[2]}%でした。受注は{usd(Decimal(orders.values[0]) * 1000)["ja"]}(既存事業ベースで+{orders.values[1]}%)と売上を大きく上回り'
          + (f'、受注残は{usd(Decimal(bl.values[1]) * 1000)["ja"]}になりました。' if bl else 'ました。'),
          f'Revenue was {usd(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and {rev.raws[2]}% from a year ago. Orders of ${orders.values[0]}B (up {orders.values[1]}% organically) far exceeded revenue'
          + (f', lifting backlog to ${bl.values[1]}B.' if bl else '.')),
        c(f'調整後EBITDAマージンは前年同期の{pc(mg.values[1])}から{pc(mg.values[0])}になりました。ただし{wja}部門のマージンは{pc(wf.values[6])}にとどまり' + ('、年初からは赤字です。' if loss_ytd is not None and loss_ytd < 0 else 'ます。'),
          f'Adjusted EBITDA margin went from {pc(mg.values[1])} a year ago to {pc(mg.values[0])}. The {wen} segment, however, earned only a {pc(wf.values[6])} margin' + (' and is still loss-making year to date.' if loss_ytd is not None and loss_ytd < 0 else '.')),
        c(f'会社は通年の見通しを、売上{rng_ja}、フリーキャッシュフロー{fcf_ja}に引き上げました。', f'The company raised its full-year outlook to revenue of {rng_en} and free cash flow of {fcf_en}.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- quarters of the fiscal year so far, from the previous file's history (for a full-year outlook) --------------------------------

def year_to_date(r0, r1, previous, quarter):
    """This quarter's revenue plus the earlier quarters of the same fiscal year: the previous quarter, then the previous file's history
    bars, newest first, labelled Q(quarter-2) down to Q1. None when a bar is missing or out of order."""
    values = [Decimal(r0), Decimal(r1)][:quarter]
    bars = list(reversed((previous or {}).get('history') or []))
    for n, bar in zip(range(quarter - 2, 0, -1), bars):
        if bar.get('label') != f'Q{n}':
            return None
        values.append(Decimal(str(bar['value'])))
    return sum(values) if len(values) == quarter else None


def last_dip(previous):
    """The latest quarter whose revenue fell from the quarter before, in the previous file's history and its own quarter:
    (label, before, after) or None."""
    bars = list((previous or {}).get('history') or [])
    if previous and previous.get('numbers'):
        bars.append({'label': f"Q{previous['periodQuarter']}", 'value': previous['numbers']['revenue']['current']})
    for a, b in reversed(list(zip(bars, bars[1:]))):
        if b['value'] < a['value']:
            return b['label'], Decimal(str(a['value'])), Decimal(str(b['value']))
    return None


# ---- Bloom Energy (BE) ----------------------------------------------------------------------------------------------------------------

def be(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'opIncome', 'netIncome', 'epsGaap', 'gm', 'opMargin', 'eps', 'product', 'service', 'productCost', 'cfo', 'capex',
         'contractAssets', 'receivables', 'cash', 'recourseDebt', 'guidanceRevenue', 'guidanceGm', 'guidanceOpIncome', 'guidanceEps')
    ev = Evidence(url)
    rev, gm, om, eps, epsg = f['revenue'], f['gm'], f['opMargin'], f['eps'], f['epsGaap']
    r0, r1, r2 = rev.values
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.adjustedEPS', eps)
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', gm)
    numbers = {'revenue': revenue_numbers(ev, rev), 'adjustedEPS': float(eps.values[0]), 'epsEstimate': None,
               'grossMargin': {'current': float(gm.values[0]), 'previous': float(gm.values[1])}, 'guidance': None, 'segments': None}
    cfo = f['cfo']
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前年同期比 {sign(yoy)}', f'YoY {sign(yoy)}'),
             text_tile('調整後(non-GAAP)営業利益率', 'Non-GAAP operating margin', pc(om.values[0]), pc(om.values[0]),
                       f'前期 {pc(om.values[1])}、前年同期 {pc(om.values[2])}', f'Prior quarter {pc(om.values[1])}, year ago {pc(om.values[2])}'),
             tile('営業キャッシュフロー', 'Operating cash flow', money_tile(ev, 2, cfo, 0, None),
                  f'前期 {"+" if cfo.values[1] >= 0 else ""}{usd(cfo.values[1])["ja"]}', f'Prior quarter {"+" if cfo.values[1] >= 0 else ""}{usd(cfo.values[1])["en"]}')]
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 2), rnd=1)
    ev.add('tiles[1].value', om)
    ev.add('tiles[1].note', om)
    ev.add('tiles[2].note', cfo, calc=amount_calc(cfo, 1, 'M')[0], rnd=1)
    pr, sv, pc_ = f['product'], f['service'], f['productCost']
    p0, p1, p2 = pr.values
    pm0, pm1 = q((p0 - pc_.values[0]) / p0 * 100), q((p1 - pc_.values[1]) / p1 * 100)
    ev.add('summary.cards.growth.sections[1]', pc_)
    dip = last_dip(previous)
    growth = card(f'製品の売上は前年同期の約{q(p0 / p2, 1)}倍', f'Product revenue about {q(p0 / p2, 1)} times a year ago', [
        chip(tone(p0 - p2), f'製品の売上 前年同期比 {sign(change(p0, p2))}', f'Product revenue {sign(change(p0, p2))} YoY'),
        chip(tone(p0 - p1), f'製品の売上 {usd(p1)["ja"]} → {usd(p0)["ja"]}', f'Product revenue {usd(p1)["en"]} → {usd(p0)["en"]}')], [
        sec('happened', f'製品の売上は{usd(p0)["ja"]}で、前年同期の{usd(p2)["ja"]}から{sign(change(p0, p2))}、前期の{usd(p1)["ja"]}から{sign(change(p0, p1), 0)}でした。製品は売上全体の約{q(p0 / r0 * 100, 0)}%です。',
            f'Product revenue was {usd(p0)["en"]}, {sign(change(p0, p2))} from {usd(p2)["en"]} a year ago and {sign(change(p0, p1), 0)} from {usd(p1)["en"]} last quarter. Products are about {q(p0 / r0 * 100, 0)}% of total revenue.'),
        sec('good', f'製品の売上から製品の原価を引いた利益率は約{pc(pm0)}で、前期の約{pc(pm1)}から{"上がりました" if pm0 > pm1 else "下がりました" if pm0 < pm1 else "変わりません"}。',
            f'Product revenue minus product cost gives a margin of about {pc(pm0)}, versus about {pc(pm1)} last quarter.'),
        sec('watch', '売上は四半期ごとに振れることがあります。' + (f'{dip[0]}には前の四半期の{usd(dip[1])["ja"]}から{usd(dip[2])["ja"]}に減りました。' if dip else ''),
            'Revenue can swing from quarter to quarter.' + (f' In {dip[0]} it fell from {usd(dip[1])["en"]} to {usd(dip[2])["en"]}.' if dip else '')),
        sec('view', f'サービスの売上は{usd(sv.values[0])["ja"]}で、前期の{usd(sv.values[1])["ja"]}とほぼ同じです。製品の伸びが後からサービスの伸びにつながるかを見ていきます。' if abs(change(sv.values[0], sv.values[1])) < 5 else
            f'サービスの売上は{usd(sv.values[0])["ja"]}で、前期は{usd(sv.values[1])["ja"]}でした。製品の伸びが後からサービスの伸びにつながるかを見ていきます。',
            f'Service revenue was {usd(sv.values[0])["en"]}' + (', about the same as ' if abs(change(sv.values[0], sv.values[1])) < 5 else ', versus ') + f'{usd(sv.values[1])["en"]} last quarter. Whether product growth later feeds service growth is worth watching.')])
    d = r0 - r1
    ggm = f['guidanceGm']
    ni, oi = f['netIncome'], f['opIncome']
    flat = abs(gm.values[0] - gm.values[1]) < 1
    ev.add('summary.cards.change.sections[1]', ni)
    ev.add('summary.cards.change.sections[1]', epsg)
    ev.add('summary.cards.change.sections[2]', ggm)
    changes = card(f'売上は前期比 {sign(qoq)}、調整後粗利益率は' + ('ほぼ横ばい' if flat else '上昇' if gm.values[0] > gm.values[1] else '低下'),
                   f'Revenue {sign(qoq)} QoQ, adjusted gross margin ' + ('about flat' if flat else 'higher' if gm.values[0] > gm.values[1] else 'lower'), [
        chip('gold' if flat else tone(gm.values[0] - gm.values[1]), f'調整後粗利益率 {pc(gm.values[1])} → {pc(gm.values[0])}', f'Adj. gross margin {pc(gm.values[1])} → {pc(gm.values[0])}'),
        chip(tone(om.values[0] - om.values[1]), f'調整後営業利益率 {pc(om.values[1])} → {pc(om.values[0])}', f'Adj. operating margin {pc(om.values[1])} → {pc(om.values[0])}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。調整後粗利益率は{pc(gm.values[1])}から{pc(gm.values[0])}、調整後営業利益率は{pc(om.values[1])}から{pc(om.values[0])}になりました。',
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}. Adjusted gross margin went from {pc(gm.values[1])} to {pc(gm.values[0])}, and the adjusted operating margin from {pc(om.values[1])} to {pc(om.values[0])}.'),
        sec('good', f'GAAPの純利益は{usd(ni.values[0])["ja"]}で、前年同期は{usd(ni.values[2])["ja"]}でした。GAAPのEPSは{ps(epsg.values[0])["ja"]}、調整後EPSは{ps(eps.values[0])["ja"]}です。',
            f'GAAP net income was {usd(ni.values[0])["en"]}, versus {usd(ni.values[2])["en"]} a year ago. GAAP EPS was {ps(epsg.values[0])["en"]} and non-GAAP EPS {ps(eps.values[0])["en"]}.'),
        sec('watch', ('粗利益率はほとんど動いておらず、利益の伸びの多くは売上の増加によるものです。' if flat else '粗利益率の動きが利益を左右しています。') + f'会社の通年の調整後粗利益率の見通しも約{ggm.raws[0]}%です。',
            ('The gross margin barely moved, so most of the profit gain came from higher sales.' if flat else 'Gross margin moves are shaping profit.') + f" The company's full-year non-GAAP gross margin outlook is about {ggm.raws[0]}%."),
        sec('means', f'粗利益率が約{ggm.raws[0]}%のままなら、利益はおおむね売上に合わせて伸びることになります。', f'If the gross margin stays near {ggm.raws[0]}%, profit will grow roughly in line with sales.')])
    ca, rc, cash, debt, capex = f['contractAssets'], f['receivables'], f['cash'], f['recourseDebt'], f['capex']
    cons = [f[k] for k in ('considerationCurrent', 'considerationLong') if k in f]
    cons_total = sum(x.values[0] for x in cons) if cons else None
    for k in ('cfo', 'capex'):
        ev.add('summary.cards.caution.sections[0]', f[k])
    ev.add('summary.cards.caution.sections[1]', ca)
    ev.add('summary.cards.caution.sections[1]', rc)
    for x in cons:
        ev.add('summary.cards.caution.sections[1]', x)
    ev.add('summary.cards.caution.sections[3]', cash)
    ev.add('summary.cards.caution.sections[3]', debt)
    rc0, rc1 = Decimal(rc.values[0]) / 1000, Decimal(rc.values[1]) / 1000
    neg = cfo.values[0] < 0
    caution = card('利益は出ているが、営業キャッシュフローはマイナス' if neg else '利益に比べて現金の入りが少ない', 'Profitable, but operating cash flow was negative' if neg else 'Cash lags profit', [
        chip(tone(cfo.values[0]), f'営業キャッシュフロー {usd(cfo.values[0])["ja"]}', f'Operating cash flow {usd(cfo.values[0])["en"]}'),
        chip(tone(ca.values[1] - ca.values[0]), f'契約資産 {usd(ca.values[1])["ja"]} → {usd(ca.values[0])["ja"]}', f'Contract assets {usd(ca.values[1])["en"]} → {usd(ca.values[0])["en"]}'),
        chip('gold', f'設備投資 {usd(-capex.values[0])["ja"]}', f'Capex {usd(-capex.values[0])["en"]}')], [
        sec('happened', f'営業キャッシュフローは{usd(cfo.values[0])["ja"]}で、前期の{usd(cfo.values[1])["ja"]}から{"悪化" if cfo.values[0] < cfo.values[1] else "改善"}しました。設備投資は前期の{usd(-capex.values[1])["ja"]}から{usd(-capex.values[0])["ja"]}になりました。',
            f'Operating cash flow was {usd(cfo.values[0])["en"]}, versus {usd(cfo.values[1])["en"]} last quarter. Capital spending went from {usd(-capex.values[1])["en"]} to {usd(-capex.values[0])["en"]}.'),
        sec('watch', f'契約資産(売上には計上したがまだ請求できないもの)は前年度末の{usd(ca.values[1])["ja"]}から{usd(ca.values[0])["ja"]}に、売掛金は{usd(rc1)["ja"]}から{usd(rc0)["ja"]}に増えました。'
            + (f'新しい「顧客への対価の資産」も合計{usd(cons_total)["ja"]}あります。' if cons_total else ''),
            f'Contract assets (revenue booked but not yet billable) went from {usd(ca.values[1])["en"]} at the prior year-end to {usd(ca.values[0])["en"]}. Receivables went from {usd(rc1)["en"]} to {usd(rc0)["en"]}'
            + (f', and a new "customer consideration asset" totals {usd(cons_total)["en"]}.' if cons_total else '.')),
        sec('means', '利益が計上されてから現金になるまでに時間がかかっています。これが続くと、成長に必要な資金を借入や株式で賄う割合が増えるかもしれません。',
            'Profit is reaching the bank later than it is reported. If that persists, more of the growth may need to be funded with debt or stock.'),
        sec('view', f'現金は{usd(cash.values[0])["ja"]}あり、すぐに資金が足りなくなる状況ではありません。返済義務のある借入は{usd(debt.values[0])["ja"]}です。次の決算で、契約資産が現金に変わり、営業キャッシュフローがプラスに戻るかを確かめます。',
            f'Cash of {usd(cash.values[0])["en"]} means there is no near-term shortage (recourse debt is {usd(debt.values[0])["en"]}). The next report will show whether contract assets convert to cash and operating cash flow turns positive.')])
    g, go, ge, raises = f['guidanceRevenue'], f['guidanceOpIncome'], f['guidanceEps'], f.get('raises')
    ev.add('summary.cards.next.sections[0]', g)
    ev.add('summary.cards.next.sections[0]', go)
    if raises:
        ev.add('summary.cards.next.sections[0]', raises)
    nth = {'first': ('1', 'first'), 'second': ('2', 'second'), 'third': ('3', 'third'), 'fourth': ('4', 'fourth')}.get(raises.values[0]) if raises else None
    ytd = year_to_date(r0, r1, previous, int(previous['periodQuarter']) % 4 + 1) if previous else None
    nxt = card(f'通年の見通しを今年{nth[0]}回目の引き上げ' if nth else '通年の見通しを引き上げ', f'Full-year outlook raised for the {nth[1]} time this year' if nth else 'Full-year outlook raised', [
        chip('gold', f'通年の売上 {usd(g.values[0])["ja"]}〜{usd(g.values[1])["ja"]}', f'Full-year revenue ${g.raws[0]}–{g.raws[1]}B'),
        chip('gold', f'調整後粗利益率 約{ggm.raws[0]}%', f'Non-GAAP gross margin ~{ggm.raws[0]}%'),
        chip('gold', f'調整後EPS {ps(ge.values[0])["ja"]}〜{ps(ge.values[1])["ja"]}', f'Non-GAAP EPS {ps(ge.values[0])["en"]}–{ge.raws[1]}')], [
        sec('happened', f'会社は通年の見通しを、売上{usd(g.values[0])["ja"]}〜{usd(g.values[1])["ja"]}、調整後営業利益{usd(go.values[0])["ja"]}〜{usd(go.values[1])["ja"]}に引き上げました。'
            + (f'CFOによると、今年{nth[0]}回目の引き上げです。' if nth else '') + '四半期の見通しは出していません。',
            f'The company raised its full-year outlook to revenue of ${g.raws[0]}–{g.raws[1]}B and non-GAAP operating income of ${go.raws[0]}M–{go.raws[1]}M'
            + (f', the {nth[1]} raise this year according to the CFO.' if nth else '.') + ' It gives no quarterly outlook.'),
        sec('means', (f'年初からの売上は約{usd(ytd)["ja"]}なので、見通しから逆算すると第4四半期の売上は約{usd(g.values[0] - ytd)["ja"]}〜{usd(g.values[1] - ytd)["ja"]}になります。' if ytd else '通年の見通しから、残りの四半期の売上の水準がわかります。'),
            (f'Year-to-date revenue was about {usd(ytd)["en"]}, so the outlook implies fourth-quarter revenue of roughly {usd(g.values[0] - ytd)["en"]}–{usd(g.values[1] - ytd)["en"]}.' if ytd else 'The full-year outlook implies the level of the remaining quarter.')),
        sec('view', '見通しは会社の計画で、実績ではありません。第4四半期の売上をこの幅と比べ、キャッシュフローの回復と合わせて確かめます。',
            "The outlook is the company's plan, not a result. Watch Q4 revenue against this range together with the cash flow recovery.")])
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前年同期の約{q(r0 / r2, 1)}倍、前期比{sign(qoq, 0)}でした。燃料電池システムの製品売上({usd(p0)["ja"]})が伸びをけん引しました。',
          f'Revenue was {usd(r0)["en"]}, about {q(r0 / r2, 1)} times a year ago and {sign(qoq, 0)} from the previous quarter. Product sales of fuel-cell systems ({usd(p0)["en"]}) drove the growth.'),
        c(f'利益は大きく改善し、GAAPの営業利益は{usd(oi.values[0])["ja"]}、調整後営業利益率は{pc(om.values[0])}でした。', f'Profit improved sharply: GAAP operating income was {usd(oi.values[0])["en"]} and the non-GAAP operating margin was {pc(om.values[0])}.'),
        c(f'ただし営業キャッシュフローは{usd(cfo.values[0])["ja"]}でした。' + ('利益はまだ現金になっていません。' if neg else ''), f'Operating cash flow, however, was {usd(cfo.values[0])["en"]}.' + (' The profit has not yet turned into cash.' if neg else ''))]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- SK hynix (SKHY): the preliminary-results 6-K and the results-day 6-Ks (shareholder returns, dividend), in won -------------------

def krw(million):
    return _money(million, 'KRW')


def _money(million, currency):
    import earnings_dive_generate as g
    return g.money(million, currency)[0]


def skhy(f, url, before_previous, report=None, events=None, previous=None):
    need(f, 'revenue', 'opProfit', 'netIncome', 'pretax')
    ev = Evidence(url)
    rev, op, ni, pt = f['revenue'], f['opProfit'], f['netIncome'], f['pretax']
    r0, r1, r2 = rev.values[0], rev.values[2], rev.values[4]
    for field, i in (('current', 0), ('previous', 2), ('yearAgo', 4)):
        ev.add(f'numbers.revenue.{field}', rev)
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': None, 'epsEstimate': None,
               'grossMargin': None, 'guidance': None, 'segments': None}
    m0, m1, m2 = (q(op.values[i] / rev.values[i] * 100, 0) for i in (0, 2, 4))
    figs = {}
    for e in events or []:
        for k, v in e['figures'].items():
            figs[k] = v
    ret, div = figs.get('returns'), figs.get('dividend')
    tiles = [tile('売上高', 'Revenue', None, f'前年同期比 +{q(rev.values[6], 0)}%', f'+{q(rev.values[6], 0)}% YoY'),
             text_tile('営業利益率', 'Operating margin', f'{m0}%', f'{m0}%', f'前期 {m1}%、前年同期 {m2}%', f'Prior quarter {m1}%; year ago {m2}%')]
    shown = krw(r0)
    tiles[0]['value'] = shown
    ev.add('tiles[0].value', rev, calc=f'{rev.raws[0]} / 1000 / 1000', rnd=2)
    ev.add('tiles[0].note', rev, calc=rev.raws[6], rnd=0)
    ev.add('tiles[1].value', op)
    ev.add('tiles[1].value', rev, calc=f'{op.raws[0]} / {rev.raws[0]} * 100', rnd=0)
    ev.add('tiles[1].note', op)
    ev.add('tiles[1].note', rev, calc=f'{op.raws[2]} / {rev.raws[2]} * 100', rnd=0)
    if ret:
        tiles.append(text_tile(f'{ret.values[0]}年の株主還元(計画)', f'Shareholder returns ({ret.values[0]} plan)', f'約{ret.values[1]}兆ウォン', f'~₩{ret.values[1]}T',
                               f'配当{ret.values[2]}兆ウォン以上、自社株の取得・消却{ret.values[3]}兆ウォン以上', f'Dividends ₩{ret.values[2]}T+ and buybacks ₩{ret.values[3]}T+'))
        ev.add('tiles[2].value', ret, url=ret.url)
        ev.add('tiles[2].note', ret, url=ret.url)
    else:  # before the results-day 6-Ks are read
        tiles.append(tile('純利益', 'Net income', krw(ni.values[0]), f'前期 {krw(ni.values[2])["ja"]}', f'Prior quarter {krw(ni.values[2])["en"]}'))
        ev.add('tiles[2].value', ni, calc=f'{ni.raws[0]} / 1000 / 1000', rnd=2)
        ev.add('tiles[2].note', ni, calc=f'{ni.raws[2]} / 1000 / 1000', rnd=2)
    qoq, opq = rev.values[3], op.values[3]
    d = r0 - r1
    ev.add('summary.cards.growth.sections[1]', op)
    growth = card(f'売上は前期比 +{q(qoq, 0)}%、営業利益は +{q(opq, 0)}%' if qoq > 0 else f'売上は前期比 {q(qoq, 0)}%', f'Revenue {sign(qoq, 0)} QoQ, operating profit {sign(opq, 0)}', [
        chip(tone(qoq), f'売上 前期比 {sign(qoq, 0)}', f'Revenue {sign(qoq, 0)} QoQ'),
        chip(tone(opq), f'営業利益 前期比 {sign(opq, 0)}', f'Operating profit {sign(opq, 0)} QoQ')], [
        sec('happened', f'売上は{krw(r1)["ja"]}から{krw(r0)["ja"]}へ、{krw(abs(d))["ja"]}{rose(d, True)}ました。前年同期の{krw(r2)["ja"]}と比べると約{q(r0 / r2, 1)}倍です。',
            f'Revenue {rose(d)} {krw(abs(d))["en"]} from {krw(r1)["en"]} to {krw(r0)["en"]}, about {q(r0 / r2, 1)} times the {krw(r2)["en"]} of a year earlier.'),
        sec('good', f'営業利益は{krw(op.values[2])["ja"]}から{krw(op.values[0])["ja"]}へ{sign(opq, 0)}で、売上の伸び({sign(qoq, 0)})' + ('を上回りました。' if opq > qoq else 'を下回りました。'),
            f'Operating profit went from {krw(op.values[2])["en"]} to {krw(op.values[0])["en"]}, {sign(opq, 0)}, ' + ('faster than revenue' if opq > qoq else 'slower than revenue') + f' ({sign(qoq, 0)}).'),
        sec('watch', 'メモリーの価格は需給で大きく動きます。価格の上昇が伸びを支えている間は、価格が下がると売上と利益が大きく減るおそれがあります。製品別の内訳は、この届出にはありません。',
            'Memory prices swing with supply and demand. While higher prices drive growth, falling prices could cut revenue and profit sharply. This filing has no product breakdown.')])
    ev.add('summary.cards.change.sections[1]', ni)
    ev.add('summary.cards.change.sections[1]', pt)
    above = ni.values[2] > op.values[2]
    changes = card(f'売上は前期比 +{q(qoq, 0)}%、営業利益率{m0}%' if qoq > 0 else f'営業利益率{m0}%', f'Revenue {sign(qoq, 0)} QoQ; operating margin {m0}%', [
        chip(tone(m0 - m1), f'営業利益率 {m1}% → {m0}%', f'Operating margin {m1}% → {m0}%'),
        chip(tone(ni.values[3]), f'純利益 前期比 {sign(ni.values[3], 0)}', f'Net income {sign(ni.values[3], 0)} QoQ')], [
        sec('happened', f'営業利益は{krw(op.values[2])["ja"]}から{krw(op.values[0])["ja"]}へ{sign(opq, 0)}、営業利益率は{m1}%から{m0}%になりました。売上100ウォンのうち約{m0}ウォンが営業利益として残る計算です。',
            f'Operating profit went from {krw(op.values[2])["en"]} to {krw(op.values[0])["en"]} ({sign(opq, 0)}), and operating margin from {m1}% to {m0}%. Of every ₩100 of sales, about ₩{m0} stays as operating profit.'),
        sec('watch', f'純利益は{krw(ni.values[0])["ja"]}で、営業利益を{"下回りました" if ni.values[0] < op.values[0] else "上回りました"}。' + (f'前期の純利益{krw(ni.values[2])["ja"]}は営業利益を上回っており、' if above else '')
            + f'税引前利益も{krw(pt.values[2])["ja"]}から{krw(pt.values[0])["ja"]}になっています。営業外の損益が最終利益を大きく動かしており、内訳はこの届出にはありません。',
            f'Net income was {krw(ni.values[0])["en"]}, {"below" if ni.values[0] < op.values[0] else "above"} operating profit.' + (f" Last quarter's net income of {krw(ni.values[2])['en']} exceeded operating profit," if above else '')
            + f' and pre-tax profit went from {krw(pt.values[2])["en"]} to {krw(pt.values[0])["en"]}. Non-operating items are swinging the bottom line a lot; this filing does not break them down.'),
        sec('means', '本業の力は営業利益で、株主に残る利益は純利益で見る、と分けて読む必要があります。',
            'Use operating profit to judge the core business and net income to judge what is left for shareholders; keep them separate.'),
        sec('view', f'売上は前年同期の約{q(r0 / r2, 1)}倍で、営業利益率は前年同期の{m2}%から{m0}%になりました。', f'Revenue is about {q(r0 / r2, 1)} times a year earlier, and operating margin went from {m2}% a year ago to {m0}%.')])
    if ret:
        ev.add('summary.cards.caution.sections[0]', ret, url=ret.url)
    if div:
        ev.add('summary.cards.caution.sections[3]', div, url=div.url)
    caution = card('非常に高い利益率は、価格しだいで変わる', 'Very high margins that depend on prices', [
        chip('gold', f'営業利益率 {m0}%', f'Operating margin {m0}%'),
        (chip('gold', f'株主還元 約{ret.values[1]}兆ウォン({ret.values[0]}年)', f'Shareholder returns ~₩{ret.values[1]}T ({ret.values[0]})') if ret else chip('gold', f'純利益 {krw(ni.values[0])["ja"]}', f'Net income {krw(ni.values[0])["en"]}')),
        (chip('gold', f'第{["first", "second", "third", "fourth"].index(div.values[0]) + 1}四半期配当 1株{int(div.values[2]):,}ウォン', f'Q{["first", "second", "third", "fourth"].index(div.values[0]) + 1} dividend ₩{int(div.values[2]):,} per share') if div else
         chip('gold', f'前年同期の営業利益率 {m2}%', f'Year-ago operating margin {m2}%'))], [
        sec('happened', (f'会社は{ret.values[0]}年の株主還元を約{ret.values[1]}兆ウォンとする計画を出しました。配当が{ret.values[2]}兆ウォン以上、自社株の取得・消却が{ret.values[3]}兆ウォン以上です。' if ret else
                         f'営業利益率は{m0}%で、前年同期の{m2}%から大きく上がりました。'),
            (f'The company plans about ₩{ret.values[1]}T of shareholder returns for {ret.values[0]}: dividends of ₩{ret.values[2]}T or more and buybacks and cancellations of ₩{ret.values[3]}T or more.' if ret else
             f'Operating margin was {m0}%, up sharply from {m2}% a year ago.')),
        sec('watch', 'メモリーの価格は需給で動きます。業界全体が生産能力を増やせば、後から価格が下がるおそれがあります。来年の投資額は、この届出にはありません。',
            "Memory prices follow supply and demand. If the whole industry adds capacity, prices could fall later. Next year's investment is not in this filing."),
        sec('means', f'{m0}%の営業利益率が続くとは限りません。価格の動きと合わせて見る必要があります。', f'Do not assume an operating margin of {m0}% will last; read it together with prices.'),
        sec('view', (f'一方、第{["first", "second", "third", "fourth"].index(div.values[0]) + 1}四半期の配当は1株{int(div.values[2]):,}ウォンで、利益の大きな部分が株主に戻ります。' if div else '株主への還元の計画は、決算発表の日の別の届出で確かめます。'),
            (f'Meanwhile, the quarterly dividend is ₩{int(div.values[2]):,} per share, so a large part of profit goes back to shareholders.' if div else 'The shareholder-return plan is in a separate filing of the results day.'))])
    unaudited = f.get('unaudited')
    if unaudited:
        ev.add('summary.conclusion[1]', unaudited)
    nxt = card('数値の見通しはなし。次の決算で水準を確かめる', 'No numeric outlook; check the level next quarter', [
        chip('gold', '数値の売上見通しなし', 'No numeric revenue guidance'),
        chip('gold', f'営業利益率 {m0}% を保てるか', f'Can the {m0}% margin hold?')], [
        sec('happened', 'SKハイニックスは、売上や利益の数値の見通しを出していません。今回の数字は監査前の速報値です。',
            'SK hynix does not give numeric revenue or profit guidance. These figures are preliminary and unaudited.'),
        sec('means', '需要と価格の見方は会社の説明会資料にあり、この届出には数字としては出ていません。', "The company's view of demand and prices is in its call materials, not as figures in this filing."),
        sec('view', '次の決算で、売上と営業利益率がこの水準を保てるか、純利益と営業利益の差がどう動くかを確かめます。',
            'Next time, check whether revenue and operating margin hold at this level and how the gap between net income and operating profit moves.')])
    conclusion = [
        c(f'売上は{krw(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期の約{q(r0 / r2, 1)}倍でした。営業利益は{krw(op.values[0])["ja"]}、営業利益率は{m0}%です。',
          f'Revenue was {krw(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and about {q(r0 / r2, 1)} times a year earlier. Operating profit was {krw(op.values[0])["en"]}, a margin of {m0}%.'),
        c(f'純利益は{krw(ni.values[0])["ja"]}で、前期の{krw(ni.values[2])["ja"]}から{sign(ni.values[3], 0)}でした。数字は監査前の速報値です。',
          f'Net income was {krw(ni.values[0])["en"]}, {sign(ni.values[3], 0)} from {krw(ni.values[2])["en"]} last quarter. The figures are preliminary and unaudited.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- Arm (ARM): the shareholder letter (6-K EX-99.2); the previous quarter from the previous letter ----------------------------------

def arm(f, url, before_previous, report=None, events=None, previous=None, prior=None):
    need(f, 'revenue', 'license', 'royalty', 'gm', 'opMargin', 'netIncome', 'eps', 'cfo', 'fcf', 'guidance', 'guidanceEps')
    need_prior(prior, 'revenue', 'gm', 'opMargin', 'royalty')
    ev = Evidence(url)
    rev, lic, roy, gm, om, eps = f['revenue'], f['license'], f['royalty'], f['gm'], f['opMargin'], f['eps']
    prev, pgm, pom, proy = prior['revenue'], prior['gm'], prior['opMargin'], prior['royalty']
    r0, r2, r1 = rev.values[0], rev.values[1], prev.values[0]
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.yearAgo', rev)
    ev.add('numbers.revenue.previous', prev)
    ev.add('numbers.adjustedEPS', eps)
    ev.add('numbers.grossMargin.current', gm)
    ev.add('numbers.grossMargin.previous', pgm)
    g = f['guidance']
    mid, band = Decimal(g.values[3]) * 1000, Decimal(g.values[4])
    low, high = mid - band, mid + band
    ev.add('numbers.guidance.low', g, calc=f'{g.raws[3]} * 1000 - {g.raws[4]}')
    ev.add('numbers.guidance.high', g, calc=f'{g.raws[3]} * 1000 + {g.raws[4]}')
    g0, g1 = gm.values[2], pgm.values[2]
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': float(eps.values[3]), 'epsEstimate': None,
               'grossMargin': {'current': float(g0), 'previous': float(g1)}, 'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': None}, 'segments': None}
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前年同期比 +{rev.raws[2]}%', f'+{rev.raws[2]}% YoY'),
             tile('ライセンスその他の売上', 'License and other revenue', money_tile(ev, 1, lic, 0, None), f'前年同期比 {sign(lic.values[2], 0)}', f'{sign(lic.values[2], 0)} YoY'),
             tile('ロイヤルティ売上', 'Royalty revenue', money_tile(ev, 2, roy, 0, None), f'前年同期比 {sign(roy.values[2], 0)}', f'{sign(roy.values[2], 0)} YoY')]
    ev.add('tiles[0].note', rev)
    ev.add('tiles[1].note', lic)
    ev.add('tiles[2].note', roy)
    acv, dcr, timing = f.get('acv'), f.get('dcRoyalties'), f.get('licenseTiming')
    ev.add('summary.cards.growth.sections[0]', lic)
    if acv:
        ev.add('summary.cards.growth.sections[0]', acv)
    if dcr:
        ev.add('summary.cards.growth.sections[0]', dcr)
    if timing:
        ev.add('summary.cards.growth.sections[2]', timing)
    growth = card(f'ライセンスその他の売上が前年同期比 {sign(lic.values[2], 0)}', f'License and other revenue {sign(lic.values[2], 0)} YoY', [
        chip(tone(lic.values[0] - lic.values[1]), f'ライセンス {usd(lic.values[1])["ja"]} → {usd(lic.values[0])["ja"]}', f'License {usd(lic.values[1])["en"]} → {usd(lic.values[0])["en"]}'),
        (chip('up', 'データセンターのロイヤルティが倍増', 'Data center royalties doubled') if dcr else
         chip(tone(roy.values[2]), f'ロイヤルティ 前年同期比 {sign(roy.values[2], 0)}', f'Royalty {sign(roy.values[2], 0)} YoY'))], [
        sec('happened', f'ライセンスその他の売上は前年同期の{usd(lic.values[1])["ja"]}から{usd(lic.values[0])["ja"]}へ、{sign(lic.values[2], 0)}でした。'
            + (f'年換算の契約額(ACV)は{sign(acv.values[2], 0)}の{usd(acv.values[0])["ja"]}で、' if acv else '') + ('データセンター向けのロイヤルティは前年同期のほぼ2倍になりました。' if dcr else ''),
            f'License and other revenue went from {usd(lic.values[1])["en"]} a year ago to {usd(lic.values[0])["en"]}, {sign(lic.values[2], 0)}.'
            + (f' Annualized contract value (ACV) was {usd(acv.values[0])["en"]}, {sign(acv.values[2], 0)}' if acv else '') + (', and data center royalties roughly doubled from a year ago.' if dcr else '.' if acv else '')),
        sec('good', 'ライセンス契約は、顧客がArmを使った新しい半導体の設計を始めたことを示します。その半導体が量産されると、後からロイヤルティ収入になります。',
            'License deals show customers starting new chip designs on Arm. When those chips reach volume production, they bring in royalty revenue later.'),
        sec('watch', ('会社は、複数の高額なライセンス契約の時期と規模も増加に影響したとしています。' if timing else '') + 'ライセンス収入は四半期ごとに大きく振れることがあります。',
            ('The company says the increase also reflects the timing and size of several high-value license agreements. ' if timing else '') + 'License revenue can swing widely from quarter to quarter.')])
    d = r0 - r1
    above = r0 > (Decimal(g.values[0]) * 1000 + Decimal(g.values[1]))
    ni, cfo, fcf = f['netIncome'], f['cfo'], f['fcf']
    ev.add('summary.cards.change.sections[0]', g)
    ev.add('summary.cards.change.sections[1]', om)
    ev.add('summary.cards.change.sections[1]', pom)
    ev.add('summary.cards.change.sections[2]', ni)
    ev.add('summary.cards.change.sections[2]', cfo)
    ev.add('summary.cards.change.sections[2]', fcf)
    flat = abs(g0 - g1) < 1
    changes = card(f'売上は前期比 {sign(qoq)}、粗利益率は' + ('ほぼ横ばい' if flat else '上昇' if g0 > g1 else '低下'), f'Revenue {sign(qoq)} QoQ, gross margin ' + ('about flat' if flat else 'higher' if g0 > g1 else 'lower'), [
        chip(tone(qoq), f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ'),
        chip(tone(g0 - g1), f'調整後粗利益率 {pc(g1)} → {pc(g0)}', f'Non-GAAP gross margin {pc(g1)} → {pc(g0)}')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。'
            + (f'会社の見通し({usd(Decimal(g.values[0]) * 1000)["ja"]}±{usd(Decimal(g.values[1]))["ja"]})の上限を上回っています。' if above else '') + f'調整後粗利益率は{pc(g1)}から{pc(g0)}になりました。',
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}' + (f", above the top of the company's ${g.values[0]}B plus or minus ${g.values[1]}M outlook" if above else '')
            + f'. Non-GAAP gross margin went from {pc(g1)} to {pc(g0)}.'),
        sec('good', f'調整後営業利益率は{pc(pom.values[2])}から{pc(om.values[2])}になり、調整後EPSは前年同期の{ps(eps.values[4])["ja"]}から{ps(eps.values[3])["ja"]}へ{sign(eps.values[5], 0)}でした。',
            f'Non-GAAP operating margin went from {pc(pom.values[2])} to {pc(om.values[2])}, and non-GAAP EPS was {ps(eps.values[3])["en"]}, {sign(eps.values[5], 0)} from {ps(eps.values[4])["en"]} a year ago.'),
        sec('watch', f'GAAPでは、純利益が前年同期の{usd(ni.values[1])["ja"]}から{usd(ni.values[0])["ja"]}へ{sign(ni.values[2], 0)}で、営業利益率は{pc(om.values[0])}でした。調整後のフリーキャッシュフローは{usd(fcf.values[1])["ja"]}から{usd(fcf.values[0])["ja"]}へ{sign(fcf.values[2], 0)}です。',
            f'On a GAAP basis, net income went from {usd(ni.values[1])["en"]} a year ago to {usd(ni.values[0])["en"]} ({sign(ni.values[2], 0)}), and the operating margin was {pc(om.values[0])}. Non-GAAP free cash flow went from {usd(fcf.values[1])["en"]} to {usd(fcf.values[0])["en"]} ({sign(fcf.values[2], 0)}).'),
        sec('view', '売上と調整後の利益は伸びましたが、GAAPの利益とキャッシュフローは' + ('弱くなりました。' if ni.values[2] < 0 or fcf.values[2] < 0 else '別の動きをしています。') + 'それぞれの数字がどの基準かを分けて追います。',
            'Revenue and adjusted profit grew, but GAAP profit and cash flow ' + ('weakened.' if ni.values[2] < 0 or fcf.values[2] < 0 else 'moved differently.') + ' Keep track of which basis each figure uses.')])
    mem, rel = f.get('memory'), f.get('related')
    rd = roy.values[0] - proy.values[0]
    ev.add('summary.cards.caution.sections[0]', roy)
    ev.add('summary.cards.caution.sections[0]', proy)
    if mem:
        ev.add('summary.cards.caution.sections[0]', mem)
    if rel:
        ev.add('summary.cards.caution.sections[1]', rel)
    caution = card('ロイヤルティ売上が前期から減少' if rd < 0 else 'ロイヤルティ売上の伸び', 'Royalty revenue fell from the previous quarter' if rd < 0 else 'Royalty revenue growth', [
        chip(tone(rd), f'ロイヤルティ {usd(proy.values[0])["ja"]} → {usd(roy.values[0])["ja"]}', f'Royalty {usd(proy.values[0])["en"]} → {usd(roy.values[0])["en"]}'),
        chip(tone(roy.values[2] - proy.values[2]), f'前年同期比 {sign(proy.values[2], 0)} → {sign(roy.values[2], 0)}', f'YoY growth {sign(proy.values[2], 0)} → {sign(roy.values[2], 0)}')], [
        sec('happened', f'ロイヤルティ売上は{usd(proy.values[0])["ja"]}から{usd(roy.values[0])["ja"]}になりました。前年同期比の伸びは前期の{sign(proy.values[2], 0)}から{sign(roy.values[2], 0)}に{"鈍りました" if roy.values[2] < proy.values[2] else "変わりました"}。'
            + ('会社はスマートフォン市場でのメモリー価格の影響を挙げています。' if mem else ''),
            f'Royalty revenue went from {usd(proy.values[0])["en"]} to {usd(roy.values[0])["en"]}. Year-over-year growth went from {sign(proy.values[2], 0)} last quarter to {sign(roy.values[2], 0)}.'
            + (' The company cited the impact of memory pricing on the smartphone market.' if mem else '')),
        sec('watch', 'ロイヤルティはArmの売上の土台です。新しい設計の採用が進んでも、スマートフォンの出荷が弱いと伸びが抑えられます。' + (f'また、売上{usd(r0)["ja"]}のうち{usd(rel.values[0])["ja"]}は関連当事者からのものです。' if rel else ''),
            "Royalties are the base of Arm's revenue. Weak smartphone shipments can hold back growth even as newer designs are adopted." + (f' Also, {usd(rel.values[0])["en"]} of the {usd(r0)["en"]} in revenue came from related parties.' if rel else '')),
        sec('means', '今期は大型のライセンス契約が補いましたが、ライセンス収入は四半期ごとに振れやすいものです。', 'Large license deals made up for it this quarter, but license revenue is volatile from quarter to quarter.'),
        sec('view', '1四半期の減少だけでは傾向とは言えません。次の決算で、ロイヤルティが前期比で回復するかが大事です。', 'One quarter is not a trend. What matters is whether royalties grow sequentially in the next report.')])
    ge = f['guidanceEps']
    agd, agr = f.get('agiDelivery'), f.get('agiRevenue')
    ev.add('summary.cards.next.chips[1]', ge)
    if agd:
        ev.add('summary.cards.next.sections[1]', agd)
    if agr:
        ev.add('summary.cards.next.sections[1]', agr)
    nxt = card('次期の会社見通しを追う', "Follow the company's outlook for next quarter", [
        chip('gold', f'売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Revenue {usd(low)["en"]}–{usd(high)["en"]}'),
        chip('gold', f'調整後EPS {ps(Decimal(ge.values[3]))["ja"]}±{ps(Decimal(ge.values[4]))["ja"]}', f'Non-GAAP EPS ${ge.values[3]} ± ${ge.values[4]}')], [
        sec('happened', f'会社は次期の売上を{usd(mid)["ja"]}±{usd(band)["ja"]}({usd(low)["ja"]}〜{usd(high)["ja"]})と見込み、調整後EPSは{ps(Decimal(ge.values[3]))["ja"]}±{ps(Decimal(ge.values[4]))["ja"]}の見通しです。下限でも今回の{usd(r0)["ja"]}より約{q(change(low, r0), 1)}%多くなります。',
            f"The company expects next-quarter revenue of {usd(mid)['en']} plus or minus {usd(band)['en']} ({usd(low)['en']} to {usd(high)['en']}) and non-GAAP EPS of ${ge.values[3]} plus or minus ${ge.values[4]}. Even the low end is about {q(change(low, r0), 1)}% above this quarter's {usd(r0)['en']}."),
        sec('means', (f'自社設計のチップ(Arm AGI CPU)の最初の商用出荷は、会計年度の{agd.values[0]}’{agd.values[1]}に予定どおり進んでいます。' if agd else '')
            + (f'会社は{agr.values[1]}〜{agr.values[2]}年度の2年間で最大{usd(Decimal(agr.values[0]) * 1000)["ja"]}の売上を見込んでいます。' if agr else '') or '見通しは会社の計画で、実績ではありません。',
            ((f"First commercial deliveries of Arm's own chip (Arm AGI CPU) are on track for fiscal {agd.values[0]}'{agd.values[1]}. " if agd else '')
             + (f'The company sees up to ${agr.values[0]}B of revenue from it across fiscal {agr.values[1]} and {agr.values[2]}.' if agr else '')).strip() or "The outlook is the company's plan, not a result."),
        sec('view', '次の決算で、売上がこの幅のどこに入るか、ロイヤルティが再び伸びるかを確かめます。', 'In the next report, check where revenue lands in this range and whether royalties grow again.')])
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期比+{rev.raws[2]}%でした。ライセンスその他の売上({sign(lic.values[2], 0)})が伸びを主導しました。',
          f'Revenue was {usd(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and {rev.raws[2]}% from a year ago, led by license and other revenue ({sign(lic.values[2], 0)}).'),
        c(f'一方、半導体の出荷に連動するロイヤルティ売上は、前期の{usd(proy.values[0])["ja"]}から{usd(roy.values[0])["ja"]}になりました。' + ('会社はスマートフォン市場でのメモリー価格の影響を挙げています。' if mem else ''),
          f'Meanwhile, royalty revenue, which follows chip shipments, went from {usd(proy.values[0])["en"]} last quarter to {usd(roy.values[0])["en"]}.' + (' The company cited the impact of memory pricing on the smartphone market.' if mem else '')),
        c(f'会社は次期の売上を{usd(mid)["ja"]}±{usd(band)["ja"]}と見込んでいます。', f'The company expects next-quarter revenue of {usd(mid)["en"]} plus or minus {usd(band)["en"]}.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}



# ---- CoreWeave (CRWV): no EPS or margin; the quarter's guidance is the full-year range minus nine months; the 10-Q for customers --------

def crwv(f, url, before_previous, report=None, events=None, previous=None, prior=None):
    need(f, 'revenue', 'nineMonths', 'opIncome', 'interest', 'netLoss', 'ebitda', 'ebitdaMargin', 'adjOp', 'adjOpMargin', 'backlog', 'capex',
         'debtCurrent', 'nonRecourseCurrent', 'debtLong', 'nonRecourseLong', 'guidance')
    need_prior(prior, 'revenue', 'adjOpMargin', 'backlog')
    report = report or {}
    ev = Evidence(url)
    rev, nm, prev = f['revenue'], f['nineMonths'], prior['revenue']
    r0, r2, r1 = rev.values[0], rev.values[1], prev.values[0]
    qoq, yoy = change(r0, r1), change(r0, r2)
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.yearAgo', rev)
    ev.add('numbers.revenue.previous', prev)
    g = f['guidance']
    ytd = nm.values[2]
    low, high = Decimal(g.values[1]) * 1000 - ytd, Decimal(g.values[2]) * 1000 - ytd
    for field, raw in (('low', g.raws[1]), ('high', g.raws[2])):
        ev.add(f'numbers.guidance.{field}', g)
        ev.add(f'numbers.guidance.{field}', nm, calc=f'{raw} * 1000 - {nm.raws[2]}')
    numbers = {'revenue': {'current': float(r0), 'previous': float(r1), 'yearAgo': float(r2)}, 'adjustedEPS': None, 'epsEstimate': None,
               'grossMargin': None, 'guidance': {'low': float(low), 'high': float(high), 'grossMarginPercent': None}, 'segments': None}
    bl, pbl, loss = f['backlog'], prior['backlog'], f['netLoss']
    pday = datetime.strptime(f'{pbl.values[1]} {pbl.values[2]}', '%B %d %Y')
    tiles = [tile('売上高', 'Revenue', money_tile(ev, 0, rev, 0, None), f'前年同期比 {sign(yoy, 0)}', f'{sign(yoy, 0)} YoY'),
             text_tile('受注残(将来の売上)', 'Revenue backlog', usd(Decimal(bl.values[0]) * 1000)['ja'], f'${bl.values[0]}B',
                       f'{pday.month}月{pday.day}日時点は{usd(Decimal(pbl.values[0]) * 1000)["ja"]}', f'${pbl.values[0]}B at {pday.strftime("%B")} {pday.day}'),
             tile('純損失(GAAP)', 'Net loss (GAAP)', money_tile(ev, 2, loss, 0, None), f'前年同期は{usd(loss.values[1])["ja"]}', f'{usd(loss.values[1])["en"]} a year earlier')]
    ev.add('tiles[0].note', rev, calc=growth_calc(rev, 0, 1), rnd=0)
    ev.add('tiles[1].value', bl)
    ev.add('tiles[1].note', pbl)
    ev.add('tiles[2].note', loss)
    ap, cp, cust, com = f.get('activePower'), f.get('contracted'), report.get('customers'), report.get('committed')
    times_bl = q(Decimal(bl.values[0]) * 1000 / r0, 0)
    for x in (ap, cp):
        if x:
            ev.add('summary.cards.growth.sections[0]', x)
    if cust:
        ev.add('summary.cards.growth.sections[2]', cust)
    if com:
        ev.add('summary.cards.growth.sections[1]', com)
    growth = card(f'受注残は約{usd(Decimal(bl.values[0]) * 1000)["ja"]}に', f'Revenue backlog reached about ${bl.values[0]}B', [
        chip('up' if Decimal(bl.values[0]) > Decimal(pbl.values[0]) else 'down', f'受注残 約{usd(Decimal(pbl.values[0]) * 1000)["ja"]} → {usd(Decimal(bl.values[0]) * 1000)["ja"]}', f'Backlog ~${pbl.values[0]}B → ${bl.values[0]}B'),
        (chip('up', f'稼働中の電力 {ap.values[1]}GW超', f'Active power over {ap.values[1]} GW') if ap else chip('gold', f'売上の約{times_bl}倍の受注残', f'Backlog ~{times_bl}x quarterly revenue'))], [
        sec('happened', f'受注残(契約済みでまだ売上になっていない金額)は、{pday.month}月{pday.day}日時点の約{usd(Decimal(pbl.values[0]) * 1000)["ja"]}から約{usd(Decimal(bl.values[0]) * 1000)["ja"]}になりました。'
            + (f'稼働中の電力は{ap.values[0]}MW以上増えて{ap.values[1]}GWを超え、' if ap else '') + (f'契約済みの電力は{cp.values[1]}GWを超えました。' if cp else ''),
            f'Revenue backlog (contracted amounts still to be recognized) went from about ${pbl.values[0]}B at {pday.strftime("%B")} {pday.day} to about ${bl.values[0]}B.'
            + (f' Active power grew by more than {ap.values[0]} MW to over {ap.values[1]} GW' if ap else '') + (f', and contracted power exceeded {cp.values[1]} GW.' if cp else '.' if ap else '')),
        sec('good', (f'10-Qによると、売上の{com.values[0]}%は確定した契約によるものです。' if com else '') + f'受注残は今期の売上の約{times_bl}倍あり、設備が稼働すれば売上になる分が多く控えています。',
            (f'Per the 10-Q, {com.values[0]}% of revenue comes from committed contracts. ' if com else '') + f"Backlog is about {times_bl} times this quarter's revenue, so a large amount is lined up to become revenue once capacity comes online."),
        sec('watch', (f'顧客の集中は高いままで、10-Qによると、今期は2社(AとB)が売上のそれぞれ{cust.values[0]}%と{cust.values[1]}%を占めました。' if cust else
                      '少数の大口顧客への集中が高く、顧客ごとの比率は決算発表の後に出る10-Qで確かめます。'),
            (f'Customer concentration remains high: per the 10-Q, two customers (A and B) accounted for {cust.values[0]}% and {cust.values[1]}% of revenue this quarter.' if cust else
             'Customer concentration is high; the 10-Q, filed after the release, shows each large customer\'s share.')),
        sec('means', '受注残を売上に変えるには、電力と設備を予定どおり用意できるかにかかっています。', 'Turning backlog into revenue depends on getting power and equipment ready on schedule.')])
    om, pom, eb, ebm, oi, it = f['adjOpMargin'], prior['adjOpMargin'], f['ebitda'], f['ebitdaMargin'], f['opIncome'], f['interest']
    d = r0 - r1
    ev.add('summary.cards.change.sections[0]', om)
    ev.add('summary.cards.change.sections[0]', pom)
    ev.add('summary.cards.change.sections[1]', eb)
    ev.add('summary.cards.change.sections[1]', ebm)
    ev.add('summary.cards.change.sections[2]', it)
    ev.add('summary.cards.change.sections[2]', oi)
    changes = card(f'売上は前期比 {sign(qoq)}、調整後営業利益率は{om.raws[0] if om.values[0] >= 0 else om.values[0]}%に', f'Revenue {sign(qoq)} QoQ, adjusted operating margin from {pom.values[0]}% to {om.values[0]}%', [
        chip(tone(qoq), f'売上 前期比 {sign(qoq)}', f'Revenue {sign(qoq)} QoQ'),
        chip(tone(om.values[0] - pom.values[0]), f'調整後営業利益率 {pom.values[0]}% → {om.values[0]}%', f'Adj. operating margin {pom.values[0]}% → {om.values[0]}%')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。調整後営業利益率は{pom.values[0]}%から{om.values[0]}%になりました。',
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}. Adjusted operating margin went from {pom.values[0]}% to {om.values[0]}%.'),
        sec('good', f'調整後EBITDA(減価償却などを引く前の利益)は{usd(eb.values[0])["ja"]}で、売上の{ebm.values[0]}%です。設備が生む現金の力は増えています。',
            f'Adjusted EBITDA (profit before depreciation and similar items) was {usd(eb.values[0])["en"]}, or {ebm.values[0]}% of revenue, so the cash-generating power of the equipment is growing.'),
        sec('watch', f'GAAPの純損失は前年同期の{usd(-loss.values[1])["ja"]}から{usd(-loss.values[0])["ja"]}になりました。支払利息{usd(-it.values[0])["ja"]}が営業利益{usd(oi.values[0])["ja"]}を大きく上回ったためです。',
            f'The GAAP net loss went from {usd(-loss.values[1])["en"]} a year ago to {usd(-loss.values[0])["en"]}, because interest expense of {usd(-it.values[0])["en"]} far exceeded operating income of {usd(oi.values[0])["en"]}.'),
        sec('view', '売上と調整後の利益は伸びていますが、借入の利息で最終損益は赤字のままです。調整後の数字と最終損益は分けて読む必要があります。',
            'Revenue and adjusted profit are growing, but interest on debt keeps the bottom line negative. Read adjusted figures and net results separately.')])
    cx = f['capex']
    debt0 = f['debtCurrent'].values[0] + f['nonRecourseCurrent'].values[0] + f['debtLong'].values[0] + f['nonRecourseLong'].values[0]
    debt1 = f['debtCurrent'].values[1] + f['nonRecourseCurrent'].values[1] + f['debtLong'].values[1] + f['nonRecourseLong'].values[1]
    conv, atm, ig = f.get('converts'), f.get('atm'), f.get('interestGuidance')
    ev.add('summary.cards.caution.sections[0]', cx)
    for k in ('debtCurrent', 'nonRecourseCurrent', 'debtLong', 'nonRecourseLong'):
        ev.add('summary.cards.caution.sections[0]', f[k])
    for x in (conv, atm):
        if x:
            ev.add('summary.cards.caution.sections[1]', x)
    if ig:
        ev.add('summary.cards.caution.sections[2]', ig)
    cap = -cx.values[0]
    caution = card(f'設備投資は売上の約{q(cap / r0, 1)}倍、借入も増加', f'Capex was about {q(cap / r0, 1)}x revenue; debt {"rose" if debt0 > debt1 else "fell"}', [
        chip('down', f'四半期の設備投資 {usd(cap)["ja"]}', f'Quarterly capex {usd(cap)["en"]}'),
        chip('down' if debt0 > debt1 else 'up', f'借入 {usd(debt1)["ja"]} → {usd(debt0)["ja"]}', f'Debt {usd(debt1)["en"]} → {usd(debt0)["en"]}')], [
        sec('happened', f'設備投資(設備などの購入)は今期{usd(cap)["ja"]}で、売上{usd(r0)["ja"]}の約{q(cap / r0, 1)}倍でした。借入の合計は前年度末の{usd(debt1)["ja"]}から{usd(debt0)["ja"]}になりました。',
            f'Capital spending (purchases of property and equipment) was {usd(cap)["en"]} in the quarter, about {q(cap / r0, 1)} times revenue of {usd(r0)["en"]}. Total debt went from {usd(debt1)["en"]} at the end of last year to {usd(debt0)["en"]}.'),
        sec('watch', (f'今期は約{usd(Decimal(conv.values[0]) * 1000)["ja"]}の転換社債を発行し、' if conv else '') + (f'最大{int(atm.values[0]) * 100:,}万株の新株を市場で売る枠も設けました。' if atm else '')
            + '転換や新株の売り出しは、既存の株主の持ち分を薄めます。' if (conv or atm) else '借入や新株による資金調達は、既存の株主の負担になりえます。',
            ((f'This quarter the company issued about ${conv.values[0]}B of convertible notes' if conv else '') + (f' and set up an at-the-market program for up to {atm.values[0]} million new shares' if atm else '')).strip()
            + '. Conversions or new share sales dilute existing holders.' if (conv or atm) else 'Debt and new shares used for funding can weigh on existing holders.'),
        sec('means', '先に設備にお金を使い、売上は後から入ります。' + (f'利息の負担も重く、会社は{ig.values[1]}年{ig.values[0][1]}四半期の支払利息を{usd(Decimal(ig.values[2]) * 1000)["ja"]}〜{usd(Decimal(ig.values[3]) * 1000)["ja"]}と見込んでいます。' if ig else ''),
            'Money is spent on equipment first and revenue comes later.' + (f' The interest burden stays heavy: the company expects {ig.values[0]} interest expense of ${ig.values[2]}B to ${ig.values[3]}B.' if ig else '')),
        sec('view', '大きな受注残も、資金を調達し続けられることが前提です。次の決算で、借入、利息、株式の発行を確かめます。',
            'A large backlog still depends on continued access to financing. Check debt, interest and share issuance in the next report.')])
    cg, pp = f.get('capexGuidance'), f.get('prepayments')
    ev.add('summary.cards.next.sections[0]', g)
    ev.add('summary.cards.next.sections[0]', nm)
    if cg:
        ev.add('summary.cards.next.sections[1]', cg)
    if pp:
        ev.add('summary.cards.next.sections[1]', pp)
    nxt = card('通年の見通しから逆算した第4四半期', 'The last quarter implied by the full-year outlook', [
        chip('gold', f'逆算した次期の売上 {usd(low)["ja"]}〜{usd(high)["ja"]}', f'Implied next-quarter revenue {usd(low)["en"]}–{usd(high)["en"]}'),
        (chip('gold', f'通年の設備投資 {usd(Decimal(cg.values[0]) * 1000)["ja"]}〜{usd(Decimal(cg.values[1]) * 1000)["ja"]}', f'FY capex ${cg.values[0]}–{cg.values[1]}B') if cg else
         chip('gold', f'通年の売上 {usd(Decimal(g.values[1]) * 1000)["ja"]}〜{usd(Decimal(g.values[2]) * 1000)["ja"]}', f'FY revenue ${g.values[1]}–{g.values[2]}B'))], [
        sec('happened', f'会社は{g.values[0]}年の売上見通しを{usd(Decimal(g.values[1]) * 1000)["ja"]}〜{usd(Decimal(g.values[2]) * 1000)["ja"]}に引き上げました。年初からの売上は{usd(ytd)["ja"]}なので、残りの四半期は{usd(low)["ja"]}〜{usd(high)["ja"]}になり、今回の{usd(r0)["ja"]}より少なくとも約{q(change(low, r0), 0)}%多くなります。',
            f"The company raised its {g.values[0]} revenue guidance to ${g.values[1]}B to ${g.values[2]}B. Year-to-date revenue was {usd(ytd)['en']}, which implies remaining-quarter revenue of {usd(low)['en']} to {usd(high)['en']}, at least about {q(change(low, r0), 0)}% above this quarter's {usd(r0)['en']}."),
        sec('watch', (f'通年の設備投資の見通しは{usd(Decimal(cg.values[0]) * 1000)["ja"]}〜{usd(Decimal(cg.values[1]) * 1000)["ja"]}です。' if cg else '')
            + (f'会社は今後3か月で約{usd(Decimal(pp.values[0]) * 1000)["ja"]}の前受け金・預かり金を見込んでいますが、支出は非常に大きいままです。' if pp else '支出は非常に大きいままです。'),
            (f'Full-year capex guidance is ${cg.values[0]}B to ${cg.values[1]}B. ' if cg else '') + (f'The company expects about ${pp.values[0]}B in customer prepayments and deposits over the next three months, but the spending remains very large.' if pp else 'The spending remains very large.')),
        sec('view', '次の決算で、売上がこの幅に入るか、支払利息と損失がどう動くかを確かめます。', 'In the next report, check whether revenue lands in this range and how interest expense and losses change.')])
    conclusion = [
        c(f'売上は{usd(r0)["ja"]}で、前期比{sign(qoq, 0)}、前年同期の約{q(r0 / r2, 1)}倍でした。受注残は約{usd(Decimal(bl.values[0]) * 1000)["ja"]}になりました。',
          f'Revenue was {usd(r0)["en"]}, {sign(qoq, 0)} from the previous quarter and about {q(r0 / r2, 1)} times the year-ago level. Revenue backlog reached about ${bl.values[0]}B.'),
        c(f'一方、純損失は{usd(-loss.values[0])["ja"]}でした。設備を借入で買っているため、支払利息{usd(-it.values[0])["ja"]}が営業利益{usd(oi.values[0])["ja"]}を大きく上回っています。',
          f'Meanwhile, the net loss was {usd(-loss.values[0])["en"]}. Because equipment is bought with borrowed money, interest expense ({usd(-it.values[0])["en"]}) far exceeded operating income ({usd(oi.values[0])["en"]}).'),
        c(f'通年の売上見通しから逆算すると、残りの四半期の売上は{usd(low)["ja"]}〜{usd(high)["ja"]}です。', f'The full-year revenue guidance implies remaining-quarter revenue of {usd(low)["en"]} to {usd(high)["en"]}.')]
    return {'tiles': tiles, 'numbers': numbers, 'evidence': ev.items, 'summary': summary(conclusion, growth, changes, caution, nxt)}


WRITERS = {'AMD': amd, 'ANET': anet, 'PLTR': pltr, 'ALAB': alab, 'LITE': lite, 'SNDK': sndk, 'VRT': vrt, 'GEV': gev, 'BE': be, 'SKHY': skhy, 'ARM': arm, 'CRWV': crwv}
