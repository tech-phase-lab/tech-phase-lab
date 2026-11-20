#!/usr/bin/env python3
"""Strengths and weaknesses audit (audit.mjs output, the `items` field): for every listed ticker the comparison offers, how many show no
strength, no weakness, or neither, by accounting basis, annual form, SIC group and data availability, and for each factor why it gave no item
(missing: no score; middle: scored between the item thresholds; item: gave a point).

    python3 -I summarize-items.py --cache DIR --before before.jsonl [--after after.jsonl] [--csv out.csv]
"""
import argparse, collections, csv, gzip, hashlib, json, os

ap = argparse.ArgumentParser()
ap.add_argument("--cache", required=True); ap.add_argument("--before", required=True); ap.add_argument("--after"); ap.add_argument("--csv")
args = ap.parse_args()
LISTED = {"NYSE", "Nasdaq", "CBOE", "Cboe", "TXSE"}

def cached(url):
    path = os.path.join(args.cache, hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if not os.path.exists(path): return None
    raw = gzip.decompress(open(path, "rb").read())
    if int.from_bytes(raw[:2], "big") != 200: return None
    try: return json.loads(raw[2:])
    except ValueError: return None

def load(path):
    rows = {}
    for line in open(path):
        if line.strip():
            r = json.loads(line)
            if r.get("exchange") in LISTED and r.get("cause") != "not-resolved": rows[r["ticker"]] = r
    return rows

SUBS = {}
def submissions(cik):
    if cik not in SUBS: SUBS[cik] = cached(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json") or {}
    return SUBS[cik]

def form(r):
    forms = (submissions(r["cik"]).get("filings") or {}).get("recent", {}).get("form", [])[:400]
    return next((f.replace("/A", "") for f in forms if f.split("/")[0] in ("10-K", "20-F", "40-F")), "なし")

def sic_group(r):
    s = str(submissions(r["cik"]).get("sic") or "")
    sic = int(s) if s.isdigit() else 0
    if 2830 <= sic <= 2836 or 8731 <= sic <= 8734: return "医薬・バイオ"
    for lo, hi, name in ((100, 1499, "農業・鉱業・エネルギー"), (1500, 1799, "建設"), (2000, 3999, "製造"), (4000, 4999, "運輸・通信・公益"),
                         (5000, 5999, "卸売・小売"), (6000, 6799, "金融・不動産"), (7000, 8999, "サービス")):
        if lo <= sic <= hi: return name
    return "不明"

def basis(r):
    b = r.get("basis")
    return {"us-gaap": "US GAAP", "ifrs-full": "IFRS"}.get(b, "提供元" if b else "なし")

def availability(r):
    a = r.get("availability")
    if a is None: return "要点あり（直近期間あり）"
    if "not been prepared" in a: return "要点未作成"
    if "latest quarterly" in a: return "直近期間を確認できない"
    if "quarterly data is unavailable" in a: return "四半期データなし"
    return "取得失敗"

def counts(r):
    items = r.get("items") or []
    return sum(i.startswith("S:") for i in items), sum(i.startswith("W:") for i in items)

# Which factor rule gave (or could not give) a point: the item ids each factor produces.
FACTOR_ITEMS = {"growth": ("revenue-growth", "revenue-qoq", "share-count", "relative-growth"), "profitability": ("operating-margin", "relative-profitability"),
                "cash": ("cash-generation", "relative-cash"), "financial": ("financial", "debt-cash", "negative-equity", "relative-financial"),
                "stability": ("stability", "margin-decline", "relative-stability"), "momentum": ("momentum", "relative-momentum"), "valuation": ("valuation",)}
def factor_state(r, factor, kind):
    if (r.get("scores") or {}).get(factor) is None: return "missing"
    ids = {i[2:] for i in (r.get("items") or []) if i[0] == kind}
    return "item" if ids & set(FACTOR_ITEMS[factor]) else "middle"

def table(rows, key, title):
    groups = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    for r in rows.values():
        g = groups[key(r)]
        g[0] += 1
        if r.get("availability") is not None: g[4] += 1; continue
        s, w = counts(r)
        g[1] += s == 0; g[2] += w == 0; g[3] += s == 0 and w == 0
    print(f"\n| {title} | 銘柄 | 長所0 | 短所0 | 両方0 | 要点なし（データ） |\n|---|---|---|---|---|---|")
    total = [0] * 5
    for name, g in sorted(groups.items(), key=lambda kv: -kv[1][0]):
        print(f"| {name} | " + " | ".join(f"{v:,}" for v in g) + " |"); total = [a + b for a, b in zip(total, g)]
    print("| 計 | " + " | ".join(f"{v:,}" for v in total) + " |")

def report(name, rows):
    print(f"\n## {name}: {len(rows):,} tickers")
    table(rows, basis, "会計基準"); table(rows, form, "年次の提出書類"); table(rows, sic_group, "業種"); table(rows, availability, "データ")
    ready = [r for r in rows.values() if r.get("availability") is None]
    for kind, label in (("S", "長所0"), ("W", "短所0")):
        zero = [r for r in ready if counts(r)[0 if kind == "S" else 1] == 0]
        print(f"\n{label} {len(zero):,}: factor states (missing / middle / item of the other kind)")
        for factor in FACTOR_ITEMS:
            c = collections.Counter(factor_state(r, factor, kind) for r in zero)
            print(f"  {factor:13} missing {c['missing']:5,}  middle {c['middle']:5,}")
    remaining(ready)
    return ready

# Why a company is still left without a strength or a weakness once the relative points exist (withRelativeItems, Nov 20). Valuation is
# never a relative point; the threshold point ids of each factor are FACTOR_ITEMS without the relative ones.
def remaining(ready):
    relative = collections.Counter(i.split(":")[0] for r in ready for i in (r.get("items") or []) if ":relative-" in i)
    print(f"\nrelative points: 長所 {relative['S']:,} / 短所 {relative['W']:,}")
    for kind, other, label in (("S", "W", "長所0"), ("W", "S", "短所0")):
        reasons = collections.Counter()
        for r in ready:
            if counts(r)[0 if kind == "S" else 1]: continue
            scored = [f for f, v in (r.get("scores") or {}).items() if v is not None and f != "valuation"]
            shown = {i[2:] for i in (r.get("items") or []) if i[0] == other}
            free = [f for f in scored if not shown & set(FACTOR_ITEMS[f])]
            reasons["採点項目が1つ以下" if len(scored) < 2 else "採点項目がすべて反対側の要点" if not free else "他の項目より低く（高く）ない・長所は5点未満か流動比率1倍未満"] += 1
        print(f"{label} {sum(reasons.values()):,}: " + ", ".join(f"{k} {v:,}" for k, v in reasons.most_common()))

before = load(args.before)
report("before", before)
if args.after:
    after = load(args.after)
    report("after", after)
    moved = collections.Counter()
    for t, r in after.items():
        b = before.get(t)
        if not b or b.get("availability") is not None or r.get("availability") is not None: continue
        for i, label in ((0, "長所"), (1, "短所")):
            x, y = counts(b)[i], counts(r)[i]
            if x == 0 and y > 0: moved[f"{label} 0→あり"] += 1
            if x > 0 and y == 0: moved[f"{label} あり→0"] += 1
    print("\nmoves:", dict(moved))
    if args.csv:
        with open(args.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["ticker", "cik", "name", "exchange", "basis", "annual_form", "sic_group", "data", "period_end", "period_months",
                        "items_before", "items_after", "strengths_after", "weaknesses_after"])
            for t in sorted(after):
                r = after[t]; b = before.get(t, {}); s, wk = counts(r)
                w.writerow([t, r.get("cik"), r.get("name"), r.get("exchange"), basis(r), form(r), sic_group(r), availability(r), r.get("periodEnd"),
                            r.get("periodMonths"), " ".join(b.get("items") or []), " ".join(r.get("items") or []), s, wk])
