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

def pltr(f, url, before_previous, report=None, events=None, previous=None):
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
    gm_word = ('やや低下', 'slightly lower') if gm0 < gm1 else ('上昇', 'higher') if gm0 > gm1 else ('横ばい', 'flat')
    changes = card(f'売上は前期比 {sign(qoq)}、粗利益率は{gm_word[0]}', f'Revenue {sign(qoq)} QoQ, gross margin {gm_word[1]}', [
        chip(tone(gm0 - gm1), f'粗利益率 {pc(gm1)} → {pc(gm0)}', f'Gross margin {pc(gm1)} → {pc(gm0)}'),
        chip('gold', f'調整後営業利益率 {aom}%(GAAPは{gom}%)', f'Adj. operating margin {aom}% (GAAP {gom}%)')], [
        sec('happened', f'売上は{usd(r1)["ja"]}から{usd(r0)["ja"]}へ、{usd(abs(d))["ja"]}{rose(d, True)}ました。GAAPの粗利益率は{pc(gm1)}から{pc(gm0)}になりました。調整後の営業利益は{aop_ja}で、利益率は{aom}%です。',
            f'Revenue {rose(d)} from {usd(r1)["en"]} to {usd(r0)["en"]}, a change of {usd(abs(d))["en"]}. GAAP gross margin went from {pc(gm1)} to {pc(gm0)}. Adjusted operating income was {aop_en}, a {aom}% margin.'),
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


WRITERS = {'AMD': amd, 'ANET': anet, 'PLTR': pltr, 'ALAB': alab}
