import { companyIntroductions, companyIntroductionFor } from "./company-introductions.ts";
import reviewedNvidia from "./company-network-nvda-reviewed.data.json" with { type: "json" };
import type { CompanyNetwork, NetworkNode, NetworkEdge, NetworkEvidence, NetworkText } from "./company-network.ts";

const layers: Record<string, number> = {
  DOCN: 6, ESTC: 6, GTLB: 6, FROG: 6, NTNX: 6, NTAP: 5,
  ASML: 0, AMAT: 0, LRCX: 0, KLAC: 0, CDNS: 0, SNPS: 0, KEYS: 0, ONTO: 0, TER: 0, ENTG: 0, ACMR: 0, ICHR: 0, UCTT: 0, MKSI: 0, CAMT: 0, NVMI: 0, ACLS: 0, COHU: 0, FORM: 0, PLAB: 0, AEHR: 0, "ASM International": 0, "Tokyo Electron": 0, "Hitachi High-Tech": 0, Lasertec: 0, Nikon: 0, Canon: 0, "Carl Zeiss SMT": 0,
  TSM: 1, GFS: 1, TSEM: 1, UMC: 1, MU: 2, "SK hynix": 2, Samsung: 2, Kioxia: 2, SNDK: 2, WDC: 2, STX: 2, AMKR: 2, ASX: 2, IMOS: 2,
  NVDA: 3, AMD: 3, AVGO: 3, INTC: 3, ARM: 3, SIMO: 3, MCHP: 3, MPWR: 3, TXN: 3, ADI: 3, NXPI: 3, ON: 3, Phison: 3, ALAB: 3, MRVL: 3, CRDO: 3, QCOM: 3, SWKS: 3, QRVO: 3, MTSI: 3, POWI: 3, SITM: 3, RMBS: 3, DIOD: 3, SLAB: 3, CEVA: 3, STM: 3, HIMX: 3, CRUS: 3, SYNA: 3, AMBA: 3, INDI: 3, PI: 3, LSCC: 3, MXL: 3, AOSL: 3, NVTS: 3,
  LITE: 4, COHR: 4, AAOI: 4, CIEN: 4, IPGP: 4, VIAV: 4, InnoLight: 4, APH: 4, TEL: 4, GLW: 4, Molex: 4,
  BE: 5, VST: 5, GEV: 5, "Siemens Energy": 5, "Mitsubishi Power": 5, Vestas: 5, Hitachi: 5, ANET: 5, VRT: 5, ETN: 5, CSCO: 5, HPE: 5, DELL: 5, SMCI: 5, HPQ: 5, JBL: 5, FLEX: 5, ARW: 5, AVT: 5, SANM: 5, BHE: 5, RKLB: 5, ASTS: 5, PL: 5, BKSY: 5, AVAV: 5, KTOS: 5, RDW: 5, "Schneider Electric": 5, Legrand: 5,
  IREN: 6, MSFT: 6, AMZN: 6, GOOG: 6, META: 6, NBIS: 6, ORCL: 6, CRWV: 6, PLTR: 6, SNOW: 6, CRM: 6, NOW: 6, IBM: 6, FTNT: 6, ZS: 6, NET: 6, DDOG: 6, MDB: 6, AKAM: 6, OKTA: 6, S: 6, CHKP: 6, IONQ: 6, RGTI: 6, QBTS: 6, QUBT: 6, Crusoe: 6, Lambda: 6,
  TSLA: 7, ADBE: 7, INTU: 7, UBER: 7, NFLX: 7, TEAM: 7, TWLO: 7, DOCU: 7, HUBS: 7, SHOP: 7, APP: 7, ABNB: 7, SPOT: 7, RDDT: 7, PINS: 7, SNAP: 7, RBLX: 7, ROKU: 7, TTD: 7, DASH: 7, MELI: 7, PYPL: 7, XYZ: 7, SOFI: 7, DUOL: 7,
};

function buildNetwork() {
  const nodes = new Map<string, NetworkNode>();
  const edges = new Map<string, NetworkEdge>();
  const aliases = new Map(companyIntroductions.flatMap(item => item.tickers.map(ticker => [ticker, item.tickers[0]] as const)));
  const addNode = (node: NetworkNode) => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  const addEdge = (from: string, to: string, kind: NetworkEdge["kind"], evidence: NetworkEvidence) => {
    if (kind === "competition" || kind === "partner") [from, to] = [from, to].sort();
    if (from === to || !nodes.has(from) || !nodes.has(to)) throw new Error("Invalid company network edge");
    if (!evidence.sources.length || evidence.sources.some(source => !source.url.startsWith("https://"))) throw new Error("Missing company network evidence");
    const id = `${kind}:${from}:${to}`;
    const existing = edges.get(id);
    if (existing) existing.evidence.push(evidence);
    else edges.set(id, { id, from, to, kind, evidence: [evidence] });
  };
  for (const item of companyIntroductions) {
    const id = item.tickers[0];
    addNode({ id, ticker: id, name: item.name, kind: "company", layer: layers[id] ?? 7, summary: { ja: item.ja.business, en: item.en.business } });
  }
  for (const item of companyIntroductions) {
    const root = item.tickers[0];
    for (const [topic, entries] of Object.entries(item.maps)) {
      for (const entry of entries) {
        // Industry buckets are scoped to one issuer; they must never join two
        // companies into an invented named-customer relationship.
        const id = entry.kind === "industry" ? `${root}:industry:${topic}:${entry.name}` : aliases.get(entry.ticker ?? "") ?? entry.ticker ?? entry.name;
        addNode({ id, ticker: entry.ticker, name: entry.name, nameJa: entry.nameJa, kind: entry.kind, layer: entry.kind === "industry" ? 8 : layers[id] ?? 7 });
        const from = entry.role === "supplier" || entry.role === "investor" ? id : root;
        const to = from === root ? id : root;
        const kind = entry.role === "competitor" ? "competition" : entry.role === "supplier" || entry.role === "customer" ? "supply" : entry.role === "investor" ? "investment" : "partner";
        addEdge(from, to, kind, { about: root, label: entry.label, reviewedOn: item.reviewedOn, sources: entry.sourceIndexes.map(index => item.sources[index]) });
      }
    }
  }

  // Additional named relationships, independently checked against primary sources.
  // A platform adoption is not represented as a disclosed direct purchase contract.
  for (const [id, name] of [["DELL", "Dell"], ["SMCI", "Supermicro"]]) addNode({ id, ticker: id, name, kind: "company", layer: 5 });
  const supplement = (from: string, to: string, kind: NetworkEdge["kind"], label: NetworkText, url: string, sourceLabel: string) => addEdge(from, to, kind, { about: from, label, reviewedOn: "2026-10-13", sources: [{ label: sourceLabel, url }] });
  const tsmcSuppliers = "https://pr.tsmc.com/english/news/3274";
  for (const id of ["ASML", "AMAT", "LRCX"]) supplement(id, "TSM", "supply", { ja: "TSMCが製造を支える供給企業として公表", en: "Named by TSMC as a manufacturing supplier" }, tsmcSuppliers, "TSMC · 2025 supplier awards");
  supplement("AMAT", "TSM", "partner", { ja: "EPIC Centerで材料・装置・製造工程を共同開発", en: "Joint materials, equipment and process development at EPIC" }, "https://ir.appliedmaterials.com/news-releases/news-release-details/applied-materials-and-tsmc-partner-epic-center-accelerate-ai/", "Applied Materials · TSMC partnership, May 2026");
  supplement("NVDA", "CRWV", "supply", { ja: "CoreWeaveがGB200システムをクラウドに導入", en: "CoreWeave deploys GB200 systems in its cloud" }, "https://blogs.nvidia.com/blog/coreweave-grace-blackwell-gb200-nvl72/", "NVIDIA · CoreWeave Blackwell deployment");
  supplement("NVDA", "DELL", "supply", { ja: "DellのGB300搭載システムをCoreWeaveが導入", en: "CoreWeave deploys Dell systems built on NVIDIA GB300" }, "https://coreweave.com/news/coreweave-becomes-first-cloud-provider-to-deploy-nvidia-gb300-nvl72-platform", "CoreWeave · GB300 deployment, July 2025");
  supplement("DELL", "CRWV", "supply", { ja: "GB300搭載ラックシステムの導入で協力", en: "Rack systems for the GB300 deployment" }, "https://coreweave.com/news/coreweave-becomes-first-cloud-provider-to-deploy-nvidia-gb300-nvl72-platform", "CoreWeave · GB300 deployment, July 2025");
  supplement("VRT", "CRWV", "partner", { ja: "GB300システムの初期導入で協力", en: "Collaboration on the initial GB300 deployment" }, "https://coreweave.com/news/coreweave-becomes-first-cloud-provider-to-deploy-nvidia-gb300-nvl72-platform", "CoreWeave · GB300 deployment, July 2025");
  supplement("NVDA", "SMCI", "supply", { ja: "SupermicroがBlackwell Ultra搭載サーバーを出荷", en: "Supermicro ships servers using Blackwell Ultra" }, "https://ir.supermicro.com/news/news-details/2025/Supermicro-Begins-Volume-Shipments-of-NVIDIA-Blackwell-Ultra-Systems-and-Rack-Plug-and-Play-Data-Center-Scale-Solutions/default.aspx", "Supermicro · Blackwell Ultra shipments");
  supplement("NVDA", "AMZN", "supply", { ja: "AWSがNVIDIA B200をEC2 P6に採用", en: "AWS uses NVIDIA B200 GPUs in EC2 P6 instances" }, "https://aws.amazon.com/about-aws/whats-new/2025/05/amazon-ec2-p6-b200-instances-nvidia-b200-gpus/", "AWS · EC2 P6-B200 availability");
  supplement("NVDA", "GOOG", "supply", { ja: "Google CloudがGB200搭載A4Xを提供", en: "Google Cloud offers GB200-powered A4X VMs" }, "https://cloud.google.com/blog/products/compute/new-a4x-vms-powered-by-nvidia-gb200-gpus", "Google Cloud · A4X availability");
  supplement("NVDA", "MSFT", "supply", { ja: "AzureがNVIDIA H100搭載VMを提供", en: "Azure offers VMs powered by NVIDIA H100 GPUs" }, "https://azure.microsoft.com/en-us/blog/microsoft-and-nvidia-partnership-continues-to-deliver-on-the-promise-of-ai/", "Microsoft Azure · NVIDIA infrastructure");
  supplement("NVDA", "ORCL", "supply", { ja: "OCIがNVIDIA B200・GB200搭載設備を提供", en: "OCI offers infrastructure using NVIDIA B200 and GB200" }, "https://www.oracle.com/apac/a/ocom/docs/cloud/accelerate-ai-with-oci-supercluster-apac.pdf", "Oracle · OCI Supercluster");
  supplement("NVDA", "META", "partner", { ja: "GPU・CPU・ネットワークを含む複数年のAI基盤提携", en: "Multi-year AI infrastructure partnership across GPUs, CPUs and networking" }, "https://nvidianews.nvidia.com/news/meta-builds-ai-infrastructure-with-nvidia", "NVIDIA · Meta partnership, February 2026");
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const catalog = buildNetwork();

// Label the selected product context without reclassifying nodes or moving cards.
// The reviewed NVIDIA graph and every other issuer keep their existing labels.
function sectorLayerLabels(root: string): Record<number, NetworkText> | undefined {
  if (root === "AAPL") return { 5: { ja: "端末・PC・スマートフォン", en: "Devices, PCs & smartphones" }, 3: { ja: "通信・半導体部品", en: "Connectivity & semiconductor components" }, 6: { ja: "AI・機能連携", en: "AI & feature integration" }, 7: { ja: "端末・サービスと比較製品", en: "Devices, services & competing products" } };
  if (["GOOG", "AMZN"].includes(root)) return { 6: { ja: "クラウド・AI・複合サービス", en: "Cloud, AI & diversified services" }, 7: { ja: "検索・通販・広告・サービス", en: "Search, commerce, ads & services" } };
  if (root === "META") return { 3: { ja: "AI半導体・基盤協業", en: "AI chips & infrastructure collaboration" }, 6: { ja: "クラウド・計算基盤", en: "Cloud & compute infrastructure" }, 7: { ja: "交流・動画・広告", en: "Social, video & ads" } };
  if (root === "ON") return { 3: { ja: "電力・アナログ・画像半導体", en: "Power, analog & imaging chips" }, 7: { ja: "製品を採用する企業", en: "Named product adopters" } };

  if (root === "RDDT") return { 6: { ja: "クラウド・AI・データ提携", en: "Cloud, AI & data partnerships" }, 7: { ja: "交流・情報探索・広告", en: "Communities, discovery & ads" } };
  if (root === "PINS") return { 6: { ja: "クラウド・ログイン・広告提携", en: "Cloud, login & ad partnerships" }, 7: { ja: "商品・画像の発見・広告", en: "Product/visual discovery & ads" } };
  if (root === "SNAP") return { 6: { ja: "クラウド・OS・配信基盤", en: "Cloud, OS & distribution" }, 7: { ja: "動画・交流・広告", en: "Video, communication & ads" } };
  if (root === "ENTG") return { 0: { ja: "半導体用の高純度化・材料", en: "Semiconductor purity & materials" } };
  if (root === "MTSI") return { 3: { ja: "RF・光接続・アナログ半導体", en: "RF, optical connectivity & analog" } };
  if (root === "POWI") return { 3: { ja: "電源制御・モーター駆動半導体", en: "Power control & motor-drive chips" } };
  if (root === "ZM") return { 7: { ja: "会議・共同作業・顧客対応", en: "Meetings, collaboration & contact centers" } };
  if (root === "DOCN") return { 6: { ja: "クラウド・AI・データ基盤", en: "Cloud, AI & data infrastructure" } };
  if (root === "ESTC") return { 6: { ja: "検索・監視・防御・クラウド", en: "Search, observability, security & cloud" } };
  if (root === "FROG") return { 6: { ja: "開発・クラウド・AI基盤", en: "Development, cloud & AI infrastructure" } };
  if (root === "LITE") return {
    3: { ja: "チップ設計・接続半導体", en: "Chip design & connectivity" },
    4: { ja: "光源・モジュール・ファイバー", en: "Light sources, modules & fiber" },
    5: { ja: "光通信装置・システム", en: "Optical networking systems" },
  };
  if (root === "CRWV") return {
    6: { ja: "GPU計算・AIクラウド", en: "GPU compute & AI cloud" },
  };
  if (root === "ORCL") return {
    6: { ja: "クラウド計算基盤", en: "Cloud computing infrastructure" },
    7: { ja: "業務アプリ・データベース", en: "Business applications & databases" },
  };
  if (root === "PANW") return {
    7: { ja: "ネットワーク・端末防御", en: "Network & endpoint security" },
  };
  if (root === "NOW") return {
    6: { ja: "企業業務・ワークフロー", en: "Enterprise processes & workflows" },
  };
  if (root === "NXPI") return {
    3: { ja: "車載・組み込み半導体", en: "Automotive & embedded chips" },
  };
  if (root === "MPWR") return {
    3: { ja: "電源管理・混載半導体", en: "Power management & mixed-signal chips" },
  };
  if (root === "CIEN") return {
    4: { ja: "光伝送・ルーティング", en: "Optical transport & routing" },
  };
  if (root === "FTNT") return {
    6: { ja: "ネットワーク・端末・安全な接続", en: "Network, endpoint & secure access" },
  };
  if (root === "UBER") return {
    7: { ja: "配車・配送・貨物仲介", en: "Mobility, delivery & freight brokerage" },
  };
  if (root === "APP") return {
    7: { ja: "デジタル広告・利用者獲得", en: "Digital advertising & user acquisition" },
  };
  if (root === "SIMO") return {
    3: { ja: "SSD・NAND制御半導体", en: "SSD & NAND controller chips" },
  };
  if (root === "AAOI") return {
    4: { ja: "光通信部品・トランシーバー", en: "Optical components & transceivers" },
  };
  if (root === "GEV") return {
    5: { ja: "発電・送配電設備", en: "Generation & grid equipment" },
  };
  if (root === "IREN") return {
    6: { ja: "GPU計算・AIクラウド", en: "GPU compute & AI cloud" },
  };
  if (root === "LRCX") return {
    0: { ja: "成膜・エッチング・洗浄装置", en: "Deposition, etch & cleaning tools" },
  };
  if (root === "KLAC") return {
    0: { ja: "検査・計測・工程管理", en: "Inspection, metrology & process control" },
  };
  if (root === "SMCI") return {
    5: { ja: "サーバー・ラック・システム設計", en: "Servers, racks & system design" },
  };
  if (root === "CSCO") return {
    5: { ja: "ネットワーク機器", en: "Networking equipment" },
    7: { ja: "セキュリティ・Web会議", en: "Security & web meetings" },
  };
  if (root === "APH") return {
    4: { ja: "コネクター・光配線", en: "Connectors & optical cabling" },
  };
  if (root === "ANET") return {
    5: { ja: "ネットワーク機器・可視化", en: "Networking & packet visibility" },
  };
  if (root === "MRVL") return {
    3: { ja: "高速接続半導体", en: "High-speed connectivity chips" },
  };
  if (root === "VRT") return {
    5: { ja: "データセンター電源・冷却", en: "Data center power & cooling" },
  };
  if (root === "ALAB") return {
    3: { ja: "PCIe・CXL接続半導体", en: "PCIe & CXL connectivity chips" },
  };
  if (root === "NBIS") return {
    0: { ja: "NBIS・Nebius", en: "NBIS · Nebius" },
    1: { ja: "供給元", en: "Supplier" },
    2: { ja: "計算容量の顧客", en: "Capacity customers" },
    3: { ja: "提携先", en: "Partners" },
    4: { ja: "モデル・接続への技術対応", en: "Model & integration compatibility" },
    5: { ja: "GPUクラウドの競合", en: "Competing GPU clouds" },
    6: { ja: "供給元の先にある企業", en: "Further upstream companies" },
  };
  if (root === "ASML") return {
    0: { ja: "露光・計測・検査・光学部品", en: "Lithography, inspection & optics" },
  };
  if (root === "CRDO") return {
    3: { ja: "高速接続半導体", en: "High-speed connectivity chips" },
    4: { ja: "ケーブル・物理接続", en: "Cables & physical interconnect" },
  };
  if (root === "MU") return {
    2: { ja: "DRAM・HBM・NANDメモリ", en: "DRAM, HBM & NAND memory" },
  };
  if (root === "INTC") return {
    1: { ja: "半導体受託製造", en: "Foundry manufacturing" },
    3: { ja: "CPU・AIアクセラレーター", en: "CPUs & AI accelerators" },
  };
  if (root === "AMAT") return {
    0: { ja: "半導体製造装置・検査", en: "Semiconductor process tools & inspection" },
  };
  if (root === "AMD") return {
    3: { ja: "CPU・GPU・プログラマブル半導体", en: "CPUs, GPUs & programmable chips" },
  };
  if (root === "ARM") return {
    3: { ja: "CPU・プロセッサー設計IP", en: "CPUs & processor design IP" },
  };
  if (root === "QCOM") return {
    3: { ja: "スマホ・PCの演算・通信半導体", en: "Phone/PC compute & connectivity chips" },
  };
  if (root === "CDNS") return {
    0: { ja: "半導体設計・物理解析", en: "Electronic design & physics analysis" },
  };
  if (root === "RBLX") return {
    6: { ja: "ゲーム・クラウド基盤", en: "Gaming & cloud platforms" },
    7: { ja: "ゲーム体験・制作ツール", en: "Gaming experiences & creation tools" },
  };
  if (root === "DASH") return {
    7: { ja: "料理・食品・日用品の配送", en: "Meal, grocery & everyday delivery" },
  };
  if (root === "SONY") return {
    3: { ja: "画像センサー・関連半導体", en: "Image sensors & related chips" },
    6: { ja: "ゲーム・クラウド基盤", en: "Gaming & cloud platforms" },
    7: { ja: "ゲーム・映像コンテンツ", en: "Gaming & screen content" },
  };
  if (root === "V") return {
    7: { ja: "決済ネットワーク・購入決済", en: "Payment networks & checkout" },
  };
  if (root === "MA") return {
    7: { ja: "決済ネットワーク・購入決済", en: "Payment networks & checkout" },
  };
  if (root === "GTLB") return {
    6: { ja: "開発・クラウド基盤", en: "Development & cloud platforms" },
    7: { ja: "開発・配布ツール", en: "Development & delivery tools" },
  };
  if (root === "NTAP") return {
    5: { ja: "企業向けストレージ", en: "Enterprise storage" },
    6: { ja: "クラウド・データ基盤", en: "Cloud & data platforms" },
  };
  if (root === "PAYX") return {
    7: { ja: "給与・人事・共同雇用型支援", en: "Payroll, HR & co-employment services" },
  };
  if (root === "ADP") return {
    7: { ja: "給与・人事・共同雇用型支援", en: "Payroll, HR & co-employment services" },
  };
  if (root === "BILL") return {
    7: { ja: "経理・請求・経費管理", en: "Accounting, invoices & expenses" },
    6: { ja: "クラウド・業務ソフト", en: "Cloud & business software" },
  };
  if (root === "APPN") return {
    7: { ja: "業務自動化・導入支援", en: "Process automation & implementation" },
    6: { ja: "クラウド・開発基盤", en: "Cloud & development platforms" },
  };
  if (root === "NCNO") return {
    7: { ja: "銀行業務ソフト・導入支援", en: "Banking software & implementation" },
    6: { ja: "クラウド・業務基盤", en: "Cloud & business platforms" },
  };
  if (root === "ALKT") return {
    7: { ja: "デジタル銀行・口座開設", en: "Digital banking & account opening" },
  };
  if (root === "RPD") return {
    7: { ja: "セキュリティ製品・運用サービス", en: "Security products & managed operations" },
    6: { ja: "クラウド・セキュリティ基盤", en: "Cloud & security platforms" },
  };
  if (root === "SAP") return {
    7: { ja: "基幹業務ソフト・導入支援", en: "Enterprise applications & implementation" },
    6: { ja: "クラウド・業務基盤", en: "Cloud & business platforms" },
  };
  if (root === "SNOW") return {
    6: { ja: "データ分析・クラウド基盤", en: "Data analytics & cloud platforms" },
  };
  if (root === "IBM") return {
    6: { ja: "企業向けソフトウェア・クラウド", en: "Enterprise software & cloud" },
    7: { ja: "ITコンサルティング・業務サービス", en: "IT consulting & business services" },
  };
  if (root === "OKTA") return {
    6: { ja: "ID管理・認証基盤", en: "Identity management & authentication" },
  };
  if (root === "S") return {
    6: { ja: "セキュリティ基盤", en: "Security platforms" },
  };
  if (root === "CHKP") return {
    6: { ja: "セキュリティ基盤", en: "Security platforms" },
  };
  if (root === "DOCU") return {
    7: { ja: "電子署名・契約管理", en: "E-signatures & contract management" },
  };
  if (root === "ABNB") return {
    7: { ja: "宿泊予約・旅行検索", en: "Accommodation booking & travel search" },
  };
  if (root === "SPOT") return {
    7: { ja: "音楽・コンテンツ・広告", en: "Music, content & advertising" },
  };
  if (root === "ASAN") return {
    7: { ja: "業務管理・コラボレーション", en: "Work management & collaboration" },
  };
  if (root === "DIS") return {
    7: { ja: "映像・スポーツ・テーマパーク", en: "Video, sports & theme parks" },
  };
  if (["WDC", "STX"].includes(root)) return {
    2: { ja: "ストレージ製品", en: "Storage products" },
  };
  if (root === "HPQ") return {
    5: { ja: "PC・印刷・関連システム", en: "PCs, printing & related systems" },
  };
  if (["BE", "VST"].includes(root)) return {
    5: { ja: "発電・電力供給", en: "Power generation & supply" },
    7: { ja: "電力の関連企業", en: "Related power companies" },
  };
  if (root === "MELI") return {
    7: { ja: "通販・金融サービス", en: "Commerce & financial services" },
  };
  if (root === "SOFI") return {
    7: { ja: "金融サービス・銀行技術", en: "Financial services & banking technology" },
  };
  if (root === "DUOL") return {
    7: { ja: "語学学習・教育・試験", en: "Language learning, education & assessment" },
  };
  if (root === "TSLA") return {
    7: { ja: "自動車・蓄電システム", en: "Vehicles & energy storage" },
  };
  if (["IONQ", "RGTI", "QBTS", "QUBT"].includes(root)) return {
    6: { ja: "量子計算システム", en: "Quantum computing systems" },
    7: { ja: "量子計算の関連企業", en: "Related quantum computing companies" },
  };
  if (root === "ASTS") return {
    5: { ja: "衛星通信システム", en: "Satellite communications systems" },
    7: { ja: "衛星通信の関連企業", en: "Related satellite communications companies" },
  };
  if (["PL", "BKSY"].includes(root)) return {
    5: { ja: "衛星画像・地理空間情報", en: "Satellite imagery & geospatial intelligence" },
    7: { ja: "地理空間情報の関連企業", en: "Related geospatial intelligence companies" },
  };
  if (["RKLB", "RDW", "AVAV", "KTOS"].includes(root)) return {
    5: { ja: "宇宙・防衛システム", en: "Space & defense systems" },
    7: { ja: "宇宙・防衛の関連企業", en: "Related space & defense companies" },
  };
}

// A diversified peer's product in this comparison can differ from its category
// in the fixed semiconductor context (for example Canon printers versus optics).
const productContexts: Record<string, Record<string, { layer: number; businessLabel: NetworkText }>> = {
  "SNOW": {
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Redshift・クラウド基盤",
        "en": "Redshift & cloud infrastructure"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Fabric・クラウド基盤",
        "en": "Fabric & cloud infrastructure"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "BigQuery・クラウド基盤",
        "en": "BigQuery & cloud infrastructure"
      }
    },
    "Databricks": {
      "layer": 6,
      "businessLabel": {
        "ja": "SQLデータ分析",
        "en": "SQL data analytics"
      }
    },
    "PLTR": {
      "layer": 6,
      "businessLabel": {
        "ja": "データ統合・業務分析",
        "en": "Data integration & analytics"
      }
    }
  },
  "IBM": {
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "クラウド・企業向けソフト",
        "en": "Cloud & enterprise software"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "クラウド・企業向けソフト",
        "en": "Cloud & enterprise software"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "クラウド・企業向けソフト",
        "en": "Cloud & enterprise software"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "データベース・企業向けソフト",
        "en": "Databases & enterprise software"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けサーバー",
        "en": "Enterprise servers"
      }
    },
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けサーバー",
        "en": "Enterprise servers"
      }
    },
    "ACN": {
      "layer": 7,
      "businessLabel": {
        "ja": "ITコンサルティング",
        "en": "IT consulting"
      }
    },
    "Capgemini": {
      "layer": 7,
      "businessLabel": {
        "ja": "ITコンサルティング",
        "en": "IT consulting"
      }
    }
  },
  "OKTA": {
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Entra ID・従業員認証",
        "en": "Entra ID workforce authentication"
      }
    },
    "Ping Identity": {
      "layer": 6,
      "businessLabel": {
        "ja": "従業員・顧客向け認証",
        "en": "Workforce/customer authentication"
      }
    },
    "SAIL": {
      "layer": 6,
      "businessLabel": {
        "ja": "アクセス権限ガバナンス",
        "en": "Access governance"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "アプリ利用者の認証",
        "en": "Application-user authentication"
      }
    }
  },
  "S": {
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "端末の脅威防御",
        "en": "Endpoint threat protection"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "端末の脅威防御",
        "en": "Endpoint threat protection"
      }
    },
    "AVGO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Carbon Black・Symantec",
        "en": "Carbon Black & Symantec"
      }
    },
    "Trellix": {
      "layer": 6,
      "businessLabel": {
        "ja": "端末の脅威防御",
        "en": "Endpoint threat protection"
      }
    },
    "PANW": {
      "layer": 6,
      "businessLabel": {
        "ja": "セキュリティ基盤",
        "en": "Security platforms"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Splunk・脅威検知",
        "en": "Splunk threat detection"
      }
    },
    "ESTC": {
      "layer": 6,
      "businessLabel": {
        "ja": "ログ分析・脅威検知",
        "en": "Log analytics & threat detection"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Wiz・クラウド防御",
        "en": "Wiz cloud protection"
      }
    }
  },
  "CHKP": {
    "PANW": {
      "layer": 6,
      "businessLabel": {
        "ja": "ネットワーク防御",
        "en": "Network security"
      }
    },
    "FTNT": {
      "layer": 6,
      "businessLabel": {
        "ja": "ファイアウォール",
        "en": "Firewalls"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "ネットワーク防御",
        "en": "Network security"
      }
    },
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "Falcon Cloud Security",
        "en": "Falcon Cloud Security"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Defender for Cloud",
        "en": "Defender for Cloud"
      }
    }
  },
  "DOCU": {
    "ADBE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Acrobat Sign・電子署名",
        "en": "Acrobat Sign e-signatures"
      }
    },
    "DBX": {
      "layer": 7,
      "businessLabel": {
        "ja": "Dropbox Sign・電子署名",
        "en": "Dropbox Sign e-signatures"
      }
    },
    "Icertis": {
      "layer": 7,
      "businessLabel": {
        "ja": "契約ライフサイクル管理",
        "en": "Contract lifecycle management"
      }
    },
    "Ironclad": {
      "layer": 7,
      "businessLabel": {
        "ja": "契約ライフサイクル管理",
        "en": "Contract lifecycle management"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft 365内の署名",
        "en": "Signing within Microsoft 365"
      }
    }
  },
  "ABNB": {
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "旅行・宿泊検索",
        "en": "Travel & accommodation search"
      }
    },
    "BKNG": {
      "layer": 7,
      "businessLabel": {
        "ja": "宿泊施設の予約",
        "en": "Accommodation booking"
      }
    },
    "EXPE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Vrbo・貸切住宅予約",
        "en": "Vrbo whole-home booking"
      }
    },
    "MAR": {
      "layer": 7,
      "businessLabel": {
        "ja": "ホテル・リゾート",
        "en": "Hotels & resorts"
      }
    }
  },
  "SPOT": {
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "YouTube Music・動画・広告",
        "en": "YouTube Music, video & ads"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "音楽・Audible・広告",
        "en": "Music, Audible & ads"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "音楽・番組・音声書籍",
        "en": "Music, podcasts & audiobooks"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "コンテンツ・広告",
        "en": "Content & advertising"
      }
    },
    "ByteDance": {
      "layer": 7,
      "businessLabel": {
        "ja": "短編動画・利用時間",
        "en": "Short video & attention"
      }
    }
  },
  "ASAN": {
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Planner・Teams連携",
        "en": "Planner & Teams integration"
      }
    },
    "TEAM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Jira・Trello",
        "en": "Jira & Trello"
      }
    },
    "MNDY": {
      "layer": 7,
      "businessLabel": {
        "ja": "業務・プロジェクト管理",
        "en": "Work & project management"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Slackなどの業務連携",
        "en": "Slack/work integrations"
      }
    }
  },
  "DIS": {
    "SONY": {
      "layer": 7,
      "businessLabel": {
        "ja": "映画・映像制作",
        "en": "Film & content production"
      }
    },
    "NFLX": {
      "layer": 7,
      "businessLabel": {
        "ja": "映画・テレビ配信",
        "en": "Film & TV streaming"
      }
    },
    "CMCSA": {
      "layer": 7,
      "businessLabel": {
        "ja": "映像・スポーツ・パーク",
        "en": "Video, sports & theme parks"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "映像・スポーツ配信",
        "en": "Video & sports streaming"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "映像の電子配信",
        "en": "Digital video distribution"
      }
    }
  },
  "GTLB": {
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "GitHub・クラウド基盤",
        "en": "GitHub & cloud infrastructure"
      }
    },
    "TEAM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Bitbucket・コード管理",
        "en": "Bitbucket code management"
      }
    },
    "FROG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Artifactory・配布物管理",
        "en": "Artifactory artifact management"
      }
    },
    "Harness": {
      "layer": 7,
      "businessLabel": {
        "ja": "公開・配備の自動化",
        "en": "Continuous delivery"
      }
    }
  },
  "NTAP": {
    "NTNX": {
      "layer": 5,
      "businessLabel": {
        "ja": "Unified Storage",
        "en": "Unified Storage"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "PowerStore",
        "en": "PowerStore"
      }
    },
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "Alletra Storage",
        "en": "Alletra Storage"
      }
    },
    "IBM": {
      "layer": 5,
      "businessLabel": {
        "ja": "FlashSystem",
        "en": "FlashSystem"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "EFS・クラウド基盤",
        "en": "EFS & cloud infrastructure"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure Files・クラウド基盤",
        "en": "Azure Files & cloud infrastructure"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Filestore・クラウド基盤",
        "en": "Filestore & cloud infrastructure"
      }
    }
  },
  "PAYX": {
    "ADP": {
      "layer": 7,
      "businessLabel": {
        "ja": "給与・TotalSource",
        "en": "Payroll & TotalSource"
      }
    },
    "PAYC": {
      "layer": 7,
      "businessLabel": {
        "ja": "給与・人事管理",
        "en": "Payroll & HR"
      }
    },
    "PCTY": {
      "layer": 7,
      "businessLabel": {
        "ja": "給与管理",
        "en": "Payroll"
      }
    },
    "TNET": {
      "layer": 7,
      "businessLabel": {
        "ja": "共同雇用型の人事支援",
        "en": "Co-employment HR services"
      }
    },
    "NSP": {
      "layer": 7,
      "businessLabel": {
        "ja": "共同雇用型の人事支援",
        "en": "Co-employment HR services"
      }
    }
  },
  "ADP": {
    "PAYX": {
      "layer": 7,
      "businessLabel": {
        "ja": "給与・共同雇用型支援",
        "en": "Payroll & co-employment services"
      }
    },
    "PAYC": {
      "layer": 7,
      "businessLabel": {
        "ja": "給与・人事管理",
        "en": "Payroll & HR"
      }
    },
    "TNET": {
      "layer": 7,
      "businessLabel": {
        "ja": "共同雇用型の人事支援",
        "en": "Co-employment HR services"
      }
    },
    "NSP": {
      "layer": 7,
      "businessLabel": {
        "ja": "共同雇用型の人事支援",
        "en": "Co-employment HR services"
      }
    },
    "WDAY": {
      "layer": 7,
      "businessLabel": {
        "ja": "人事・給与管理",
        "en": "HCM & payroll"
      }
    }
  },
  "BILL": {
    "INTU": {
      "layer": 7,
      "businessLabel": {
        "ja": "QuickBooks Bill Pay",
        "en": "QuickBooks Bill Pay"
      }
    },
    "Ramp": {
      "layer": 7,
      "businessLabel": {
        "ja": "請求書の支払い",
        "en": "Invoice payments"
      }
    },
    "Tipalti": {
      "layer": 7,
      "businessLabel": {
        "ja": "買掛金・支払い自動化",
        "en": "Accounts payable automation"
      }
    },
    "SAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Concur Expense",
        "en": "Concur Expense"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "NetSuite・クラウド基盤",
        "en": "NetSuite & cloud infrastructure"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Dynamics・クラウド基盤",
        "en": "Dynamics & cloud infrastructure"
      }
    }
  },
  "APPN": {
    "PEGA": {
      "layer": 7,
      "businessLabel": {
        "ja": "Pega Platform",
        "en": "Pega Platform"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Power Platform・Azure",
        "en": "Power Platform & Azure"
      }
    },
    "NOW": {
      "layer": 7,
      "businessLabel": {
        "ja": "App Engine Studio",
        "en": "App Engine Studio"
      }
    },
    "PATH": {
      "layer": 7,
      "businessLabel": {
        "ja": "RPA・業務自動化",
        "en": "RPA automation"
      }
    },
    "ACN": {
      "layer": 7,
      "businessLabel": {
        "ja": "導入・業務変革支援",
        "en": "Implementation & transformation"
      }
    }
  },
  "NCNO": {
    "QTWO": {
      "layer": 7,
      "businessLabel": {
        "ja": "融資・条件設定",
        "en": "Lending & relationship pricing"
      }
    },
    "FIS": {
      "layer": 7,
      "businessLabel": {
        "ja": "法人向け融資管理",
        "en": "Commercial loan origination"
      }
    },
    "Abrigo": {
      "layer": 7,
      "businessLabel": {
        "ja": "融資・信用リスク管理",
        "en": "Lending & credit risk"
      }
    },
    "MeridianLink": {
      "layer": 7,
      "businessLabel": {
        "ja": "デジタル口座開設",
        "en": "Digital account opening"
      }
    },
    "ACN": {
      "layer": 7,
      "businessLabel": {
        "ja": "銀行業務の導入支援",
        "en": "Banking implementation"
      }
    }
  },
  "ALKT": {
    "QTWO": {
      "layer": 7,
      "businessLabel": {
        "ja": "デジタル銀行サービス",
        "en": "Digital banking"
      }
    },
    "FI": {
      "layer": 7,
      "businessLabel": {
        "ja": "Experience Digital",
        "en": "Experience Digital"
      }
    },
    "JKHY": {
      "layer": 7,
      "businessLabel": {
        "ja": "デジタル銀行サービス",
        "en": "Digital banking"
      }
    },
    "MeridianLink": {
      "layer": 7,
      "businessLabel": {
        "ja": "デジタル口座開設",
        "en": "Digital account opening"
      }
    }
  },
  "RPD": {
    "TENB": {
      "layer": 7,
      "businessLabel": {
        "ja": "脆弱性・露出管理",
        "en": "Vulnerability & exposure management"
      }
    },
    "QLYS": {
      "layer": 7,
      "businessLabel": {
        "ja": "脆弱性管理",
        "en": "Vulnerability management"
      }
    },
    "CSCO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Splunk Enterprise Security",
        "en": "Splunk Enterprise Security"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Sentinel・クラウド基盤",
        "en": "Sentinel & cloud infrastructure"
      }
    },
    "CRWD": {
      "layer": 7,
      "businessLabel": {
        "ja": "Falcon Complete MDR",
        "en": "Falcon Complete MDR"
      }
    }
  },
  "SAP": {
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Fusion ERP・クラウド",
        "en": "Fusion ERP & cloud"
      }
    },
    "WDAY": {
      "layer": 7,
      "businessLabel": {
        "ja": "人事・財務管理",
        "en": "HCM & financial management"
      }
    },
    "MANH": {
      "layer": 7,
      "businessLabel": {
        "ja": "倉庫管理",
        "en": "Warehouse management"
      }
    },
    "ACN": {
      "layer": 7,
      "businessLabel": {
        "ja": "業務ソフトの導入支援",
        "en": "Enterprise application implementation"
      }
    }
  },
  "AMAT": {
    "LRCX": {
      "layer": 0,
      "businessLabel": {
        "ja": "成膜・エッチング",
        "en": "Deposition & etch"
      }
    },
    "Tokyo Electron": {
      "layer": 0,
      "businessLabel": {
        "ja": "成膜・エッチング",
        "en": "Deposition & etch"
      }
    },
    "ASM International": {
      "layer": 0,
      "businessLabel": {
        "ja": "原子層堆積（ALD）",
        "en": "Atomic layer deposition"
      }
    },
    "KLAC": {
      "layer": 0,
      "businessLabel": {
        "ja": "検査・計測",
        "en": "Inspection & metrology"
      }
    }
  },
  "AMD": {
    "INTC": {
      "layer": 3,
      "businessLabel": {
        "ja": "サーバー・PCのCPU",
        "en": "Server & PC CPUs"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "GPU・AI計算",
        "en": "GPUs & AI compute"
      }
    },
    "Altera": {
      "layer": 3,
      "businessLabel": {
        "ja": "FPGA・適応型SoC",
        "en": "FPGAs & adaptive SoCs"
      }
    },
    "LSCC": {
      "layer": 3,
      "businessLabel": {
        "ja": "組み込みFPGA",
        "en": "Embedded FPGAs"
      }
    },
    "MCHP": {
      "layer": 3,
      "businessLabel": {
        "ja": "FPGA・プログラマブル半導体",
        "en": "FPGAs & programmable chips"
      }
    }
  },
  "ARM": {
    "INTC": {
      "layer": 3,
      "businessLabel": {
        "ja": "x86 CPU",
        "en": "x86 CPUs"
      }
    },
    "AMD": {
      "layer": 3,
      "businessLabel": {
        "ja": "x86 CPU",
        "en": "x86 CPUs"
      }
    },
    "SiFive": {
      "layer": 3,
      "businessLabel": {
        "ja": "RISC-V CPU設計IP",
        "en": "RISC-V CPU IP"
      }
    },
    "SNPS": {
      "layer": 3,
      "businessLabel": {
        "ja": "ARC・ARC-V設計IP",
        "en": "ARC & ARC-V processor IP"
      }
    }
  },
  "QCOM": {
    "MediaTek": {
      "layer": 3,
      "businessLabel": {
        "ja": "モバイル演算・通信",
        "en": "Mobile compute & connectivity"
      }
    },
    "Samsung Electronics": {
      "layer": 3,
      "businessLabel": {
        "ja": "Exynosモバイル半導体",
        "en": "Exynos mobile processors"
      }
    },
    "AAPL": {
      "layer": 3,
      "businessLabel": {
        "ja": "C1携帯モデム",
        "en": "C1 cellular modem"
      }
    },
    "INTC": {
      "layer": 3,
      "businessLabel": {
        "ja": "Core Ultra PC用CPU",
        "en": "Core Ultra PC processors"
      }
    },
    "AMD": {
      "layer": 3,
      "businessLabel": {
        "ja": "Ryzen PC用CPU",
        "en": "Ryzen PC processors"
      }
    }
  },
  "CDNS": {
    "SNPS": {
      "layer": 0,
      "businessLabel": {
        "ja": "EDA・IP・Ansys解析",
        "en": "EDA, IP & Ansys simulation"
      }
    },
    "Siemens EDA": {
      "layer": 0,
      "businessLabel": {
        "ja": "電子設計・検証EDA",
        "en": "Electronic design & verification"
      }
    },
    "KEYS": {
      "layer": 0,
      "businessLabel": {
        "ja": "電子設計・物理解析",
        "en": "Electronic design & analysis"
      }
    }
  },
  "RBLX": {
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Minecraft・クラウド基盤",
        "en": "Minecraft & cloud platforms"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "Horizon・体験制作",
        "en": "Horizon experience creation"
      }
    },
    "Epic Games": {
      "layer": 7,
      "businessLabel": {
        "ja": "Fortnite・UEFN",
        "en": "Fortnite & UEFN"
      }
    },
    "U": {
      "layer": 7,
      "businessLabel": {
        "ja": "ゲーム制作エンジン",
        "en": "Game creation engine"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "App Store・配信と決済",
        "en": "App Store distribution & payments"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Play・クラウド",
        "en": "Google Play & cloud"
      }
    }
  },
  "DASH": {
    "UBER": {
      "layer": 7,
      "businessLabel": {
        "ja": "Uber Eats・料理配達",
        "en": "Uber Eats meal delivery"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "食品・日用品の配送",
        "en": "Grocery & everyday delivery"
      }
    },
    "CART": {
      "layer": 7,
      "businessLabel": {
        "ja": "食品配送マーケットプレイス",
        "en": "Grocery delivery marketplace"
      }
    },
    "WMT": {
      "layer": 7,
      "businessLabel": {
        "ja": "食品・日用品の注文と配送",
        "en": "Grocery ordering & delivery"
      }
    }
  },
  "SONY": {
    "DIS": {
      "layer": 7,
      "businessLabel": {
        "ja": "映画・映像制作",
        "en": "Film & screen production"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Xbox・クラウド基盤",
        "en": "Xbox & cloud platforms"
      }
    },
    "Nintendo": {
      "layer": 7,
      "businessLabel": {
        "ja": "Switchゲーム機・ソフト",
        "en": "Switch consoles & games"
      }
    },
    "Samsung Electronics": {
      "layer": 3,
      "businessLabel": {
        "ja": "ISOCELL画像センサー",
        "en": "ISOCELL image sensors"
      }
    },
    "ON": {
      "layer": 3,
      "businessLabel": {
        "ja": "Hyperlux画像センサー",
        "en": "Hyperlux image sensors"
      }
    },
    "NFLX": {
      "layer": 7,
      "businessLabel": {
        "ja": "映像作品の配信先",
        "en": "Screen-content distributor"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Prime Video・クラウド",
        "en": "Prime Video & cloud"
      }
    }
  },
  "V": {
    "MA": {
      "layer": 7,
      "businessLabel": {
        "ja": "国際カード決済網",
        "en": "Global card network"
      }
    },
    "AXP": {
      "layer": 7,
      "businessLabel": {
        "ja": "カード決済ネットワーク",
        "en": "Card-payment network"
      }
    },
    "JCB": {
      "layer": 7,
      "businessLabel": {
        "ja": "カード決済ネットワーク",
        "en": "Card-payment network"
      }
    },
    "COF": {
      "layer": 7,
      "businessLabel": {
        "ja": "Discover決済ネットワーク",
        "en": "Discover payment network"
      }
    },
    "PYPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "残高・口座を使う購入決済",
        "en": "Balance/bank-funded checkout"
      }
    }
  },
  "MA": {
    "V": {
      "layer": 7,
      "businessLabel": {
        "ja": "国際カード決済網",
        "en": "Global card network"
      }
    },
    "AXP": {
      "layer": 7,
      "businessLabel": {
        "ja": "カード決済ネットワーク",
        "en": "Card-payment network"
      }
    },
    "JCB": {
      "layer": 7,
      "businessLabel": {
        "ja": "カード決済ネットワーク",
        "en": "Card-payment network"
      }
    },
    "COF": {
      "layer": 7,
      "businessLabel": {
        "ja": "Discover決済ネットワーク",
        "en": "Discover payment network"
      }
    },
    "PYPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "残高・口座を使う購入決済",
        "en": "Balance/bank-funded checkout"
      }
    }
  },
  "APH": {
    "TEL": {
      "layer": 4,
      "businessLabel": {
        "ja": "コネクター・電源接続",
        "en": "Connectors & power interconnect"
      }
    },
    "Molex": {
      "layer": 4,
      "businessLabel": {
        "ja": "高速電気・光接続",
        "en": "Electrical & optical interconnect"
      }
    },
    "GLW": {
      "layer": 4,
      "businessLabel": {
        "ja": "光ファイバー・配線",
        "en": "Optical fiber & cabling"
      }
    }
  },
  "ANET": {
    "CSCO": {
      "layer": 5,
      "businessLabel": {
        "ja": "スイッチ・ルーター",
        "en": "Switches & routers"
      }
    },
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "Aruba・Juniperネットワーク",
        "en": "Aruba & Juniper networking"
      }
    },
    "NVDA": {
      "layer": 5,
      "businessLabel": {
        "ja": "AI計算・ネットワーク接続",
        "en": "AI compute & networking"
      }
    },
    "EXTR": {
      "layer": 5,
      "businessLabel": {
        "ja": "学内・企業ネットワーク",
        "en": "Campus networking"
      }
    },
    "KEYS": {
      "layer": 5,
      "businessLabel": {
        "ja": "Visionパケットブローカー",
        "en": "Vision network packet brokers"
      }
    }
  },
  "MRVL": {
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "PCIe接続半導体",
        "en": "PCIe connectivity chips"
      }
    },
    "CRDO": {
      "layer": 3,
      "businessLabel": {
        "ja": "Toucan PCIeリタイマー",
        "en": "Toucan PCIe retimers"
      }
    },
    "ALAB": {
      "layer": 3,
      "businessLabel": {
        "ja": "Aries PCIeリタイマー",
        "en": "Aries PCIe retimers"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS：半導体顧客・EDA基盤",
        "en": "AWS: chip customer / EDA compute"
      }
    }
  },
  "VRT": {
    "Schneider Electric": {
      "layer": 5,
      "businessLabel": {
        "ja": "Uniflair冷却システム",
        "en": "Uniflair cooling"
      }
    },
    "ETN": {
      "layer": 5,
      "businessLabel": {
        "ja": "データセンター配電",
        "en": "Data center power distribution"
      }
    },
    "Legrand": {
      "layer": 5,
      "businessLabel": {
        "ja": "ラック配電",
        "en": "Rack power distribution"
      }
    },
    "JCI": {
      "layer": 5,
      "businessLabel": {
        "ja": "データセンター冷却",
        "en": "Data center thermal management"
      }
    },
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "GB300導入の協力先",
        "en": "GB300 deployment collaborator"
      }
    }
  },
  "ALAB": {
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "PCIeスイッチ・リタイマー",
        "en": "PCIe switches & retimers"
      }
    },
    "MRVL": {
      "layer": 3,
      "businessLabel": {
        "ja": "Alaska P PCIeリタイマー",
        "en": "Alaska P PCIe retimers"
      }
    },
    "CRDO": {
      "layer": 3,
      "businessLabel": {
        "ja": "Toucan PCIeリタイマー",
        "en": "Toucan PCIe retimers"
      }
    },
    "MCHP": {
      "layer": 3,
      "businessLabel": {
        "ja": "Switchtec PCIeスイッチ",
        "en": "Switchtec PCIe switches"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVLink Fusion接続協業",
        "en": "NVLink Fusion connectivity"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "支払い連動の顧客ワラント",
        "en": "Payment-linked customer warrants"
      }
    }
  },
  "NBIS": {
    "CRWV": {
      "layer": 5,
      "businessLabel": {
        "ja": "専業GPUクラウド",
        "en": "Specialist GPU cloud"
      }
    },
    "Crusoe": {
      "layer": 6,
      "businessLabel": {
        "ja": "GPUクラウド",
        "en": "GPU cloud"
      }
    },
    "Lambda": {
      "layer": 6,
      "businessLabel": {
        "ja": "GPUインスタンス",
        "en": "GPU instances"
      }
    },
    "AMZN": {
      "layer": 5,
      "businessLabel": {
        "ja": "AWS GPU計算",
        "en": "AWS GPU compute"
      }
    },
    "GOOG": {
      "layer": 5,
      "businessLabel": {
        "ja": "Google Cloud GPU計算",
        "en": "Google Cloud GPU compute"
      }
    },
    "MSFT": {
      "layer": 2,
      "businessLabel": {
        "ja": "Azure・容量顧客／競合",
        "en": "Azure · capacity customer / rival"
      }
    },
    "ORCL": {
      "layer": 5,
      "businessLabel": {
        "ja": "OCI GPU計算",
        "en": "OCI GPU compute"
      }
    },
    "NBIS": {
      "layer": 0,
      "businessLabel": {
        "ja": "Nebius・選択中の企業",
        "en": "Nebius · selected company"
      }
    },
    "NVDA": {
      "layer": 1,
      "businessLabel": {
        "ja": "GPU基盤の供給・技術協力",
        "en": "GPU infrastructure & engineering"
      }
    },
    "META": {
      "layer": 2,
      "businessLabel": {
        "ja": "GPU計算容量の顧客",
        "en": "GPU capacity customer"
      }
    },
    "PLTR": {
      "layer": 3,
      "businessLabel": {
        "ja": "ソブリンAI基盤の正式提携",
        "en": "Sovereign AI infrastructure partner"
      }
    },
    "Anthropic": {
      "layer": 4,
      "businessLabel": {
        "ja": "Claude・MCP接続への技術対応",
        "en": "Claude / MCP compatibility"
      }
    },
    "OpenAI": {
      "layer": 4,
      "businessLabel": {
        "ja": "GPT-OSSモデルの提供対応",
        "en": "GPT-OSS model availability"
      }
    },
    "IREN": {
      "layer": 5,
      "businessLabel": {
        "ja": "専用GPU計算容量",
        "en": "Dedicated GPU capacity"
      }
    }
  },
  "ASML": {
    "Nikon": {
      "layer": 0,
      "businessLabel": {
        "ja": "DUV露光装置",
        "en": "DUV lithography"
      }
    },
    "Canon": {
      "layer": 0,
      "businessLabel": {
        "ja": "DUV露光装置",
        "en": "DUV lithography"
      }
    },
    "AMAT": {
      "layer": 0,
      "businessLabel": {
        "ja": "計測・検査装置",
        "en": "Metrology & inspection"
      }
    },
    "KLAC": {
      "layer": 0,
      "businessLabel": {
        "ja": "計測・検査装置",
        "en": "Metrology & inspection"
      }
    },
    "Carl Zeiss SMT": {
      "layer": 0,
      "businessLabel": {
        "ja": "露光装置向け光学部品",
        "en": "Lithography optical components"
      }
    }
  },
  "CRDO": {
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "PCIe接続半導体",
        "en": "PCIe connectivity chips"
      }
    },
    "MRVL": {
      "layer": 3,
      "businessLabel": {
        "ja": "Alaska P PCIeリタイマー",
        "en": "Alaska P PCIe retimers"
      }
    },
    "ALAB": {
      "layer": 3,
      "businessLabel": {
        "ja": "Aries PCIeリタイマー",
        "en": "Aries PCIe retimers"
      }
    },
    "APH": {
      "layer": 4,
      "businessLabel": {
        "ja": "アクティブ電気ケーブル",
        "en": "Active electrical cables"
      }
    }
  },
  "MU": {
    "Samsung": {
      "layer": 2,
      "businessLabel": {
        "ja": "DRAM・HBM・NAND",
        "en": "DRAM, HBM & NAND"
      }
    },
    "SK hynix": {
      "layer": 2,
      "businessLabel": {
        "ja": "DRAM・HBM・NAND",
        "en": "DRAM, HBM & NAND"
      }
    },
    "Kioxia": {
      "layer": 2,
      "businessLabel": {
        "ja": "NANDフラッシュ・SSD",
        "en": "NAND flash & SSDs"
      }
    },
    "SNDK": {
      "layer": 2,
      "businessLabel": {
        "ja": "NANDフラッシュ・SSD",
        "en": "NAND flash & SSDs"
      }
    }
  },
  "INTC": {
    "AMD": {
      "layer": 3,
      "businessLabel": {
        "ja": "PC・サーバーCPUとAI計算",
        "en": "PC/server CPUs & AI compute"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "AIアクセラレーター",
        "en": "AI accelerators"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "半導体受託製造",
        "en": "Foundry manufacturing"
      }
    },
    "QCOM": {
      "layer": 3,
      "businessLabel": {
        "ja": "Snapdragon PC用CPU",
        "en": "Snapdragon PC processors"
      }
    },
    "AAPL": {
      "layer": 3,
      "businessLabel": {
        "ja": "MシリーズPC用CPU",
        "en": "M-series PC processors"
      }
    },
    "Samsung Electronics": {
      "layer": 1,
      "businessLabel": {
        "ja": "半導体受託製造",
        "en": "Foundry manufacturing"
      }
    }
  },
  "SIMO": {
    "Phison": {
      "layer": 3,
      "businessLabel": {
        "ja": "NAND・SSDコントローラー",
        "en": "NAND & SSD controllers"
      }
    },
    "MCHP": {
      "layer": 3,
      "businessLabel": {
        "ja": "Flashtec SSDコントローラー",
        "en": "Flashtec SSD controllers"
      }
    }
  },
  "AAOI": {
    "COHR": {
      "layer": 4,
      "businessLabel": {
        "ja": "データセンター光モジュール",
        "en": "Datacom optical modules"
      }
    },
    "LITE": {
      "layer": 4,
      "businessLabel": {
        "ja": "データセンター光トランシーバー",
        "en": "Datacom optical transceivers"
      }
    },
    "InnoLight": {
      "layer": 4,
      "businessLabel": {
        "ja": "光トランシーバー",
        "en": "Optical transceivers"
      }
    }
  },
  "GEV": {
    "Siemens Energy": {
      "layer": 5,
      "businessLabel": {
        "ja": "発電・送配電設備",
        "en": "Generation & grid equipment"
      }
    },
    "Mitsubishi Power": {
      "layer": 5,
      "businessLabel": {
        "ja": "発電設備",
        "en": "Power generation equipment"
      }
    },
    "Vestas": {
      "layer": 5,
      "businessLabel": {
        "ja": "風力発電機",
        "en": "Wind turbines"
      }
    },
    "Schneider Electric": {
      "layer": 5,
      "businessLabel": {
        "ja": "電力網制御・自動化",
        "en": "Grid control & automation"
      }
    },
    "Hitachi": {
      "layer": 5,
      "businessLabel": {
        "ja": "原子炉・燃料・保守の合弁",
        "en": "Nuclear technology joint ventures"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS電力協力・クラウド利用",
        "en": "AWS power initiatives & cloud"
      }
    }
  },
  "IREN": {
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "AI向けGPUクラウド",
        "en": "AI GPU cloud"
      }
    },
    "NBIS": {
      "layer": 6,
      "businessLabel": {
        "ja": "AI向けGPUクラウド",
        "en": "AI GPU cloud"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS GPU計算",
        "en": "AWS GPU compute"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud GPU計算",
        "en": "Google Cloud GPU compute"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure・専用GPU容量契約",
        "en": "Azure & dedicated GPU capacity"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "OCI GPU計算",
        "en": "OCI GPU compute"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "GPUサーバー調達",
        "en": "GPU server systems"
      }
    }
  },
  "LRCX": {
    "AMAT": {
      "layer": 0,
      "businessLabel": {
        "ja": "成膜・エッチング",
        "en": "Deposition & etch"
      }
    },
    "ASM International": {
      "layer": 0,
      "businessLabel": {
        "ja": "ALD・PECVD成膜",
        "en": "ALD & PECVD deposition"
      }
    },
    "Tokyo Electron": {
      "layer": 0,
      "businessLabel": {
        "ja": "エッチング・湿式洗浄",
        "en": "Etch & wet clean"
      }
    }
  },
  "KLAC": {
    "AMAT": {
      "layer": 0,
      "businessLabel": {
        "ja": "検査・計測",
        "en": "Inspection & metrology"
      }
    },
    "ASML": {
      "layer": 0,
      "businessLabel": {
        "ja": "計測・電子線検査",
        "en": "Metrology & e-beam inspection"
      }
    },
    "Hitachi High-Tech": {
      "layer": 0,
      "businessLabel": {
        "ja": "検査・計測",
        "en": "Inspection & metrology"
      }
    },
    "Lasertec": {
      "layer": 0,
      "businessLabel": {
        "ja": "検査装置",
        "en": "Inspection systems"
      }
    },
    "ONTO": {
      "layer": 0,
      "businessLabel": {
        "ja": "検査・計測",
        "en": "Inspection & metrology"
      }
    }
  },
  "SMCI": {
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "サーバー・ラック",
        "en": "Servers & racks"
      }
    },
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けサーバー",
        "en": "Enterprise servers"
      }
    },
    "CSCO": {
      "layer": 5,
      "businessLabel": {
        "ja": "データセンターシステム",
        "en": "Data center systems"
      }
    },
    "Lenovo": {
      "layer": 5,
      "businessLabel": {
        "ja": "サーバーシステム",
        "en": "Server systems"
      }
    },
    "Foxconn": {
      "layer": 5,
      "businessLabel": {
        "ja": "サーバーの設計・製造",
        "en": "Server design & manufacturing"
      }
    },
    "Quanta Computer": {
      "layer": 5,
      "businessLabel": {
        "ja": "サーバーの設計・製造",
        "en": "Server design & manufacturing"
      }
    }
  },
  "CSCO": {
    "ANET": {
      "layer": 5,
      "businessLabel": {
        "ja": "ネットワーク機器",
        "en": "Networking equipment"
      }
    },
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けネットワーク",
        "en": "Enterprise networking"
      }
    },
    "PANW": {
      "layer": 7,
      "businessLabel": {
        "ja": "ファイアウォール・防御",
        "en": "Firewalls & network defense"
      }
    },
    "CRWD": {
      "layer": 7,
      "businessLabel": {
        "ja": "端末保護・EDR",
        "en": "Endpoint protection & EDR"
      }
    },
    "ZM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Web会議",
        "en": "Web meetings"
      }
    }
  },
  "CRWV": {
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "専用GPUクラウド",
        "en": "Specialized GPU cloud"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS GPU計算",
        "en": "AWS GPU compute"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud GPU計算",
        "en": "Google Cloud GPU compute"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure・GPU容量の顧客",
        "en": "Azure & GPU-capacity customer"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "OCI GPU計算",
        "en": "OCI GPU compute"
      }
    }
  },
  "ORCL": {
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "OCI・データベース・業務アプリ",
        "en": "OCI, databases & applications"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWSクラウド基盤",
        "en": "AWS cloud infrastructure"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud基盤",
        "en": "Google Cloud infrastructure"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure・企業業務アプリ",
        "en": "Azure & enterprise applications"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "顧客対応アプリ",
        "en": "Customer-service applications"
      }
    },
    "SAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "ERP・業務アプリ",
        "en": "ERP & business applications"
      }
    },
    "IBM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Db2データベース",
        "en": "Db2 databases"
      }
    }
  },
  "PANW": {
    "PANW": {
      "layer": 7,
      "businessLabel": {
        "ja": "ネットワーク・クラウド・端末防御",
        "en": "Network, cloud & endpoint security"
      }
    },
    "CSCO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Secure Firewall",
        "en": "Secure Firewall"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Defender・Azure保護の連携",
        "en": "Defender & Azure protection ecosystem"
      }
    },
    "CRWD": {
      "layer": 7,
      "businessLabel": {
        "ja": "Falcon端末保護",
        "en": "Falcon endpoint protection"
      }
    },
    "FTNT": {
      "layer": 7,
      "businessLabel": {
        "ja": "FortiGateファイアウォール",
        "en": "FortiGate firewalls"
      }
    }
  },
  "NOW": {
    "NOW": {
      "layer": 6,
      "businessLabel": {
        "ja": "IT・顧客・人事ワークフロー",
        "en": "IT, customer & employee workflows"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Power Automate・クラウド連携",
        "en": "Power Automate & cloud collaboration"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Fusion企業業務",
        "en": "Fusion enterprise processes"
      }
    },
    "CRM": {
      "layer": 6,
      "businessLabel": {
        "ja": "Service Cloud顧客対応",
        "en": "Service Cloud customer service"
      }
    },
    "SAP": {
      "layer": 6,
      "businessLabel": {
        "ja": "Build業務自動化",
        "en": "Build process automation"
      }
    },
    "WDAY": {
      "layer": 6,
      "businessLabel": {
        "ja": "人事業務・HCM",
        "en": "HR processes & HCM"
      }
    }
  },
  "NXPI": {
    "NXPI": {
      "layer": 3,
      "businessLabel": {
        "ja": "車載・産業用組み込み半導体",
        "en": "Automotive/industrial embedded chips"
      }
    },
    "ADI": {
      "layer": 3,
      "businessLabel": {
        "ja": "アナログ・車載産業用半導体",
        "en": "Analog/automotive-industrial chips"
      }
    },
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "車載Ethernet",
        "en": "Automotive Ethernet"
      }
    },
    "MCHP": {
      "layer": 3,
      "businessLabel": {
        "ja": "マイコン・組み込み半導体",
        "en": "MCUs & embedded chips"
      }
    },
    "QCOM": {
      "layer": 3,
      "businessLabel": {
        "ja": "車載プラットフォーム",
        "en": "Automotive platforms"
      }
    },
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "アナログ・組み込み半導体",
        "en": "Analog & embedded chips"
      }
    }
  },
  "MPWR": {
    "MPWR": {
      "layer": 3,
      "businessLabel": {
        "ja": "電源管理・電力変換",
        "en": "Power management & conversion"
      }
    },
    "ADI": {
      "layer": 3,
      "businessLabel": {
        "ja": "電源・混載半導体",
        "en": "Power & mixed-signal chips"
      }
    },
    "NXPI": {
      "layer": 3,
      "businessLabel": {
        "ja": "PMIC電源管理",
        "en": "PMIC power management"
      }
    },
    "ON": {
      "layer": 3,
      "businessLabel": {
        "ja": "電源変換製品",
        "en": "Power conversion products"
      }
    },
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "電源管理半導体",
        "en": "Power-management chips"
      }
    },
    "Infineon": {
      "layer": 3,
      "businessLabel": {
        "ja": "電源IC",
        "en": "Power-supply ICs"
      }
    }
  },
  "CIEN": {
    "CIEN": {
      "layer": 4,
      "businessLabel": {
        "ja": "光伝送装置・ルーター",
        "en": "Optical transport systems & routers"
      }
    },
    "Nokia": {
      "layer": 4,
      "businessLabel": {
        "ja": "光伝送・ネットワーク",
        "en": "Optical transport & networking"
      }
    },
    "CSCO": {
      "layer": 4,
      "businessLabel": {
        "ja": "ルーティング・光通信",
        "en": "Routing & optical networking"
      }
    },
    "HPE": {
      "layer": 4,
      "businessLabel": {
        "ja": "Juniperルーター",
        "en": "Juniper routers"
      }
    },
    "Huawei": {
      "layer": 4,
      "businessLabel": {
        "ja": "通信・光伝送設備",
        "en": "Telecom & optical transport"
      }
    },
    "ZTE": {
      "layer": 4,
      "businessLabel": {
        "ja": "光伝送・ネットワーク",
        "en": "Optical transport & networking"
      }
    }
  },
  "FTNT": {
    "FTNT": {
      "layer": 6,
      "businessLabel": {
        "ja": "FortiGate・FortiEDR・安全な接続",
        "en": "FortiGate, FortiEDR & secure access"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Secure Firewall",
        "en": "Secure Firewall"
      }
    },
    "PANW": {
      "layer": 6,
      "businessLabel": {
        "ja": "ファイアウォール・防御",
        "en": "Firewalls & network defense"
      }
    },
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "Falcon端末保護",
        "en": "Falcon endpoint protection"
      }
    },
    "ZS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Internet Access安全な接続",
        "en": "Internet Access secure access"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Defender端末防御",
        "en": "Defender endpoint security"
      }
    }
  },
  "UBER": {
    "UBER": {
      "layer": 7,
      "businessLabel": {
        "ja": "配車・配送・貨物仲介",
        "en": "Mobility, delivery & freight brokerage"
      }
    },
    "LYFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "配車アプリ",
        "en": "Ride-hailing app"
      }
    },
    "Didi": {
      "layer": 7,
      "businessLabel": {
        "ja": "海外の配車",
        "en": "International ride-hailing"
      }
    },
    "Bolt": {
      "layer": 7,
      "businessLabel": {
        "ja": "地域別の配車",
        "en": "Regional ride-hailing"
      }
    },
    "Ola": {
      "layer": 7,
      "businessLabel": {
        "ja": "インドの配車",
        "en": "Indian ride-hailing"
      }
    },
    "DASH": {
      "layer": 7,
      "businessLabel": {
        "ja": "商品配送",
        "en": "Product delivery"
      }
    },
    "CHRW": {
      "layer": 7,
      "businessLabel": {
        "ja": "貨物仲介",
        "en": "Freight brokerage"
      }
    }
  },
  "APP": {
    "APP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Axon広告・媒体収益化",
        "en": "Axon advertising & monetization"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google広告",
        "en": "Google advertising"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "広告配信・利用者獲得",
        "en": "Advertising & user acquisition"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "広告配信",
        "en": "Advertising platforms"
      }
    },
    "U": {
      "layer": 7,
      "businessLabel": {
        "ja": "広告による利用者獲得",
        "en": "Advertising user acquisition"
      }
    }
  },
  "LITE": {
    "LITE": {
      "layer": 4,
      "businessLabel": {
        "ja": "光半導体・モジュール",
        "en": "Optical chips & modules"
      }
    },
    "COHR": {
      "layer": 4,
      "businessLabel": {
        "ja": "光通信部品・産業用レーザー",
        "en": "Optics & industrial lasers"
      }
    },
    "AAOI": {
      "layer": 4,
      "businessLabel": {
        "ja": "データセンター光モジュール",
        "en": "Datacom optical modules"
      }
    },
    "IPGP": {
      "layer": 4,
      "businessLabel": {
        "ja": "材料加工用レーザー",
        "en": "Materials-processing lasers"
      }
    },
    "AVGO": {
      "layer": 4,
      "businessLabel": {
        "ja": "200G/lane EML光源",
        "en": "200G/lane EML light sources"
      }
    },
    "CIEN": {
      "layer": 5,
      "businessLabel": {
        "ja": "2017年WaveLogicモジュール開発",
        "en": "2017 WaveLogic module development"
      }
    },
    "GLW": {
      "layer": 4,
      "businessLabel": {
        "ja": "ファイバー・2026年CPO展示",
        "en": "Fiber & OFC 2026 CPO demo"
      }
    },
    "MTSI": {
      "layer": 3,
      "businessLabel": {
        "ja": "2019年OFC相互接続デモ",
        "en": "OFC 2019 interoperability demo"
      }
    },
    "POET": {
      "layer": 4,
      "businessLabel": {
        "ja": "2022年DML採用発表",
        "en": "2022 DML adoption announcement"
      }
    }
  },
  "RKLB": {
    "RKLB": {
      "layer": 5,
      "businessLabel": {
        "ja": "打ち上げ・宇宙機・部品",
        "en": "Launch, spacecraft & components"
      }
    },
    "LUNR": {
      "layer": 5,
      "businessLabel": {
        "ja": "Lanteris国防向け宇宙機",
        "en": "Lanteris defense spacecraft"
      }
    },
    "PL": {
      "layer": 7,
      "businessLabel": {
        "ja": "衛星画像事業・打ち上げ顧客",
        "en": "Imagery business & past launch customer"
      }
    },
    "SpaceX": {
      "layer": 5,
      "businessLabel": {
        "ja": "打ち上げサービス",
        "en": "Launch services"
      }
    },
    "FLY": {
      "layer": 5,
      "businessLabel": {
        "ja": "Alpha打ち上げサービス",
        "en": "Alpha launch services"
      }
    },
    "NOC": {
      "layer": 5,
      "businessLabel": {
        "ja": "宇宙機・衛星バス",
        "en": "Spacecraft & satellite buses"
      }
    },
    "RDW": {
      "layer": 5,
      "businessLabel": {
        "ja": "宇宙機電力・構造部品",
        "en": "Spacecraft power/structure components"
      }
    }
  },
  "RDDT": {
    "RDDT": {
      "layer": 7,
      "businessLabel": {
        "ja": "交流・情報探索・広告",
        "en": "Communities, discovery & ads"
      }
    },
    "PINS": {
      "layer": 7,
      "businessLabel": {
        "ja": "発見・趣味・広告",
        "en": "Discovery, interests & ads"
      }
    },
    "SNAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "利用時間・広告",
        "en": "Engagement & ads"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud・2024年データ提携",
        "en": "Google Cloud & 2024 data partnership"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "Facebook等の交流・広告",
        "en": "Facebook communities & ads"
      }
    },
    "ByteDance": {
      "layer": 7,
      "businessLabel": {
        "ja": "TikTok関連事業・合弁会社の利用時間・広告",
        "en": "TikTok businesses/JVs: engagement & ads"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS・クラウド基盤の利用",
        "en": "AWS cloud infrastructure"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "2024年データ・AI・広告提携",
        "en": "2024 data, AI & advertising partnership"
      }
    }
  },
  "PINS": {
    "PINS": {
      "layer": 7,
      "businessLabel": {
        "ja": "商品・画像の発見・広告",
        "en": "Product/visual discovery & ads"
      }
    },
    "RDDT": {
      "layer": 7,
      "businessLabel": {
        "ja": "交流・広告",
        "en": "Community engagement & ads"
      }
    },
    "SNAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "利用時間・広告",
        "en": "Engagement & ads"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Googleログイン基盤",
        "en": "Google login platform"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "Facebook・Instagram・広告等",
        "en": "Facebook, Instagram & ads"
      }
    },
    "ByteDance": {
      "layer": 7,
      "businessLabel": {
        "ja": "TikTok関連事業・合弁会社の利用時間・広告",
        "en": "TikTok businesses/JVs: engagement & ads"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS基盤・Amazon広告提携",
        "en": "AWS infrastructure / Amazon ads"
      }
    },
    "AAPL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Appleログイン基盤",
        "en": "Apple login platform"
      }
    }
  },
  "SNAP": {
    "SNAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "動画・交流・広告",
        "en": "Video, communication & ads"
      }
    },
    "PINS": {
      "layer": 7,
      "businessLabel": {
        "ja": "利用時間・広告",
        "en": "Engagement & ads"
      }
    },
    "RDDT": {
      "layer": 7,
      "businessLabel": {
        "ja": "交流・広告",
        "en": "Community engagement & ads"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud・Android配信",
        "en": "Google Cloud / Android distribution"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "Instagram Stories・広告等",
        "en": "Instagram Stories & ads"
      }
    },
    "ByteDance": {
      "layer": 7,
      "businessLabel": {
        "ja": "TikTokと関連合弁会社",
        "en": "TikTok & affiliated joint ventures"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWSクラウド基盤",
        "en": "AWS cloud infrastructure"
      }
    },
    "AAPL": {
      "layer": 6,
      "businessLabel": {
        "ja": "iOS・App Store配信",
        "en": "iOS / App Store distribution"
      }
    }
  },
  "ENTG": {
    "ENTG": {
      "layer": 0,
      "businessLabel": {
        "ja": "半導体用の高純度化・材料",
        "en": "Semiconductor purity & materials"
      }
    },
    "Pall": {
      "layer": 0,
      "businessLabel": {
        "ja": "Danaher傘下・高純度化",
        "en": "Danaher subsidiary"
      }
    },
    "Merck Electronics": {
      "layer": 0,
      "businessLabel": {
        "ja": "Merck KGaA・電子材料",
        "en": "Merck KGaA electronic materials"
      }
    }
  },
  "MTSI": {
    "MTSI": {
      "layer": 3,
      "businessLabel": {
        "ja": "RF・光接続・アナログ半導体",
        "en": "RF, optical connectivity & analog"
      }
    },
    "ADI": {
      "layer": 3,
      "businessLabel": {
        "ja": "RF・高性能アナログ",
        "en": "RF/high-performance analog"
      }
    },
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "通信・光接続半導体",
        "en": "Communication/optical connectivity chips"
      }
    },
    "MRVL": {
      "layer": 3,
      "businessLabel": {
        "ja": "高速通信半導体",
        "en": "High-speed communication chips"
      }
    },
    "SWKS": {
      "layer": 3,
      "businessLabel": {
        "ja": "RF・旧Qorvo事業を含む",
        "en": "RF, including former Qorvo"
      }
    }
  },
  "POWI": {
    "POWI": {
      "layer": 3,
      "businessLabel": {
        "ja": "電源制御・モーター駆動半導体",
        "en": "Power control & motor-drive chips"
      }
    },
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "PWM制御IC",
        "en": "PWM controllers"
      }
    },
    "NXPI": {
      "layer": 3,
      "businessLabel": {
        "ja": "PWM制御IC",
        "en": "PWM controllers"
      }
    },
    "ON": {
      "layer": 3,
      "businessLabel": {
        "ja": "モーター駆動用モジュール",
        "en": "Motor-drive power modules"
      }
    },
    "Infineon": {
      "layer": 3,
      "businessLabel": {
        "ja": "高電圧電源IC・駆動製品",
        "en": "High-voltage power ICs/drivers"
      }
    },
    "STM": {
      "layer": 3,
      "businessLabel": {
        "ja": "高電圧電源IC・モーター駆動",
        "en": "High-voltage power ICs/motor drives"
      }
    }
  },
  "ZM": {
    "ZM": {
      "layer": 7,
      "businessLabel": {
        "ja": "会議・共同作業・顧客対応",
        "en": "Meetings, collaboration & contact centers"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Teams・会議と共同作業",
        "en": "Teams meetings/collaboration"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google Meet・会議",
        "en": "Google Meet meetings"
      }
    },
    "CSCO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Webex会議",
        "en": "Webex meetings"
      }
    },
    "FIVN": {
      "layer": 7,
      "businessLabel": {
        "ja": "コンタクトセンター",
        "en": "Contact center"
      }
    }
  },
  "DOCN": {
    "DOCN": {
      "layer": 6,
      "businessLabel": {
        "ja": "クラウド・AI計算基盤",
        "en": "Cloud & AI compute infrastructure"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "クラウド・AI/ML基盤",
        "en": "Cloud/AI-ML infrastructure"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azureクラウド・AI/ML",
        "en": "Azure cloud/AI-ML"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud・AI/ML",
        "en": "Google Cloud/AI-ML"
      }
    },
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "AI/ML計算基盤",
        "en": "AI/ML infrastructure"
      }
    }
  },
  "ESTC": {
    "ESTC": {
      "layer": 6,
      "businessLabel": {
        "ja": "検索・可観測性・セキュリティ",
        "en": "Search, observability & security"
      }
    },
    "MDB": {
      "layer": 6,
      "businessLabel": {
        "ja": "Atlasの検索・ベクトル検索",
        "en": "Atlas search/vector search"
      }
    },
    "DDOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "可観測性",
        "en": "Observability"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Splunk可観測性・防御",
        "en": "Splunk observability/security"
      }
    },
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "セキュリティ",
        "en": "Security"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "派生検索基盤",
        "en": "Fork-based search platform"
      }
    }
  },
  "FROG": {
    "FROG": {
      "layer": 6,
      "businessLabel": {
        "ja": "ソフトウェア成果物の管理",
        "en": "Software artifact management"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "GitHub Packages成果物保管",
        "en": "GitHub Packages artifacts"
      }
    },
    "GTLB": {
      "layer": 6,
      "businessLabel": {
        "ja": "Package Registry",
        "en": "Package Registry"
      }
    },
    "Sonatype": {
      "layer": 6,
      "businessLabel": {
        "ja": "Nexus Repository成果物保管",
        "en": "Nexus Repository artifacts"
      }
    }
  },
  "ON": {
    "NIO": {
      "layer": 7,
      "businessLabel": {
        "ja": "EliteSiC採用のEVメーカー",
        "en": "EV maker adopting EliteSiC"
      }
    },
    "Samsung": {
      "layer": 3,
      "businessLabel": {
        "ja": "画像センサー",
        "en": "Image sensors"
      }
    }
  },
  "AAPL": {
    "AAPL": {
      "layer": 5,
      "businessLabel": {
        "ja": "端末・ソフトウェア・サービス",
        "en": "Devices, software & services"
      }
    },
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "5G RF・FBAR部品",
        "en": "5G RF / FBAR components"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "ChatGPT機能の統合提携",
        "en": "ChatGPT integration partner"
      }
    },
    "HPQ": {
      "layer": 5,
      "businessLabel": {
        "ja": "Macと比較するPC",
        "en": "PCs competing with Mac"
      }
    },
    "Samsung": {
      "layer": 5,
      "businessLabel": {
        "ja": "Galaxyスマートフォン",
        "en": "Galaxy smartphones"
      }
    }
  },
  "AMZN": {
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS・通販・広告",
        "en": "AWS, commerce & ads"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS Trainiumの計算顧客",
        "en": "AWS Trainium compute customer"
      }
    },
    "PINS": {
      "layer": 7,
      "businessLabel": {
        "ja": "AWSを利用する画像探索・広告企業",
        "en": "Visual-discovery / ads company using AWS"
      }
    },
    "SNAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "AWSを利用する交流・広告企業",
        "en": "Social / ads company using AWS"
      }
    },
    "MRVL": {
      "layer": 3,
      "businessLabel": {
        "ja": "AWS向けAI・光接続半導体",
        "en": "AI / optical chips for AWS"
      }
    }
  },
  "GOOG": {
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud・検索・広告",
        "en": "Google Cloud, search & ads"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud TPUの計算顧客",
        "en": "Google Cloud TPU customer"
      }
    },
    "RDDT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Data API・Vertex AI提携",
        "en": "Data API / Vertex AI partner"
      }
    },
    "SNAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google Cloudを利用する交流・広告企業",
        "en": "Social / ads company using Google Cloud"
      }
    }
  },
  "META": {
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "交流・広告・AIサービス",
        "en": "Social, ads & AI services"
      }
    },
    "AMD": {
      "layer": 3,
      "businessLabel": {
        "ja": "Instinct GPUの容量計画",
        "en": "Instinct GPU capacity plan"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "CPU・GPU・通信基盤の協業",
        "en": "CPU / GPU / networking partner"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "検索・YouTubeの広告",
        "en": "Search / YouTube advertising"
      }
    },
    "NBIS": {
      "layer": 6,
      "businessLabel": {
        "ja": "契約に基づくAI計算容量の供給元",
        "en": "Contracted AI compute-capacity supplier"
      }
    }
  }
};

function productScopedNodes(root: string, nodes: NetworkNode[]): NetworkNode[] {
  if (productContexts[root]) return nodes.map(node => {
    const product = productContexts[root][node.id];
    return product ? { ...node, ...product } : node;
  });
  if (root === "MELI") return nodes.map(node => {
    if (["AMZN", "SE"].includes(node.id)) return {
      ...node, layer: 7, businessLabel: { ja: "ブラジルの通販", en: "Brazilian commerce" },
    };
    if (node.id === "NU") return {
      ...node, layer: 7, businessLabel: { ja: "個人向け金融", en: "Consumer finance" },
    };
    return node;
  });
  if (root === "HPQ") return nodes.map(node => {
    if (["DELL", "AAPL", "MSFT", "Lenovo"].includes(node.id)) return {
      ...node, layer: 5, businessLabel: { ja: "PC・端末", en: "PCs & devices" },
    };
    if (["Canon", "Seiko Epson", "Brother Industries", "XRX"].includes(node.id)) return {
      ...node, layer: 5, businessLabel: { ja: "プリンター・消耗品", en: "Printers & supplies" },
    };
    return node;
  });
  if (["WDC", "STX"].includes(root)) return nodes.map(node => {
    if (["WDC", "STX", "Toshiba Electronic Devices & Storage"].includes(node.id) && node.id !== root) return {
      ...node, layer: 2, businessLabel: { ja: "HDD", en: "HDDs" },
    };
    if (["MU", "Samsung Electronics"].includes(node.id)) return {
      ...node, layer: 2, businessLabel: { ja: "企業向けSSD", en: "Enterprise SSDs" },
    };
    return node;
  });
  return nodes;
}

export function companyNetworkFor(issuer: { cik: number; ticker: string }): CompanyNetwork | null {
  const introduction = companyIntroductionFor(issuer);
  if (!introduction) return null;
  const root = introduction.tickers[0];
  // NVIDIA's editorial map is restored exactly from 95b5b29 (before bulk
  // additions). Biographies must never automatically expand this reviewed map.
  if (root === "NVDA") return reviewedNvidia as CompanyNetwork;
  // Start with this issuer's researched facts, never references added by
  // unrelated biographies. Only the fixed reviewed map supplies context.
  const ownEdges = catalog.edges.filter(edge =>
    (edge.from === root || edge.to === root) && edge.evidence.some(item => item.about === root));
  const included = new Set([root]);
  for (const edge of ownEdges) {
    if (edge.from === root) included.add(edge.to);
    if (edge.to === root) included.add(edge.from);
  }
  const context = reviewedNvidia as CompanyNetwork;
  if (root === "NBIS") {
    const suppliers = new Set(introduction.maps.relationships.filter(e => e.kind === "company" && e.role === "supplier").map(e => e.ticker ?? e.name));
    const extra = context.edges.filter(e => e.kind === "supply" && suppliers.has(e.to) && !included.has(e.from));
    const ids = new Set([...included, ...extra.map(e => e.from)]);
    const ownNodes = catalog.nodes.filter(n => ids.has(n.id));
    const scoped = productScopedNodes(root, ownNodes).map(n => included.has(n.id) ? n : { ...n, layer: 6 });
    return { root, nodes: scoped, edges: [...ownEdges, ...extra], layerLabels: sectorLayerLabels(root) };
  }
  if (["PINS", "SNAP", "AMAT", "MRVL", "VRT", "ALAB", "ON", "AAPL", "AMZN", "GOOG", "META"].includes(root)) {
    // Supplier context may explain an upstream dependency. It must not import
    // that supplier's unrelated customers or turn an AI partner into NVIDIA's
    // entire customer network. Competition is never an expansion bridge.
    const suppliers = new Set(introduction.maps.relationships.filter(e => e.kind === "company" && e.role === "supplier").map(e => e.ticker ?? e.name));
    const extra = context.edges.filter(e => e.kind === "supply" && suppliers.has(e.to) && e.from !== root && !ownEdges.some(own => own.id === e.id));
    const ids = new Set([...included, ...extra.flatMap(e => [e.from, e.to])]);
    return { root, nodes: productScopedNodes(root, catalog.nodes.filter(n => ids.has(n.id))), edges: [...ownEdges, ...extra], layerLabels: sectorLayerLabels(root) };
  }
  const depth = new Map<string, number>([[root, 0]]);
  for (const edge of ownEdges) if (edge.kind !== "competition") depth.set(edge.from === root ? edge.to : edge.from, 1);
  // At most three steps, 41 cards and 61 edges: the approved NVDA scale.
  // Rivalry never pulls in a rival's customers or suppliers.
  for (let step = 1; step < 3; step++) for (const edge of context.edges) {
    if (edge.kind === "competition") continue;
    const next = depth.get(edge.from) === step ? edge.to : depth.get(edge.to) === step ? edge.from : null;
    if (!next || depth.has(next) || included.size >= 41) continue;
    included.add(next);
    depth.set(next, step + 1);
  }
  const edges = new Map(ownEdges.map(edge => [edge.id, edge]));
  for (const edge of context.edges) {
    if (edges.size >= 61) break;
    if (edge.kind !== "competition" && included.has(edge.from) && included.has(edge.to) && !edges.has(edge.id)) edges.set(edge.id, edge);
  }
  // Use the reviewed labels/order for context; add only this issuer's own nodes.
  const nodes = new Map(context.nodes.filter(node => included.has(node.id)).map(node => [node.id, node]));
  for (const node of catalog.nodes) if (included.has(node.id) && !nodes.has(node.id)) nodes.set(node.id, node);
  nodes.set(root, catalog.nodes.find(node => node.id === root)!);
  const layerLabels = sectorLayerLabels(root);
  return { root, nodes: productScopedNodes(root, [...nodes.values()]), edges: [...edges.values()], ...(layerLabels ? { layerLabels } : {}) };
}
