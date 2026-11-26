/** Every on-screen wording of the Stock Comparison's company-type metrics (Nov 26), in one place: the line beside each bar and the method
 *  notes. Existing wordings stay where they were; these are only the new metrics' own labels. */
type Copy = { ja: string; en: string };
const signed = (n: number, digits = 1) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

export const ALTERNATIVE_LABELS = {
  runway: {
    months: (m: number): Copy => ({ ja: `資金の持ち期間 約${m >= 100 ? "100+" : m.toFixed(m < 10 ? 1 : 0)}か月`, en: `Cash runway ~${m >= 100 ? "100+" : m.toFixed(m < 10 ? 1 : 0)} months` }),
    positive: { ja: "資金の持ち期間 営業キャッシュフロー黒字", en: "Cash runway: operating cash flow positive" } as Copy,
  },
  lossTrend: (pct: number, basis: "quarters" | "years"): Copy => ({
    ja: `${basis === "quarters" ? "直近4四半期" : "直近期"}の純損益 前年比${signed(pct)}%`,
    en: `Net income vs a year earlier ${signed(pct)}% (${basis === "quarters" ? "last 4 quarters" : "fiscal year"})` }),
  rdIntensity: (share: number): Copy => ({ ja: `研究開発費の比率 ${share.toFixed(0)}%`, en: `R&D share of spending ${share.toFixed(0)}%` }),
  dilution: (pct: number): Copy => ({ ja: `株数の増加 前年比${signed(pct)}%`, en: `Share count vs a year earlier ${signed(pct)}%` }),
  capitalRatio: (pct: number): Copy => ({ ja: `自己資本比率 ${pct.toFixed(1)}%`, en: `Equity ÷ assets ${pct.toFixed(1)}%` }),
  roe: (pct: number): Copy => ({ ja: `ROE ${signed(pct)}%`, en: `Return on equity ${signed(pct)}%` }),
  niiMargin: (pct: number): Copy => ({ ja: `純投資利益率 ${pct.toFixed(1)}%`, en: `Net investment income margin ${pct.toFixed(1)}%` }),
  /** Stability from four fiscal years (a foreign filer reporting yearly or half-yearly). */
  annualStability: (profitable: number): Copy => ({ ja: `営業黒字 ${profitable}/4期（年次）`, en: `Profitable ${profitable}/4 fiscal years` }),
  /** Cash generation from the latest fiscal year when the quarter's cash flows are not available. */
  annualFcf: (pct: number): Copy => ({ ja: `簡易FCF率（年次） ${pct.toFixed(1)}%`, en: `Simple FCF margin (fiscal year) ${pct.toFixed(1)}%` }),
  /** Valuation: no multiple exists for a company whose shareholders' equity is negative and which has no revenue. */
  negativeEquity: { ja: "純資産がマイナスのため倍率なし", en: "No multiple: shareholders' equity is negative" } as Copy,
  /** Why a pre-revenue metric is missing (the filing has no such figure), instead of a bare "no revenue yet". */
  missing: {
    cash: { ja: "営業キャッシュフローの記載なし", en: "No operating cash flow reported" } as Copy,
    growth: { ja: "比べる前年の純損益が未開示", en: "No year-earlier net income to compare" } as Copy,
    profitability: { ja: "研究開発費の記載なし", en: "No R&D expense reported" } as Copy,
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
    unreadable: { note: { ja: "売上が会社独自の項目名で記載されており、他社と比べられる形で読み取れません。", en: "Its revenue is filed under the company's own line items, which cannot be compared." } as Copy,
      line: { ja: "売上の記載を読み取れません", en: "Revenue line not readable" } as Copy },
  },
  /** The availability note for a company whose newest quarter's revenue is filed as zero. */
  zeroQuarterNote: { ja: "直近四半期の売上がゼロの会社です。資金の持ち期間・損益の推移・研究開発費・株数の増加で比べます。", en: "No revenue in the latest quarter: compared on cash runway, net-income trend, R&D share and share dilution." } as Copy,
  /** The availability note for a pre-revenue company now compared on its own metrics. */
  preRevenueNote: { ja: "売上がまだ無い会社です。資金の持ち期間・損益の推移・研究開発費・株数の増加で比べます。", en: "No revenue yet: compared on cash runway, net-income trend, R&D share and share dilution." } as Copy,
};

/** What each new metric measures, for the factor notes (method text), in the same voice as twelveFactorMethods. */
export const ALTERNATIVE_METHODS: Record<string, Copy> = {
  runway: { ja: "売上がまだ無い会社の資金創出は、現金と短期投資を直近の営業キャッシュフロー流出（最大4四半期の平均）で割った資金の持ち期間で見ます。0か月＝0点、24か月以上＝10点。",
    en: "For a company with no revenue yet, cash generation is its cash runway: cash and short-term investments divided by the average quarterly operating cash outflow (up to four quarters). 0 months scores 0, 24 months or more scores 10." },
  lossTrend: { ja: "売上がまだ無い会社の成長性は、直近4四半期の純損益をその前の4四半期と比べた変化で見ます。4四半期分が無ければ直近2期で比べます。変化なし＝5点、損失50%縮小＝10点、50%拡大＝0点。",
    en: "For a company with no revenue yet, growth is the change in net income over the last four quarters against the four before (else the last two fiscal years). Unchanged scores 5, a loss 50% smaller scores 10, 50% larger scores 0." },
  rdIntensity: { ja: "売上がまだ無い会社の収益性の欄は、費用のうち研究開発費の比率です。利益の指標ではありません。0%＝0点、80%以上＝10点。",
    en: "For a company with no revenue yet, the profitability row shows R&D as a share of operating expenses (not a profit measure). 0% scores 0, 80% or more scores 10." },
  dilution: { ja: "売上がまだ無い会社の安定性は、株数（加重平均）の前年同期比の増加で見ます。増加なし＝10点、+50%以上＝0点。株式併合は同じ書類の修正後の数字で比べます。",
    en: "For a company with no revenue yet, stability is the year-on-year increase in its weighted-average share count, both figures from the same filing (split-adjusted). No increase scores 10, +50% or more scores 0." },
  capitalRatio: { ja: "銀行・保険・証券・BDCの財務健全性は、自己資本÷総資産（自己資本比率）で見ます。0%＝0点、20%以上＝10点。",
    en: "For a bank, insurer, broker or BDC, financial strength is shareholders' equity divided by total assets. 0% scores 0, 20% or more scores 10." },
  roe: { ja: "銀行・保険・証券・BDCの資金創出は、直近4四半期（無ければ直近期）の純利益÷自己資本（ROE）で見ます。0%＝5点、+15%＝10点、−15%＝0点。",
    en: "For a bank, insurer, broker or BDC, cash generation is return on equity: net income of the last four quarters (else the fiscal year) divided by equity. 0% scores 5, +15% scores 10, −15% scores 0." },
  niiMargin: { ja: "BDCの収益性は、純投資利益÷投資収益（純投資利益率）で見ます。50%＝10点。", en: "For a business development company, profitability is net investment income divided by total investment income. 50% scores 10." },
};
