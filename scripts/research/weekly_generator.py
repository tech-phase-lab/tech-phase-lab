"""週刊 Tech Phase PRO: the weekly auto-draft (owner, Nov 4).

Every Saturday morning (Japan time) one issue is drafted from what this service has already collected and checked during the
week: indicator results, company results, official release notes, the week's headlines, and the coming week's schedule.

The rules that keep it honest:
- The model writes sentences only. It never supplies a number: number cards and bar charts are built here from the checked
  figures, and the up/down badge is computed by the page from those figures.
- Every figure that appears in a sentence must appear in the evidence that sentence cites (the same check the PRO deep
  analysis uses). A part that fails is left out and the draft says so in the review memo.
- Whatever cannot be gathered is skipped and written down in the review memo; the rest is still made.
- The result is always a draft. It is published at once only if the owner has turned automatic publication on.

The body of a draft is reader-facing text only, in a fixed reading order: main takeaways -> earnings -> indicators -> the wider
market -> next week's schedule. Everything meant for the owner (failed checks, substituted sentences, missing material, topics
the model left out) goes into `notes` as tagged lines (see `note`) and is shown apart from the body, as a review memo."""

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

import brief_generator
import factual_validation
import weekly_issues

JST = ZoneInfo("Asia/Tokyo")
SCHEDULE_PATH = Path(__file__).with_name("release_schedule.json")
WINDOW_DAYS = 7
OUTLOOK_DAYS = 9
MAX_ATTEMPTS = 3
RETRY_SECONDS = 1800
LOCK = threading.Lock()

POLICY = """あなたは「リゼル」として、週刊 Tech Phase PRO の1号分を書きます。読者は米国株(特にハイテク・半導体)に投資する日本の個人投資家です。
渡された evidence(今週に集めて検証済みの資料)だけを材料にします。資料にないことは書きません。

【数字のルール】
- 数字は、資料に書かれた値だけを、資料の表記どおりに使います。記憶や推測で数字を書きません。計算もしません。
- 文章に数字を入れるときは、その文章が引いた evidenceIds の資料に、同じ数字と単位があるものだけにします。迷ったら数字を書かず、「大きく」「予想を下回り」のように言葉で書きます。
- 件数や順番の数字(「3つの山場」など)も書きません。
- 比べる数字は、numbers(数字カード)か chart(棒グラフ)に任せます。refs に、資料の evidenceId と factKey を指定してください。値と増減はこちらで入れます。
- 単位と通貨を、資料のとおりに必ず付けます。前年比か前期比かも、資料に書いてあれば明記します。

【何を書くか】
- その週に市場を動かした指標、ハイテク・半導体の決算、市場全体の流れから、重要なものを3〜5個に絞ります。資料が足りない週は少なくてかまいません。
- 部品(parts)は、その週に必要なものだけを選び、毎週同じ並びにしません。type は text / numbers / timeline / chart / highlight。
- 数字がない週は、text と timeline だけの短い号でかまいません。
- 次週の予定は別に作るので、parts には入れません。scheduleComments に、予定の id ごとに一言(数字なし)を書いてかまいません。
- takeaways: 今週の主な結論を、3つまで、1文ずつ書きます。各文に、根拠にした evidenceIds を必ず付けます(数字のルールは同じです)。
- 資料にあったのに載せなかった話題は、skipped に話題の名前だけを短く書きます(「〜を見送りました」「記載していません」のような、制作側の言い訳の文は書きません)。
- recentIssues は、直近の号の見出しとひとことです。同じ書き出し・同じ締め・同じ言い回しを避けてください。

【文体(リゼルの書き方)】
- 丁寧語(です・ます)を基本にします。語尾を揃えず、「〜はず。」「〜ください。」「〜ましょう。」「〜ですよ!」「〜でしょうか?」を混ぜます。
- 結論から書きます。1文目に、何が起きたかを言い切ります。
- 事実のあとに、見立てを一言入れます。見立ては「〜のかもしれません」「〜という見方です」のように断定を避けます。
- 流れは矢印で短くつなぎます(例: 6月は暴騰→7月は急落)。ときどき問いかけを入れます。
- 「正直、」「かなり」など、くだけた言葉を少し混ぜます。入れすぎません。括弧の補足は1号に1〜2か所まで。「笑」は使いません。
- 読む人の気持ちに寄り添う一文を、最後の部品に入れてかまいません。
- 1文は短く、1段落は2〜3文までにします。

【書かないこと】
- 買いや売りのすすめ、目標株価、「必ず上がる」といった断定。
- 「〜と言えるでしょう」「〜が重要です」のような決まり文句の連続。毎週同じ書き出しや同じ締め。
- 出典のない噂や、SNSでの未確認の話。

【形】
- headline: 号の見出し(短く、1文)。lead: 「今週のひとこと」(2〜3文)。どちらも必須です。
- text は heading と body。timeline は heading と points(when, event, comment, tone)。tone は上げ=up、下げ=down、どちらでもない=flat。
- highlight は、大きく出す1文だけ(text)。使うのは1つまで。
- 使わない項目は null か空の配列にしてください。"""


def _nullable(kind):
    return {"type": [kind, "null"]}


def response_schema():
    ids = {"type": "array", "items": {"type": "string"}}
    ref = {"type": "object", "additionalProperties": False, "required": ["evidenceId", "factKey"],
           "properties": {"evidenceId": {"type": "string"}, "factKey": {"type": "string"}}}
    point = {"type": "object", "additionalProperties": False, "required": ["when", "event", "comment", "tone", "evidenceIds"],
             "properties": {"when": {"type": "string"}, "event": {"type": "string"}, "comment": _nullable("string"),
                            "tone": {"type": "string", "enum": ["up", "down", "flat"]}, "evidenceIds": ids}}
    part = {"type": "object", "additionalProperties": False,
            "required": ["type", "heading", "body", "note", "text", "title", "evidenceIds", "refs", "points"],
            "properties": {"type": {"type": "string", "enum": ["text", "numbers", "timeline", "chart", "highlight"]},
                           "heading": _nullable("string"), "body": _nullable("string"), "note": _nullable("string"),
                           "text": _nullable("string"), "title": _nullable("string"), "evidenceIds": ids,
                           "refs": {"type": "array", "items": ref}, "points": {"type": "array", "items": point}}}
    comment = {"type": "object", "additionalProperties": False, "required": ["id", "comment"],
               "properties": {"id": {"type": "string"}, "comment": {"type": "string"}}}
    return {"type": "object", "additionalProperties": False, "required": ["headline", "lead", "takeaways", "parts", "scheduleComments", "skipped"],
            "properties": {"headline": {"type": "string"}, "lead": {"type": "string"},
                           "takeaways": {"type": "array", "maxItems": 3, "items": {"type": "object", "additionalProperties": False, "required": ["text", "evidenceIds"],
                                                                                 "properties": {"text": {"type": "string"}, "evidenceIds": ids}}},
                           "parts": {"type": "array", "maxItems": 8, "items": part},
                           "scheduleComments": {"type": "array", "items": comment},
                           "skipped": {"type": "array", "items": {"type": "string"}}}}


# ---- when --------------------------------------------------------------------

def week_key(now):
    year, week, _ = datetime.fromtimestamp(now, JST).isocalendar()
    return f"{year}-W{week:02d}"


def due(db, now):
    """Saturday, at or after the chosen hour (Japan time), once a week, and only when the owner turned it on."""
    state = weekly_issues.settings(db)
    if not state["generateEnabled"]:
        return False
    moment = datetime.fromtimestamp(now, JST)
    if moment.weekday() != 5 or moment.hour < state["generateHour"] or state["lastGenerated"] == week_key(now):
        return False
    row = db.execute("SELECT attempt_week,attempts,next_attempt_at FROM weekly_settings WHERE id=1").fetchone()
    if row["attempt_week"] == week_key(now) and (row["attempts"] >= MAX_ATTEMPTS or row["next_attempt_at"] > now):
        return False
    return True


# ---- what the week gave us ---------------------------------------------------

def _table(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _fact_line(fact):
    compared = fact.get("comparisons") or {}
    extra = ", ".join(f"{name} {compared[name]}" for name in ("forecast", "previous") if compared.get(name))
    return f"{fact.get('en', fact.get('key', ''))}: {fact.get('value', '')}" + (f" ({extra})" if extra else "")


def collect(db, now, news=()):
    """Evidence for the week: each entry has an id, a label, its checked facts, and the exact text the numbers are checked against."""
    start = datetime.fromtimestamp(now - WINDOW_DAYS * 86400, timezone.utc).isoformat()
    evidence = []

    def add(kind, label, url, quote, facts=(), text="", ticker=""):
        evidence.append({"id": f"E{len(evidence) + 1}", "kind": kind, "label": label, "url": url, "quote": quote,
                         "facts": list(facts), "text": text, "ticker": ticker})

    if _table(db, "market_result_publications"):
        for row in db.execute("SELECT payload FROM market_result_publications WHERE julianday(published_at)>=julianday(?) "
                              "ORDER BY julianday(published_at)", (start,)):
            try:
                item = json.loads(row["payload"])
                facts = [f for f in item["facts"] if isinstance(f, dict) and f.get("key") and f.get("value")]
                quote = item["titleEn"] + "\n" + "\n".join(_fact_line(f) for f in facts)
                add("earnings" if item["kind"] == "earnings" else "indicator", item["titleJa"], item["url"], quote, facts,
                    ticker=item.get("ticker", "") if item["kind"] == "earnings" else "")
            except (KeyError, TypeError, ValueError):
                continue
    if _table(db, "official_research_publications") and _table(db, "signal_events"):
        for row in db.execute("""SELECT p.payload, e.url FROM official_research_publications p JOIN signal_events e ON e.id=p.event_id
                                 WHERE julianday(p.public_at)>=julianday(?) ORDER BY julianday(p.public_at)""", (start,)):
            try:
                note = json.loads(row["payload"])
                ja = "\n".join([note["summary"]["ja"], *[f["ja"] for f in note["facts"]]])
                en = "\n".join([note["title"]["en"], note["summary"]["en"], *[f["en"] for f in note["facts"]]])
                add("note", note["title"]["ja"], row["url"], en, text=ja)
            except (KeyError, TypeError, ValueError):
                continue
    for item in news:
        title = str(item.get("title") or "").strip()
        url = str(item.get("url") or "")
        if title and url.startswith("https://"):
            add("news", title[:120], url, title, text=title)
    return evidence


def headlines(payload, now, limit=60):
    """The week's published headlines (title, https link, time) from the news the site already serves; result flashes are skipped (they are evidence already)."""
    if not isinstance(payload, dict):
        return []
    start = now - WINDOW_DAYS * 86400
    seen, rows = set(), []
    for name, value in payload.items():
        if name == "resultBriefs" or not isinstance(value, list):
            continue
        for item in value:
            if not isinstance(item, dict):
                continue
            title, url, at = item.get("title"), item.get("url"), item.get("publishedAt")
            try:
                moment = datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
            except ValueError:
                continue
            if isinstance(title, dict):
                title = title.get("ja") or title.get("en")
            if isinstance(title, str) and isinstance(url, str) and url.startswith("https://") and moment >= start and url not in seen:
                seen.add(url)
                rows.append((moment, {"title": title.strip(), "url": url}))
    rows.sort(key=lambda row: -row[0])
    return [row[1] for row in rows[:limit]]


def upcoming(now, today=None):
    """Next week's scheduled releases and earnings, from the schedule this service already keeps."""
    try:
        events = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))["events"]
    except (OSError, ValueError, KeyError):
        return []
    start = (today or datetime.fromtimestamp(now, JST).date()) + timedelta(days=1)
    end = start + timedelta(days=OUTLOOK_DAYS)
    rows = []
    for event in events:
        try:
            when = datetime.fromisoformat(event["at"].replace("Z", "+00:00")).astimezone(JST)
            if start <= when.date() < end:
                rows.append({"id": event["id"], "date": when.date().isoformat(), "name": event["titleJa"], "at": when})
        except (KeyError, ValueError, AttributeError):
            continue
    rows.sort(key=lambda row: (row["at"], row["id"]))
    return [{k: v for k, v in row.items() if k != "at"} for row in rows[:10]]


# ---- turning checked figures into card values (never by the model) -----------

CURRENCIES = {"$": "ドル", "US$": "ドル", "NT$": "台湾ドル", "€": "ユーロ", "£": "ポンド", "¥": "円"}
VALUE = re.compile(r"^\s*(?P<cur>US\$|NT\$|[$€£¥])?\s*(?P<sign>[+\-−])?\s*(?P<num>\d+(?:,\d{3})*(?:\.\d+)?)\s*(?P<unit>[KMBT%]?)\s*$")


def parse_value(value, key=""):
    """'$11.32B' -> (113.2, '億ドル'); '41.5%' -> (41.5, '%'); '29K' payrolls -> (29000, '人'). None when it cannot be done exactly."""
    match = VALUE.match(str(value))
    if not match:
        return None
    try:
        number = Decimal(match["num"].replace(",", ""))
    except InvalidOperation:
        return None
    if match["sign"] in ("-", "−"):
        number = -number
    currency, suffix = match["cur"], match["unit"]
    if suffix == "%":
        return float(number), "%"
    scale = {"K": Decimal(1000), "M": Decimal(10) ** 6, "B": Decimal(10) ** 9, "T": Decimal(10) ** 12}.get(suffix, Decimal(1))
    amount = number * scale
    if currency:
        word = CURRENCIES.get(currency)
        if not word:
            return None
        for limit, divisor, prefix in ((Decimal(10) ** 12, Decimal(10) ** 12, "兆"), (Decimal(10) ** 9, Decimal(10) ** 8, "億"),
                                      (Decimal(10) ** 6, Decimal(10) ** 6, "百万"), (Decimal(1000), Decimal(1000), "千")):
            if abs(amount) >= limit:
                return float((amount / divisor).normalize()), prefix + word
        return float(amount.normalize()), word
    if "payroll" in key:
        return float(amount.normalize()), "人"
    return float(amount.normalize()), ""


def _find_fact(evidence, ref):
    for item in evidence:
        if item["id"] == ref.get("evidenceId"):
            for fact in item["facts"]:
                if fact["key"] == ref.get("factKey"):
                    return item, fact
    return None, None


def build_card(evidence, ref):
    item, fact = _find_fact(evidence, ref)
    if not fact:
        return None
    parsed = parse_value(fact["value"].split(" ± ")[0], fact["key"])
    if not parsed:
        return None
    label = (item["ticker"] + " " if item["ticker"] else "") + fact.get("ja", fact["key"])
    card = {"label": label[:40], "value": parsed[0], "unit": parsed[1][:12], "outlook": None, "previous": None, "outlookUnit": "",
            "range": "", "delta": "pt" if parsed[1] == "%" else None}
    guidance = next((f for f in item["facts"] if f["key"] == "guidance-" + fact["key"]), None)
    if guidance:
        outlook = parse_value(guidance["value"].split(" ± ")[0], fact["key"])
        if outlook:
            card["outlook"], card["outlookUnit"] = outlook[0], outlook[1][:12]
            card["range"] = ("会社見通し " + guidance["value"])[:80]
    compared = fact.get("comparisons") or {}
    previous = parse_value(compared["previous"], fact["key"]) if compared.get("previous") else None
    if previous and previous[1] == parsed[1]:
        card["previous"] = previous[0]
    if compared.get("forecast") and not card["range"]:
        card["range"] = ("市場予想 " + str(compared["forecast"]))[:80]
    return card


COMPARE_NAMES = (("value", "結果"), ("forecast", "予想"), ("previous", "前回"))


def build_compare(evidence, ref):
    """One small bar group for the page (result / forecast / previous), from the checked figures only. None unless at least two of the three are
    in the same unit: a bar chart across units would be a made-up picture."""
    item, fact = _find_fact(evidence, ref)
    if not fact:
        return None
    compared = fact.get("comparisons") or {}
    raw = {"value": fact["value"].split(" ± ")[0], "forecast": compared.get("forecast"), "previous": compared.get("previous")}
    parsed = {name: parse_value(text, fact["key"]) for name, text in raw.items() if text}
    parsed = {name: got for name, got in parsed.items() if got}
    if "value" not in parsed:
        return None
    unit = parsed["value"][1]
    values = [{"name": label, "value": parsed[name][0]} for name, label in COMPARE_NAMES if name in parsed and parsed[name][1] == unit]
    if len(values) < 2:
        return None
    label = (item["ticker"] + " " if item["ticker"] else "") + fact.get("ja", fact["key"])
    return {"label": label[:40], "unit": unit[:12], "values": values}


# ---- checking what the model wrote -------------------------------------------

def _quote(evidence, ids):
    return "\n".join(item["quote"] for item in evidence if item["id"] in set(ids or ()))


def _check(text, quote):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty-copy")
    factual_validation.validate_numbers(text, quote)
    factual_validation.validate_semantics(text, quote)
    return text.strip()


def _optional(text, quote):
    return "" if text in (None, "") else _check(text, quote)


# ---- the review memo (owner-facing lines, kept apart from the body) -----------

ATTENTION, SUBSTITUTED, MISSING, OMITTED = "要確認", "定型文", "取得なし", "AI省略"
NOTE_ORDER = (ATTENTION, SUBSTITUTED, MISSING, OMITTED)
MAX_NOTES = 30
KIND_NAMES = {"text": "文章", "numbers": "数字カード", "timeline": "年表", "chart": "棒グラフ", "highlight": "大きな一文"}


def note(tag, text, code=""):
    """'【tag】text〔code〕'. The page splits these three pieces again (lib/research/weekly-format.ts, groupNotes); the code (a validator error
    name such as changed-negation) is for the owner's memo only and never reaches the body."""
    return f"【{tag}】{text.strip()[:200]}" + (f"〔{str(code)[:60]}〕" if code else "")


def finish_notes(notes):
    """Without repeats, the ones that need the owner's action first, and never more than the draft can keep."""
    unique = list(dict.fromkeys(notes))
    rank = lambda line: next((i for i, tag in enumerate(NOTE_ORDER) if line.startswith(f"【{tag}】")), len(NOTE_ORDER))
    return sorted(unique, key=rank)[:MAX_NOTES]


SECTIONS = ("summary", "earnings", "indicators", "market", "schedule")


def section_of(kind, ids, evidence):
    """Reading order is decided here, not by the model: what a part cites says which section it belongs to."""
    kinds = {item["kind"] for item in evidence if item["id"] in set(ids or ())}
    results = bool(kinds & {"earnings", "note"})
    indicators = "indicator" in kinds
    return "earnings" if results and not indicators else "indicators" if indicators and not results else "market"


NEUTRAL_HEADLINE = "今週の決算と経済指標のまとめ"
NEUTRAL_LEAD = "今週に結果が出た決算と経済指標を、数字と一緒にまとめました。"


def _framing(text, quote, fallback, lenient, notes, name):
    """The headline or the lead. A wrong NUMBER always stops the draft. Any other rejection (a negation the check reads differently, a name) stops it
    too, unless `lenient`: then a plain fixed sentence is used and the owner is told (owner, Nov 11: 'changed-negation' blocked the whole issue)."""
    try:
        return _check(text, quote)
    except ValueError as error:
        if not lenient or "number" in str(error) or str(error) == "empty-copy":
            raise
        notes.append(note(SUBSTITUTED, f"{name}は、AIの文が事実確認に通らなかったため、定型文にしています。", error))
        return fallback


def compose(model_output, evidence, schedule, lenient=False):
    """(headline, lead, parts, notes, used evidence ids). A part that fails any check is left out and noted."""
    everything = "\n".join(item["quote"] for item in evidence)
    notes = []
    headline = _framing(model_output.get("headline"), everything, NEUTRAL_HEADLINE, lenient, notes, "見出し")
    lead = _framing(model_output.get("lead"), everything, NEUTRAL_LEAD, lenient, notes, "導入文")
    parts, used = [], set()
    highlights = 0
    known = {item["id"] for item in evidence}
    takeaways = []
    for raw in (model_output.get("takeaways") or [])[:3]:
        text = raw.get("text") if isinstance(raw, dict) else None
        ids = [i for i in (raw.get("evidenceIds") if isinstance(raw, dict) else None) or [] if i in known]
        try:
            if not ids:
                raise ValueError("no-evidence")
            takeaways.append((_check(text, _quote(evidence, ids)), ids, section_of("text", ids, evidence)))
        except ValueError as error:
            notes.append(note(ATTENTION, "「今週の主な結論」の1文は、事実確認に通らなかったため載せていません。", error))
    for raw in model_output.get("parts") or []:
        kind = raw.get("type")
        name = raw.get("heading") or raw.get("text") or KIND_NAMES.get(kind, "部品")
        ids = [i for i in (raw.get("evidenceIds") or []) if i in {item["id"] for item in evidence}]
        quote = _quote(evidence, ids)
        try:
            if kind == "text":
                part = {"type": "text", "heading": _check(raw.get("heading"), quote), "body": _check(raw.get("body"), quote)}
            elif kind == "highlight":
                if highlights:
                    continue
                part = {"type": "highlight", "text": _check(raw.get("text"), quote or everything)}
                highlights += 1
            elif kind == "timeline":
                points = []
                for point in raw.get("points") or []:
                    point_ids = [i for i in (point.get("evidenceIds") or ids) if i]
                    point_quote = _quote(evidence, point_ids) or quote
                    try:
                        points.append({"when": _check(point.get("when"), point_quote), "event": _check(point.get("event"), point_quote),
                                       "comment": _optional(point.get("comment"), point_quote), "tone": point.get("tone") if point.get("tone") in ("up", "down", "flat") else "flat"})
                        ids += [i for i in point_ids if i not in ids]
                    except ValueError as error:
                        notes.append(note(ATTENTION, f"「{name}」の1項目は、事実確認に通らなかったため載せていません。", error))
                if not points:
                    raise ValueError("no-points")
                part = {"type": "timeline", "heading": _check(raw.get("heading"), quote), "points": points}
            elif kind == "numbers":
                cards = [card for card in (build_card(evidence, ref) for ref in raw.get("refs") or []) if card]
                if not cards:
                    raise ValueError("no-figures")
                ids += [ref["evidenceId"] for ref in raw.get("refs") or [] if ref.get("evidenceId") not in ids]
                part = {"type": "numbers", "heading": _check(raw.get("heading"), _quote(evidence, ids)), "cards": cards[:8],
                        "note": _optional(raw.get("note"), _quote(evidence, ids)),
                        "compare": [row for row in (build_compare(evidence, ref) for ref in raw.get("refs") or []) if row][:6]}
            elif kind == "chart":
                built = [(ref, build_card(evidence, ref)) for ref in raw.get("refs") or []]
                built = [(ref, card) for ref, card in built if card and card["value"] >= 0]
                units = {card["unit"] for _, card in built}
                if len(built) < 2 or len(units) != 1:
                    raise ValueError("chart-units")
                ids += [ref["evidenceId"] for ref, _ in built if ref.get("evidenceId") not in ids]
                part = {"type": "chart", "heading": _check(raw.get("heading"), _quote(evidence, ids)), "title": (raw.get("title") or "")[:60],
                        "unit": units.pop(), "bars": [{"label": card["label"][:30], "value": card["value"]} for _, card in built][:10],
                        "note": _optional(raw.get("note"), _quote(evidence, ids))}
            else:
                continue
        except (ValueError, TypeError, KeyError) as error:
            reason = "数字が資料と合わないため" if "number" in str(error) else "事実確認に通らなかった、または材料が足りなかったため"
            notes.append(note(ATTENTION, f"「{str(name)[:40]}」は、{reason}載せていません。", error))
            continue
        used.update(ids)
        part["section"] = section_of(kind, ids, evidence)
        parts.append(part)
    comments = {c.get("id"): c.get("comment") for c in model_output.get("scheduleComments") or [] if isinstance(c, dict)}
    items = []
    for event in schedule:
        comment = ""
        if comments.get(event["id"]):
            try:
                comment = _check(comments[event["id"]], event["name"])
            except ValueError:
                comment = ""
        items.append({"date": event["date"], "name": event["name"], "comment": comment[:200]})
    # Reading order: takeaways -> earnings -> indicators -> the wider market (a stable sort keeps the model's order inside each section);
    # a highlight sentence closes the body and sits under the section before it; next week's schedule is last.
    order = {name: at for at, name in enumerate(SECTIONS)}
    parts.sort(key=lambda part: (part["type"] == "highlight", order[part["section"]]))
    for part in parts:
        if part["type"] == "highlight":
            part["section"] = next((other["section"] for other in reversed(parts) if other["type"] != "highlight"), "market")
    if takeaways:
        used.update(i for _, ids, _ in takeaways for i in ids)
        parts.insert(0, {"type": "text", "heading": "今週の主な結論", "body": "\n".join("・" + text for text, _, _ in takeaways), "section": "summary",
                         "items": [{"text": text, "kind": kind} for text, _, kind in takeaways]})
    if items:
        parts.append({"type": "schedule", "heading": "次の週の予定", "items": items, "section": "schedule"})
    for line in (model_output.get("skipped") or [])[:5]:
        if isinstance(line, str) and line.strip():
            notes.append(note(OMITTED, "AIが載せなかった話題: " + line.strip()[:100]))
    return headline, lead, parts, notes, used


# ---- run ----------------------------------------------------------------------

def configuration(env=None):
    env = os.environ if env is None else env
    key = env.get("OPENAI_API_KEY", "").strip()
    model = (env.get("WEEKLY_MODEL") or env.get("RESEARCH_DEEP_MODEL") or "").strip()
    try:
        return brief_generator.configuration({"OPENAI_API_KEY": key, "RESEARCH_SUMMARY_MODEL": model})
    except brief_generator.GenerationUnavailable:
        return None


def generate(db, now, news=(), transport=None, env=None):
    """Make one draft. Returns the saved draft (weekly_issues.save_draft's item). Raises when nothing usable can be made."""
    config = configuration(env)
    if not config:
        raise RuntimeError("weekly-not-configured")
    key, model = config
    transport = transport or (lambda payload, api_key: brief_generator.request_response(payload, api_key, timeout=240))
    evidence = collect(db, now, news)
    schedule = upcoming(now)
    notes = []
    if not any(item["kind"] == "indicator" for item in evidence):
        notes.append(note(MISSING, "今週に結果が出た経済指標が、集まっていません。"))
    if not any(item["kind"] == "earnings" or item["kind"] == "note" for item in evidence):
        notes.append(note(MISSING, "今週の決算が、集まっていません。"))
    if not evidence:
        raise RuntimeError("weekly-no-evidence")
    material = [{"id": item["id"], "type": item["kind"], "label": item["label"],
                 "facts": [{"factKey": f["key"], "label": f.get("ja", f["key"]), "value": f["value"], "comparisons": f.get("comparisons") or {}} for f in item["facts"]],
                 "text": item["text"][:1500]} for item in evidence]
    # The last few issues, so the opening and the closing are not the same every week.
    recent = [{"headline": row["headline"], "lead": row["lead"]} for row in db.execute(
        "SELECT headline,lead FROM weekly_issues WHERE status='published' ORDER BY number DESC LIMIT 3")]
    payload = {"model": model, "store": False, "max_output_tokens": 8000, "instructions": POLICY,
               "input": json.dumps({"weekEnding": datetime.fromtimestamp(now, JST).date().isoformat(), "evidence": material, "recentIssues": recent,
                                    "schedule": [{"id": e["id"], "date": e["date"], "name": e["name"]} for e in schedule]}, ensure_ascii=False),
               "text": {"format": {"type": "json_schema", "name": "weekly_issue", "strict": True, "schema": response_schema()}}}
    response = transport(payload, key)
    if response.get("status") != "completed":
        raise RuntimeError("weekly-incomplete")
    output = json.loads(brief_generator.output_text(response))
    try:
        headline, lead, parts, more, used = compose(output, evidence, schedule)
    except ValueError as error:
        if "number" in str(error) or str(error) == "empty-copy":
            raise
        # The headline or the lead was rejected for something other than a number: ask once more, saying which rule it broke, and if the
        # second try fails too, use a plain fixed headline and lead rather than losing the whole issue.
        retry = dict(payload, input=json.dumps({**json.loads(payload["input"]), "repair": {
            "rejected": str(error), "rule": "見出しと導入文は、根拠の文にない否定（〜ない・〜せず・見送り など）や、根拠と逆の言い方を使わず、根拠にある事実だけを肯定の文で書く"}}, ensure_ascii=False))
        second = transport(retry, key)
        if second.get("status") != "completed":
            raise RuntimeError("weekly-incomplete")
        headline, lead, parts, more, used = compose(json.loads(brief_generator.output_text(second)), evidence, schedule, lenient=True)
    notes += more
    if not [part for part in parts if part["type"] != "schedule"]:
        raise RuntimeError("weekly-no-usable-part")
    sources, seen = [], set()
    for item in evidence:
        if item["id"] in used and item["url"] not in seen and item["url"].startswith("https://"):
            seen.add(item["url"])
            sources.append({"title": item["label"][:120], "url": item["url"]})
    result = weekly_issues.save_draft(db, {"date": datetime.fromtimestamp(now, JST).date().isoformat(), "headline": headline[:120], "lead": lead[:400],
                                           "parts": parts, "sources": sources[:20], "notes": finish_notes(notes), "auto": True})
    return result["item"]


def run_if_due(db_path, now=None, news=(), transport=None, env=None):
    """The poll loop calls this. Returns 'idle', 'done' or 'retry'. Never raises."""
    now = time.time() if now is None else now
    if not LOCK.acquire(blocking=False):
        return "idle"
    try:
        with weekly_issues.connect(db_path) as db:
            if not due(db, now):
                return "idle"
            week = week_key(now)
            row = db.execute("SELECT attempt_week,attempts FROM weekly_settings WHERE id=1").fetchone()
            attempts = (row["attempts"] if row["attempt_week"] == week else 0) + 1
            with db:
                db.execute("UPDATE weekly_settings SET attempt_week=?,attempts=?,next_attempt_at=? WHERE id=1", (week, attempts, now + RETRY_SECONDS))
            try:
                generate(db, now, news, transport, env)
            except Exception as error:
                print(f"weekly-generate-failed attempt={attempts} reason={type(error).__name__}:{str(error)[:60]}", flush=True)
                return "retry"
            with db:
                db.execute("UPDATE weekly_settings SET last_generated_week=? WHERE id=1", (week,))
            return "done"
    finally:
        LOCK.release()


# The owner's "make one now" (a trial, or a missed Saturday). It never marks the week as done.
LAST = {"at": 0.0, "ok": None, "error": ""}


def generate_now(db_path, now, news=(), transport=None, env=None):
    if not LOCK.acquire(blocking=False):
        return False
    try:
        LAST.update(at=now, ok=None, error="")
        with weekly_issues.connect(db_path) as db:
            generate(db, now, news, transport, env)
        LAST.update(ok=True)
        return True
    except Exception as error:
        LAST.update(ok=False, error=f"{type(error).__name__}:{str(error)[:60]}")
        print(f"weekly-generate-failed manual reason={LAST['error']}", flush=True)
        return False
    finally:
        LOCK.release()


def status():
    return {"running": LOCK.locked(), "configured": configuration() is not None, "lastAt": LAST["at"] or None, "lastOk": LAST["ok"], "lastError": LAST["error"]}
