#!/usr/bin/env python3
"""The issuers whose listed tickers the Stock Comparison does not offer (owner, Nov 19: option A): blank-check companies (SPACs) and
exchange-traded funds and commodity trusts, which file no comparable revenue or profit. Built from the comparison audit (audit.mjs output)
and its SEC cache (submissions: SIC code, name); only certain cases are listed:

- SPAC: SIC 6770 (blank checks), and the comparison found no revenue for it;
- fund: SIC 6221 (commodity trusts), 6199 (crypto funds such as FETH, ETHW) or no SIC, a fund-like name (ETF, Trust, Fund, ...), and no revenue (or no XBRL financial data at all);
- fund, even with revenue: SIC 6221 or 6199 and a fund-like name. A crypto staking, commodity or currency fund books its staking rewards,
  interest or trading gains as revenue (SOLC, SUIS, IAU, USO, ProShares Trust II), which is no business to compare (Nov 19). An operating
  company in those codes (Evernorth, Antalpha, AI Financial, Solana Co) has no fund-like name and stays.

Each entry keeps the issuer's name: a SPAC that completes its merger takes the operating company's name, and the comparison then offers it
again without a new list. Preferreds, warrants, units and rights are recognised from the ticker itself (lib/research/comparison-exclusions.ts).

- etn (owner, Nov 20): the banks that issue exchange-traded notes (ETNs), with their own share tickers. The SEC's ticker list files an ETN
  (VXX, BDCZ, DGZ, FNGU) under the issuing bank's CIK, so the comparison scored it with the bank's own figures. Every other ticker under
  such a CIK is a note and is not offered; the bank's own shares (DB, BMO, JPM, GS) and its parent's (UBS, BCS: another CIK) stay.
  ETN_ISSUERS is checked against the SEC's ticker list (company_tickers_exchange.json from --cache, or --directory): each own share must
  be there under the issuer's CIK. Other banks and brokers with an exchange-listed ticker that is neither their share nor a preferred
  are printed for review (a new ETN issuer is added to ETN_ISSUERS by hand, after reading its filings).

    python3 -I excluded.py --cache DIR --audit after.jsonl --out lib/research/comparison-exclusions.json [--merge] [--directory FILE]

--merge keeps the entries already in --out (an audit run after the exclusions answers an excluded ticker as unknown, without its figures).
"""
import argparse, gzip, hashlib, json, os, re

ap = argparse.ArgumentParser()
ap.add_argument("--cache", required=True); ap.add_argument("--audit", required=True); ap.add_argument("--out", required=True); ap.add_argument("--merge", action="store_true")
ap.add_argument("--directory", help="company_tickers_exchange.json (default: the SEC copy in --cache)")
args = ap.parse_args()

def cached(url):
    path = os.path.join(args.cache, hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if not os.path.exists(path): return None, None
    raw = gzip.decompress(open(path, "rb").read())
    status = int.from_bytes(raw[:2], "big")
    if status != 200: return status, None
    try: return status, json.loads(raw[2:])
    except ValueError: return status, None

# The ETN issuers: SEC CIK -> (name as the SEC lists it, own share tickers). Checked Nov 20 against the issuers' filings: UBS AG's ETRACS
# (BDCZ, MLPB, ...), Barclays Bank's iPath (VXX, VXZ, DJP, GRN; BWVTF, JJETF over the counter), Credit Suisse's X-Links (GLDI, SLVO, USOI),
# Deutsche Bank's DB ETNs (DGP, DGZ, DZZ; OLOXF and the others over the counter: 424B3 of Apr 2019), Bank of Montreal's MicroSectors and MAX
# (FNGU, FNGD, BNKU, ...), JPMorgan's Alerian MLP and Inverse VIX ETNs (AMJB, VYLD: 10-K 2025 exhibit 4.6) and Goldman's GS Connect ETN
# (GSC, now GSCE over the counter). Morgan Stanley and Citigroup have no ETN under them today (their tickers are their shares and
# preferreds). The finance subsidiaries that issue the US banks' notes are listed too, for a note the SEC files under one later.
ETN_ISSUERS = {
    1114446: ("UBS AG", []),                          # UBS Group AG (UBS) is CIK 1610520
    312070: ("BARCLAYS BANK PLC", []),                # Barclays PLC (BCS) is CIK 312069
    1053092: ("CREDIT SUISSE AG", []),
    1159508: ("DEUTSCHE BANK AKTIENGESELLSCHAFT", ["DB"]),
    927971: ("BANK OF MONTREAL /CAN/", ["BMO"]),
    19617: ("JPMORGAN CHASE & CO", ["JPM"]),
    1665650: ("JPMorgan Chase Financial Co. LLC", []),
    886982: ("GOLDMAN SACHS GROUP INC", ["GS"]),
    1419828: ("GS Finance Corp.", []),
    895421: ("MORGAN STANLEY", ["MS"]),
    1666268: ("Morgan Stanley Finance LLC", []),
    831001: ("CITIGROUP INC", ["C"]),
    200245: ("Citigroup Global Markets Holdings Inc.", []),
}
PREFERRED = re.compile(r"-P[A-Z]?$")   # the SEC's preferred suffix: not offered as a preferred already
BANK_NAME = re.compile(r"\bBANK\b|BANCO|\bAG$|SUISSE|BARCLAYS|DEUTSCHE BANK|JPMORGAN|GOLDMAN|MORGAN STANLEY|CITIGROUP|NOMURA|HSBC|"
                       r"SOCIETE GENERALE|NATIXIS|SVENSK|\bETNS?\b|ETRACS|IPATH|MICROSECTORS|X-LINKS|EXCHANGE TRADED NOTE", re.I)

def etn_issuers(directory):
    """ETN_ISSUERS checked against the SEC's ticker list; prints each issuer's notes, and other banks' extra tickers for review."""
    by_cik = {}
    for cik, name, ticker, exchange in directory["data"]: by_cik.setdefault(int(cik), []).append((ticker, name, exchange))
    out = {}
    for cik, (name, shares) in ETN_ISSUERS.items():
        rows = by_cik.get(cik, [])
        missing = [s for s in shares if s not in {t for t, _, _ in rows}]
        if missing: raise SystemExit(f"etn: {name} ({cik}) has no {' '.join(missing)} in the SEC's ticker list")
        if rows and rows[0][1].strip().upper() != name.upper(): print(f"etn: {cik} is listed as {rows[0][1]!r}, not {name!r}")
        notes = [t for t, _, _ in rows if t not in shares and not PREFERRED.search(t)]
        print(f"etn: {name} ({cik}): {len(notes)} {' '.join(notes)}".rstrip())
        out[str(cik)] = {"name": name, "shares": shares}
    for cik, rows in by_cik.items():
        if cik in ETN_ISSUERS or not BANK_NAME.search(rows[0][1]): continue
        other = [t for t, _, ex in rows[1:] if not PREFERRED.search(t) and ex not in ("OTC", None)]
        if other: print(f"etn: review {rows[0][1]} ({cik}): {rows[0][0]} beside {' '.join(other)}")
    return out

FUND_NAME = re.compile(r"\bETF\b|\bETFs\b|\bTrust\b|\bFund\b|\bShares\b|iShares|SPDR|ProShares|Grayscale|\bETN\b", re.I)
out = {"spac": {}, "fund": {}}
if args.merge and os.path.exists(args.out):
    kept = json.load(open(args.out))
    out = {"spac": dict(kept.get("spac", {})), "fund": dict(kept.get("fund", {}))}
for line in open(args.audit):
    r = json.loads(line)
    if r.get("cause") == "not-resolved": continue   # already excluded (kept by --merge)
    cik = int(r["cik"])
    _, sub = cached(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
    if not sub: continue
    sic = str(sub.get("sic") or "")
    name = r.get("name") or sub.get("name") or ""
    if r.get("status") == "ready":   # the comparison found revenue: excluded only as a commodity, currency or crypto fund
        if sic in ("6221", "6199") and FUND_NAME.search(name): out["fund"][str(cik)] = name
        continue
    if sic == "6770": out["spac"][str(cik)] = name
    elif sic in ("6221", "6199", "") and FUND_NAME.search(name): out["fund"][str(cik)] = name
if args.directory: directory = json.load(open(args.directory))
else:
    _, directory = cached("https://www.sec.gov/files/company_tickers_exchange.json")
    if not directory: raise SystemExit("etn: the SEC's ticker list is not in --cache; pass --directory")
out["etn"] = etn_issuers(directory)   # rebuilt from ETN_ISSUERS each run (--merge keeps only the SPACs and funds)
result = {"source": "scripts/research/comparison-audit/excluded.py", **{k: dict(sorted(v.items(), key=lambda x: int(x[0]))) for k, v in out.items()}}
json.dump(result, open(args.out, "w"), ensure_ascii=False, indent=0)
open(args.out, "a").write("\n")
print({k: len(v) for k, v in out.items()})
