/** Every on-screen wording of the Stock Comparison's company-type metrics (Nov 26), in one place: the line beside each bar and the method
 *  notes. Existing wordings stay where they were; these are only the new metrics' own labels. */
type Copy = { ja: string; en: string };
const signed = (n: number, digits = 1) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

/** The name of a company's latest period (Financials.periodMonths): a foreign filer's fiscal year or half-year is never called a quarter
 *  (Nov 28 audit: the growth notes said 「…終了の四半期」 / "the quarter ended" for 20-F filers' annual figures). */
export const periodName = (months?: number): Copy => months === 12 ? { ja: "年度", en: "fiscal year" } : months === 6 ? { ja: "半期", en: "half-year" } : { ja: "四半期", en: "quarter" };

export const ALTERNATIVE_LABELS = {
  runway: {
    months: (m: number): Copy => ({ ja: `資金の持ち期間 約${m >= 100 ? "100+" : m.toFixed(m < 10 ? 1 : 0)}か月`, en: `Cash runway ~${m >= 100 ? "100+" : m.toFixed(m < 10 ? 1 : 0)} months` }),
    positive: { ja: "資金の持ち期間 営業CF黒字", en: "Cash runway: operating cash flow positive" } as Copy,
  },
  /** Net income now against a year earlier, said plainly (owner's review, Nov 26: 「純損益 前年比-24.5%」 did not say whether the loss grew). */
  lossTrend: (now: number, before: number, basis: "quarters" | "years"): Copy => {
    const when = basis === "quarters" ? { ja: "直近4四半期の", en: " (4 qtrs)" } : { ja: "直近期の", en: " (fiscal yr)" };
    const pct = before !== 0 ? Math.abs((Math.abs(now) - Math.abs(before)) / Math.abs(before) * 100).toFixed(1) : "";
    if (now < 0 && before < 0) return Math.abs(now) > Math.abs(before)
      ? { ja: `${when.ja}赤字が前年より${pct}%拡大`, en: `Loss up ${pct}% YoY${when.en}` }
      : { ja: `${when.ja}赤字が前年より${pct}%縮小`, en: `Loss down ${pct}% YoY${when.en}` };
    if (now >= 0 && before < 0) return { ja: `${when.ja}損益が黒字に転換`, en: `Turned profitable${when.en}` };
    if (now < 0 && before >= 0) return { ja: `${when.ja}損益が赤字に転落`, en: `Turned to a loss${when.en}` };
    return { ja: `${when.ja}純利益 前年比${signed((now - before) / Math.abs(before || 1) * 100)}%`, en: `Net income ${signed((now - before) / Math.abs(before || 1) * 100)}% YoY${when.en}` };
  },
  /** Profitability of a company with no revenue: no margin exists, so no score; the line says so and gives the R&D share of spending as a
   *  fact (owner's review, Nov 26: R&D intensity scored as profitability was a stretch). */
  // Short enough to show in full in a two-line snapshot cell at 360px with three companies (owner, Nov 26: no hidden text).
  // The share says what it is of (reviewer, Nov 26): of operating expenses, or of R&D plus G&A when no operating-expense total is filed.
  noMargin: (share: number | null, of: "operating-expenses" | "rd-and-ga" = "operating-expenses"): Copy => share === null ? { ja: "売上なし（利益率なし）", en: "No revenue: no margin" }
    : of === "rd-and-ga" ? { ja: `売上なし（研究費は研究・管理費の${share.toFixed(0)}%）`, en: `No revenue (R&D ${share.toFixed(0)}% of R&D+G&A)` }
    : { ja: `売上なし（研究開発費は費用の${share.toFixed(0)}%）`, en: `No revenue (R&D ${share.toFixed(0)}% of costs)` },
  /** A bank's, insurer's or broker's cash generation when no net income can be matched to its equity. */
  noRoe: { ja: "ROE算出用の純利益が未開示", en: "Net income for ROE not available" } as Copy,
  /** An operating income above the revenue line: the margin is not scored. */
  marginWithheld: { ja: "営業利益が売上を超え算出せず", en: "Op. income above revenue: not scored" } as Copy,
  /** An IFRS bank whose readable revenue is net interest and fee income only, beside a profit that holds its other income too. */
  growthWithheld: { ja: "売上の記載が一部のみで算出せず", en: "Revenue line is partial: not scored" } as Copy,
  marginSign: { ja: "営業損益と税引前損益が逆で算出せず", en: "Pre-tax result differs: not scored" } as Copy,
  marginPartial: { ja: "売上が利息・手数料のみで算出せず", en: "Revenue is interest and fees only: not scored" } as Copy,
  /** Free cash flow above the revenue itself (an upfront licence payment, customer deposits): not scored as cash generation. */
  fcfAboveRevenue: { ja: "営業CFが売上を超え算出せず", en: "Cash flow above revenue: not scored" } as Copy,
  dilution: (pct: number): Copy => ({ ja: `株数の増加 前年比${signed(pct)}%`, en: `Share count vs a year earlier ${signed(pct)}%` }),
  capitalRatio: (pct: number): Copy => ({ ja: `自己資本比率 ${pct.toFixed(1)}%`, en: `Equity ÷ assets ${pct.toFixed(1)}%` }),
  roe: (pct: number, basis: "quarters" | "year" = "quarters"): Copy => basis === "year" ? { ja: `ROE（年次） ${signed(pct)}%`, en: `Return on equity (fiscal year) ${signed(pct)}%` }
    : { ja: `ROE ${signed(pct)}%`, en: `Return on equity ${signed(pct)}%` },
  niiMargin: (pct: number): Copy => ({ ja: `純投資利益率 ${pct.toFixed(1)}%`, en: `Net investment income margin ${pct.toFixed(1)}%` }),
  /** Stability from four fiscal years (a foreign filer reporting yearly or half-yearly). */
  annualStability: (profitable: number, pretax = false): Copy => ({ ja: `${pretax ? "税引前黒字" : "営業黒字"} ${profitable}/4期（年次）`, en: `${pretax ? "Pre-tax profitable" : "Profitable"} ${profitable}/4 fiscal years` }),
  /** Cash generation from the latest fiscal year when the quarter's cash flows are not available. */
  annualFcf: (pct: number): Copy => ({ ja: `簡易FCF率（年次） ${pct.toFixed(1)}%`, en: `Simple FCF margin (fiscal year) ${pct.toFixed(1)}%` }),
  /** Valuation: no multiple exists for a company whose shareholders' equity is negative and which has no revenue. */
  negativeEquity: { ja: "純資産がマイナスのため倍率なし", en: "No multiple: shareholders' equity is negative" } as Copy,
  /** Why a pre-revenue metric is missing (the filing has no such figure), instead of a bare "no revenue yet". */
  missing: {
    cash: { ja: "営業CFの記載なし", en: "No operating cash flow reported" } as Copy,
    growth: { ja: "比べる前年の純損益が未開示", en: "No year-earlier net income to compare" } as Copy,
    stability: { ja: "前年同期の株数が未開示", en: "No year-earlier share count" } as Copy,
  },
  /** Why a company has no current figures (Financials.gapReason): the availability note, and the line beside each filing-based score. */
  gap: {
    "no-report": { note: { ja: "この会社名義の決算書類（10-K・10-Q・20-F）がまだ提出されていません。上場直後や組織再編後の会社です。", en: "No annual or quarterly report has been filed under this company yet (a new listing or a reorganised company)." } as Copy,
      line: { ja: "決算書類がまだありません", en: "No report filed yet" } as Copy },
    "no-xbrl": { note: { ja: "決算書類に機械で読める数値（XBRL）が付いていないため、数値を読み取れません。", en: "Its reports carry no machine-readable (XBRL) figures." } as Copy,
      line: { ja: "決算書類に数値データなし", en: "No XBRL figures in its reports" } as Copy },
    stale: { note: (date: string): Copy => ({ ja: `決算書類の提出が${date}を最後に止まっています。`, en: `Its last report was filed on ${date}.` }),
      line: { ja: "決算書類の提出が止まっています", en: "Reports have stopped" } as Copy },
    // Revenue under a company-specific or bank/insurer line the comparison does not read (APA, VIV, KB): said without guessing which.
    unreadable: { note: { ja: "決算書類の売上の記載を、他社と比べられる形（標準の売上項目）で読み取れません。", en: "Its filings do not state revenue in a standard line that can be compared." } as Copy,
      line: { ja: "売上の記載を読み取れません", en: "Revenue line not readable" } as Copy },
  },
  /** The availability note for a company whose newest quarter's revenue is filed as zero. */
  zeroQuarterNote: { ja: "直近四半期の売上がゼロの会社です。資金の持ち期間・赤字の推移・株数の増加で比べます。売上が無いため利益率は出しません。", en: "No revenue in the latest quarter: compared on cash runway, loss trend and share dilution; no margin without revenue." } as Copy,
  /** The availability note for a pre-revenue company now compared on its own metrics. */
  preRevenueNote: { ja: "売上がまだ無い会社です。資金の持ち期間・赤字の推移・株数の増加で比べます。売上が無いため利益率は出しません。", en: "No revenue yet: compared on cash runway, loss trend and share dilution; no margin without revenue." } as Copy,
};

/** What each new metric measures, for the factor notes (method text), in the same voice as twelveFactorMethods. */
export const ALTERNATIVE_METHODS: Record<string, Copy> = {
  runway: { ja: "売上がまだ無い会社の資金創出は、現金と短期投資を直近の営業キャッシュフロー流出（最大4四半期の平均）で割った資金の持ち期間で見ます。0か月＝0点、24か月以上＝10点。",
    en: "For a company with no revenue yet, cash generation is its cash runway: cash and short-term investments divided by the average quarterly operating cash outflow (up to four quarters). 0 months scores 0, 24 months or more scores 10." },
  lossTrend: { ja: "売上がまだ無い会社の成長性は、直近4四半期の純損益をその前の4四半期と比べた変化で見ます。4四半期分が無ければ直近2期で比べます。変化なし＝5点、損失50%縮小＝10点、50%拡大＝0点。",
    en: "For a company with no revenue yet, growth is the change in net income over the last four quarters against the four before (else the last two fiscal years). Unchanged scores 5, a loss 50% smaller scores 10, 50% larger scores 0." },
  rdIntensity: { ja: "売上がまだ無い会社には利益率が無いため、収益性は点を付けず、費用のうち研究開発費の比率を参考に表示します。",
    en: "A company with no revenue has no margin: profitability is not scored, and its R&D share of operating expenses is shown for reference." },
  dilution: { ja: "売上がまだ無い会社の安定性は、株数（加重平均）の前年同期比の増加で見ます。増加なし＝10点、+50%以上＝0点。株式併合は同じ書類の修正後の数字で比べます。",
    en: "For a company with no revenue yet, stability is the year-on-year increase in its weighted-average share count, both figures from the same filing (split-adjusted). No increase scores 10, +50% or more scores 0." },
  capitalRatio: { ja: "銀行・保険・貸金業・証券・BDCの財務健全性は、自己資本÷総資産（自己資本比率）で見ます。銀行は2%＝0点、10%以上＝10点、ほかは0%＝0点、20%以上＝10点です。SECの業種コードが銀行・貸金業・証券・保険（6000〜6411。決済業6099と医療保険6324を除く）の会社は、現金÷有利子負債では見ません。強み・弱みの要点には挙げません。",
    en: "For a bank, insurer, lender, broker or BDC, financial strength is shareholders' equity divided by total assets: for a bank 2% scores 0 and 10% or more scores 10; for the others 0% scores 0 and 20% or more scores 10. A company whose SEC industry code is a bank's, lender's, broker's or insurer's (6000-6411, payment processors 6099 and health insurers 6324 aside) is never scored on cash against debt. It is not listed as a strength or weakness." },
  roe: { ja: "銀行・保険・証券・BDCの資金創出は、直近4四半期（無ければ直近期）の純利益÷自己資本（ROE）で見ます。0%＝5点、+15%＝10点、−15%＝0点。",
    en: "For a bank, insurer, broker or BDC, cash generation is return on equity: net income of the last four quarters (else the fiscal year) divided by equity. 0% scores 5, +15% scores 10, −15% scores 0." },
  niiMargin: { ja: "BDCの収益性は、純投資利益÷投資収益（純投資利益率）で見ます。50%＝10点。", en: "For a business development company, profitability is net investment income divided by total investment income. 50% scores 10." },
};
