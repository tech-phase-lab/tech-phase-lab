import type { Metric, Source } from "./quality";

export type Language = "ja" | "en";
export type Copy = Record<Language, string>;
export type ResearchEvent = {
  id: string; ticker: string; company: string;
  category: "cloud" | "memory";
  kind: "partnership" | "earnings" | "capacity" | "financing";
  publishedOn: string; reviewedOn: string;
  title: Copy; summary: Copy; change: Copy; interpretation: Copy;
  facts: { text: Copy; sourceIds: string[] }[];
  unknown: Copy; next: Copy;
  sources: Source[]; metrics: Metric[];
  previous?: Metric[];
};

const copy = (ja: string, en: string): Copy => ({ ja, en });
const nebiusRelease: Source = {
  id: "nbis-q2", publisher: "Nebius IR", title: "Q2 2026 results",
  url: "https://assets.nebius.com/assets/72a8c258-bbb7-4df7-ab9d-8698f6cb88fc/PR.pdf?cache-buster=2026-08-12T11:54:07.336Z",
  publishedOn: "2026-08-12", location: "p. 1 · Consolidated results",
};
const nebiusLetter: Source = {
  id: "nbis-letter", publisher: "Nebius IR", title: "Q2 2026 shareholder letter",
  url: "https://assets.nebius.com/assets/a6ecfd85-a6cb-4967-8ef7-9a25bd261f9c/SHLQ226.pdf?cache-buster=2026-08-12T11:54:46.695Z",
  publishedOn: "2026-08-12", location: "pp. 2, 5, 9–11 · Capacity / Financial update",
};
const micronSource: Source = {
  id: "mu-q3", publisher: "Micron IR", title: "Fiscal Q3 2026 results",
  url: "https://investors.micron.com/news/press-release/2026/Micron-Technology-Inc--Reports-Record-Results-for-the-Third-Quarter-of-Fiscal-2026/default.aspx",
  publishedOn: "2026-06-24", location: "Quarterly Financial Results / Business Outlook",
};
function metric(name: string, value: number, opts: Partial<Metric> = {}): Metric {
  return { name, value, unit: "million", currency: "USD", basis: "GAAP", scope: "Nebius Group", period: "Q2 2026", periodEnd: "2026-06-30", duration: "quarter", kind: "actual", sourceId: "nbis-q2", ...opts };
}

export const events: ResearchEvent[] = [
  {
    id: "nbis-palantir-2026-09-08", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "partnership",
    publishedOn: "2026-09-08", reviewedOn: "2026-09-19",
    title: copy("Palantirとの提携で、企業顧客への接点を拡大", "Palantir partnership opens a new enterprise channel"),
    summary: copy("Nebiusを優先インフラパートナーに指定。実際の収益化には統合と顧客の利用が必要。", "Nebius becomes a preferred infrastructure partner; integration and customer adoption remain ahead."),
    change: copy("Palantir顧客にNebiusの計算基盤を届ける、新たな提携を発表。", "A new partnership targets delivery of Nebius infrastructure to Palantir customers."),
    facts: [
      { text: copy("PalantirはNebiusを、ソブリンAIの優先インフラパートナーに指定。", "Palantir selected Nebius as its preferred sovereign AI infrastructure partner."), sourceIds: ["nbis-palantir"] },
      { text: copy("統合期間を経て、対象顧客がPalantirの環境内でNebiusを利用する計画。", "Eligible customers are expected to access Nebius within Palantir’s environment after integration."), sourceIds: ["nbis-palantir"] },
    ],
    interpretation: copy("企業向けの販路が広がる可能性。提携の発表だけで売上増加を確定させない。", "This could expand enterprise distribution. An announcement alone does not establish incremental revenue."),
    unknown: copy("この発表には契約金額・売上貢献額・利用開始日の具体的な開示がない。", "The announcement does not specify contract value, revenue contribution, or a launch date."),
    next: copy("統合完了、顧客の利用開始、収益への寄与が開示されるか。", "Watch for integration completion, customer adoption, and disclosed revenue contribution."),
    sources: [{ id: "nbis-palantir", publisher: "Nebius Newsroom", title: "Palantir–Nebius partnership", publishedOn: "2026-09-08", location: "Announcement · opening paragraphs", url: "https://nebius.com/newsroom/palantir-and-nebius-partner-to-deliver-a-complete-sovereign-ai-stack-to-palantir-customers" }],
    metrics: [],
  },
  {
    id: "nbis-q2-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "earnings",
    publishedOn: "2026-08-12", reviewedOn: "2026-09-19",
    title: copy("四半期売上とARRを分けて、成長を確認する", "Separate quarterly revenue from annualized run-rate"),
    summary: copy("グループ売上は$582.3M。AIクラウドのARR $3.0Bとは対象・期間・定義が異なる。", "Group revenue was $582.3M. AI cloud ARR of $3.0B has a different scope and definition."),
    change: copy("同じ四半期のグループ売上を前年と比較。ARRを四半期売上として扱わない。", "Compare group revenue with the same quarter a year earlier; do not treat ARR as quarterly revenue."),
    facts: [
      { text: copy("2026年Q2のグループ売上$582.3M、前年同期$105.1M。", "Q2 2026 group revenue was $582.3M versus $105.1M a year earlier."), sourceIds: ["nbis-q2"] },
      { text: copy("グループの継続事業純損失は$190.4M。", "Group net loss from continuing operations was $190.4M."), sourceIds: ["nbis-q2"] },
      { text: copy("AIクラウドARRは四半期最終月の売上を12倍した指標。", "AI cloud ARR annualizes the final month of the quarter by multiplying revenue by 12."), sourceIds: ["nbis-letter"] },
    ],
    interpretation: copy("売上拡大と損益は別々に追う。ARRは年間の売上実績ではない。", "Track growth and profitability separately. ARR is not realized annual revenue."),
    unknown: copy("この画面では市場予想と比較していないため、「予想超え」とは判定しない。", "No consensus comparison is included, so this is not labeled an earnings beat."),
    next: copy("売上拡大に伴い、継続事業の損失が縮小するか。", "Watch whether losses from continuing operations narrow as revenue grows."),
    sources: [nebiusRelease, nebiusLetter],
    metrics: [metric("revenue", 582.3), metric("arr", 3000, { scope: "Nebius AI cloud", basis: "operating", duration: "point-in-time", kind: "run-rate", sourceId: "nbis-letter" }), metric("net-income-continuing", -190.4)],
    previous: [metric("revenue", 105.1, { period: "Q2 2025", periodEnd: "2025-06-30" })],
  },
  {
    id: "nbis-capacity-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "capacity",
    publishedOn: "2026-08-12", reviewedOn: "2026-09-19",
    title: copy("契約電力の目標5GW。稼働済み容量とは区別", "5 GW contracted-power target is not operating capacity"),
    summary: copy("年末目標は契約電力。稼働開始と売上計上までを追う必要がある。", "The year-end target concerns contracted power; commissioning and revenue conversion still matter."),
    change: copy("2026年末の契約電力目標を5GWに引き上げ。", "The year-end 2026 contracted-power target increased to 5 GW."),
    facts: [
      { text: copy("会社は年末の契約電力目標を5GWとした。", "Management set a 5 GW contracted-power target for year-end."), sourceIds: ["nbis-letter"] },
    ],
    interpretation: copy("電力確保の進展は供給拡大の前提。5GWすべてが稼働しているとは読めない。", "Secured power supports expansion, but does not mean 5 GW is already operational."),
    unknown: copy("契約電力の数値だけでは稼働率や実際の売上を算定できない。", "Contracted power alone does not establish utilization or realized revenue."),
    next: copy("建設・通電・GPU導入・顧客利用の進捗を確認。", "Track construction, energization, GPU installation, and customer usage."),
    sources: [nebiusLetter],
    metrics: [metric("contracted-power", 5, { unit: "GW", currency: null, scope: "Nebius AI cloud", basis: "operating", period: "YE 2026", periodEnd: "2026-12-31", duration: "point-in-time", kind: "guidance", sourceId: "nbis-letter" })],
  },
  {
    id: "mu-q3-2026", ticker: "MU", company: "Micron", category: "memory", kind: "earnings",
    publishedOn: "2026-06-24", reviewedOn: "2026-09-19",
    title: copy("売上・粗利益率を前四半期と比較する", "Track quarterly revenue and gross-margin expansion"),
    summary: copy("Q3実績とQ4会社見通しを分離。GAAPと調整後の数値を混ぜない。", "Separate Q3 actuals from Q4 guidance and retain the same accounting basis."),
    change: copy("GAAP売上と粗利益率が前四半期から上昇。", "GAAP revenue and gross margin rose from the previous quarter."),
    facts: [
      { text: copy("Q3売上$41,456M、前四半期$23,860M。", "Q3 revenue was $41,456M versus $23,860M in Q2."), sourceIds: ["mu-q3"] },
      { text: copy("GAAP粗利益率は74.4%から84.6%へ。", "GAAP gross margin rose from 74.4% to 84.6%."), sourceIds: ["mu-q3"] },
      { text: copy("Q4売上の会社見通しは$50.0B ± $1.0B。", "Q4 revenue guidance was $50.0B ± $1.0B."), sourceIds: ["mu-q3"] },
    ],
    interpretation: copy("収益性の改善を確認。次四半期の見通しは未達・超過の両方があり得る。", "Profitability improved; next-quarter guidance remains an estimate."),
    unknown: copy("この資料だけでは現在の株価にどこまで織り込まれているかは分からない。", "This release alone does not establish how much is reflected in the current share price."),
    next: copy("Q4実績が売上見通しの範囲に入るか、同じ会計基準で検証。", "Compare Q4 results with the guidance range on a consistent basis."),
    sources: [micronSource],
    metrics: [
      metric("revenue", 41456, { scope: "Micron", period: "FQ3 2026", periodEnd: "2026-05-28", sourceId: "mu-q3" }),
      metric("gross-margin", 84.6, { unit: "percent", currency: null, scope: "Micron", period: "FQ3 2026", periodEnd: "2026-05-28", sourceId: "mu-q3" }),
    ],
    previous: [
      metric("revenue", 23860, { scope: "Micron", period: "FQ2 2026", periodEnd: "2026-02-26", sourceId: "mu-q3" }),
      metric("gross-margin", 74.4, { unit: "percent", currency: null, scope: "Micron", period: "FQ2 2026", periodEnd: "2026-02-26", sourceId: "mu-q3" }),
    ],
  },
  {
    id: "nbis-funding-q2-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "financing",
    publishedOn: "2026-08-12", reviewedOn: "2026-09-19",
    title: copy("資金調達を、売上成長と分けて追う", "Track equity funding alongside growth"),
    summary: copy("Q2にATMプログラムで1,270万株を売却。調達資金と1株当たりの持分への影響を確認する。", "12.7 million shares were sold through the ATM program in Q2. Track both funding and ownership dilution."),
    change: copy("四半期中の株式売却による資金調達を開示。", "The company disclosed equity funding during the quarter."),
    facts: [
      { text: copy("6月末までにATMで1,270万株を売却し、総額約$2.8Bを調達。", "Through June 30, ATM sales totaled 12.7 million shares and approximately $2.8B in gross proceeds."), sourceIds: ["nbis-letter"] },
      { text: copy("同プログラムで売却可能な残りの枠は1,230万株。", "The program had capacity for a further 12.3 million shares."), sourceIds: ["nbis-letter"] },
    ],
    interpretation: copy("設備拡張の資金確保と、既存株主の持分希薄化を同時に評価する。", "Assess expansion funding and dilution together."),
    unknown: copy("残りの枠が今後すべて使われるか、この資料では確定しない。", "The remaining authorization does not establish future sales."),
    next: copy("追加の株式売却、発行済株式数、設備投資額を次の開示で照合。", "Reconcile subsequent share sales, shares outstanding, and capital spending."),
    sources: [nebiusLetter], metrics: [],
  },
  {
    id: "nbis-q1-2026", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "earnings",
    publishedOn: "2026-05-13", reviewedOn: "2026-09-19",
    title: copy("Q1を比較の起点にする", "Establish the Q1 comparison baseline"),
    summary: copy("売上$399.0M、営業損失$128.0M。投資評価益を含む純利益とは分けて確認。", "Revenue was $399.0M and operating loss $128.0M. Distinguish operations from investment revaluation gains."),
    change: copy("次の決算と照合するため、Q1の実績を記録。", "Record the Q1 actuals for comparison with the next release."),
    facts: [
      { text: copy("グループ売上$399.0M、営業損失$128.0M。", "Group revenue was $399.0M and operating loss was $128.0M."), sourceIds: ["nbis-q1"] },
      { text: copy("継続事業純利益$621.2Mには、投資有価証券の評価益$780.6Mが含まれる。", "Net income from continuing operations of $621.2M included $780.6M in investment revaluation gains."), sourceIds: ["nbis-q1"] },
    ],
    interpretation: copy("純利益の黒字だけで本業の黒字化と判断しない。", "Positive net income alone does not establish operating profitability."),
    unknown: copy("投資評価益が次の四半期も続くとは限らない。", "Investment gains may not recur in the next quarter."),
    next: copy("Q2の売上、営業損失、資金需要を同じ定義で確認。", "Compare Q2 revenue, operating loss, and funding needs on the same basis."),
    sources: [
      { id: "nbis-q1", publisher: "Nebius IR", title: "Q1 2026 results", publishedOn: "2026-05-13", location: "pp. 1–2, 7 · Results / Cash flow / Operations", url: "https://assets.nebius.com/assets/0de223a2-f519-408d-8c7e-04f2fef342a9/Financial%20results_Q1%202026.pdf?cache-buster=2026-05-13T10:36:29.509Z" },
      { id: "nbis-q1-letter", publisher: "Nebius IR", title: "Q1 2026 shareholder letter", publishedOn: "2026-05-13", location: "pp. 3, 6, 9 · Capacity / ARR", url: "https://assets.nebius.com/assets/aa1bc2e6-df83-40cd-a6a2-95e7cda3d16c/Nebius%20SHL_Q1%202026.pdf?cache-buster=2026-05-13T14:00:35.352Z" },
    ],
    metrics: [metric("revenue", 399, { period: "Q1 2026", periodEnd: "2026-03-31", sourceId: "nbis-q1" })],
  },
];

export const metricNames: Record<string, Copy> = {
  revenue: copy("売上高", "Revenue"),
  arr: copy("AIクラウド ARR", "AI cloud ARR"),
  "net-income-continuing": copy("継続事業の純損益", "Net income · continuing operations"),
  "contracted-power": copy("契約電力の目標", "Contracted-power target"),
  "gross-margin": copy("粗利益率", "Gross margin"),
  "operating-income": copy("営業損益", "Operating income / loss"),
  "capital-spending": copy("設備・無形資産への支出", "Property, equipment & intangible purchases"),
  "net-capex": copy("設備投資（純額）", "Capital expenditures, net"),
  "adjusted-fcf": copy("調整後フリーキャッシュフロー", "Adjusted free cash flow"),
};
