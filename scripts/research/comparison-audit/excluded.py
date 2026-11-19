#!/usr/bin/env python3
"""The issuers whose listed tickers the Stock Comparison does not offer (owner, Nov 19: option A): blank-check companies (SPACs) and
exchange-traded funds and commodity trusts, which file no comparable revenue or profit. Built from the comparison audit (audit.mjs output)
and its SEC cache (submissions: SIC code, name); only certain cases are listed:

- SPAC: SIC 6770 (blank checks), and the comparison found no revenue for it;
- fund: SIC 6221 (commodity trusts) or no SIC, a fund-like name (ETF, Trust, Fund, ...), and no revenue (or no XBRL financial data at all).

Each entry keeps the issuer's name: a SPAC that completes its merger takes the operating company's name, and the comparison then offers it
again without a new list. Preferreds, warrants, units and rights are recognised from the ticker itself (lib/research/comparison-exclusions.ts).

    python3 -I excluded.py --cache DIR --audit after.jsonl --out lib/research/comparison-exclusions.json
"""
import argparse, gzip, hashlib, json, os, re

ap = argparse.ArgumentParser()
ap.add_argument("--cache", required=True); ap.add_argument("--audit", required=True); ap.add_argument("--out", required=True)
args = ap.parse_args()

def cached(url):
    path = os.path.join(args.cache, hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if not os.path.exists(path): return None, None
    raw = gzip.decompress(open(path, "rb").read())
    status = int.from_bytes(raw[:2], "big")
    if status != 200: return status, None
    try: return status, json.loads(raw[2:])
    except ValueError: return status, None

FUND_NAME = re.compile(r"\bETF\b|\bETFs\b|\bTrust\b|\bFund\b|\bShares\b|iShares|SPDR|ProShares|Grayscale|\bETN\b", re.I)
out = {"spac": {}, "fund": {}}
for line in open(args.audit):
    r = json.loads(line)
    if r.get("status") == "ready": continue   # the comparison found revenue: never excluded
    cik = int(r["cik"])
    _, sub = cached(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
    if not sub: continue
    sic = str(sub.get("sic") or "")
    name = r.get("name") or sub.get("name") or ""
    if sic == "6770": out["spac"][str(cik)] = name
    elif sic in ("6221", "") and FUND_NAME.search(name): out["fund"][str(cik)] = name
result = {"source": "scripts/research/comparison-audit/excluded.py", **{k: dict(sorted(v.items(), key=lambda x: int(x[0]))) for k, v in out.items()}}
json.dump(result, open(args.out, "w"), ensure_ascii=False, indent=0)
open(args.out, "a").write("\n")
print({k: len(v) for k, v in out.items()})
