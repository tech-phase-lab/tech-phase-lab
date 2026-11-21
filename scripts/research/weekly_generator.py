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
- Cost (owner, Nov 15): the model is called ONCE per weekly draft. The Saturday run tries once a week and never again that week, a request is
  sent once (no transport retry), and a sentence that fails a check is dropped or replaced here, never sent back to the model. Making another
  draft is the owner's own button. The fixed POLICY and schema lead every request (same text each week) so the provider's prompt cache applies,
  and a company that already has a PRO deep analysis this week is described to the model by that analysis, not by the long official note.

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
import llm_cost
import factual_validation
import weekly_issues
import weekly_market

JST = ZoneInfo("Asia/Tokyo")
NEW_YORK = ZoneInfo("America/New_York")
SCHEDULE_PATH = Path(__file__).with_name("release_schedule.json")
WINDOW_DAYS = 7
OUTLOOK_DAYS = 9
MAX_ATTEMPTS = 1  # owner, Nov 15 (cost): one automatic try per week; a failed Saturday is made again only by the owner's button
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

【今週の相場(いちばん大事)】
- type が market の資料は、実際の終値からプログラムが計算した今週の騰落率です(指数・金・銀・ビットコイン・追っている銘柄)。「〜以来の大きさ」「〜以降で最大」も、ここに書いてあるときだけ使えます。資料にない歴史比較(「コロナ以来」「過去最大」など)は書きません。
- marketNotable が true の週は、lead(今週のひとこと)の1文目を、その週の相場の動きにします。指数の名前(例: ナスダック100)、資料にある騰落率、資料にある「〜以来」をそのまま入れます。headline にも相場の動きを入れます。決算や指標の話は、そのあとです。
- その週の相場を動かした話(政策・要人の発言・大きな企業ニュース・資金の動き)は、type が news の資料から、市場への影響が大きい順に取り上げます。news の資料にない出来事は書きません。理由を断定せず、「〜と報じられました」「〜が重なりました」のように資料のとおりに書きます。
- 疑惑・指摘・調査の報道(空売り調査会社のレポート、当局の調査など)は、事実として書きません。「〇〇(空売り調査会社)がレポートで〜と指摘し、会社は〜と反論しました」のように、誰の主張か、会社の反応(資料にあれば)を必ず書きます。資料にない社名や反論は書きません。
- 輸出の承認や規制の話は、資料にある期間・数字・出どころ(例: 下院委員会が公開した記録)を添えます。出荷されたかどうかが資料で分からないときは、そう書きます。
- 相場が大きく動いた週に「決算が強かったので株価も上がりそう」のような、実際の値動きと逆の見立ては書きません。見立ては market の資料の数字と合わせます。

【何を書くか】
- その週に市場を動かした指標、ハイテク・半導体の決算、市場全体の流れから、重要なものを4〜6個に絞ります。資料が足りない週は少なくてかまいません。
- 資料はすべて今週(weekStart〜weekEnd)に起きたことです。それより前の決算や指標を、今週の話として書きません。
- 経済指標は、何の指標か(例: 米小売売上高)、前月比か前年比か、結果と予想・前回の比較が分かるように書きます。「結果1.1%」のような、何の数字か分からない書き方はしません。
- Tech Phase はハイテク・半導体株の投資サイトです。どの話題も、「ハイテク・半導体株にとって何を意味するか」まで書きます。事実(何が起きたか)→数字→見立て(ハイテク株への影響。「〜という見方です」「〜のかもしれません」)→次に見るもの、の順に深く掘ります。ただし資料にない理由や原因を事実として書きません。
- 決算は、売上・EPSなどの結果と、会社見通し・予想との差を、資料にある数字で書きます。強い部分と弱い部分の両方を挙げます。
- 資料に「計算」と書かれた行(例: 予想比、前回比、見通し比)は、プログラムが検証済みの数字から計算した値です。そのまま使ってかまいません。自分で計算はしません。
- 指標や予定は、名前を具体的に書きます(例: 米CPI(消費者物価指数)、米PPI(生産者物価指数)、米雇用統計)。「物価の発表」のような曖昧な書き方はしません。
- text と numbers の heading は、話題の名前ではなく、結論か問いかけにします(例: 「NBISの決算は、良い数字と悪い数字がはっきり分かれました」「TSMとASMLはどうか?」)。読者が見出しだけを追っても、その週の流れが分かるようにします。
- 同じテーマの2社(例: TSMとASML、MUとSNDK)は、並べて比べると読みやすくなります。同じ text の中で、それぞれの強い点・弱い点を1〜2文ずつ書きます。
- 部品(parts)は、その週に必要なものだけを選び、毎週同じ並びにしません。type は text / numbers / timeline / chart / highlight。
- 数字がない週は、text と timeline だけの短い号でかまいません。
- 次週の予定は別に作るので、parts には入れません。scheduleComments に、予定の id ごとに一言(数字なし)を書いてかまいません。何を見る発表で、ハイテク株にとってなぜ大事かを書きます。
- takeaways: 今週の主な結論を3つ、1文ずつ書きます。各文に、①資料にある具体的な数字(売上高、予想比など)を1つ以上入れ、②ハイテク・半導体株にとっての意味を見立てとして一言添えます(例: 「〜という見方です」)。各文に、根拠にした evidenceIds を必ず付けます(数字のルールは同じです)。来週の予定に触れる文は、type が schedule の資料のIDを付けます。
- type が analysis の資料は、決算資料を読み込んだ深掘り分析です(各文は数字の検査に通っています)。決算の話題では、売上やEPSの結果だけで終わらせず、analysis にある「何が伸びたか・何が弱いか・会社が何を見通しているか・次に何を確かめるか」まで書いてください。PRO会員向けなので、ニュースの見出しを言い換えただけの文は書きません。
- 資料にあったのに載せなかった話題は、skipped に話題の名前だけを短く書きます(「〜を見送りました」「記載していません」のような、制作側の言い訳の文は書きません)。
- recentIssues は、直近の号の見出しとひとことです。同じ書き出し・同じ締め・同じ言い回しを避けてください。

【表記】
- 通貨は「ドル」と書きます(「米ドル」とは書きません)。閉じ括弧のすぐあとに句読点を置きません。飾らない、平易な文で書きます。

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


PROMPT_CACHE_KEY = "techphase-weekly-issue"


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
    extra = ", ".join(f"{name} {compared[name]}" for name in ("forecast", "previous", "yearAgo") if compared.get(name))  # yearAgo: the same quarter a year before
    return f"{fact.get('en', fact.get('key', ''))}: {fact.get('value', '')}" + (f" ({extra})" if extra else "")


SIGN = lambda value: "+" if value > 0 else "-" if value < 0 else ""


def derived_lines(facts):
    """Differences the program computes from checked figures (result vs forecast, vs previous, vs company outlook), as lines of the evidence the
    model may quote. The model never calculates: it copies these. Only figures in the same unit are compared; a percentage-point gap for %."""
    lines = []
    for fact in facts:
        key = fact["key"]
        if key.startswith("guidance-"):
            continue
        got = parse_value(fact["value"].split(" ± ")[0], key)
        if not got:
            continue
        compared = fact.get("comparisons") or {}
        refs = [("予想比", compared.get("forecast")), ("前回比", compared.get("previous"))]
        guidance = next((f for f in facts if f["key"] == "guidance-" + key), None)
        if guidance:
            refs.append(("次期の会社見通しは今回の結果比", guidance["value"].split(" ± ")[0]))
        parts = []
        for name, text in refs:
            other = parse_value(text, key) if text else None
            if not other or other[1] != got[1]:
                continue
            if got[1] == "%":
                gap = Decimal(str(got[0])) - Decimal(str(other[0]))
                parts.append(f"{name.replace('比', '')}との差 {SIGN(gap)}{abs(gap).quantize(Decimal('0.01')).normalize():f}pt")
            elif other[0]:
                base, new = (got[0], other[0]) if name.startswith("次期") else (other[0], got[0])
                pct = (Decimal(str(new)) - Decimal(str(base))) / abs(Decimal(str(base))) * 100
                parts.append(f"{name} {SIGN(pct)}{abs(pct).quantize(Decimal('0.1'))}%")
        if parts:
            lines.append(f"計算 {fact.get('ja', key)}: " + "、".join(parts))
    return lines


# ---- the issue's week, and the date of each event (owner, Nov 21) ---------------------------------------------------------------------
# The Nov 21 draft carried SK hynix's results, released on Oct 28. Every source was picked by the time THIS service handled it (a flash's
# insertion time, a translation's public time, a deep analysis's publication time), and SK hynix's SEC 6-K copies of older releases were
# first stored on Nov 13 and Nov 16. An item now enters an issue only when the EVENT itself (the results release, the indicator release,
# the headline) falls inside the issue's week, and the earliest date known for it decides: the source's own publication date, a date the
# release states in its title or dateline, and, for company results, the results date in the release schedule this service keeps.

MONTH_NUMBERS = {name: i for i, name in enumerate(("january", "february", "march", "april", "may", "june", "july", "august", "september",
                                                   "october", "november", "december"), 1)}
TITLE_DATE = re.compile(r"\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(20\d\d)\b", re.I)
# A press-release dateline ("SEOUL, October 28, 2026 /PRNewswire/ --", "October 28, 2026 — SK hynix announced") or "announced on <date>".
DATELINE = re.compile(r"(?:(?:announced|reported|released)\s+(?:on\s+)?(?P<a>" + TITLE_DATE.pattern[2:-2] + r"))|(?:(?P<b>" + TITLE_DATE.pattern[2:-2]
                      + r")\s*(?:/[A-Za-z ]+/|[-–—]{1,2}|\(BUSINESS WIRE\)|\(GLOBE NEWSWIRE\)))", re.I)
RESULTS_WORDS = re.compile(r"results|earnings|quarter|決算|四半期|業績", re.I)
SCHEDULE_REACH_DAYS = 75  # a results date in the schedule further back than this is a different quarter, not this release


def issue_window(now):
    """(first, last) New York dates of the issue's week: from the Saturday before the trading week (a Monday release in Asia is still Sunday in
    New York) to its Friday. A Saturday issue covers the Monday..Friday just before it."""
    monday, friday = weekly_market.week_of(datetime.fromtimestamp(now, JST).date())
    return monday - timedelta(days=2), friday


def ny_date(value):
    """The New York calendar date of an ISO timestamp, or the date itself for a date-only value. None when it cannot be read."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if len(text) == 10:
            return datetime.fromisoformat(text).date()
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone(NEW_YORK).date()
    except ValueError:
        return None


def _date_of(match):
    word = match.group(1).lower().rstrip(".")
    try:
        month = MONTH_NUMBERS.get(word) or next(number for name, number in MONTH_NUMBERS.items() if name.startswith(word[:3]))
        return datetime(int(match.group(3)), month, int(match.group(2))).date()
    except (StopIteration, ValueError, TypeError):
        return None


def stated_dates(title, text=""):
    """Dates a release states for itself: any date in its title ("... Financial Results October 28, 2026"), and its dateline."""
    found = [_date_of(match) for match in TITLE_DATE.finditer(title or "")]
    for match in DATELINE.finditer((text or "")[:1500]):
        inner = TITLE_DATE.search(match.group("a") or match.group("b") or "")
        if inner:
            found.append(_date_of(inner))
    return [day for day in found if day]


def scheduled_results(ticker, around, events=None):
    """The latest results date of `ticker` in the release schedule on or before `around` (+1 day), within SCHEDULE_REACH_DAYS."""
    if not ticker or not around:
        return None
    if events is None:
        try:
            events = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))["events"]
        except (OSError, ValueError, KeyError):
            return None
    best = None
    for event in events:
        if event.get("kind") != "earnings" or event.get("ticker") != ticker:
            continue
        day = ny_date(event.get("at"))
        if day and around - timedelta(days=SCHEDULE_REACH_DAYS) <= day <= around + timedelta(days=1) and (best is None or day > best):
            best = day
    return best


def event_date(item, events=None):
    """(date, how it was found) of the event an evidence item reports: the earliest of its own date, the dates it states, and (results only)
    the scheduled results date. (None, 'unknown') when nothing gives a date."""
    candidates = []
    own = item.get("eventDate")
    if own:
        candidates.append((own, item.get("eventDateSource") or "source"))
    for day in stated_dates(item.get("label", "") + "\n" + item.get("title", ""), item.get("quote", "")):
        candidates.append((day, "stated"))
    results = item["kind"] in ("earnings", "analysis") or (item["kind"] == "note" and RESULTS_WORDS.search(item.get("label", "") + " " + item.get("quote", "")[:300]))
    if results and item.get("ticker"):
        around = min((day for day, _ in candidates), default=None)
        scheduled = scheduled_results(item["ticker"], around, events)
        if scheduled:
            candidates.append((scheduled, "schedule"))
    if not candidates:
        return None, "unknown"
    return min(candidates, key=lambda pair: pair[0])


def keep_in_window(evidence, window, notes, events=None):
    """Only items whose event falls inside the issue's week. What is left out is written in the owner's memo with its date."""
    first, last = window
    kept = []
    for item in evidence:
        day, how = event_date(item, events)
        if day is None:
            if item["kind"] != "news":
                notes.append(note(ATTENTION, f"日付が確かめられないため外しました: {item['label'][:60]}", "no-event-date"))
            continue
        if not first <= day <= last:
            if item["kind"] != "news":
                notes.append(note(ATTENTION, f"今週({first.month}/{first.day}〜{last.month}/{last.day})より前・後の出来事のため外しました: "
                                  f"{item['label'][:60]}(米国時間{day.isoformat()})", "outside-week-" + how))
            continue
        item["date"] = day.isoformat()
        item["dateFrom"] = how
        for key in ("eventDate", "eventDateSource"):
            item.pop(key, None)
        kept.append(item)
    for at, item in enumerate(kept, 1):
        item["id"] = f"E{at}"
    return kept


def collect(db, now, news=(), notes=None, events=None):
    """Evidence for the week: each entry has an id, a label, its checked facts, the exact text the numbers are checked against, and the date
    of the event it reports. Items whose event is outside the issue's week are left out (and written in `notes` when given)."""
    start = datetime.fromtimestamp(now - (WINDOW_DAYS + 3) * 86400, timezone.utc).isoformat()
    evidence = []

    def add(kind, label, url, quote, facts=(), text="", ticker="", when=None, how="source", title=""):
        evidence.append({"id": f"E{len(evidence) + 1}", "kind": kind, "label": label, "url": url, "quote": quote,
                         "facts": list(facts), "text": text, "ticker": ticker, "eventDate": ny_date(when), "eventDateSource": how, "title": title})

    if _table(db, "market_result_publications"):
        for row in db.execute("SELECT payload,published_at FROM market_result_publications WHERE julianday(published_at)>=julianday(?) "
                              "ORDER BY julianday(published_at)", (start,)):
            try:
                item = json.loads(row["payload"])
                facts = [f for f in item["facts"] if isinstance(f, dict) and f.get("key") and f.get("value")]
                quote = "\n".join([item["titleEn"], *[_fact_line(f) for f in facts], *derived_lines(facts)])
                kind = "earnings" if item["kind"] == "earnings" else "indicator"
                label = item["titleJa"] if kind == "earnings" else indicator_title(item)
                # The source post's own time (publishedAt), never the time this service stored it.
                add(kind, label, item["url"], quote, facts, ticker=item.get("ticker", "") if kind == "earnings" else "",
                    when=item.get("publishedAt"), how="source", title=item.get("titleEn", ""))
                if kind == "indicator":
                    evidence[-1]["period"] = item.get("period", "")
            except (KeyError, TypeError, ValueError):
                continue
    if _table(db, "official_research_publications") and _table(db, "signal_events"):
        columns = {column["name"] for column in db.execute("PRAGMA table_info(signal_events)")}
        pick = lambda name, fallback="NULL": f"e.{name}" if name in columns else fallback
        for row in db.execute(f"""SELECT p.payload, e.url, {pick('tickers_json', "'[]'")} AS tickers, {pick('published_at')} AS published_at,
                                  {pick('published_on')} AS published_on FROM official_research_publications p
                                  JOIN signal_events e ON e.id=p.event_id WHERE julianday(p.public_at)>=julianday(?) ORDER BY julianday(p.public_at)""", (start,)):
            try:
                note_ = json.loads(row["payload"])
                ja = "\n".join([note_["summary"]["ja"], *[f["ja"] for f in note_["facts"]]])
                en = "\n".join([note_["title"]["en"], note_["summary"]["en"], *[f["en"] for f in note_["facts"]]])
                tickers = [t for t in json.loads(row["tickers"] or "[]") if isinstance(t, str)]
                add("note", note_["title"]["ja"], row["url"], en, text=ja, ticker=tickers[0] if tickers else "",
                    when=row["published_at"] or row["published_on"], how="source", title=note_["title"]["en"])
            except (KeyError, TypeError, ValueError):
                continue
    # The week's PRO deep analyses (owner, Nov 15: "ありきたりな情報だと弱い"): each point already passed the figure checks against the release, so
    # its own wording is the quote a weekly sentence is checked against. They give the model what drove the quarter, not only the headline figures.
    # Its date is the release's: the source event's own date when it came from one, else the release time the analysis was made for.
    if _table(db, "deep_analyses"):
        columns = {column["name"] for column in db.execute("PRAGMA table_info(signal_events)")} if _table(db, "signal_events") else set()
        for row in db.execute("SELECT source_ref,kind,subject,payload,source_url,source_title,created_at FROM deep_analyses WHERE state='done' "
                              "AND published_at IS NOT NULL AND julianday(published_at)>=julianday(?) ORDER BY julianday(published_at)", (start,)):
            try:
                note_ = json.loads(row["payload"])
                pieces = [note_["headline"], *(note_.get("points") or []), *([note_["watch"]] if note_.get("watch") else [])]
                ja = "\n".join(p["ja"] for p in pieces if isinstance(p, dict) and p.get("ja"))
                en = "\n".join(p["en"] for p in pieces if isinstance(p, dict) and p.get("en"))
                if not ja:
                    continue
                when = row["created_at"]
                ref = str(row["source_ref"] or "").split(":")
                if len(ref) == 3 and ref[0] == "event" and ref[1].isdigit() and {"published_at", "published_on"} <= columns:
                    source = db.execute("SELECT published_at,published_on FROM signal_events WHERE id=?", (int(ref[1]),)).fetchone()
                    if source and (source["published_at"] or source["published_on"]):
                        when = min(filter(None, (ny_date(source["published_at"]), ny_date(source["published_on"]), ny_date(row["created_at"])))).isoformat()
                url = row["source_url"] or ""
                add("analysis", f"{row['subject']}: {note_['headline']['ja']}"[:120], url if url.startswith("https://") else "", en + "\n" + ja, text=ja,
                    ticker=row["subject"] if row["kind"] == "earnings" else "", when=when, how="release", title=row["source_title"] or "")
            except (KeyError, TypeError, ValueError):
                continue
    # Reuse what is already written (owner, Nov 15: cost): a company with a deep analysis this week is described to the model by that analysis.
    # Its official note stays evidence (the checks still read its exact words, and a sentence may still cite it), but its text is not sent again.
    for item in news:
        title = str(item.get("title") or "").strip()
        url = str(item.get("url") or "")
        if title and url.startswith("https://"):
            publisher = str(item.get("publisher") or "").strip()
            label = (f"{publisher}: " if publisher else "") + title
            english = str(item["titleEn"]) if item.get("titleEn") and item["titleEn"] != title else ""
            summary = str(item.get("summary") or "").strip()
            quote = "\n".join(part for part in (label, english, summary) if part)  # the publisher too: a sentence names who reported it
            add("news", label[:160], url, quote, text="\n".join(part for part in (title, summary) if part), when=item.get("publishedAt"), how="source")
            evidence[-1]["publisher"] = publisher
    evidence = keep_in_window(evidence, issue_window(now), notes if notes is not None else [], events)
    analysed = {item["ticker"] for item in evidence if item["kind"] == "analysis" and item["ticker"]}
    for item in evidence:
        if item["kind"] == "note" and item["ticker"] in analysed:
            item["covered"] = True
    return evidence


MONTH_IN_TITLE = re.compile(r"[（(][^）)]*\d{1,2}月[^）)]*[）)]")


def plain_title(name):
    """「米国PCE物価指数（10月）」→「米国PCE物価指数」 (owner, Nov 21: the reference month in parentheses is not part of a title)."""
    return re.sub(r"\s{2,}", " ", MONTH_IN_TITLE.sub("", str(name or ""))).strip()


INDICATOR_TITLES = (("cpi", "米CPI(消費者物価指数)"), ("ppi", "米PPI(生産者物価指数)"), ("pce", "米PCE物価指数"), ("nonfarm", "米雇用統計"),
                    ("unemployment", "米雇用統計"), ("hourly-earnings", "米雇用統計"))


def indicator_title(item):
    """What an indicator result is, in words: the indicator's name, never a bare 「結果 1.1%」."""
    keys = [str(fact.get("key", "")) for fact in item.get("facts") or []]
    for prefix, name in INDICATOR_TITLES:
        if any(key.replace("core-", "").startswith(prefix) for key in keys):
            return name
    head = str(item.get("titleJa") or "").split("：")[0]
    return plain_title(head) or "経済指標"


# ---- the week's market headlines, ranked by how much they could move the market (owner, Nov 21) ----------------------------------------

MAJOR_PUBLISHERS = re.compile(r"^(?:Reuters|Bloomberg|WSJ|Wall Street Journal|CNBC|Market ?Watch|Financial Times|Barron'?s|Associated Press|AP|Nikkei)\b", re.I)
WIRE_PUBLISHERS = re.compile(r"GlobeNewsWire|Globe Newswire|Business Wire|PRNewsWire|PR Newswire|Newsfile|ACCESSWIRE", re.I)
MARKET_WORDS = re.compile(r"\b(?:Nasdaq|S&P|Dow|Wall Street|stocks?|sell-?off|plunge|plunges|crash|rout|bear market|correction|wipeout|panic|"
                          r"turns red|bust|slide|tumble|sinks?)\b", re.I)
POLICY_WORDS = re.compile(r"\b(?:Trump|White House|tariffs?|export|ban|bans|sanctions?|China|Chinese|Commerce|Fed|Powell|Treasury|Bessent|"
                          r"regulators?|SEC|Congress|penaliz\w*|probe|investigation)\b", re.I)
TECH_WORDS = re.compile(r"\b(?:Nvidia|AMD|chips?|semiconductors?|AI|data cent(?:er|re)s?|Anthropic|OpenAI|TSMC|Broadcom|Micron|Intel)\b", re.I)
NOISE_WORDS = re.compile(r"\b(?:Announces?|Declares?|Appoints?|to Present|Investor Event|Dividend|Inducement|Annual General Meeting|"
                         r"Investigation Notice|Notifies Investors|Private Placement)\b", re.I)
# Owner, Nov 21: the week's export approvals (879,000 Nvidia and AMD chips for China) and a short seller's allegations against AMD moved the
# market and were missing. Approvals, licences, allegations, short-seller reports and regulators' probes are scored as market-moving, in
# English and in the Japanese headline the translator wrote.
ALLEGATION_WORDS = re.compile(r"\b(?:short[- ]?sell(?:er|ing)?|short report|alleg\w*|accus\w*|probe[sd]?|subpoena\w*|fraud|divert\w*|smuggl\w*|"
                              r"blacklist\w*|export controls?|licen[cs]es?|approv\w*)\b", re.I)
JAPANESE_IMPACT = re.compile(r"空売り|疑惑|横流し|密輸|調査|承認|輸出|規制|制裁|禁止|中国|トランプ|急落|暴落|最悪|売り")


def impact(title, publisher="", ticker="", title_ja=""):
    """A rough score of how much a headline could matter to the market: a major newsroom, market-wide words, policy and allegation words,
    chips and AI. Scored on the English headline and on its Japanese translation."""
    score = 0
    score += 3 if MAJOR_PUBLISHERS.search(publisher or "") else 0
    score -= 4 if WIRE_PUBLISHERS.search(publisher or "") else 0
    score += 4 if MARKET_WORDS.search(title) else 0
    score += 3 if POLICY_WORDS.search(title) else 0
    score += 3 if ALLEGATION_WORDS.search(title) else 0
    score += 2 if TECH_WORDS.search(title) else 0
    score += 2 if JAPANESE_IMPACT.search(title_ja or "") and not (MARKET_WORDS.search(title) or POLICY_WORDS.search(title) or ALLEGATION_WORDS.search(title)) else 0
    score += 2 if ticker == "MKT" else 0
    score += 1 if ticker in weekly_market.COVERED else 0
    score -= 4 if NOISE_WORDS.search(title) else 0
    return score


def wire_headlines(db, now, limit=24):
    """The week's company and market headlines from the news intake (company_wire: the Stock News API, Google News and Yahoo rows, already
    judged news by the translator), ranked by `impact`, one per story. Each keeps its publisher, its own time and its link."""
    if not _table(db, "company_wire"):
        return []
    first, last = issue_window(now)
    since = datetime.combine(first, datetime.min.time(), NEW_YORK).astimezone(timezone.utc).isoformat()
    rejected = _table(db, "company_wire_article_attempts")
    translated = _table(db, "company_wire_article_ja")
    columns = {column["name"] for column in db.execute("PRAGMA table_info(company_wire)")}
    if not {"title", "url", "published_at"} <= columns:
        return []
    article = "article" in columns
    publisher = "w.publisher" if "publisher" in columns else "NULL"
    summary = "w.summary_en" if "summary_en" in columns else "NULL"  # the provider's short summary: who said what, so a sentence can name them
    title_ja = ", j.title_ja" if translated and article else ", NULL AS title_ja"
    joins = (" LEFT JOIN company_wire_article_ja j ON j.article=w.article" if translated and article else "") + \
            (" LEFT JOIN company_wire_article_attempts a ON a.article=w.article" if rejected and article else "")
    judged = " AND COALESCE(a.reason,'') NOT IN ('not-news','off-topic')" if rejected and article else ""
    query = (f"SELECT w.ticker, w.title, w.url, {publisher} AS publisher, {summary} AS summary, w.published_at{title_ja} FROM company_wire w{joins}"
             f" WHERE w.published_at>=?{judged} ORDER BY w.published_at DESC LIMIT 3000")
    seen, rows = set(), []
    for row in db.execute(query, (since,)):
        title, url = str(row["title"] or "").strip(), str(row["url"] or "")
        day = ny_date(row["published_at"])
        if not title or not url.startswith("https://") or not day or not first <= day <= last:
            continue
        key = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()[:80]
        if key in seen:
            continue
        seen.add(key)
        score = impact(title, row["publisher"] or "", row["ticker"] or "", row["title_ja"] or "")
        if score >= 5:
            rows.append((score, row["published_at"], {"title": row["title_ja"] or title, "titleEn": title, "url": url, "publisher": row["publisher"] or "",
                                                      "publishedAt": row["published_at"], "ticker": row["ticker"] or "", "summary": str(row["summary"] or "")[:1200]}))
    rows.sort(key=lambda row: (row[0], str(row[1])), reverse=True)  # the largest impact first, the newest first within it
    return [row[2] for row in rows[:limit]]


def headlines(payload, now, limit=60):
    """The week's published headlines (title, https link, time) from the news the site already serves; result flashes are skipped (they are evidence already)."""
    if not isinstance(payload, dict):
        return []
    first, last = issue_window(now)
    seen, rows = set(), []
    for name, value in payload.items():
        if name == "resultBriefs" or not isinstance(value, list):
            continue
        for item in value:
            if not isinstance(item, dict):
                continue
            title, url, at = item.get("title") or item.get("titleJa") or item.get("titleEn"), item.get("url"), item.get("publishedAt")
            try:
                moment = datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
            except ValueError:
                continue
            if isinstance(title, dict):
                title = title.get("ja") or title.get("en")
            day = ny_date(at)
            if isinstance(title, str) and isinstance(url, str) and url.startswith("https://") and day and first <= day <= last and url not in seen:
                seen.add(url)
                rows.append((moment, {"title": title.strip(), "url": url, "publishedAt": str(at), "publisher": str(item.get("publisher") or item.get("source") or "")}))
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
                rows.append({"id": event["id"], "date": when.date().isoformat(), "name": plain_title(event["titleJa"]), "at": when})
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


def _plain_number(value):
    return f"{Decimal(str(value)).normalize():f}"


def ja_amount(text, key=""):
    """'$130.0B ± 3%' -> '1300億ドル±3%', '$12.5B ± $300M' -> '125億ドル±3億ドル' (owner, Nov 21: a card reads in Japanese units). Left as
    written when a part cannot be read exactly."""
    out = []
    for piece in str(text).split(" ± "):
        parsed = parse_value(piece, key)
        if not parsed:
            return str(text)
        number, unit = parsed
        if unit.startswith("百万"):  # 300百万ドル -> 3億ドル, 96百万ドル -> 9600万ドル
            number, unit = ((float(Decimal(str(number)) / 100), "億" + unit[2:]) if abs(number) >= 100
                            else (float(Decimal(str(number)) * 100), "万" + unit[2:]))
        out.append(_plain_number(number) + unit)
    return "±".join(out)


def build_card(evidence, ref):
    item, fact = _find_fact(evidence, ref)
    if not fact:
        return None
    parsed = parse_value(fact["value"].split(" ± ")[0], fact["key"])
    if not parsed:
        return None
    label = card_label(item, fact)
    card = {"label": label[:40], "value": parsed[0], "unit": parsed[1][:12], "outlook": None, "previous": None, "outlookUnit": "",
            "range": "", "delta": "pt" if parsed[1] == "%" else None}
    guidance = next((f for f in item["facts"] if f["key"] == "guidance-" + fact["key"]), None)
    if guidance:
        outlook = parse_value(guidance["value"].split(" ± ")[0], fact["key"])
        if outlook:
            card["outlook"], card["outlookUnit"] = outlook[0], outlook[1][:12]
            card["range"] = ("会社見通し " + ja_amount(guidance["value"], fact["key"]))[:80]
    compared = fact.get("comparisons") or {}
    previous = parse_value(compared["previous"], fact["key"]) if compared.get("previous") else None
    if previous and previous[1] == parsed[1]:
        card["previous"] = previous[0]
    if compared.get("forecast") and not card["range"]:
        card["range"] = ("市場予想 " + ja_amount(str(compared["forecast"]), fact["key"]))[:80]
    if item["kind"] == "indicator":
        # Owner, Nov 21: a card must say what it is. The basis and the comparisons in words; the reference month only here, small.
        said = [f"{name} {compared[key]}" for key, name in (("forecast", "予想"), ("previous", "前回")) if compared.get(key)]
        month = re.search(r"\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\b", str(item.get("period", "")).upper())
        if month:
            said.append(f"{MONTH_NUMBERS[month[1].lower()]}月分")
        card["range"] = "・".join(said)[:80]
    return card


BASIS = (("-yoy", "前年比"), ("-mom", "前月比"))


def card_label(item, fact):
    """'NVDA 売上高'; for an indicator its name and what the figure is ('米CPI(消費者物価指数) 前年比'), never a bare '結果'."""
    if item["kind"] != "indicator":
        return (item["ticker"] + " " if item["ticker"] else "") + fact.get("ja", fact["key"])
    name = item["label"]
    what = fact.get("ja", "")
    if what in ("", "結果", "Actual"):
        what = next((basis for suffix, basis in BASIS if fact["key"].endswith(suffix)), "")
    return (name + (" " + what if what and what not in name else "")).strip()


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
    label = card_label(item, fact)
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

ATTENTION, SUBSTITUTED, MISSING, OMITTED, VERIFIED = "要確認", "定型文", "取得なし", "AI省略", "検証"
NOTE_ORDER = (ATTENTION, SUBSTITUTED, MISSING, OMITTED, VERIFIED)
MAX_NOTES = 60
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


SECTIONS = ("summary", "market", "earnings", "indicators", "schedule")  # owner, Nov 21: the week's market story comes first


def section_of(kind, ids, evidence):
    """Reading order is decided here, not by the model: what a part cites says which section it belongs to."""
    kinds = {item["kind"] for item in evidence if item["id"] in set(ids or ())}
    results = bool(kinds & {"earnings", "note", "analysis"})
    indicators = "indicator" in kinds
    return "earnings" if results and not indicators else "indicators" if indicators and not results else "market"


NEUTRAL_HEADLINE = "今週の決算と経済指標のまとめ"
NEUTRAL_LEAD = "今週に結果が出た決算と経済指標を、数字と一緒にまとめました。"

# Owner, Nov 15: every draft carried the same fixed headline. The cause: the headline and the lead were checked against the whole week's
# evidence joined into one text, and the "the source is negated, so the copy must keep the negation" rule (factual_validation.validate_negation)
# fires for ANY Japanese copy as soon as one sentence anywhere in that text has a negation ("did not change its outlook", 「〜ません」) and some
# Japanese is present (next week's schedule always is). An affirmative, conclusion-style headline therefore failed with changed-negation almost
# every week, the retry asked for an affirmative sentence again, and the lenient pass fell back to NEUTRAL_HEADLINE. That rule is meant for a
# translation of one source; for a summary it now reads only the negated sentences the headline could be restating (see negated_scope).
# The number check is unchanged: it still reads all the evidence, and a figure the evidence does not have still stops the draft.
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|[。！？\n]+")
LATIN_NAME = re.compile(r"[A-Za-z][A-Za-z0-9&.'-]*[A-Za-z0-9]")


def _metrics(text):
    return {name for name, english, japanese in factual_validation.DIRECTION_METRICS if re.search(f"(?:{english})|(?:{japanese})", text, re.I)}


def _names(text):
    return {word.lower().rstrip(".") for word in LATIN_NAME.findall(text)} - factual_validation.NAME_ALLOWANCE


def negated_scope(text, evidence):
    """The negated sentences of the evidence that a headline or lead could be restating: about a company or indicator the copy names (its ticker,
    or a Latin-script name both share) AND whose negated clause is about a metric the copy also talks about (revenue, margin, outlook...). A headline that restates one of
    them without its negation is still rejected; a negation somewhere else in the week is not a reason to reject it."""
    named = _names(text)
    stated = _metrics(text)
    if not stated:
        return ""
    lines = []
    for item in evidence:
        # What the whole item is about: its ticker and the names in its title (an official note carries no ticker, but "MUの公式発表" does).
        about = ({(item.get("ticker") or "").lower()} | _names(item.get("label") or "")) & named
        for sentence in SENTENCE_SPLIT.split(item["quote"]):
            sentence = sentence.strip()
            if not sentence or not factual_validation.negated(sentence):
                continue
            if not (about or (_names(sentence) & named)):
                continue
            # The negated clause itself must be about a metric the copy states ("revenue rose, but it is not yet profitable" is not about revenue).
            for clause in re.split(factual_validation.CLAUSE_BOUNDARY, sentence, flags=re.I):
                if clause and factual_validation.negated(clause) and _metrics(clause) & stated:
                    lines.append(sentence)
                    break
    return "\n".join(lines)


def _check_framing(text, evidence, quote):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty-copy")
    factual_validation.validate_numbers(text, quote)
    # The computed market lines ("...は週間で-10.5%...下落") are read for the meaning of a headline only when it speaks about the market: a
    # headline about one company's growth is not contradicted by the week's falling prices (the figures above still read everything).
    speaks = any(alias in text for spec in weekly_market.INDICES + weekly_market.ASSETS for alias in spec["aliases"]) or re.search(r"相場|株価|市場|下落|上昇|売られ|買われ", text)
    meaning = quote if speaks else "\n".join(item["quote"] for item in evidence if item.get("kind") != "market")
    factual_validation.validate_semantics(text, meaning, negated_scope=negated_scope(text, evidence))
    return text.strip()


INDICATOR_NAMES = (("core-cpi", "米CPI"), ("cpi", "米CPI"), ("core-ppi", "米PPI"), ("ppi", "米PPI"), ("core-pce", "米PCE"), ("pce", "米PCE"),
                   ("nonfarm", "米雇用統計"), ("unemployment", "米雇用統計"), ("hourly-earnings", "米雇用統計"))


def _indicator_name(item):
    keys = [fact.get("key", "") for fact in item.get("facts") or []]
    for prefix, name in INDICATOR_NAMES:
        if any(key.startswith(prefix) for key in keys):
            return name
    name = re.sub(r"[（(][^）)]*[）)]", "", item["label"].split("：")[0]).strip()
    return name if name and len(name) <= 16 and not re.search(r"[0-9０-９]", name) else ""


def fallback_headline(evidence, date=""):
    """A plain headline built here from the checked evidence, used when the model's headline cannot be used: the issue date and the week's top one
    or two subjects (the company with the most material, the first indicator), never a figure. So even a fallback differs from week to week,
    e.g. 「11/14号：NBIS決算と米CPI」."""
    count = {}
    for item in evidence:
        ticker = item.get("ticker") or ""
        if item["kind"] in ("earnings", "analysis") and re.fullmatch(r"[A-Z][A-Z.]{0,5}", ticker):
            count[ticker] = count.get(ticker, 0) + 1
    companies = [f"{ticker}決算" for ticker in sorted(count, key=lambda t: -count[t])]
    indicators = list(dict.fromkeys(name for name in (_indicator_name(item) for item in evidence if item["kind"] == "indicator") if name))
    subjects = (companies[:1] + indicators[:1]) if companies and indicators else (companies or indicators)[:2]
    try:
        day = datetime.fromisoformat(date).date()
        prefix = f"{day.month}/{day.day}号："
    except (TypeError, ValueError):
        prefix = ""
    return prefix + ("と".join(subjects) if subjects else NEUTRAL_HEADLINE)


def _framing(text, evidence, quote, fallback, lenient, notes, name):
    """The headline or the lead. Any rejection raises, unless `lenient` (what generate uses: one model call, no second round): then the sentence is
    replaced by a plain one built here and the owner is told; a wrong NUMBER is never published either way (owner, Nov 11 and Nov 15)."""
    try:
        return _check_framing(text, evidence, quote)
    except ValueError as error:
        if not lenient:
            raise
        # Owner, Nov 15 (cost): the model is not asked again. A wrong NUMBER still never reaches readers: the sentence is replaced and the owner
        # is asked to look (要確認); any other rejection is a plain substitution (定型文).
        if "number" in str(error):
            notes.append(note(ATTENTION, f"{name}は、数字が資料と合わないため、AIの文を使わず定型文にしています。", error))
        else:
            notes.append(note(SUBSTITUTED, f"{name}は、AIの文が事実確認に通らなかったため、定型文にしています。", error))
        return fallback


FIGURE_KEYS = ("revenue", "eps", "net-revenue", "total-revenue", "data-center-revenue", "gross-margin", "operating-margin")


def auto_figures(evidence, limit=4):
    """Figures the issue always carries (owner, Nov 15: "図がないね"), built from the checked figures only, never from the model: for each company
    result of the week (up to `limit`), its main figures as cards with result / forecast / previous bars; then the indicators' results."""
    def refs_of(item):
        keys = [f["key"] for f in item["facts"]]
        chosen = [k for k in FIGURE_KEYS if k in keys] or [k for k in keys if not k.startswith("guidance-")][:2]
        return [{"evidenceId": item["id"], "factKey": k} for k in chosen[:3]]
    parts = []
    for kind, heading in (("earnings", "決算の数字"), ("indicator", "経済指標の数字")):
        refs = [ref for item in evidence if item["kind"] == kind and item["facts"] for ref in refs_of(item)]
        refs = refs[: limit * 2]
        cards = [card for card in (build_card(evidence, ref) for ref in refs) if card]
        if not cards:
            continue
        ids = list(dict.fromkeys(ref["evidenceId"] for ref in refs))
        parts.append({"type": "numbers", "heading": heading, "cards": cards[:8], "note": "",
                      "compare": [row for row in (build_compare(evidence, ref) for ref in refs) if row][:6],
                      "section": section_of("numbers", ids, evidence), "ids": ids})
    return parts


def market_framing(text, market, fallback, lenient, notes, name):
    """Owner, Nov 21: a week with a notable index move must say so in the headline and in 今週のひとこと, with the computed figure (and its
    historical comparison when there is one). A copy that leaves it out is rejected (strict) or replaced by a sentence built here from the
    computed facts (lenient), and the owner is told."""
    if not weekly_market.notable(market) or weekly_market.mentions(text, market):
        return text
    if not lenient:
        raise ValueError("omits-market-move")
    notes.append(note(SUBSTITUTED, f"{name}は、今週の大きな相場の動き(指数の騰落率)に触れていなかったため、計算した数字から作った文にしています。", "omits-market-move"))
    return fallback


def market_parts(market, evidence):
    """The week's market in figures, always built here from the computed closes (never by the model): the indices and other markets, then
    the covered stocks that moved most."""
    ids = [item["id"] for item in evidence if item["kind"] == "market"]
    if not market or not ids:
        return []
    parts = [{"type": "numbers", "heading": "今週の指数と金・銀・ビットコイン", "cards": weekly_market.cards(market), "note": f"出典: {market['source']}。前週末の終値と比べた騰落率です。",
              "section": "market", "ids": ids}]
    movers = weekly_market.mover_cards(market)
    if movers:
        parts.append({"type": "numbers", "heading": "今週大きく動いた銘柄", "cards": movers, "note": f"Tech Phase が追う{market['covered']}銘柄から。出典: {market['source']}。",
                      "section": "market", "ids": ids})
    return parts


def compose(model_output, evidence, schedule, lenient=False, date="", market=None):
    """(headline, lead, parts, notes, used evidence ids). A part that fails any check is left out and noted."""
    everything = "\n".join(item["quote"] for item in evidence)
    notes = []
    headline = _framing(model_output.get("headline"), evidence, everything, fallback_headline(evidence, date), lenient, notes, "見出し")
    lead = _framing(model_output.get("lead"), evidence, everything, NEUTRAL_LEAD, lenient, notes, "導入文")
    if market:
        headline = market_framing(headline, market, weekly_market.headline_sentence(market), lenient, notes, "見出し")
        lead = market_framing(lead, market, weekly_market.lead_sentence(market), lenient, notes, "導入文")
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
                # The companies a text is about (from the results it cites): the page shows their photos side by side (owner, Nov 15).
                tickers = list(dict.fromkeys(item["ticker"] for item in evidence if item["id"] in ids and item["kind"] in ("earnings", "analysis")
                                             and re.fullmatch(r"[A-Z]{1,6}", item.get("ticker") or "")))
                if tickers:
                    part["tickers"] = tickers[:2]
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
    # Figures are never left to the model's choice: when it chose none for a section, the checked figures are added as cards and bars.
    shown = {part["section"] for part in parts if part["type"] in ("numbers", "chart")}
    for part in auto_figures(evidence):
        ids = part.pop("ids")
        if part["section"] not in shown:
            used.update(ids)
            parts.append(part)
    for part in reversed(market_parts(market, evidence)):
        used.update(part.pop("ids"))
        part["fixed"] = True
        parts.insert(0, part)
    comments ={c.get("id"): c.get("comment") for c in model_output.get("scheduleComments") or [] if isinstance(c, dict)}
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
    # An issue holds at most weekly_issues.MAX_PARTS parts: the model's last parts give way first, never the market figures, the takeaways
    # or the schedule.
    while len(parts) > weekly_issues.MAX_PARTS:
        drop = next(i for i in range(len(parts) - 1, -1, -1) if not parts[i].get("fixed") and parts[i]["section"] not in ("summary", "schedule"))
        notes.append(note(OMITTED, f"部品の数の上限のため外しました: {str(parts[drop].get('heading') or parts[drop].get('text') or '')[:60]}"))
        parts.pop(drop)
    for part in parts:
        part.pop("fixed", None)
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


def generate(db, now, news=(), transport=None, env=None, market=None):
    """Make one draft. Returns the saved draft (weekly_issues.save_draft's item). Raises when nothing usable can be made."""
    config = configuration(env)
    if not config:
        raise RuntimeError("weekly-not-configured")
    key, model = config
    # One request, never repeated by the transport either (a timed-out request may still be billed).
    transport = transport or (lambda payload, api_key: brief_generator.request_response(payload, api_key, timeout=240, attempts=1))
    week = prepare(db, now, news, env, market)
    payload = {"model": model, **week["request"]}
    response = transport(payload, key)
    llm_cost.record(db, "weekly", "weekly:%s" % datetime.fromtimestamp(now, JST).date().isoformat(), model, response, now=now)
    if response.get("status") != "completed":
        raise RuntimeError("weekly-incomplete")
    output = json.loads(brief_generator.output_text(response))
    # The only model call of this draft. What fails a check is dropped (a part) or replaced (the headline, the lead) and noted for the owner.
    return weekly_issues.save_draft(db, {**finish(week, output), "auto": True})["item"]


def market_facts(issue_date, env=None):
    """The week's computed market facts (weekly_market.compute). Raises RuntimeError('weekly-no-market-data') when the prices cannot be read:
    an issue that cannot see the week's market is not made (owner, Nov 21), and no model call is spent on it."""
    try:
        return weekly_market.compute(issue_date, env=env)
    except weekly_market.MarketUnavailable as error:
        raise RuntimeError(f"weekly-no-market-data:{error}") from None


def prepare(db, now, news=(), env=None, market=None):
    """Everything before the model call: the week's evidence (dated, inside the issue's week), the computed market facts, next week's schedule,
    the owner's notes so far, and the request body (without the model name)."""
    issue_date = datetime.fromtimestamp(now, JST).date()
    first, last = issue_window(now)
    notes = []
    market = market if market is not None else market_facts(issue_date, env)
    # The week's headlines from the news intake, ranked by market impact, next to the ones the site serves.
    wire = wire_headlines(db, now)
    evidence = collect(db, now, list(news) + wire, notes)
    gathered = len(evidence)
    quote = "\n".join(weekly_market.lines(market))
    evidence.append({"id": f"E{len(evidence) + 1}", "kind": "market", "label": f"今週の市場の動き({market['source']})", "url": "", "quote": quote,
                     "facts": [], "text": quote, "ticker": "", "date": market["week"]["friday"]})
    schedule = upcoming(now)
    # Next week's schedule is evidence too, so a sentence may name the coming releases (米CPI, 米PPI, ...) and still be checked against the names.
    for event in schedule:
        quote = f"{event['name']} ({event['date']})"
        evidence.append({"id": f"E{len(evidence) + 1}", "kind": "schedule", "label": event["name"], "url": "", "quote": quote, "facts": [], "text": quote, "ticker": ""})
    if not any(item["kind"] == "indicator" for item in evidence):
        notes.append(note(MISSING, "今週に発表された経済指標はありません。載せるのは今週が発表日の指標だけです。"))
    if not any(item["kind"] == "earnings" or item["kind"] == "note" for item in evidence):
        notes.append(note(MISSING, "今週の決算が、集まっていません。"))
    if not any(item["kind"] == "news" for item in evidence):
        notes.append(note(MISSING, "今週のニュースの見出しが、集まっていません。"))
    if not gathered:
        raise RuntimeError("weekly-no-evidence")
    notes += [note(VERIFIED, line) for line in weekly_market.verification(market)]
    material = [{"id": item["id"], "type": item["kind"], "label": item["label"], "date": item.get("date", ""),
                 "facts": [{"factKey": f["key"], "label": card_label(item, f) if item["kind"] == "indicator" else f.get("ja", f["key"]), "value": f["value"],
                            "comparisons": f.get("comparisons") or {}} for f in item["facts"]],
                 "calculated": derived_lines(item["facts"]), "text": "" if item.get("covered") else item["text"][:1500],
                 **({"seeAnalysisOf": item["ticker"]} if item.get("covered") else {})} for item in evidence]
    # The last few issues, so the opening and the closing are not the same every week.
    recent = [{"headline": row["headline"], "lead": row["lead"]} for row in db.execute(
        "SELECT headline,lead FROM weekly_issues WHERE status='published' ORDER BY number DESC LIMIT 3")]
    # The fixed parts first and identical every week (instructions, then the output schema), the week's material last, so the provider's
    # prompt cache can reuse the shared prefix (owner, Nov 15: cost). The cache key groups the weekly requests together.
    request = {"instructions": POLICY,
               "text": {"format": {"type": "json_schema", "name": "weekly_issue", "strict": True, "schema": response_schema()}},
               "prompt_cache_key": PROMPT_CACHE_KEY, "store": False, "max_output_tokens": 8000,
               "input": json.dumps({"weekEnding": issue_date.isoformat(), "weekStart": first.isoformat(), "weekEnd": last.isoformat(),
                                    "marketNotable": bool(weekly_market.notable(market)),
                                    "schedule": [{"id": e["id"], "date": e["date"], "name": e["name"]} for e in schedule],
                                    "recentIssues": recent, "evidence": material}, ensure_ascii=False)}
    return {"date": issue_date.isoformat(), "evidence": evidence, "schedule": schedule, "notes": notes, "market": market, "request": request}


def finish(week, output):
    """The draft (date, headline, lead, parts, sources, notes) from the model's answer, after every check."""
    evidence = week["evidence"]
    headline, lead, parts, more, used = compose(output, evidence, week["schedule"], lenient=True, date=week["date"], market=week["market"])
    if not [part for part in parts if part["type"] != "schedule"]:
        raise RuntimeError("weekly-no-usable-part")
    sources, seen = [], set()
    for item in evidence:
        if item["id"] in used and item["url"] not in seen and item["url"].startswith("https://"):
            seen.add(item["url"])
            sources.append({"title": (item["label"] + (f"({item['date']})" if item.get("date") else ""))[:180], "url": item["url"]})
    return {"date": week["date"], "headline": headline[:120], "lead": lead[:400], "parts": parts, "sources": sources[:30],
            "notes": finish_notes(week["notes"] + more)}


def run_if_due(db_path, now=None, news=(), transport=None, env=None):
    """The poll loop calls this. Returns 'idle', 'done' or 'failed'. Never raises. One try per week (MAX_ATTEMPTS): a failure is not retried, and
    no spending cap ever delays or skips the Saturday run (owner, Nov 15)."""
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
                return "failed"
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
