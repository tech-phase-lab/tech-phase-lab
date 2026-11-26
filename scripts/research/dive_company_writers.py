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
    ev.add('numbers.revenue.current', rev)
    ev.add('numbers.revenue.previous', rev)
    if ago is not None:
        ev.add('numbers.revenue.yearAgo', rev)
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


WRITERS = {'AMD': amd, 'ANET': anet}
