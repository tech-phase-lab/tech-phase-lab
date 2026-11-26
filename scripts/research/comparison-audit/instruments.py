#!/usr/bin/env python3
"""Listings the Stock Comparison does not offer because they are not an operating company's share (owner, Nov 26: "全部直して"; the
coverage audit of Nov 26 found 254 such exchange tickers and 317 over the counter still offered, scored with the issuer's figures or with
nothing). Adds two things to lib/research/comparison-exclusions.json, keeping every other entry:

- "instrument": ticker -> kind, from Twelve Data's free reference list (GET /stocks, no credits) when its type for that ticker is
  Preferred Stock (also the baby bonds and CORTS/STRATS certificates it files there), Exchange-Traded Note, Warrant or Unit, or Trust (a
  royalty or grantor trust: the name must say Trust). A ticker the comparison's curated catalog or provider list names is never listed.
- "fund" and "spac" (CIK -> name, matched with the name as today): a registered fund (N-CSR, N-CSRS, NPORT-P or N-CEN filed and no
  10-K or 10-Q), a crypto or commodity grantor trust (SIC 6221 or 6199, or no SIC, with a fund-like name and no 10-Q) and a blank-check
  company (SIC 6770 with an acquisition-company name, or with no revenue in the SEC's company facts).

Business development companies (10-K filers that also file N-2 or N-54A), REITs, banks, land and royalty *companies* (TPL, LandBridge)
are kept: they are compared on metrics fit for them.

    python3 -I instruments.py --cache DIR --td-stocks stocks.json --directory company_tickers_exchange.json --out lib/research/comparison-exclusions.json
"""
import argparse, gzip, hashlib, json, os, re

ap = argparse.ArgumentParser()
ap.add_argument("--cache", required=True); ap.add_argument("--td-stocks", required=True); ap.add_argument("--directory", required=True)
ap.add_argument("--out", required=True); ap.add_argument("--keep", default="", help="comma-separated tickers never listed")
args = ap.parse_args()

def cached(url):
    path = os.path.join(args.cache, hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if not os.path.exists(path): return None
    raw = gzip.decompress(open(path, "rb").read())
    if int.from_bytes(raw[:2], "big") != 200: return None
    try: return json.loads(raw[2:])
    except ValueError: return None

KINDS = {"Preferred Stock": "preferred", "Exchange-Traded Note": "etn", "Warrant": "warrant", "Unit": "unit", "Trust": "trust"}
FUND_FORMS = re.compile(r"^(N-CSRS?|NPORT-P|N-CEN)$")
FUND_NAME = re.compile(r"\bETF\b|\bETFs\b|\bTrust\b|\bFund\b|iShares|SPDR|ProShares|Grayscale", re.I)
SPAC_NAME = re.compile(r"Acquisitions?(?: [IVX0-9]+)? (?:Corp|Co\b|Company|Inc|Ltd|Holdings)|\bSPAC\b|Merger Corp|Blank Check", re.I)
EXCHANGE = {"Nasdaq": "NASDAQ", "NYSE": "NYSE", "CBOE": "CBOE", "OTC": "OTC"}
provider_symbol = lambda t: re.sub(r"^([A-Z]{1,6})-([A-OQ-Z])$", r"\1.\2", t)

root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
keep = set(filter(None, args.keep.split(",")))
for name in ("providers.json",):
    for p in json.load(open(os.path.join(root, "lib/research", name))): keep.add(p.get("ticker"))
catalog = open(os.path.join(root, "lib/research/comparison-catalog.ts"), encoding="utf-8").read()
keep |= set(re.findall(r'ticker:\s*"([A-Z.\-]+)"', catalog))

td = {}
for row in json.load(open(args.td_stocks)).get("data", []):
    td.setdefault(str(row.get("symbol", "")).upper(), []).append(row)
directory = json.load(open(args.directory))
fields = directory["fields"]
rows = [dict(zip(fields, r)) for r in directory["data"]]
out = json.load(open(args.out))
instrument, fund, spac = {}, dict(out.get("fund", {})), dict(out.get("spac", {}))
seen_cik = {}
for r in rows:
    ticker, cik, name, exchange = r["ticker"], int(r["cik"]), r["name"], r.get("exchange") or ""
    if ticker in keep: continue
    listed = td.get(provider_symbol(ticker), [])
    same = [x for x in listed if x.get("exchange", "").upper().startswith(EXCHANGE.get(exchange, exchange.upper())[:4])] or listed
    types = {x.get("type") for x in same}
    kind = next((KINDS[t] for t in ("Exchange-Traded Note", "Warrant", "Unit", "Preferred Stock", "Trust") if t in types), None)
    if kind == "trust" and not re.search(r"\bTrust\b", name, re.I): kind = None
    if kind: instrument[ticker] = kind; continue
    if cik in seen_cik: continue
    sub = cached(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
    seen_cik[cik] = True
    if not sub: continue
    forms = set((sub.get("filings", {}).get("recent", {}) or {}).get("form", []))
    periodic = any(f.startswith(("10-K", "10-Q")) for f in forms)
    sic = str(sub.get("sic") or "")
    if any(FUND_FORMS.match(f) for f in forms) and not periodic: fund[str(cik)] = name; continue
    if (sic == "6221" and re.search(r"\bL\.?P\.?$", name)) or sic in ("6221", "6199", "") and FUND_NAME.search(name) and (sic or not any(f.startswith("10-Q") for f in forms)):
        fund[str(cik)] = name; continue
    # A blank-check company files the SIC code of the industry it hopes to buy into (BCCQ 3760, IPXG 7373): its name and its trust account
    # (AssetsHeldInTrust...) or the absence of any revenue line identify it.
    if SPAC_NAME.search(name):
        facts = cached(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json") or {}
        tags = facts.get("facts", {}).get("us-gaap") or {}
        revenue = any(t.startswith(("Revenue", "Revenues", "SalesRevenue")) for t in tags)
        if any(t.startswith("AssetsHeldInTrust") for t in tags) or not revenue: spac[str(cik)] = name; continue
    if sic == "6770":
        facts = cached(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json") or {}
        revenue = any(t.startswith(("Revenue", "Revenues", "SalesRevenue")) for t in (facts.get("facts", {}).get("us-gaap") or {}))
        if SPAC_NAME.search(name) or not revenue: spac[str(cik)] = name
out["fund"] = dict(sorted(fund.items(), key=lambda x: int(x[0])))
out["spac"] = dict(sorted(spac.items(), key=lambda x: int(x[0])))
out["instrument"] = dict(sorted(instrument.items()))
json.dump(out, open(args.out, "w"), ensure_ascii=False, indent=0)
open(args.out, "a").write("\n")
counts = {}
for k in instrument.values(): counts[k] = counts.get(k, 0) + 1
print({"instrument": counts, "fund": len(fund), "spac": len(spac)})
