"""週刊 Tech Phase PRO: the week's market move, computed here from real closing prices (owner, Nov 21).

The owner rejected a draft whose 今週のひとこと said nothing about a week in which the Nasdaq 100 fell more than in any week since
March 2020: the generator never read a price. This module reads daily closes from Twelve Data (the provider the site already uses for
its price screens), and computes, for the indices the site shows (the ETFs that track them: on this plan the index symbols NDX / SPX
answer with other securities, see lib/research/market-data.ts), for gold, silver and bitcoin, and for the covered stocks:
- the weekly change (last close of the issue's week against the last close of the week before),
- the historical context of that move ("the largest weekly decline since the week of 2020-03-16"), found by scanning every earlier
  week of the series. A comparison is only ever stated when the data proves it; the model never supplies one.

Every figure carries its source and dates, so the owner can check it (the draft's review memo lists them)."""

import json
import os
import urllib.parse
import urllib.error
import urllib.request
from time import sleep
from datetime import date as Date, timedelta
from decimal import Decimal, ROUND_HALF_UP

BASE_ENV = "TWELVE_DATA_BASE_URL"
KEY_ENV = "TWELVE_DATA_API_KEY"
SOURCE = "Twelve Data の日足終値"
HISTORY_START = "2008-01-01"

# The index cards of the site read these ETFs (lib/research/market-data.ts, market-reaction.ts): Nasdaq 100, S&P 500 and semiconductors.
INDICES = (
    {"symbol": "QQQ", "name": "ナスダック100", "label": "ナスダック100連動ETF（QQQ）", "aliases": ("ナスダック", "NASDAQ", "Nasdaq", "QQQ"), "notable": Decimal("3")},
    {"symbol": "SPY", "name": "S&P500", "label": "S&P500連動ETF（SPY）", "aliases": ("S&P", "SPY"), "notable": Decimal("3")},
    {"symbol": "SMH", "name": "半導体株", "label": "半導体ETF（SMH）", "aliases": ("半導体", "SMH", "SOX"), "notable": Decimal("5")},
    {"symbol": "SOXX", "name": "半導体株", "label": "半導体ETF（SOXX）", "aliases": ("半導体", "SOXX", "SOX"), "notable": Decimal("5")},
)
# Other markets on the site's market board (owner, Nov 21: gold, silver and bitcoin were sold too, and the draft never said so). They
# trade outside stock-market hours; the week is still read from Friday's close to Friday's close.
ASSETS = (
    {"symbol": "XAU/USD", "name": "金", "label": "金（XAU/USD）", "aliases": ("金",), "notable": Decimal("3")},
    {"symbol": "XAG/USD", "name": "銀", "label": "銀（XAG/USD）", "aliases": ("銀",), "notable": Decimal("5")},
    {"symbol": "BTC/USD", "name": "ビットコイン", "label": "ビットコイン（BTC/USD）", "aliases": ("ビットコイン", "BTC"), "notable": Decimal("8")},
)
# The covered stocks: the research roster (deep_analysis.ROSTER) less SK hynix, which has no US listing on the provider.
COVERED = ("MU", "SNDK", "NBIS", "NVDA", "AMD", "AVGO", "ARM", "TSM", "ASML", "MRVL", "ANET", "CRDO", "CRWV", "VRT", "GEV", "DELL", "PLTR",
           "MSFT", "AMZN", "GOOGL", "ORCL")
# A move is part of the week's story when it passes the series' threshold, or is the largest of its direction for at least a year.
RECORD_WEEKS = 52
MOVERS = 3
BATCH_ROWS = 100000  # the provider refuses a batch whose symbols x rows exceeds this
RATE_RETRIES = 2
RATE_WAIT_SECONDS = 61


class MarketUnavailable(RuntimeError):
    pass


def _get(path, params, env=None, timeout=30):
    env = os.environ if env is None else env
    base = (env.get(BASE_ENV) or "https://api.twelvedata.com").rstrip("/")
    query = dict(params)
    key = (env.get(KEY_ENV) or "").strip()
    if key:
        query["apikey"] = key
    request = urllib.request.Request(f"{base}/{path}?{urllib.parse.urlencode(query)}", headers={"User-Agent": "tech-phase-weekly/1"})
    # The key is shared with the site's price screens, whose per-minute credits can run out: wait for the next minute, at most twice.
    for attempt in range(RATE_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
            if isinstance(body, dict) and body.get("code") == 429 and attempt < RATE_RETRIES:
                sleep(RATE_WAIT_SECONDS)
                continue
            return body
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < RATE_RETRIES:
                sleep(RATE_WAIT_SECONDS)
                continue
            raise MarketUnavailable(f"twelve-data-{path}-http-{error.code}") from None
        except Exception as error:  # the message may carry the URL (and the key): never print it
            raise MarketUnavailable(f"twelve-data-{path}-{type(error).__name__}") from None
    raise MarketUnavailable(f"twelve-data-{path}-rate-limited")


def _series(body):
    if not isinstance(body, dict) or body.get("status") != "ok" or not isinstance(body.get("values"), list):
        return None
    rows = []
    for value in body["values"]:
        try:
            day = Date.fromisoformat(str(value["datetime"])[:10])
            close = Decimal(str(value["close"]))
        except (KeyError, TypeError, ValueError, ArithmeticError):
            continue
        if close > 0 and day.weekday() < 5:  # weekday closes only: gold and bitcoin also print on weekends
            rows.append((day, close))
    rows.sort()
    return rows or None


def fetch_closes(symbols, start, end, transport=None, env=None):
    """{symbol: [(date, close), ...] ascending} from start up to (not including) end. Batched; a symbol that does not answer is absent."""
    transport = transport or (lambda path, params: _get(path, params, env))
    size = max(1, min(5000, (Date.fromisoformat(end) - Date.fromisoformat(start)).days + 1))
    per = max(1, BATCH_ROWS // size)
    found = {}
    for at in range(0, len(symbols), per):
        group = list(symbols[at:at + per])
        body = transport("time_series", {"symbol": ",".join(group), "interval": "1day", "start_date": start, "end_date": end, "order": "asc",
                                         "outputsize": str(size)})
        if len(group) == 1:
            body = {group[0]: body}
        if not isinstance(body, dict):
            raise MarketUnavailable("twelve-data-shape")
        for symbol in group:
            rows = _series(body.get(symbol))
            if rows:
                found[symbol] = rows
    return found


def weekly(rows):
    """[(monday, last session date, last close)] per calendar week, ascending."""
    weeks = {}
    for day, close in rows:
        monday = day - timedelta(days=day.weekday())
        if monday not in weeks or day > weeks[monday][0]:
            weeks[monday] = (day, close)
    return [(monday, last, close) for monday, (last, close) in sorted(weeks.items())]


def pct(new, old):
    return ((new / old - 1) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def week_of(issue_date):
    """The trading week an issue is about: Monday..Friday of the last full week that ended before the issue date (a Saturday issue reads
    the Monday..Friday just before it)."""
    friday = issue_date - timedelta(days=(issue_date.weekday() - 4) % 7 or 7)
    return friday - timedelta(days=4), friday


def move(rows, monday, friday):
    """The week's move of one series, the closes it was computed from, and its historical context. None when the week has no close."""
    weeks = [week for week in weekly(rows) if week[1] <= friday]
    at = next((i for i, (start, _, _) in enumerate(weeks) if start == monday), None)
    if at is None or at == 0:
        return None
    changes = [None] + [pct(weeks[i][2], weeks[i - 1][2]) for i in range(1, len(weeks))]
    change = changes[at]
    result = {"monday": monday.isoformat(), "lastDate": weeks[at][1].isoformat(), "close": weeks[at][2], "previousDate": weeks[at - 1][1].isoformat(),
              "previousClose": weeks[at - 1][2], "pct": change, "since": None, "firstWeek": weeks[1][0].isoformat() if len(weeks) > 1 else None}
    if change == 0:
        return result
    # The most recent earlier week that moved as much or more in the same direction: this week is the largest since then.
    for i in range(at - 1, 0, -1):
        if (change < 0 and changes[i] <= change) or (change > 0 and changes[i] >= change):
            result["since"] = {"monday": weeks[i][0].isoformat(), "lastDate": weeks[i][1].isoformat(), "pct": changes[i], "weeks": at - i}
            break
    else:
        result["since"] = {"monday": None, "pct": None, "weeks": at - 1, "beyondData": True}
    return result


def money(value):
    return f"{value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):,f}"


def _md(iso):
    day = Date.fromisoformat(iso)
    return f"{day.month}/{day.day}"


def _ym(iso):
    day = Date.fromisoformat(iso)
    return f"{day.year}年{day.month}月"


def word(change):
    return "下落" if change < 0 else "上昇"


def record(item):
    """'2020年3月以来' when the move is the largest of its direction for at least RECORD_WEEKS weeks; else ''."""
    since = item.get("since") or {}
    if not since or (since.get("weeks") or 0) < RECORD_WEEKS:
        return ""
    if since.get("beyondData"):
        return f"{_ym(item['firstWeek'])}以降で最大" if item.get("firstWeek") else ""
    return f"{_ym(since['monday'])}以来"


def _measure(series, group, history, monday, friday):
    out = []
    for spec in series:
        got = move(history.get(spec["symbol"], []), monday, friday) if spec["symbol"] in history else None
        if got:
            got.update(symbol=spec["symbol"], name=spec["name"], label=spec["label"], group=group)
            got["record"] = record(got) if abs(got["pct"]) * 2 >= spec["notable"] else ""  # a small move is never a "record"
            got["notable"] = abs(got["pct"]) >= spec["notable"] or bool(got["record"])
            out.append(got)
    return out


def compute(issue_date, transport=None, env=None):
    """The week's market facts for an issue dated `issue_date` (a date). Raises MarketUnavailable when no index can be read."""
    monday, friday = week_of(issue_date)
    end = (friday + timedelta(days=1)).isoformat()  # the provider's end_date is exclusive
    history = fetch_closes([spec["symbol"] for spec in INDICES + ASSETS], HISTORY_START, end, transport, env)
    indices = _measure(INDICES, "index", history, monday, friday)
    if not indices:
        raise MarketUnavailable("no-index")
    assets = _measure(ASSETS, "asset", history, monday, friday)
    recent = fetch_closes(list(COVERED), (monday - timedelta(days=14)).isoformat(), end, transport, env)
    stocks = []
    for ticker in COVERED:
        got = move(recent.get(ticker, []), monday, friday) if ticker in recent else None
        if got:
            got.update(symbol=ticker)
            stocks.append(got)
    stocks.sort(key=lambda item: (item["pct"], item["symbol"]))
    losers = [item for item in stocks if item["pct"] < 0][:MOVERS]
    gainers = [item for item in reversed(stocks) if item["pct"] > 0][:MOVERS]
    return {"source": SOURCE, "week": {"monday": monday.isoformat(), "friday": friday.isoformat()}, "indices": indices, "assets": assets,
            "losers": losers, "gainers": gainers, "covered": len(stocks), "fallen": sum(1 for item in stocks if item["pct"] < 0),
            "missing": sorted(set(COVERED) - {item["symbol"] for item in stocks})}


def notable(market, groups=("index",)):
    return [item for item in (market or {}).get("indices", []) + (market or {}).get("assets", []) if item.get("notable") and item["group"] in groups]


def signed(value):
    return ("+" if value > 0 else "") + f"{value:f}"


def _line(item):
    line = (f"{item['label']}は週間で{abs(item['pct']):f}%{word(item['pct']) if item['pct'] else '横ばい'}。騰落率{signed(item['pct'])}%。{_md(item['previousDate'])}終値{money(item['previousClose'])}ドル→"
            f"{_md(item['lastDate'])}終値{money(item['close'])}ドル。")
    if item["record"]:
        since = item["since"]
        if since.get("beyondData"):
            line += f"週間の{word(item['pct'])}率として{item['record']}。"
        else:
            line += f"週間の{word(item['pct'])}率として{item['record']}の大きさ。比べた週は{since['monday']}の週で{signed(since['pct'])}%。"
    return line


def lines(market):
    """The facts as evidence lines the model may quote (and the checks read): every figure here was computed above from closing prices."""
    out = [f"今週({_md(market['week']['monday'])}〜{_md(market['week']['friday'])})の市場の動き。出典: {market['source']}。"]
    out += [_line(item) for item in market["indices"]]
    out += [_line(item) for item in market["assets"]]
    for title, group in (("今週大きく下げた銘柄", market["losers"]), ("今週大きく上げた銘柄", market["gainers"])):
        if group:
            out.append(title + ": " + "、".join(f"{item['symbol']}は{abs(item['pct']):f}%{word(item['pct'])}" for item in group) + "。騰落率は" + "、".join(f"{item['symbol']} {signed(item['pct'])}%" for item in group) + "。")
    if market.get("covered"):
        out.append(f"Tech Phase が追う{market['covered']}銘柄のうち{market['fallen']}銘柄が週間で下落。")
    return out


def verification(market):
    """One line per computed figure for the owner's memo: what was compared, from which closes, from which source."""
    out = []
    for item in market["indices"] + market["assets"]:
        text = f"{item['symbol']} 週間{signed(item['pct'])}% = {item['lastDate']}終値 {money(item['close'])} ÷ {item['previousDate']}終値 {money(item['previousClose'])} − 1"
        since = item.get("since") or {}
        if item["record"] and since.get("monday"):
            text += f"。これ以上の{word(item['pct'])}だった直近の週は{since['monday']}の週 {signed(since['pct'])}%、{since['weeks']}週前"
        elif item["record"]:
            text += f"。{item['firstWeek']}以降の全週で最大"
        out.append(f"{text}。出典: {market['source']}")
    movers = market["losers"] + market["gainers"]
    if movers:
        out.append(f"銘柄の週間騰落率({market['week']['friday']}終値 ÷ 前週末終値 − 1、対象{market['covered']}銘柄): "
                   + "、".join(f"{item['symbol']} {signed(item['pct'])}%" for item in movers) + f"。出典: {market['source']}")
    return out


def mentions(text, market):
    """Does the copy carry the week's notable index move: the name of a notable index together with its weekly change, and the year of
    its historical comparison when it has one? The figure itself is checked against the evidence elsewhere (factual_validation)."""
    if not isinstance(text, str):
        return False
    for item in notable(market):
        spec = next(s for s in INDICES if s["symbol"] == item["symbol"])
        figure = f"{abs(item['pct']):f}"
        if any(alias in text for alias in spec["aliases"]) and figure in text and (not item["record"] or item["record"].split("年")[0] + "年" in text):
            return True
    return False


def _first(market):
    items = notable(market)
    # One per name (SMH and SOXX are both 半導体株): the larger move.
    chosen = {}
    for item in items:
        if item["name"] not in chosen or abs(item["pct"]) > abs(chosen[item["name"]]["pct"]):
            chosen[item["name"]] = item
    return sorted(chosen.values(), key=lambda item: [s["symbol"] for s in INDICES].index(item["symbol"]))


def lead_sentence(market):
    """A plain lead built here from the computed facts, used when the model's lead leaves out a notable move."""
    items = _first(market)
    if not items:
        return ""
    first = items[0]
    text = f"今週は{first['name']}が週間で{abs(first['pct']):f}%{word(first['pct'])}しました。"
    if first["record"]:
        text = (f"今週は{first['name']}が週間で{abs(first['pct']):f}%{word(first['pct'])}し、"
                f"{first['record']}の大きな{'下げ' if first['pct'] < 0 else '上げ'}になりました。")
    others = "、".join(f"{other['name']}は{abs(other['pct']):f}%{word(other['pct'])}" for other in items[1:])
    if others:
        text += others + "です。"
    sold = [asset for asset in market.get("assets", []) if asset["pct"] < 0]
    if first["pct"] < 0 and sold:
        text += "、".join(f"{asset['name']}" for asset in sold) + "も売られました。"
    return text


def headline_sentence(market):
    items = _first(market)
    if not items:
        return ""
    first = items[0]
    tail = f"、{first['record']}の{'下げ' if first['pct'] < 0 else '上げ'}" if first["record"] else ""
    return f"{first['name']}が週間{abs(first['pct']):f}%{'安' if first['pct'] < 0 else '高'}{tail}"


def _card(item, label):
    return {"label": label[:40], "value": float(round(item["close"], 2)), "previous": float(round(item["previousClose"], 2)), "outlook": None, "unit": "ドル",
            "outlookUnit": "", "range": (f"{item['record']}の{word(item['pct'])}率" if item.get("record") else f"{_md(item['previousDate'])}→{_md(item['lastDate'])}の終値")[:80],
            "delta": "pct"}


def cards(market):
    """Number cards (value = this week's close, previous = last week's close; the page computes the % badge)."""
    return [_card(item, item["label"]) for item in market["indices"] + market["assets"]][:8]


def mover_cards(market):
    return [_card(item, item["symbol"]) for item in market["losers"] + market["gainers"]][:8]
