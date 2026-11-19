#!/usr/bin/env python3
"""Spot check of the figures behind the strengths and weaknesses (audit.mjs output with `inputs`) against the SEC originals: for a sample
of the tickers that show no strength or no weakness, the XBRL instance of the very filing the comparison used is read with an independent
parser, and the revenue, the year-ago revenue, the operating figure, cash, current assets and current liabilities must be there under the
same concept, for the same period, without dimensions, with the same value. A fourth quarter (fiscal year minus nine months) is not
rebuilt here (spot-check.py does that); its balance figures are still checked.

    python3 -I spot-check-items.py --audit after.jsonl --cache DIR --out spot-items.jsonl [--per-cell 2] [--rate 4]

SEC fair access: at most --rate requests a second (default 4), a generic User-Agent (RESEARCH_USER_AGENT or a default without personal
data); responses are cached on disk (the same layout as audit.mjs).
"""
import argparse, gzip, hashlib, json, os, random, re, sys, time, urllib.request, urllib.error

ap = argparse.ArgumentParser()
ap.add_argument("--audit", required=True); ap.add_argument("--cache", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--per-cell", type=int, default=2); ap.add_argument("--rate", type=float, default=4); ap.add_argument("--seed", type=int, default=19)
args = ap.parse_args()
UA = os.environ.get("RESEARCH_USER_AGENT") or "TechPhaseAudit/1.0 research@example.com"
LISTED = {"NYSE", "Nasdaq", "CBOE", "Cboe", "TXSE"}
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
        if status in (200, 404): open(path, "wb").write(gzip.compress(status.to_bytes(2, "big") + body))
        return status, body
    return status, body

CTX = re.compile(r"<(?:xbrli:)?context\b[^>]*\bid=\"([^\"]+)\"[^>]*>(.*?)</(?:xbrli:)?context>", re.S)
def facts(xml, prefix, name):
    contexts = {}
    for cid, body in CTX.findall(xml):
        if re.search(r"<(?:xbrli:)?(?:segment|scenario)\b", body): continue
        start = re.search(r"<(?:xbrli:)?startDate>\s*([\d-]+)", body); end = re.search(r"<(?:xbrli:)?endDate>\s*([\d-]+)", body)
        inst = re.search(r"<(?:xbrli:)?instant>\s*([\d-]+)", body)
        contexts[cid] = (start.group(1) if start else None, end.group(1) if end else (inst.group(1) if inst else None))
    out = []
    for m in re.finditer(r"<([\w-]+):%s\b([^>]*)>([^<]*)<" % re.escape(name), xml):
        if m.group(1).replace("_", "-") != prefix: continue
        ctx = re.search(r'contextRef="([^"]+)"', m.group(2))
        if not ctx or ctx.group(1) not in contexts: continue
        try: out.append((contexts[ctx.group(1)], float(m.group(3).strip())))
        except ValueError: pass
    return out

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
def accession(url): m = re.search(r"/(\d{10}-\d{2}-\d{6})-index\.htm", url or ""); return m.group(1) if m else None

rows = [json.loads(l) for l in open(args.audit) if l.strip()]
rows = [r for r in rows if r.get("exchange") in LISTED and r.get("availability") is None and r.get("figures") and r["basis"] in ("us-gaap", "ifrs-full")]
def bucket(r):
    s = sum(i.startswith("S:") for i in r["items"]); w = sum(i.startswith("W:") for i in r["items"])
    return "none" if not s and not w else "no-strength" if not s else "no-weakness" if not w else None
cells = {}
for r in rows:
    b = bucket(r)
    if b: cells.setdefault((b, r["basis"], r.get("periodMonths") or 3), []).append(r)
random.seed(args.seed)
sample = [x for key in sorted(cells) for x in random.sample(cells[key], min(args.per_cell, len(cells[key])))]
print(f"spot-check-items: {len(sample)} sampled from {len(cells)} cells", file=sys.stderr)

def check(r):
    f, bal, basis = r["figures"], (r.get("inputs") or {}).get("balance") or {}, r["basis"]
    acc = f.get("accession")
    xml = instance(r["cik"], acc) if acc else None
    if xml is None: return {"result": "no-instance"}
    out = {}
    def duration(tag, value, start, end):
        if tag.startswith("TechPhase"): return "derived"
        vals = [v for (s, e), v in facts(xml, basis, tag) if (s, e) == (start, end)]
        return "missing" if not vals else "match" if any(close(v, value) for v in vals) else "mismatch"
    annual_quarter = (r.get("periodMonths") or 3) == 3 and r["periodStart"] and days(r["periodEnd"]) - days(r["periodStart"]) < 120 and not any(
        (s, e) == (r["periodStart"], r["periodEnd"]) for (s, e), _ in facts(xml, basis, f["tag"]))
    if not annual_quarter:
        out["revenue"] = duration(f["tag"], f["revenue"], r["periodStart"], r["periodEnd"])
        if f.get("operating") is not None and f.get("operatingTag"): out["operating"] = duration(f["operatingTag"], f["operating"], r["periodStart"], r["periodEnd"])
        if f.get("previous") is not None and not f["tag"].startswith("TechPhase"):
            length = days(r["periodEnd"]) - days(r["periodStart"])
            prior = [v for (s, e), v in facts(xml, basis, f["tag"]) if s and e and 357 <= days(r["periodEnd"]) - days(e) <= 373 and abs(days(e) - days(s) - length) <= 7]
            out["previous"] = "missing" if not prior else "match" if any(close(v, f["previous"]) for v in prior) else "mismatch"
    else: out["revenue"] = "fourth-quarter (spot-check.py)"
    if bal.get("end") == r["periodEnd"]:
        names = {"cash": bal.get("cashTag"), "currentAssets": "AssetsCurrent" if basis == "us-gaap" else "CurrentAssets",
                 "currentLiabilities": "LiabilitiesCurrent" if basis == "us-gaap" else "CurrentLiabilities"}
        for key, tag in names.items():
            if bal.get(key) is None or not tag or tag.startswith("TechPhase"): continue
            vals = [v for (s, e), v in facts(xml, basis, tag) if e == bal["end"] and s is None]
            out[key] = "missing" if not vals else "match" if any(close(v, bal[key]) for v in vals) else "mismatch"
    checked = [v for v in out.values() if v in ("match", "mismatch", "missing")]
    out["result"] = "mismatch" if "mismatch" in checked else "missing" if "missing" in checked else "match"
    return out

with open(args.out, "w") as fh:
    for r in sample:
        try: res = check(r)
        except Exception as e: res = {"result": "error", "error": str(e)[:120]}
        fh.write(json.dumps({"ticker": r["ticker"], "bucket": bucket(r), "basis": r["basis"], "periodMonths": r.get("periodMonths"), "periodEnd": r["periodEnd"],
                             "items": r["items"], "inputs": {k: v for k, v in (r.get("inputs") or {}).items() if k != "source"}, **res}) + "\n")
print("spot-check-items: done", file=sys.stderr)
