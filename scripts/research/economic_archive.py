"""Economic indicator results kept for good (HQ, Nov 28: rows vanished from the calendar 7 days after their release).

The BLS (jobs, CPI, PPI) and BEA (PCE) results reach the site as official headlines (signal_events), and the news feed shows only
the last seven days of those. Each such official result is copied once into event_results, under the same id the calendar gives it
(lib/research/pce-results.ts: "cpi-2026-10", "pce-2026-09"), with the official wording unchanged and the official page as its one
source. The other indicators (FOMC, GDP, retail sales, jobless claims, ADP, ISM) are already stored there by their own readers.

`answer()` gives the calendar every published indicator result (newest first, bounded), not only the news feed's newest 20.
The copied rows carry "archived": "official" and are left out of the news feed's event results (`public_view`), so the feed and the
push notices see no change: BLS and BEA results are announced from the headlines, as before. A withdrawn row is never re-copied.
Nothing here writes a word or a number of its own.
"""

import json
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

import event_results

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
# The same paths and titles mergeEconomicResults accepts (lib/research/pce-results.ts).
BLS = (
    ("jobs", "empsit", "jobs report", "米国雇用統計（{m}月）", "U.S. employment report ({p})",
     "非農業部門雇用者数の増減・失業率・平均時給(前月比と前年比。取得できた場合)をBLS公式発表から取得。市場予想との比較は含みません。",
     "Change in total nonfarm payroll employment, the unemployment rate, and average hourly earnings (monthly and yearly change, when stated) from the official BLS release. No consensus comparison."),
    ("cpi", "cpi", "CPI", "米国CPI（消費者物価指数）（{m}月）", "U.S. Consumer Price Index ({p})",
     "総合とコアの前月比・前年比をBLS公式発表から取得。市場予想との比較は含みません。",
     "Headline and core monthly and annual changes from the official BLS release. No consensus comparison."),
    ("ppi", "ppi", "PPI", "米国PPI（生産者物価指数）（{m}月）", "U.S. Producer Price Index ({p})",
     "最終需要の前月比・前年比と、食品・エネルギー・貿易サービスを除くコアの変化をBLS公式発表から取得。市場予想との比較は含みません。",
     "Final demand and core (less foods, energy and trade services) monthly and annual changes from the official BLS release. No consensus comparison."),
)
PCE_PATH = re.compile(r"/news/(20\d{2})/personal-income-and-outlays-([a-z]+)-(20\d{2})")
# Every indicator the calendar shows, by the id's leading word.
INDICATORS = ("pce", "cpi", "ppi", "jobs", "adp", "retail", "gdp", "claims", "ism", "fomc")
ANSWER_LIMIT = 400


def _published(value):
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else None


def official_result(update):
    """The event_results payload for one official BLS or BEA headline, or None when it is not one the calendar files."""
    if not isinstance(update, dict):
        return None
    url, ja, title = update.get("url"), str(update.get("translationJa") or "").strip(), str(update.get("title") or "").strip()
    published = _published(update.get("publishedAt"))
    if not isinstance(url, str) or not ja or not title or published is None or len(ja) > 500 or len(title) > 500:
        return None
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.query or parts.fragment:
        return None
    observed = str(update.get("observedAt") or "")[:10]
    verified = observed if re.fullmatch(r"\d{4}-\d{2}-\d{2}", observed) else published.astimezone(timezone.utc).date().isoformat()
    if parts.hostname == "www.bea.gov" and update.get("publisher") == "BEA":
        match = PCE_PATH.fullmatch(parts.path)
        if not match or match.group(2) not in MONTHS:
            return None
        month = MONTHS.index(match.group(2)) + 1
        period = f"{match.group(3)}-{month:02d}"
        return _payload(f"pce-{period}", f"米国PCE物価指数（{month}月）", f"U.S. PCE price index ({period})", "BEA", update, published, verified,
                        "総合とコアの前月比・前年比をBEA公式発表から取得。市場予想との比較は含みません。",
                        "Headline and core monthly and annual changes from the official BEA release. No consensus comparison.", "Personal Income and Outlays")
    if parts.hostname == "www.bls.gov" and update.get("publisher") == "BLS":
        for key, file, label, title_ja, title_en, detail_ja, detail_en in BLS:
            match = re.fullmatch(rf"/news\.release/archives/{file}_(\d{{2}})(\d{{2}})(20\d{{2}})\.htm", parts.path)
            named = re.match(rf"U\.S\. ([A-Z][a-z]+) {re.escape(label)}:", title)
            if not match or not named or named.group(1).lower() not in MONTHS:
                continue
            month = MONTHS.index(named.group(1).lower()) + 1
            release_month, release_year = int(match.group(1)), int(match.group(3))
            year = release_year - (1 if month > release_month else 0)
            period = f"{year}-{month:02d}"
            return _payload(f"{key}-{period}", title_ja.format(m=month), title_en.format(p=period), "BLS", update, published, verified,
                            detail_ja, detail_en, title.split(":")[0])
    return None


def _payload(event_id, title_ja, title_en, source, update, published, verified, detail_ja, detail_en, source_title):
    return {
        "id": event_id, "titleJa": title_ja, "titleEn": title_en, "sourceName": source,
        "releasedAt": published.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "resultJa": str(update["translationJa"]).strip(), "resultEn": str(update["title"]).strip(),
        "detailJa": detail_ja, "detailEn": detail_en, "sourceUrl": update["url"],
        "sources": [{"publisher": source, "title": source_title[:300], "url": update["url"]}],
        "verifiedOn": verified, "archived": "official",
    }


def archive(db, updates, now=None):
    """Copies the official BLS/BEA results among `updates` into event_results. Returns how many rows were added or changed.
    A row the owner withdrew stays withdrawn; a row stored by another reader under the same id is left as it is."""
    now = now or datetime.now(timezone.utc)
    changed = 0
    for update in updates or []:
        payload = official_result(update)
        if payload is None:
            continue
        row = db.execute("SELECT state,payload FROM event_results WHERE id=?", (payload["id"],)).fetchone()
        if row is not None:
            stored = json.loads(row["payload"])
            if row["state"] != "published" or stored.get("archived") != "official" or stored == payload:
                continue
        event_results._store(db, payload["id"], "published", payload, now, keep_time=True)
        changed += 1
    return changed


def answer(db, limit=ANSWER_LIMIT):
    """Every published indicator result, newest release first, for the calendar (GET /economic-results)."""
    rows = db.execute("SELECT id,payload FROM event_results WHERE state='published'").fetchall()
    out = []
    for row in rows:
        if row["id"].split("-", 1)[0] not in INDICATORS and not row["id"].startswith("expected-"):
            continue
        try:
            payload = json.loads(row["payload"])
        except ValueError:
            continue
        if isinstance(payload, dict) and _published(payload.get("releasedAt")) is not None:
            out.append(payload)
    out.sort(key=lambda payload: _published(payload["releasedAt"]), reverse=True)
    return {"ok": True, "eventResults": out[:limit]}
