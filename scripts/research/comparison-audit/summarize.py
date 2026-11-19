#!/usr/bin/env python3
"""Counts for the comparison audit (audit.mjs output): outcome per run, and for the tickers that cannot be scored ("正確に測れない"), the
kind of security or company and the reason, read from the audit's own SEC cache (submissions: SIC code, name).

    python3 -I summarize.py --cache DIR --before before.jsonl --after after.jsonl --csv audit.csv
"""
import argparse, collections, csv, gzip, hashlib, json, os, re

ap = argparse.ArgumentParser()
ap.add_argument("--cache", required=True); ap.add_argument("--before", required=True); ap.add_argument("--after", required=True); ap.add_argument("--csv")
args = ap.parse_args()

def cached(url):
    path = os.path.join(args.cache, hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if not os.path.exists(path): return None
    raw = gzip.decompress(open(path, "rb").read())
    if int.from_bytes(raw[:2], "big") != 200: return None
    try: return json.loads(raw[2:])
    except ValueError: return None

def load(path): return {r["ticker"]: r for r in (json.loads(l) for l in open(path) if l.strip())}
before, after = load(args.before), load(args.after)

def kind(r):
    """The group a ticker falls in (the same groups as the Nov 18 audit, plus the other securities of a listed company)."""
    sub = cached(f"https://data.sec.gov/submissions/CIK{int(r['cik']):010d}.json") or {}
    sic = int(sub.get("sic") or 0) if str(sub.get("sic") or "").isdigit() else 0
    name = (r.get("name") or sub.get("name") or "")
    ticker = r["ticker"]
    taxonomies = (r.get("diagnosis") or {}).get("taxonomies") or []
    ifrs = r.get("basis") == "ifrs-full" or "ifrs-full" in taxonomies
    if re.search(r"-(?:P[A-Z]?|WTA?|WS|UN|U|RI|R|W)$", ticker): return "優先株・ワラント・ユニット等"
    if sic == 6770 or re.search(r"\bacquisition (?:corp|co|company|inc)|\bmerger corp", name, re.I): return "SPAC"
    if sic in (6221, 6798) and re.search(r"trust|fund|etf|shares", name, re.I) or re.search(r"\b(?:etf|fund|trust)\b|ishares|proshares|spdr|invesco|grayscale", name, re.I) and sic in (0, 6221, 6200, 6726, 6799, 6211):
        return "ETF・投資信託・商品信託"
    if (2830 <= sic <= 2836 or 8731 <= sic <= 8734) and not ifrs: return "医薬・バイオ（売上なし等）"
    if 6000 <= sic <= 6799 and ifrs: return "金融（IFRS）"
    if 6000 <= sic <= 6799: return "金融（US GAAP）"
    if ifrs: return "その他（IFRS）"
    return "その他（US GAAP）"

def reason(r):
    if r.get("cause") == "not-resolved": return "比較対象外（SEC一覧にない）"
    if r.get("cause") == "error": return "読み込みエラー"
    d = r.get("diagnosis") or {}
    if d.get("facts") == "none": return "SECのXBRL財務データなし"
    if d.get("facts") in ("too-large",) or str(d.get("facts", "")).startswith("http"): return "SECデータ取得不可"
    w = " ".join(r.get("warnings") or [])
    if r.get("status") != "ready":
        return "売上の数値なし（標準タグなし・タグ矛盾）" if d.get("facts") == "ok" else "SECデータなし"
    if "quarterly filing" in w: return "最新の提出書類から数値を取得できない"
    if "earnings release" in w: return "決算発表後、報告書の反映待ち"
    if "could not be checked" in w: return "提出書類を確認できない"
    missing = r.get("missing") or {}
    if missing and all("unverified" in (v or "") for v in missing.values() if v): return "最新期間が古い"
    return "一部の項目のみ"

groups = collections.Counter(); reasons = collections.Counter(); outcome = {"before": collections.Counter(), "after": collections.Counter()}
moves = collections.Counter(); rows = []
for t, a in after.items():
    b = before.get(t, {})
    outcome["before"][b.get("outcome", "?")] += 1; outcome["after"][a["outcome"]] += 1
    moves[(b.get("outcome", "?"), a["outcome"])] += 1
    kb, ka = kind(b) if b else None, kind(a)
    if b.get("outcome") == "failing": groups[(kb, "before")] += 1
    if a["outcome"] == "failing": groups[(ka, "after")] += 1; reasons[(ka, reason(a))] += 1
    rows.append({"ticker": t, "cik": a["cik"], "name": a.get("name", ""), "exchange": a.get("exchange", ""), "before": b.get("outcome", ""), "before_scored": b.get("scored", ""),
        "after": a["outcome"], "after_scored": a.get("scored", ""), "group": ka, "basis": a.get("basis") or "", "currency": a.get("unit") or "", "period_end": a.get("periodEnd") or "",
        "period_months": a.get("periodMonths") or "", "price_listed": "yes" if a.get("price") else "", "reason_after": reason(a) if a["outcome"] == "failing" else "",
        "missing_after": ";".join(sorted((a.get("missing") or {}).keys()))})

print("outcome", {k: dict(v) for k, v in outcome.items()})
print("moves", {f"{a}->{b}": n for (a, b), n in sorted(moves.items()) if a != b})
for g in sorted({g for g, _ in groups}, key=str): print(f"group {g}: before {groups[(g, 'before')]} after {groups[(g, 'after')]}")
for (g, r), n in sorted(reasons.items(), key=lambda x: -x[1]): print(f"reason {g} / {r}: {n}")
if args.csv:
    with open(args.csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(sorted(rows, key=lambda r: r["ticker"]))
