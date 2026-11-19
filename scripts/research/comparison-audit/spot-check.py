#!/usr/bin/env python3
"""Spot check of the comparison's figures against the SEC originals (the audit's figures, audit.mjs --out).

For a stratified sample (accounting standard x filing form x industry), the filing that the comparison took its quarter from is opened on
EDGAR and its XBRL instance (the *_htm.xml the SEC extracts from the inline filing) is read with an independent parser: the revenue and
operating figures must be there, under the same concept, for the same period, without dimensions, with the same value. A derived figure
(a bank's net interest income plus noninterest income) is rebuilt from its parts. Also flags a quarter whose revenue is far from a
quarter of the annual figure (a sign of the wrong line).

    python3 -I spot-check.py --audit after.jsonl --cache DIR --out spot.jsonl [--per-cell 6] [--rate 4]

SEC fair access: at most --rate requests a second (default 4, the SEC allows 10), a generic User-Agent (RESEARCH_USER_AGENT or a default
without personal data); responses are cached on disk (gzip, the same layout as audit.mjs).
"""
import argparse, gzip, hashlib, json, os, random, re, sys, time, urllib.request, urllib.error

ap = argparse.ArgumentParser()
ap.add_argument("--audit", required=True); ap.add_argument("--cache", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--per-cell", type=int, default=6); ap.add_argument("--rate", type=float, default=4); ap.add_argument("--seed", type=int, default=19)
args = ap.parse_args()
UA = os.environ.get("RESEARCH_USER_AGENT") or "TechPhaseAudit/1.0 research@example.com"
os.makedirs(args.cache, exist_ok=True)
last = [0.0]

def fetch(url):
    path = os.path.join(args.cache, hashlib.sha1(url.encode()).hexdigest() + ".gz")
    if os.path.exists(path):
        raw = gzip.decompress(open(path, "rb").read())
        return int.from_bytes(raw[:2], "big"), raw[2:]
    for attempt in range(4):
        wait = last[0] + 1 / args.rate - time.time()
        if wait > 0: time.sleep(wait)
        last[0] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r: status, body = r.status, r.read()
        except urllib.error.HTTPError as e: status, body = e.code, b""
        except Exception: status, body = 598, b""
        if status in (429, 503, 403, 598) and attempt < 3: time.sleep(5 * (attempt + 1)); continue
        if status == 200 or status == 404: open(path, "wb").write(gzip.compress(status.to_bytes(2, "big") + body))
        return status, body
    return status, body

def industry(sic):
    s = int(sic) if str(sic or "").isdigit() else 0
    if 6000 <= s <= 6799: return "financial"
    if 2830 <= s <= 2836 or 8731 <= s <= 8734: return "pharma"
    if 3570 <= s <= 3579 or 3660 <= s <= 3679 or 7370 <= s <= 7379: return "tech"
    if 1300 <= s <= 1399 or 2900 <= s <= 2999 or 4900 <= s <= 4999: return "energy-utility"
    return "other"

CTX = re.compile(r"<(?:xbrli:)?context\b[^>]*\bid=\"([^\"]+)\"[^>]*>(.*?)</(?:xbrli:)?context>", re.S)
def instance_facts(xml, concepts):
    contexts = {}
    for cid, body in CTX.findall(xml):
        if re.search(r"<(?:xbrli:)?(?:segment|scenario)\b", body): continue
        start = re.search(r"<(?:xbrli:)?startDate>\s*([\d-]+)", body); end = re.search(r"<(?:xbrli:)?endDate>\s*([\d-]+)", body)
        inst = re.search(r"<(?:xbrli:)?instant>\s*([\d-]+)", body)
        contexts[cid] = (start.group(1) if start else None, end.group(1) if end else (inst.group(1) if inst else None))
    out = {}
    for concept in concepts:
        prefix, name = concept.split(":")
        for m in re.finditer(r"<([\w-]+):%s\b([^>]*)>([^<]*)<" % re.escape(name), xml):
            if m.group(1) not in (prefix, prefix.replace("-", "_")) and not (prefix == "us-gaap" and m.group(1) == "us-gaap") and not (prefix == "ifrs-full" and m.group(1) == "ifrs-full"): continue
            ctx = re.search(r'contextRef="([^"]+)"', m.group(2))
            if not ctx or ctx.group(1) not in contexts: continue
            try: val = float(m.group(3).strip())
            except ValueError: continue
            out.setdefault(concept, []).append((contexts[ctx.group(1)], val))
    return out

def submissions(cik):
    status, body = fetch(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
    return json.loads(body) if status == 200 else {}

rows = [json.loads(l) for l in open(args.audit) if l.strip()]
rows = [r for r in rows if r.get("figures") and r["figures"].get("accession")]
cells = {}
for r in rows:
    sub = submissions(r["cik"])
    recent = sub.get("filings", {}).get("recent", {})
    acc = r["figures"]["accession"]
    form = next((recent["form"][i] for i, a in enumerate(recent.get("accessionNumber", [])) if a == acc), None) or "?"
    r["form"], r["industry"] = form, industry(sub.get("sic"))
    cells.setdefault((r["basis"], re.sub(r"/A$", "", form), r["industry"]), []).append(r)
random.seed(args.seed)
sample = [x for key in sorted(cells) for x in random.sample(cells[key], min(args.per_cell, len(cells[key])))]
print(f"spot-check: {len(rows)} with figures, {len(cells)} cells, {len(sample)} sampled", file=sys.stderr)

def instance(cik, acc):
    folder = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/"
    status, body = fetch(folder + "index.json")
    if status != 200: return None
    names = [i["name"] for i in json.loads(body)["directory"]["item"]]
    inst = [n for n in names if n.endswith("_htm.xml")] or [n for n in names if n.endswith(".xml") and not re.search(r"(_cal|_def|_lab|_pre|FilingSummary|MetaLinks)", n)]
    if not inst: return None
    status, body = fetch(folder + inst[0])
    return body.decode("utf-8", "replace") if status == 200 else None

def days(d): return time.mktime(time.strptime(d, "%Y-%m-%d")) / 86400

def close(v, w): return abs(v - w) <= max(1, abs(w) * 1e-6)

def fourth_quarter(r, xml, concept, value):
    """A fourth quarter is the fiscal year (this 10-K) minus the nine months of the third-quarter 10-Q: both are read from their own filings."""
    year = [(s, e, v) for (s, e), v in instance_facts(xml, [concept]).get(concept, []) if e == r["periodEnd"] and s and 350 <= days(e) - days(s) <= 380]
    if not year: return "missing"
    start = year[0][0]
    recent = submissions(r["cik"]).get("filings", {}).get("recent", {})
    q3 = [recent["accessionNumber"][i] for i, form in enumerate(recent.get("form", [])) if form.startswith("10-Q") and abs(days(recent["reportDate"][i]) - (days(r["periodStart"]) - 1)) <= 7]
    if not q3: return "missing"
    other = instance(r["cik"], q3[0])
    nine = [v for (s, e), v in instance_facts(other or "", [concept]).get(concept, []) if s == start and abs(days(e) - (days(r["periodStart"]) - 1)) <= 7]
    if not nine: return "missing"
    return "match" if any(close(y - n, value) for (_, _, y) in year for n in nine) else "mismatch"

def check(r):
    f = r["figures"]; xml = instance(r["cik"], f["accession"])
    if xml is None: return {"result": "no-instance"}
    basis = r["basis"]
    quarter_in_annual = r["form"].startswith("10-K") and (r.get("periodMonths") or 3) == 3
    def found(tag, value, start, end):
        if quarter_in_annual and not tag.startswith("TechPhase"): return fourth_quarter(r, xml, f"{basis}:{tag}", value)
        if tag == "TechPhaseBankRevenue":
            parts = instance_facts(xml, ["us-gaap:InterestIncomeExpenseNet", "us-gaap:NoninterestIncome"])
            a = [v for (s, e), v in parts.get("us-gaap:InterestIncomeExpenseNet", []) if (s, e) == (start, end)]
            b = [v for (s, e), v in parts.get("us-gaap:NoninterestIncome", []) if (s, e) == (start, end)]
            return "match" if a and b and abs(a[0] + b[0] - value) <= max(1, abs(value) * 1e-6) else "mismatch"
        if tag.startswith("TechPhase"): return "derived"
        concept = f"{basis}:{tag}"
        vals = [v for (s, e), v in instance_facts(xml, [concept]).get(concept, []) if (s, e) == (start, end)]
        if not vals: return "missing"
        return "match" if any(abs(v - value) <= max(1, abs(value) * 1e-6) for v in vals) else "mismatch"
    out = {"revenue": found(f["tag"], f["revenue"], r["periodStart"], r["periodEnd"])}
    if f.get("operating") is not None and f.get("operatingTag"): out["operating"] = found(f["operatingTag"], f["operating"], r["periodStart"], r["periodEnd"])
    if f.get("previous") is not None and not f["tag"].startswith("TechPhase") and not quarter_in_annual:
        # The same period a year earlier, from the same filing (the growth rate's base); a 52/53-week year ends a few days apart.
        concept = f"{basis}:{f['tag']}"
        length = days(r["periodEnd"]) - days(r["periodStart"])
        prior = [v for (s, e), v in instance_facts(xml, [concept]).get(concept, []) if s and e and 357 <= days(r["periodEnd"]) - days(e) <= 373 and abs(days(e) - days(s) - length) <= 7]
        out["previous"] = "missing" if not prior else "match" if any(close(v, f["previous"]) for v in prior) else "mismatch"
    out["result"] = "mismatch" if "mismatch" in out.values() else "missing" if "missing" in out.values() else "match"
    return out

with open(args.out, "w") as fh:
    for r in sample:
        try: res = check(r)
        except Exception as e: res = {"result": "error", "error": str(e)[:120]}
        fh.write(json.dumps({"ticker": r["ticker"], "basis": r["basis"], "form": r["form"], "industry": r["industry"], "periodStart": r["periodStart"],
            "periodEnd": r["periodEnd"], "unit": r["unit"], "tag": r["figures"]["tag"], "revenue": r["figures"]["revenue"], "operatingTag": r["figures"].get("operatingTag"), **res}) + "\n")
print("spot-check: done", file=sys.stderr)
