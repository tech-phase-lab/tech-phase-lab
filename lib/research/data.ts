import type { Metric, Source } from "./quality";

export type Language = "ja" | "en";
export type Copy = Record<Language, string>;
export type ResearchEvent = {
  id: string; ticker: string; company: string;
  category: "cloud" | "memory";
  kind: "partnership" | "earnings" | "capacity" | "financing" | "product" | "external-research";
  publishedOn: string; reviewedOn: string;
  title: Copy; summary: Copy; change: Copy; interpretation: Copy;
  facts: { text: Copy; sourceIds: string[] }[];
  analysis?: { heading: Copy; body: Copy }[];
  scenarios?: { heading: Copy; body: Copy }[];
  unknown: Copy; next: Copy;
  sources: Source[]; metrics: Metric[];
  previous?: Metric[];
};

const copy = (ja: string, en: string): Copy => ({ ja, en });
const nebiusRelease: Source = {
  id: "nbis-q2", publisher: "Nebius IR", title: "Q2 2026 results",
  url: "https://assets.nebius.com/assets/72a8c258-bbb7-4df7-ab9d-8698f6cb88fc/PR.pdf?cache-buster=2026-08-12T11:54:07.336Z",
  publishedOn: "2026-08-12", location: "pp. 1–2, 7 · Results / Cash flow / Operations",
};
const nebiusLetter: Source = {
  id: "nbis-letter", publisher: "Nebius IR", title: "Q2 2026 shareholder letter",
  url: "https://assets.nebius.com/assets/a6ecfd85-a6cb-4967-8ef7-9a25bd261f9c/SHLQ226.pdf?cache-buster=2026-08-12T11:54:46.695Z",
  publishedOn: "2026-08-12", location: "pp. 2, 5, 9–11 · Capacity / Financial update",
};
const micronSource: Source = {
  id: "mu-q3", publisher: "Micron IR", title: "Fiscal Q3 2026 results",
  url: "https://investors.micron.com/news/press-release/2026/Micron-Technology-Inc--Reports-Record-Results-for-the-Third-Quarter-of-Fiscal-2026/default.aspx",
  publishedOn: "2026-06-24", location: "Quarterly results / Cash-flow reconciliation / Outlook",
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
    publishedOn: "2026-06-24", reviewedOn: "2026-09-27",
    title: copy("Micron：値上がりの次は、利益を守れる契約か", "Micron: from rising prices to more durable earnings?"),
    summary: copy("増収の勢いより、価格が落ち着いた後の利益に注目。長期契約の保護範囲と、増産に伴うコストが次の評価軸になる。", "Look beyond the revenue surge to earnings after pricing normalizes. Contract protection and the cost of expansion become the next tests."),
    change: copy("売上は前四半期比73.7％増。しかし、この伸び率を将来に延長するより、価格上昇への依存がどこまで契約で補われるかを読む決算。", "Revenue rose 73.7% sequentially. The forward question is how far contracts can cushion dependence on further price increases."),
    facts: [
      { text: copy("売上238.60億→414.56億ドル、GAAP粗利益率74.4％→84.6％。Q4会社予想は売上490〜510億ドル、同利益率約86％。", "Revenue: $23.860B → $41.456B; GAAP gross margin: 74.4% → 84.6%. Q4 guidance: $49–51B and approximately 86%."), sourceIds: ["mu-q3"] },
      { text: copy("会社は価格上昇を利益率改善の主因と説明。長期の顧客契約16件を締結し、大口契約には価格の上下限を設定。契約期間中の数量ではDRAM約2割・NAND約3分の1が対象。", "Management attributes margin expansion mainly to pricing. Sixteen strategic customer agreements are signed; major agreements have price floors and ceilings. Signed agreements cover roughly 20% of DRAM volume and one-third of NAND volume over their terms."), sourceIds: ["mu-remarks"] },
      { text: copy("会社は今後の製品高度化・新工場立ち上げに伴うDRAMの単位コスト上昇を想定。", "Management expects DRAM unit costs to rise with more complex products and new-fab ramps."), sourceIds: ["mu-remarks"] },
    ],
    interpretation: copy("Tech Phaseの見立ては「成長率の再加速」より「高収益をどこまで残せるか」への移行です。値上げが鈍っても利益の水準が維持されれば、伸び率低下だけで事業の悪化とは読めません。一方、長期契約があるという理由だけで、現在の利益率が固定されたとも考えません。", "Our thesis shifts from accelerating growth to retaining earnings power. Slower price increases need not mean deteriorating operations if profit levels hold. Conversely, long-term agreements do not lock in the current margin."),
    analysis: [
      { heading: copy("01｜次の決算は「増収率」だけでは判定できない", "01 | Slower growth is not the same as a reversal"), body: copy("Q4売上予想の中心値500億ドルは、Q3比で約20.6％増です。Q3の73.7％増からは減速しますが、同時に会社は利益率の上昇を見込んでいます。したがって、次に成長率が下がったという見出しだけでは判断を誤ります。確認するのは、価格上昇が緩やかになっても売上と利益の絶対額が増えるか。数量増と単価改善を分けて追い、値上げに頼らず伸ばせる部分が広がるなら、成長の質はむしろ改善する可能性があります。", "The $50B Q4 midpoint implies about 20.6% sequential growth, below Q3’s 73.7%, alongside a higher guided margin. A slower-growth headline would therefore be insufficient evidence of reversal. Separate shipment growth from pricing and ask whether revenue and profit dollars still rise. A broader volume contribution could improve growth quality even as the headline rate slows.") },
      { heading: copy("02｜長期契約は「上値を譲って、下値を守る」仕組み", "02 | Contract protection has an upside trade-off"), body: copy("価格の下限は、市況が下がったときに売上が全面的に連動して落ちるリスクを和らげます。ただし上限があれば、市況がさらに上昇しても、その契約部分の単価は同じようには伸びません。ここは強気材料と弱気材料を別々に数えるのではなく、収益の振れ幅を抑える交換条件として読むべきです。評価したいのは最大の利益ではなく、次の調整局面に残る利益。現時点の対象はDRAMの約2割・NANDの約3分の1という数量ベースで、全社を覆うものではありません。これを売上の保護割合に置き換えることもできません。契約外の価格と製品ごとの採算が、残る振れ幅を左右します。", "A floor can soften the transmission of weaker market prices into revenue. A ceiling can also restrict participation in further price increases. These are two sides of a trade-off: less variability rather than unlimited upside. The analytical target is profit retained through a downturn, not peak profit. The disclosed volume coverage is partial, not company-wide, and cannot be treated as a revenue-coverage ratio. Uncontracted pricing and product economics still determine residual volatility.") },
      { heading: copy("03｜価格が守られても、利益率は守られるとは限らない", "03 | Protected pricing is not protected margin"), body: copy("粗利益率は販売価格と製造コストの両方で決まります。価格の下限があっても、新工場の稼働率が低い期間や新製品の製造効率が上がらない期間には、採算が悪化し得ます。次世代製品の付加価値を価格に転嫁できるかが重要です。見る順番は、契約条件、製造コスト、設備投資後に残る現金。契約の拡大と同時に現金創出も維持されるなら、供給拡大を自力で支える構造に近づいたと評価できます。", "Margins depend on costs as well as prices. A price floor cannot prevent underused new capacity or poor manufacturing yields from compressing profitability. The key is whether new-product premiums cover added costs. Follow contract economics, manufacturing efficiency and cash remaining after investment, in that order. Stronger coverage accompanied by sustained cash generation would support a more self-financing expansion.") },
    ],
    scenarios: [
      { heading: copy("基本線｜伸び率は落ち着き、利益水準は維持", "Base case | Growth settles; earnings hold"), body: copy("会社予想に沿って売上と利益率が進み、価格の鈍化を数量・製品構成で補う。これを出発点とし、利益率の伸びが小さいことだけでは見立てを変えない。", "Start with delivery broadly consistent with guidance and volume or mix supporting sales as pricing moderates. Smaller margin gains alone would not overturn the thesis.") },
      { heading: copy("上振れ｜価格以外の成長が太くなる", "Upside | Growth broadens beyond pricing"), body: copy("出荷の増加と製造効率の改善が同時に進み、投資後の現金も増える場合。単価の上振れだけより、次の期にも続く利益の根拠として強い。", "Higher shipments and better manufacturing efficiency arrive together, with more cash after investment. That is stronger evidence of repeatable earnings than a price-only upside surprise.") },
      { heading: copy("見直し｜契約の保護よりコスト・需要の悪化が大きい", "Reassessment | Costs or demand overwhelm protection"), body: copy("契約条件の変更や数量の弱さに、利益率低下と現金創出の悪化が重なる場合。「成長率の正常化」では片づけず、収益の持続性という見立てを引き下げる。", "Contract revisions or weaker volumes coincide with margin compression and worse cash generation. That combination would weaken the durability thesis, rather than qualify as simple growth normalization.") },
    ],
    unknown: copy("契約別の採算と将来の製造コストは十分に見えません。そのため、下限価格から将来利益や適正株価を逆算する段階ではありません。上記の分岐は6月24日の開示から組み立てた分析で、会社予想とは区別しています。", "Contract-level economics and future manufacturing costs remain incomplete. We cannot derive a future earnings floor or fair share price from contract floors. The scenarios are our June 24 information-set analysis, not company forecasts."),
    next: copy("次の決算：売上490〜510億ドル・GAAP粗利益率約86％との比較に加え、数量と価格を分けて確認。\n契約の開示：件数だけでなく、対象数量・価格条件の変化を追う。保護が全社にどこまで届くかを見直す。\n増産の進捗：利益率と投資後の現金を組み合わせ、成長が資金負担の増加だけに終わっていないか確かめる。", "Next results: compare revenue and GAAP margin with guidance; separate volume from pricing.\nContract updates: track covered volume and pricing terms, not just agreement counts. Reassess company-wide protection.\nExpansion: assess margins alongside cash after investment to test whether growth is creating value beyond a larger funding burden."),
    sources: [micronSource, { id: "mu-remarks", publisher: "Micron IR", title: "Fiscal Q3 2026 prepared remarks", url: "https://s25.q4cdn.com/621799436/files/doc_financials/2026/q3/Q3-FY26-Prepared-Remarks.pdf", publishedOn: "2026-06-24", location: "pp. 2–4, 8, 10 · Contracts / Costs / Pricing / Outlook" }],
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
  {
    id: "nbis-spot-pricing-2026-09-22", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "product",
    publishedOn: "2026-09-22", reviewedOn: "2026-09-22",
    title: copy("プリエンプティブルVMに、需要連動のスポット価格を導入", "Nebius introduces demand-based spot pricing for preemptible VMs"),
    summary: copy("10月8日からGPU種類・地域・空き容量・需要に応じて価格を動的計算。利用者は上限価格を設定するか、スポット価格へ追従できます。", "From October 8, prices will vary by GPU type, region, available capacity, and demand. Customers can set a maximum price or follow the spot price."),
    change: copy("固定割引ではなく、空き容量と需要を反映する価格方式へ変更。", "Pricing moves from a fixed discount to a model tied to available capacity and demand."),
    facts: [
      { text: copy("NebiusはプリエンプティブルVMへスポット価格を導入すると公式発表。", "Nebius officially announced spot pricing for preemptible VMs."), sourceIds: ["nbis-spot-x"] },
      { text: copy("価格はGPU種類とリージョンごとに、利用可能な容量と需要をもとに動的に計算。", "Prices will be calculated dynamically by GPU type and region using available capacity and demand."), sourceIds: ["nbis-spot-x"] },
      { text: copy("利用者は価格上限を設定するか、その時点のスポット価格へ追従できる。", "Customers can set a maximum spot price or follow the current spot price."), sourceIds: ["nbis-spot-docs"] },
    ],
    interpretation: copy("余剰GPU容量の稼働率を上げ、価格に敏感な学習・推論需要を取り込む施策です。一方、低価格利用の増加が売上と利益率へどう効くかは、稼働率と平均単価を分けて確認する必要があります。", "The model can improve utilization of spare GPU capacity and attract price-sensitive training and inference workloads. Revenue and margin effects still depend on utilization and realized pricing."),
    unknown: copy("開始時点のGPU別スポット価格、通常価格からの平均割引率、対象容量、売上・利益率への影響は今回の発表だけでは確定しません。", "The announcement does not establish launch prices by GPU, average discounts versus on-demand rates, available capacity, or the revenue and margin impact."),
    next: copy("10月8日の実価格、対象リージョンとGPU、稼働率やAIクラウド売上への寄与を確認。", "Check October 8 launch prices, eligible regions and GPUs, and any later disclosure on utilization or AI cloud revenue."),
    sources: [
      { id: "nbis-spot-x", publisher: "Nebius official X", title: "Spot pricing announcement", publishedOn: "2026-09-22", location: "Official post · full announcement", url: "https://x.com/nebiusai/status/2102398298833190969" },
      { id: "nbis-spot-docs", publisher: "Nebius AI Cloud Docs", title: "Preemptible virtual machines", publishedOn: "2026-09-22", location: "Pricing policy / Follow spot price", url: "https://docs.nebius.com/compute/virtual-machines/preemptible" },
    ],
    metrics: [],
  },
  {
    id: "nbis-clustermax-platinum-2026-09-23", ticker: "NBIS", company: "Nebius", category: "cloud", kind: "external-research",
    publishedOn: "2026-09-23", reviewedOn: "2026-09-23",
    title: copy("SemiAnalysisがNebiusをClusterMAXのPlatinum tierに選定", "SemiAnalysis moves Nebius into ClusterMAX's Platinum tier"),
    summary: copy("GPUクラウドの外部評価で、NebiusはGoldからPlatinumへ。これは企業発表ではなく、SemiAnalysisによる有料業界調査の評価です。", "An external GPU-cloud assessment moves Nebius from Gold to Platinum. This is SemiAnalysis's paid industry research, not a company announcement."),
    change: copy("SemiAnalysisのClusterMAX 3.0で、Nebiusが前回のGoldからPlatinumへ昇格。", "In SemiAnalysis's ClusterMAX 3.0, Nebius moves up from Gold to Platinum."),
    facts: [
      { text: copy("調査は管理型GPUクラスター77社を対象とし、200社超の利用者への聞き取りを含むと説明。", "SemiAnalysis says ClusterMAX 3.0 reviews 77 managed GPU-cluster providers and draws on interviews with more than 200 end users."), sourceIds: ["nbis-clustermax-2026"] },
      { text: copy("公開された要約で、NebiusをCoreWeaveと並ぶPlatinum tierに分類。価格プレミアムを得られる事業者との評価を示した。", "The public summary places Nebius in the Platinum tier alongside CoreWeave and says it can command a pricing premium."), sourceIds: ["nbis-clustermax-2026"] },
    ],
    interpretation: copy("第三者によるGPUクラウドの技術・事業評価が上向いた材料です。ただし評価はSemiAnalysis独自の調査で、顧客契約や売上増加を直接証明するものではありません。", "This is a favorable third-party assessment of Nebius's GPU-cloud offering. The rating is SemiAnalysis's own research and does not directly prove customer contracts or revenue growth."),
    unknown: copy("評価の詳細な採点根拠は有料記事です。今回確認できた公開要約だけでは、Platinum判定の個別スコア、売上への寄与、調査方法の全容は分かりません。", "The detailed scoring is in a paid article. The public summary does not establish Nebius's individual scores, revenue impact, or the full methodology."),
    next: copy("Nebiusの稼働容量、顧客利用、価格・売上の会社開示と、今後の調査更新を別々に確認。", "Track company disclosures on deployed capacity, customer usage, pricing, and revenue separately from future rating updates."),
    sources: [{ id: "nbis-clustermax-2026", publisher: "SemiAnalysis · paid industry research", title: "ClusterMAX 3.0: The Industry Standard GPU Cloud Rating System Returns", publishedOn: "2026-09-23", location: "Public executive summary; Nebius rating and research scope", url: "https://newsletter.semianalysis.com/p/clustermax-30-the-industry-standard" }],
    metrics: [],
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
