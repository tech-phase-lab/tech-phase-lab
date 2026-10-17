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
  if (root === "TENB") return { 5: { ja: "関連する計算基盤", en: "Related computing infrastructure" }, 6: { ja: "クラウド・技術連携", en: "Cloud and technology integration" }, 7: { ja: "脆弱性管理・クラウド防御", en: "Vulnerability management and cloud security" } };
  if (root === "QTWO") return { 5: { ja: "関連する計算基盤", en: "Related computing infrastructure" }, 6: { ja: "クラウド・金融技術の連携", en: "Cloud and financial technology integration" }, 7: { ja: "銀行ソフト・融資・組込金融", en: "Banking software, lending and embedded finance" } };
  if (root === "TTWO") return { 5: { ja: "関連する端末・計算基盤", en: "Related devices and computing infrastructure" }, 6: { ja: "クラウド・プラットフォーム連携", en: "Cloud and platform relationships" }, 7: { ja: "ゲーム開発・販売・配信", en: "Game development, publishing and distribution" } };
  if (root === "BHE") return {"5":{"ja":"電子機器受託製造・サーバー供給先","en":"Electronics manufacturing & server customer"}};
  if (root === "SWKS") return {"3": {"ja": "RF・アナログ半導体", "en": "RF & analog semiconductors"}, "7": {"ja": "半導体製品の顧客", "en": "Semiconductor customers"}};
  if (root === "RDW") return {"5": {"ja": "宇宙・防衛システムと機器供給先", "en": "Space / defense systems & hardware customers"}, "7": {"ja": "宇宙・防衛の関連企業", "en": "Related space & defense companies"}};
  if (root === "KTOS") return {"5": {"ja": "無人機・防衛システムの開発協力", "en": "Uncrewed / defense systems & collaboration"}, "7": {"ja": "宇宙・防衛の関連企業", "en": "Related space & defense companies"}};
  if (root === "AVAV") return {"5": {"ja": "無人機・防衛システム・ペイロード対応", "en": "Uncrewed / defense systems & payload integration"}, "7": {"ja": "防衛システムの関連企業", "en": "Related defense-system companies"}};
  if (root === "BKSY") return {"1": {"ja": "衛星打ち上げの供給元", "en": "Satellite-launch provider"}, "5": {"ja": "衛星画像・地理空間情報", "en": "Satellite imagery & geospatial intelligence"}, "7": {"ja": "地理空間情報の関連企業", "en": "Related geospatial intelligence companies"}};
  if (root === "PL") return {"3": {"ja": "GPU画像処理の開発協力", "en": "GPU-imagery development partner"}, "5": {"ja": "衛星画像・地理空間情報", "en": "Satellite imagery & geospatial intelligence"}, "7": {"ja": "地理空間情報の関連企業", "en": "Related geospatial intelligence companies"}};
  if (root === "QUBT") return {"4": {"ja": "量子安全な光通信の技術協力", "en": "Quantum-safe optical communications"}, "6": {"ja": "量子計算システム", "en": "Quantum computing systems"}, "7": {"ja": "量子計算の関連企業", "en": "Related quantum companies"}};
  if (root === "QBTS") return {"6": {"ja": "量子計算システム", "en": "Quantum computing systems"}, "7": {"ja": "量子最適化を使う通信事業者", "en": "Telecom quantum-optimization user"}};
  if (root === "RGTI") return {"6": {"ja": "量子計算システム・クラウド利用窓口", "en": "Quantum systems & cloud-access partners"}, "7": {"ja": "量子計算の関連企業", "en": "Related quantum companies"}};
  if (root === "IONQ") return {"6": {"ja": "量子計算システム・クラウド利用窓口", "en": "Quantum systems & cloud-access partners"}, "7": {"ja": "量子計算の関連企業", "en": "Related quantum companies"}};
  if (root === "IPGP") return {"0": {"ja": "産業用レーザー・溶接構成", "en": "Industrial lasers & welding options"}};
  if (root === "NVTS") return {"3": {"ja": "GaN・SiC電源半導体", "en": "GaN & SiC power chips"}, "5": {"ja": "800VDC向け技術対応", "en": "800 VDC architecture compatibility"}};
  if (root === "CEVA") return {"3": {"ja": "半導体IP・採用先のチップ", "en": "Semiconductor IP & licensee chips"}};
  if (root === "SLAB") return {"3": {"ja": "無線・IoT半導体", "en": "Wireless & IoT chips"}, "7": {"ja": "Sidewalkネットワーク技術対応", "en": "Sidewalk network compatibility"}};
  if (root === "DIOD") return {"3": {"ja": "アナログ・電源・ディスクリート半導体", "en": "Analog, power & discrete chips"}, "7": {"ja": "半導体の販売代理店", "en": "Semiconductor distributors"}};
  if (root === "RMBS") return {"3": {"ja": "半導体IP・メモリー技術協力", "en": "Semiconductor IP & memory collaboration"}};
  if (root === "SITM") return {"1": {"ja": "ウエハー製造の供給元", "en": "Wafer foundry suppliers"}, "3": {"ja": "タイミング半導体", "en": "Timing semiconductors"}};
  if (root === "PAYC") return {"7": {"ja": "給与・人事・給与カード網", "en": "Payroll, HR & payroll-card network"}};
  if (root === "WMT") return {"6": {"ja": "AIを使うコマース連携", "en": "AI-commerce integrations"}, "7": {"ja": "小売・通販", "en": "Retail & commerce"}};
  if (root === "QLYS") return {"6": {"ja": "クラウド接続・認証対応", "en": "Cloud connectors & authentication"}, "7": {"ja": "脆弱性・サイバーリスク管理", "en": "Vulnerability & cyber-risk management"}};
  if (root === "APPF") return {"6": {"ja": "クラウド基盤・AIモデル対応", "en": "Cloud infrastructure & AI models"}, "7": {"ja": "不動産管理ソフトウェア", "en": "Property-management software"}};
  if (root === "TWLO") return {"6": {"ja": "会話AIの開発協業", "en": "Conversational-AI development"}, "7": {"ja": "通信・顧客対応・顧客データ基盤", "en": "Communications, engagement & customer data"}};
  if (root === "AKAM") return {"3": {"ja": "GPU供給元と上流", "en": "GPU supplier & upstream"}, "6": {"ja": "クラウド・CDN・防御サービス", "en": "Cloud, CDN & security"}, "7": {"ja": "CPUクラウド容量の顧客", "en": "CPU cloud-capacity customer"}};
  if (root === "XYZ") return {"7": {"ja": "決済・店舗・注文連携", "en": "Payments, merchants & order integration"}};
  if (root === "PYPL") return {"7": {"ja": "決済・ウォレット・コマース連携", "en": "Payments, wallets & commerce"}, "6": {"ja": "クラウド・AI・コマース技術連携", "en": "Cloud, AI & commerce technology"}};
  if (root === "TTD") return {"7": {"ja": "広告購入・媒体在庫連携", "en": "Ad buying & publisher inventory"}};
  if (root === "ROKU") return {"7": {"ja": "TV配信・CTV広告", "en": "TV streaming & CTV advertising"}};
  if (root === "SHOP") return {"7": {"ja": "コマース基盤・販売チャネル", "en": "Commerce platforms & channels"}, "6": {"ja": "クラウド・AI・コマース技術連携", "en": "Cloud, AI & commerce technology"}};
  if (root === "NFLX") return {"7": {"ja": "動画・ゲーム配信と番組協業", "en": "Video, games & program distribution"}};
  if (root === "VIAV") return {"0": {"ja": "通信ネットワーク試験", "en": "Network test & validation"}, "3": {"ja": "AI-RAN試験・シミュレーション協業", "en": "AI-RAN testing / simulation collaboration"}, "4": {"ja": "光学材料・特殊光製品", "en": "Optical materials & specialty optics"}};
  if (root === "MXL") return {"3": {"ja": "接続・通信・信号処理半導体", "en": "Connectivity & signal-processing silicon"}, "5": {"ja": "エッジネットワーク技術協業", "en": "Edge-network collaboration"}};
  if (root === "LSCC") return {"3": {"ja": "FPGA・物理AIプラットフォーム協業", "en": "FPGAs & physical-AI platform collaboration"}};
  if (root === "PI") return {"3": {"ja": "RFID半導体・識別技術", "en": "RFID chips & identification"}, "7": {"ja": "RFID製品の採用先", "en": "RFID product adopter"}};
  if (root === "INDI") return {"1": {"ja": "レーダーSoCの製造技術協業", "en": "Radar-SoC manufacturing collaboration"}, "3": {"ja": "車載レーダー・電源半導体", "en": "Automotive radar & power semiconductors"}};
  if (root === "AMBA") return {"1": {"ja": "半導体の製造供給元", "en": "Semiconductor foundry supplier"}, "3": {"ja": "エッジAI・車載・映像SoC", "en": "Edge AI, automotive & vision SoCs"}};
  if (root === "SYNA") return {"3": {"ja": "エッジ半導体・接続・MLコア協業", "en": "Edge silicon, connectivity & ML collaboration"}};
  if (root === "CRUS") return {"1": {"ja": "ウエハー製造の供給元", "en": "Wafer foundry suppliers"}, "3": {"ja": "音声・制御半導体", "en": "Audio & control semiconductors"}, "7": {"ja": "製造受託会社経由の最終顧客", "en": "End customer via contract manufacturers"}};
  if (root === "HIMX") return {"3": {"ja": "表示・画像用半導体", "en": "Display & imaging semiconductors"}, "4": {"ja": "CPOの共同開発", "en": "CPO co-development"}};
  if (root === "STM") return {"3": {"ja": "半導体・車載・電源・センサー", "en": "Semiconductors, automotive, power & sensors"}, "6": {"ja": "データセンター向け半導体の顧客", "en": "Data-center semiconductor customer"}};
  if (root === "UMC") return {"1": {"ja": "受託製造・12nm開発協業", "en": "Foundries & 12nm development"}};
  if (root === "TEL") return {"3": {"ja": "接続技術の展示協力", "en": "Connectivity demonstration collaboration"}, "4": {"ja": "接続部品・輸送機器向けセンサー", "en": "Connectivity & transportation sensors"}};
  if (root === "GLW") return {"4": {"ja": "光接続・機能性ガラス・材料", "en": "Optical connectivity, glass & materials"}, "6": {"ja": "光接続製品の顧客", "en": "Optical-connectivity customer"}, "7": {"ja": "研究・医療向け製品", "en": "Laboratory & healthcare products"}};
  if (root === "TSEM") return {"1": {"ja": "受託製造・工場共有・生産能力調達", "en": "Foundries, shared fab & capacity access"}, "3": {"ja": "シリコンフォトニクスの技術協業", "en": "Silicon-photonics collaboration"}};
  if (root === "GFS") return {"1": {"ja": "半導体の受託製造", "en": "Semiconductor foundries"}, "3": {"ja": "製造提携の半導体顧客", "en": "Chip customer / manufacturing alliance"}};
  if (root === "ASX") return {"0": {"ja": "先端包装のEDA設計協業", "en": "Advanced-packaging EDA collaboration"}, "2": {"ja": "半導体の包装・検査", "en": "Semiconductor packaging & test"}, "5": {"ja": "電子機器の製造受託", "en": "Electronics contract manufacturing"}};
  if (root === "ACLS") return {"0": {"ja": "イオン注入装置", "en": "Ion implantation"}, "1": {"ja": "成熟プロセス工場の顧客", "en": "Mature-process fab customer"}};
  if (root === "CAMT") return {"0": {"ja": "検査・計測・技術協力・出資元", "en": "Inspection, metrology, technology & investor"}};
  if (root === "TER") return {"0": {"ja": "半導体・電子機器の試験", "en": "Semiconductor & electronics test"}, "5": {"ja": "テスト装置の製造委託・ロボティクス", "en": "Test-system manufacturing & robotics"}};
  if (root === "ONTO") return {"0": {"ja": "検査・計測装置", "en": "Inspection & metrology"}, "1": {"ja": "受託製造の顧客", "en": "Foundry customer"}, "2": {"ja": "HBM生産の顧客", "en": "HBM-production customer"}};
  if (root === "ICHR") return {"0": {"ja": "流体システム・精密加工", "en": "Fluid systems & precision machining"}, "1": {"ja": "流体システム等の装置顧客", "en": "Equipment customers for fluid systems / parts"}};
  if (root === "UCTT") return {"0": {"ja": "装置サブシステム・洗浄", "en": "Equipment subsystems & cleaning"}, "1": {"ja": "装置向けサブシステムの顧客", "en": "Equipment-subsystem customers"}};
  if (root === "FORM") return {"0": {"ja": "プローブ・計測・温度制御", "en": "Probes, measurement & thermal control"}, "2": {"ja": "メモリー分野の顧客", "en": "Memory customers"}};
  if (root === "AMKR") return {"1": {"ja": "先端包装・試験の協業", "en": "Advanced-packaging / test collaboration"}, "2": {"ja": "半導体の包装・検査受託", "en": "Semiconductor packaging & test"}, "3": {"ja": "半導体設計の顧客", "en": "Chip-design customers"}, "7": {"ja": "電子機器の顧客", "en": "Electronics customers"}};
  if (root === "JBL") return {"0": {"ja": "半導体装置分野の顧客", "en": "Semiconductor-equipment customers"}, "5": {"ja": "電子機器の設計・製造受託", "en": "Electronics design & contract manufacturing"}};
  if (root === "COHU") return {"0": {"ja": "半導体テスト・搬送・検査", "en": "Semiconductor test, handling & inspection"}, "5": {"ja": "テスト装置の製造委託先", "en": "Test-system contract manufacturer"}};
  if (root === "SANM") return {"4": {"ja": "光アクセス機器の製造顧客", "en": "Optical-access manufacturing customer"}, "5": {"ja": "電子機器の設計・製造受託", "en": "Electronics design & contract manufacturing"}};
  if (root === "ARW") return {"3": {"ja": "販売する半導体・IT製品の供給元", "en": "Semiconductor / IT distribution suppliers"}, "5": {"ja": "電子部品・企業ITの流通", "en": "Components & enterprise-IT distribution"}};
  if (root === "AVT") return {"3": {"ja": "設計・統合向け半導体の供給元", "en": "Semiconductor suppliers for design / integration"}, "5": {"ja": "電子部品流通・設計支援", "en": "Component distribution & design support"}};
  if (root === "PLAB") return {"0": {"ja": "フォトマスク・合弁・地域別競合", "en": "Photomasks, joint ventures & regional competition"}};
  if (root === "CIEN") return {4: {ja: "光伝送・ルーティング", en: "Optical transport & routing"}, 6: {ja: "データセンター管理の共同開発", en: "Data-center management co-development"}};
  if (root === "CSCO") return {"3": {"ja": "AIプラットフォームの協業", "en": "AI-platform collaboration"}, "5": {"ja": "ネットワーク機器・AIサーバー", "en": "Networking & AI servers"}, "7": {"ja": "セキュリティ・Web会議", "en": "Security & web meetings"}};
  if (root === "ETN") return {"3": {"ja": "AI基盤の電源・冷却設計協業", "en": "AI power / cooling design collaboration"}, "5": {"ja": "データセンター電源・冷却", "en": "Data-center power & cooling"}};
  if (root === "PLTR") return {"6": {"ja": "データ・AI基盤とクラウド連携", "en": "Data / AI platforms & cloud alliances"}, "7": {"ja": "データ・AI分析ソフト", "en": "Data & AI analytics software"}};
  if (root === "WDC") return {"2": {"ja": "ストレージ製品", "en": "Storage products"}, "6": {"ja": "HDDの資源回収協力", "en": "HDD material-recovery collaboration"}};
  if (root === "STX") return {"2": {"ja": "ストレージ製品", "en": "Storage products"}, "6": {"ja": "Xboxストレージの共同設計", "en": "Xbox storage co-design"}};
  if (root === "CDNS") return {"0": {"ja": "半導体設計・物理解析", "en": "Electronic design & physics analysis"}, "1": {"ja": "製造プロセス向け設計認証", "en": "Design certification for manufacturing processes"}};
  if (root === "KEYS") return {"0": {"ja": "電子設計・検証・試験", "en": "Electronic design, verification & test"}, "3": {"ja": "通信半導体の試験協業", "en": "Networking-chip test collaboration"}, "4": {"ja": "光通信・ネットワーク試験", "en": "Optical & network testing"}};
  if (root === "FLEX") return {"3": {"ja": "AI基盤の電源・ラック設計協業", "en": "AI power / rack-design collaboration"}, "5": {"ja": "製造受託・電源・冷却", "en": "Manufacturing services, power & cooling"}};
  if (root === "FTNT") return {"6": {"ja": "ネットワーク・端末・安全な接続", "en": "Network, endpoint & secure access"}, "7": {"ja": "クラウド防御の開発・販売提携", "en": "Cloud-security development & co-selling"}};
  if (root === "EGHT") return {"6": {"ja": "CRM・Teams・音声AIへの技術対応", "en": "CRM, Teams & voice-AI compatibility"}, "7": {"ja": "企業通信・顧客対応", "en": "Business communications & contact centers"}};
  if (root === "PEGA") return {"6": {"ja": "クラウド・AI開発協業", "en": "Cloud / AI development collaboration"}, "7": {"ja": "業務自動化・導入支援", "en": "Workflow automation & implementation"}};
  if (root === "NICE") return {"6": {"ja": "通信・顧客対応の販売提携", "en": "Communications / contact-center distribution"}, "7": {"ja": "顧客対応・金融犯罪対策", "en": "Contact centers & financial-crime tools"}};
  if (root === "DBX") return {"6": {"ja": "クラウド基盤・AI文書連携", "en": "Cloud infrastructure & AI document connections"}, "7": {"ja": "保存・共有・署名・検索", "en": "Storage, sharing, signatures & search"}};
  if (root === "FIVN") return {"6": {"ja": "CRM・業務ソフト・AI基盤の連携", "en": "CRM, workflow & cloud AI integrations"}, "7": {"ja": "クラウドの顧客対応基盤", "en": "Cloud contact-center platforms"}};
  if (root === "RNG") return {"6": {"ja": "通信の販売提携・技術供給", "en": "Communications distribution & technology"}, "7": {"ja": "企業通信・顧客対応", "en": "Business communications & contact centers"}};
  if (root === "MNDY") return {"6": {"ja": "クラウド基盤・AIモデル対応", "en": "Cloud hosting & AI model access"}, "7": {"ja": "業務管理・共同作業", "en": "Work management & collaboration"}};
  if (root === "FRSH") return {"6": {"ja": "クラウド基盤・販売協業", "en": "Cloud hosting & distribution"}, "7": {"ja": "IT運用・顧客対応ソフト", "en": "IT operations & customer-service tools"}};
  if (root === "KVYO") return {"7": {"ja": "通販・広告・製品連携・出資元", "en": "Commerce, advertising, integrations & investor"}};
  if (root === "BRZE") return {"6": {"ja": "データ・AIモデルの技術連携", "en": "Data & AI-model interoperability"}, "7": {"ja": "顧客体験・マーケティング配信", "en": "Customer journeys & marketing messages"}};
  if (root === "SPT") return {"6": {"ja": "SNS・クラウド・CRM連携と採用", "en": "Social, cloud & CRM integration / adoption"}, "7": {"ja": "SNS運用・分析ソフト", "en": "Social management & analytics"}};
  if (root === "ADSK") return {"5": {"ja": "ソフトウェアの販売・流通", "en": "Software sales & distribution"}, "6": {"ja": "クラウド・AI・販売経路の協業", "en": "Cloud, AI & channel collaboration"}, "7": {"ja": "設計・製造・建設ソフト", "en": "Design, manufacturing & construction software"}};
  if (root === "PTC") return {"6": {"ja": "設計・製品情報の技術連携", "en": "Design / product-data technology collaboration"}, "7": {"ja": "設計・製品・ソフト開発管理", "en": "Design, product & software lifecycle management"}};
  if (root === "BSY") return {"6": {"ja": "クラウド基盤・都市デジタルツイン", "en": "Cloud infrastructure & city digital twins"}, "7": {"ja": "インフラの設計・建設・資産運用", "en": "Infrastructure design, delivery & asset software"}};
  if (root === "VEEV") return {"6": {"ja": "クラウド・従来CRM・製品連携", "en": "Cloud, legacy CRM & product integration"}, "7": {"ja": "ライフサイエンスの業務・データ", "en": "Life-sciences applications & data"}};
  if (root === "MANH") return {"6": {"ja": "クラウド基盤・販売経路", "en": "Cloud infrastructure & distribution"}, "7": {"ja": "物流・店舗・業務ソフトと導入支援", "en": "Supply-chain / store applications & implementation"}};
  if (root === "HUBS") return {"6": {"ja": "顧客情報のAIツール連携", "en": "Customer-context integration in AI tools"}, "7": {"ja": "CRM・営業・マーケティング", "en": "CRM, sales & marketing"}};
  if (root === "TEAM") return {"6": {"ja": "業務情報・AIエージェント連携", "en": "Work context & AI agent integration"}, "7": {"ja": "案件・開発・IT業務ソフト", "en": "Work, development & IT service software"}};
  if (root === "DT") return {"5": {"ja": "AIインフラの監視エコシステム", "en": "AI infrastructure observability ecosystem"}, "6": {"ja": "監視・分析・クラウド連携", "en": "Observability, analytics & cloud integration"}};
  if (root === "OTEX") return {"6": {"ja": "情報管理・クラウド・AI連携", "en": "Information management, cloud & AI"}, "7": {"ja": "文書・業務アプリ連携", "en": "Content & business application integration"}};
  if (root === "COST") return {"5": {"ja": "通販基盤・商品の配送提携", "en": "Commerce platforms & merchandise delivery"}, "6": {"ja": "米国の提携カード・決済網", "en": "US co-brand card & payment network"}, "7": {"ja": "会員制小売・総合小売・通販", "en": "Warehouse clubs, general retail & e-commerce"}};

  if (root === "CRWD") return {"6": {"ja": "端末・クラウド防御・AI研究協力", "en": "Endpoint / cloud security & AI research"}};
  if (root === "NET") return {"6": {"ja": "配信・安全な接続・AI検索研究", "en": "Delivery, secure access & AI-search research"}};
  if (root === "INTU") return {"6": {"ja": "金融ツールのAIモデル連携", "en": "AI model integration in financial tools"}, "7": {"ja": "会計・税務・給与・販促・個人金融", "en": "Accounting, tax, payroll, marketing & personal finance"}};
  if (root === "SAP") return {"6": {"ja": "クラウド・データ・AI連携", "en": "Cloud, data & AI collaboration"}, "7": {"ja": "企業の業務アプリ・導入支援", "en": "Enterprise applications & implementation"}};
  if (root === "PAYX") return {"6": {"ja": "人事情報の業務ツール連携", "en": "HR intelligence in workflow tools"}, "7": {"ja": "給与・人事・福利厚生", "en": "Payroll, HR & benefits"}};
  if (root === "NTNX") return {"5": {"ja": "対応サーバー・ストレージ連携", "en": "Compatible servers & storage integration"}, "6": {"ja": "仮想化・クラウド基盤", "en": "Virtualization & cloud infrastructure"}};
  if (root === "APH") return {"3": {"ja": "接続アーキテクチャの技術協力", "en": "Interconnect architecture collaboration"}, "4": {"ja": "接続部品・ケーブル・光ファイバー", "en": "Connectors, cables & fiber"}, "5": {"ja": "USFP機器・接続部品の開発協力", "en": "USFP systems / connector development"}};

  if (root === "TXN") return {"3": {"ja": "アナログ・制御・ロボット技術連携", "en": "Analog, control & robotics collaboration"}};
  if (root === "ADI") return {"1": {"ja": "半導体の受託製造", "en": "External wafer fabrication"}, "3": {"ja": "アナログ・信号処理半導体", "en": "Analog & signal-processing chips"}, "7": {"ja": "自動車の採用事例", "en": "Automotive adoption"}};
  if (root === "DDOG") return {"6": {"ja": "監視・セキュリティ・クラウド連携", "en": "Observability, security & cloud collaboration"}};
  if (root === "ZS") return {"6": {"ja": "安全な接続・防御AI・運用連携", "en": "Secure access, defensive AI & SecOps"}};

  if (root === "MSFT") return {"6": {"ja": "クラウド・企業ソフト・AI提携", "en": "Cloud, enterprise software & AI partnerships"}, "7": {"ja":"PC用OS・営業CRM・ゲーム機","en":"PC OS, sales CRM & game consoles"}};
  if (root === "ADBE") return {"6": {"ja": "制作ツールのAIモデル連携", "en": "AI model integration in creative tools"}, "7": {"ja": "制作・文書・マーケティング", "en": "Creative, documents & marketing"}};
  if (root === "CRM") return {"6": {"ja": "営業・顧客対応・マーケティング・AI", "en": "Sales, customer service, marketing & AI"}};
  if (root === "BOX") return {"6": {"ja": "企業コンテンツ・AI連携", "en": "Enterprise content & AI integration"}, "7": {"ja": "会議・共同作業", "en": "Meetings & collaboration"}};
  if (root === "WDAY") return {"6": {"ja": "クラウド・業務AI連携", "en": "Cloud & workflow AI integration"}, "7": {"ja": "人事・財務・給与", "en": "HR, finance & payroll"}};
  if (root === "DELL") return {"3": {"ja": "サーバー用GPU・CPU", "en": "Server GPUs & CPUs"}, "5": {"ja": "サーバー・ラック", "en": "Servers & racks"}, "6": {"ja": "ラックを導入するクラウド企業", "en": "Cloud companies adopting racks"}};
  if (root === "HPE") return {"3": {"ja": "サーバー用GPU・CPU", "en": "Server GPUs & CPUs"}, "5": {"ja": "サーバー・ネットワーク", "en": "Servers & networking"}, "6": {"ja": "クラウド・ハイブリッド基盤", "en": "Cloud & hybrid infrastructure"}};
  if (root === "ADSK") return {"5": {"ja": "ソフトウェアの販売・流通", "en": "Software sales & distribution"}, "7": {"ja": "設計・製造・建設ソフト", "en": "Design, manufacturing & construction software"}};

  if (root === "AAPL") return { 5: { ja: "端末・PC・スマートフォン・時計", en: "Devices, PCs, phones & watches" }, 3: { ja: "通信・半導体部品", en: "Connectivity & semiconductor components" }, 6: { ja: "AI・機能連携", en: "AI & feature integration" }, 7: { ja: "端末・サービスと比較製品", en: "Devices, services & competing products" } };
  if (["GOOG", "AMZN"].includes(root)) return { 6: { ja: "クラウド・AI・複合サービス", en: "Cloud, AI & diversified services" }, 7: { ja: "検索・通販・広告・サービス", en: "Search, commerce, ads & services" } };
  if (root === "META") return { 3: { ja: "AI半導体・基盤協業", en: "AI chips & infrastructure collaboration" }, 6: { ja: "クラウド・計算基盤", en: "Cloud & compute infrastructure" }, 7: { ja: "交流・動画・広告", en: "Social, video & ads" } };
  if (root === "ON") return { 5: { ja: "AIデータセンターの電源技術連携", en: "AI data-center power collaboration" }, 3: { ja: "電力・アナログ・画像半導体", en: "Power, analog & imaging chips" }, 7: { ja: "EV向け採用・供給契約", en: "EV adoption & supply agreements" } };

  if (root === "RDDT") return { 6: { ja: "クラウド・AI・データ提携", en: "Cloud, AI & data partnerships" }, 7: { ja: "交流・情報探索・広告", en: "Communities, discovery & ads" } };
  if (root === "PINS") return { 6: { ja: "クラウド・ログイン・広告提携", en: "Cloud, login & ad partnerships" }, 7: { ja: "商品・画像の発見・広告", en: "Product/visual discovery & ads" } };
  if (root === "SNAP") return { 6: { ja: "クラウド・OS・配信基盤", en: "Cloud, OS & distribution" }, 7: { ja: "動画・交流・広告", en: "Video, communication & ads" } };
  if (root === "ENTG") return {"0": {"ja": "半導体材料・汚染管理", "en": "Semiconductor materials & purity"}, "1": {"ja": "材料・汚染管理製品の顧客", "en": "Materials / purity customer"}};
  if (root === "MTSI") return {"3": {"ja": "通信半導体・銅接続規格の協力", "en": "Connectivity chips & copper standards"}};
  if (root === "POWI") return {"1": {"ja": "ウエハー製造の供給元", "en": "Wafer foundry supplier"}, "3": {"ja": "電源制御半導体", "en": "Power-control semiconductors"}, "5": {"ja": "800VDC向け参照構成", "en": "800 VDC reference architecture"}};
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
    6: { ja: "クラウド計算・AIモデル連携", en: "Cloud computing & AI-model collaboration" },
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
  if (root === "MPWR") return {"1": {"ja": "製造能力拡張の契約先", "en": "Manufacturing-capacity agreement"}, "3": {"ja": "電源管理半導体", "en": "Power-management semiconductors"}};
  if (root === "CIEN") return {
    4: { ja: "光伝送・ルーティング", en: "Optical transport & routing" },
  };
  if (root === "FTNT") return {
    6: { ja: "ネットワーク・端末・安全な接続", en: "Network, endpoint & secure access" },
  };
  if (root === "UBER") return {"7": {"ja": "配車・配送・自動運転協業", "en": "Mobility, delivery & AV collaboration"}};
  if (root === "APP") return {"7": {"ja": "広告技術・クラウド供給", "en": "Advertising technology & cloud supply"}, "6": {"ja": "クラウド・AI・コマース技術連携", "en": "Cloud, AI & commerce technology"}};
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
  if (root === "DASH") return {"7": {"ja": "配送・小売販売チャネル", "en": "Delivery & retail sales channels"}};
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
  if (root === "OKTA") return {"6": {"ja": "ID認証・権限・AI防御研究", "en": "Identity, access & AI security research"}};
  if (root === "S") return {"6": {"ja": "セキュリティ・クラウド供給・開発協業", "en": "Security, cloud supply & collaboration"}};
  if (root === "CHKP") return {"6": {"ja": "セキュリティ製品・Azure連携", "en": "Security products & Azure integration"}};
  if (root === "DOCU") return {"7": {"ja": "電子署名・契約管理・Azure供給", "en": "E-signatures, agreements & Azure supply"}};
  if (root === "ABNB") return {"7": {"ja": "旅行・宿泊予約", "en": "Travel & accommodation booking"}, "6": {"ja": "クラウド・AI・コマース技術連携", "en": "Cloud, AI & commerce technology"}};
  if (root === "SPOT") return {"7": {"ja": "音楽・音声・動画配信", "en": "Music, audio & video distribution"}};
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
  if (root === "MELI") return {"7": {"ja": "通販・小売・決済サービス", "en": "Commerce, retail & payments"}};
  if (root === "SOFI") return {"7": {"ja": "銀行・金融技術・決済ネットワーク", "en": "Banking, fintech & payment networks"}};
  if (root === "DUOL") return {"6": {"ja": "学習用AIモデル技術", "en": "AI models for learning"}, "7": {"ja": "語学学習・語学評価", "en": "Language learning & assessment"}};
  if (root === "TSLA") return {
    2: { ja: "電池セル供給元", en: "Battery-cell suppliers" },
    7: { ja: "自動車・蓄電システム", en: "Vehicles & energy storage" },
  };
  if (["IONQ", "RGTI", "QBTS", "QUBT"].includes(root)) return {
    6: { ja: "量子計算システム", en: "Quantum computing systems" },
    7: { ja: "量子計算の関連企業", en: "Related quantum computing companies" },
  };
  if (root === "ASTS") return {"5": {"ja": "衛星通信システム・サービス", "en": "Satellite communications systems & services"}, "7": {"ja": "提携する携帯通信事業者", "en": "Mobile-network partners"}};
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
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Cortex AIのClaude・共同販売",
        "en": "Claude in Cortex AI / joint go-to-market"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "Cortex AIのモデル提供",
        "en": "Models available in Cortex AI"
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
    },
    "ADBE": {
      "layer": 6,
      "businessLabel": {
        "ja": "顧客向けソリューションの戦略提携",
        "en": "Strategic customer-solution partner"
      }
    },
    "SAP": {
      "layer": 6,
      "businessLabel": {
        "ja": "顧客向けソリューションの戦略提携",
        "en": "Strategic customer-solution partner"
      }
    }
  },
  "OKTA": {
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft | Entra ID・従業員認証",
        "en": "Microsoft | Entra ID workforce authentication"
      }
    },
    "Ping Identity": {
      "layer": 6,
      "businessLabel": {
        "ja": "Ping Identity | 従業員・顧客向け認証",
        "en": "Ping Identity | Workforce/customer authentication"
      }
    },
    "SAIL": {
      "layer": 6,
      "businessLabel": {
        "ja": "SailPoint | アクセス権限ガバナンス",
        "en": "SailPoint | Access governance"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google | アプリ利用者の認証",
        "en": "Google | Application-user authentication"
      }
    },
    "OKTA": {
      "layer": 6,
      "businessLabel": {
        "ja": "Okta",
        "en": "Okta"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜Daybreak研究協力",
        "en": "OpenAI | Daybreak research"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Anthropic｜Glasswing研究協力",
        "en": "Anthropic | Glasswing research"
      }
    }
  },
  "S": {
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "CrowdStrike | 端末の脅威防御",
        "en": "CrowdStrike | Endpoint threat protection"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft | 端末の脅威防御",
        "en": "Microsoft | Endpoint threat protection"
      }
    },
    "AVGO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Broadcom | Carbon Black・Symantec",
        "en": "Broadcom | Carbon Black & Symantec"
      }
    },
    "Trellix": {
      "layer": 6,
      "businessLabel": {
        "ja": "Trellix | 端末の脅威防御",
        "en": "Trellix | Endpoint threat protection"
      }
    },
    "PANW": {
      "layer": 6,
      "businessLabel": {
        "ja": "Palo Alto Networks | セキュリティ基盤",
        "en": "Palo Alto Networks | Security platforms"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Cisco | Splunk・脅威検知",
        "en": "Cisco | Splunk threat detection"
      }
    },
    "ESTC": {
      "layer": 6,
      "businessLabel": {
        "ja": "Elastic | ログ分析・脅威検知",
        "en": "Elastic | Log analytics & threat detection"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜基盤供給・防御協業",
        "en": "Google | cloud / security partner"
      }
    },
    "S": {
      "layer": 6,
      "businessLabel": {
        "ja": "SentinelOne",
        "en": "SentinelOne"
      }
    }
  },
  "CHKP": {
    "PANW": {
      "layer": 6,
      "businessLabel": {
        "ja": "Palo Alto Networks | ネットワーク防御",
        "en": "Palo Alto Networks | Network security"
      }
    },
    "FTNT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Fortinet | ファイアウォール",
        "en": "Fortinet | Firewalls"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Cisco | ネットワーク防御",
        "en": "Cisco | Network security"
      }
    },
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "CrowdStrike | Falcon Cloud Security",
        "en": "CrowdStrike | Falcon Cloud Security"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜Azure連携・防御製品",
        "en": "Microsoft | Azure / security"
      }
    },
    "CHKP": {
      "layer": 6,
      "businessLabel": {
        "ja": "Check Point Software Technologies",
        "en": "Check Point Software Technologies"
      }
    }
  },
  "DOCU": {
    "ADBE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Adobe | Acrobat Sign・電子署名",
        "en": "Adobe | Acrobat Sign e-signatures"
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
        "ja": "Icertis | 契約ライフサイクル管理",
        "en": "Icertis | Contract lifecycle management"
      }
    },
    "Ironclad": {
      "layer": 7,
      "businessLabel": {
        "ja": "Ironclad | 契約ライフサイクル管理",
        "en": "Ironclad | Contract lifecycle management"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft｜Azure供給・電子署名",
        "en": "Microsoft | Azure / e-signatures"
      }
    },
    "DOCU": {
      "layer": 7,
      "businessLabel": {
        "ja": "Docusign",
        "en": "Docusign"
      }
    }
  },
  "ABNB": {
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google | 旅行・宿泊検索",
        "en": "Google | Travel & accommodation search"
      }
    },
    "BKNG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Booking Holdings | 宿泊施設の予約",
        "en": "Booking Holdings | Accommodation booking"
      }
    },
    "EXPE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Expedia Group | Vrbo・貸切住宅予約",
        "en": "Expedia Group | Vrbo whole-home booking"
      }
    },
    "MAR": {
      "layer": 7,
      "businessLabel": {
        "ja": "Marriott International | ホテル・リゾート",
        "en": "Marriott International | Hotels & resorts"
      }
    },
    "ABNB": {
      "layer": 7,
      "businessLabel": {
        "ja": "Airbnb｜宿泊・体験予約",
        "en": "Airbnb | stays / experiences"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon / AWS｜クラウド供給",
        "en": "Amazon / AWS | cloud provider"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜開発用モデル契約",
        "en": "OpenAI | model-access agreement"
      }
    }
  },
  "SPOT": {
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google | YouTube Music・動画・広告",
        "en": "Google | YouTube Music, video & ads"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon | 音楽・Audible・広告",
        "en": "Amazon | Music, Audible & ads"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Apple | 音楽・番組・音声書籍",
        "en": "Apple | Music, podcasts & audiobooks"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "Meta | コンテンツ・広告",
        "en": "Meta | Content & advertising"
      }
    },
    "ByteDance": {
      "layer": 7,
      "businessLabel": {
        "ja": "ByteDance | 短編動画・利用時間",
        "en": "ByteDance | Short video & attention"
      }
    },
    "SPOT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Spotify｜音楽・音声・動画",
        "en": "Spotify | music / audio / video"
      }
    },
    "NFLX": {
      "layer": 7,
      "businessLabel": {
        "ja": "Netflix｜番組動画配信協業",
        "en": "Netflix | video-program collaboration"
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
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "WISEのCopilot・Teams対応",
        "en": "WISE in Copilot / Teams"
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
        "ja": "給与後処理・税務の認定連携",
        "en": "Certified post-payroll / tax integration"
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
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Business AI・Joule連携計画",
        "en": "Business AI / Joule integration plans"
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
        "ja": "Synopsys｜EDA・Ansys",
        "en": "Synopsys | EDA / Ansys"
      }
    },
    "Siemens EDA": {
      "layer": 0,
      "businessLabel": {
        "ja": "Siemens EDA｜設計・検証",
        "en": "Siemens EDA | design / verify"
      }
    },
    "KEYS": {
      "layer": 0,
      "businessLabel": {
        "ja": "Keysight｜設計・解析",
        "en": "Keysight | design / analysis"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC｜設計フロー認証",
        "en": "TSMC | certified design flows"
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
        "ja": "Uber Technologies | Uber Eats・料理配達",
        "en": "Uber Technologies | Uber Eats meal delivery"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon | 食品・日用品の配送",
        "en": "Amazon | Grocery & everyday delivery"
      }
    },
    "CART": {
      "layer": 7,
      "businessLabel": {
        "ja": "Instacart | 食品配送マーケットプレイス",
        "en": "Instacart | Grocery delivery marketplace"
      }
    },
    "WMT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Walmart | 食品・日用品の注文と配送",
        "en": "Walmart | Grocery ordering & delivery"
      }
    },
    "DASH": {
      "layer": 7,
      "businessLabel": {
        "ja": "DoorDash｜地域配送",
        "en": "DoorDash | local delivery"
      }
    },
    "KR": {
      "layer": 7,
      "businessLabel": {
        "ja": "Kroger｜食料品配達協業",
        "en": "Kroger | grocery-delivery partner"
      }
    },
    "SHOP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Shopify｜米国実店舗販売連携",
        "en": "Shopify | US physical-store channel"
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
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "MGX・USFP接続の技術協力",
        "en": "MGX / USFP interconnect collaboration"
      }
    },
    "CSCO": {
      "layer": 5,
      "businessLabel": {
        "ja": "USFPコネクター等の開発計画",
        "en": "USFP connector development plans"
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
        "ja": "Arista｜ネットワーク",
        "en": "Arista | networking"
      }
    },
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "Hewlett Packard Enterprise",
        "en": "Hewlett Packard Enterprise"
      }
    },
    "PANW": {
      "layer": 7,
      "businessLabel": {
        "ja": "Palo Alto Networks｜防御",
        "en": "Palo Alto Networks | firewalls"
      }
    },
    "CRWD": {
      "layer": 7,
      "businessLabel": {
        "ja": "CrowdStrike｜端末保護",
        "en": "CrowdStrike | Endpoint / EDR"
      }
    },
    "ZM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Zoom｜Web会議",
        "en": "Zoom | Web meetings"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜AI基盤協業",
        "en": "NVIDIA | AI infrastructure"
      }
    },
    "SMCI": {
      "layer": 5,
      "businessLabel": {
        "ja": "Supermicro｜AIサーバー協業",
        "en": "Supermicro | AI servers"
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
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "Stargate計算容量・GPTモデル連携",
        "en": "Stargate capacity / GPT model integration"
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
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Build AgentのClaude・社内採用",
        "en": "Claude in Build Agent / internal adoption"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "モデル・音声エージェント連携計画",
        "en": "Model / voice-agent collaboration plans"
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
        "ja": "Monolithic Power Systems | 電源管理・電力変換",
        "en": "Monolithic Power Systems | Power management & conversion"
      }
    },
    "ADI": {
      "layer": 3,
      "businessLabel": {
        "ja": "Analog Devices | 電源・混載半導体",
        "en": "Analog Devices | Power & mixed-signal chips"
      }
    },
    "NXPI": {
      "layer": 3,
      "businessLabel": {
        "ja": "NXP Semiconductors | PMIC電源管理",
        "en": "NXP Semiconductors | PMIC power management"
      }
    },
    "ON": {
      "layer": 3,
      "businessLabel": {
        "ja": "onsemi | 電源変換製品",
        "en": "onsemi | Power conversion products"
      }
    },
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "Texas Instruments | 電源管理半導体",
        "en": "Texas Instruments | Power-management chips"
      }
    },
    "Infineon": {
      "layer": 3,
      "businessLabel": {
        "ja": "Infineon | 電源IC",
        "en": "Infineon | Power-supply ICs"
      }
    },
    "GFS": {
      "layer": 1,
      "businessLabel": {
        "ja": "GlobalFoundries｜製造契約・2027年能力拡張計画",
        "en": "GlobalFoundries | manufacturing agreement / 2027 plan"
      }
    }
  },
  "CIEN": {
    "CIEN": {
      "layer": 4,
      "businessLabel": {
        "ja": "Ciena｜光伝送・ルーター",
        "en": "Ciena | optical transport"
      }
    },
    "Nokia": {
      "layer": 4,
      "businessLabel": {
        "ja": "Nokia｜光伝送",
        "en": "Nokia | optical networking"
      }
    },
    "CSCO": {
      "layer": 4,
      "businessLabel": {
        "ja": "Cisco｜ルーター・光通信",
        "en": "Cisco | routing / optics"
      }
    },
    "HPE": {
      "layer": 4,
      "businessLabel": {
        "ja": "Hewlett Packard Enterprise",
        "en": "Hewlett Packard Enterprise"
      }
    },
    "Huawei": {
      "layer": 4,
      "businessLabel": {
        "ja": "Huawei｜光伝送",
        "en": "Huawei | optical transport"
      }
    },
    "ZTE": {
      "layer": 4,
      "businessLabel": {
        "ja": "ZTE｜光伝送",
        "en": "ZTE | optical networking"
      }
    },
    "META": {
      "layer": 6,
      "businessLabel": {
        "ja": "Meta｜DCOM共同開発",
        "en": "Meta | DCOM co-development"
      }
    }
  },
  "FTNT": {
    "FTNT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Fortinet｜FortiGate・端末防御",
        "en": "Fortinet | FortiGate / EDR"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Cisco｜Secure Firewall",
        "en": "Cisco | Secure Firewall"
      }
    },
    "PANW": {
      "layer": 6,
      "businessLabel": {
        "ja": "Palo Alto Networks｜防御",
        "en": "Palo Alto Networks | firewalls"
      }
    },
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "CrowdStrike｜Falcon",
        "en": "CrowdStrike | Falcon"
      }
    },
    "ZS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Zscaler｜安全な接続",
        "en": "Zscaler | Internet Access"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜Defender",
        "en": "Microsoft | Defender"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google｜クラウド防御協業",
        "en": "Google | cloud-security alliance"
      }
    }
  },
  "UBER": {
    "UBER": {
      "layer": 7,
      "businessLabel": {
        "ja": "Uber｜配車・配送",
        "en": "Uber | mobility / delivery"
      }
    },
    "LYFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Lyft | 配車アプリ",
        "en": "Lyft | Ride-hailing app"
      }
    },
    "Didi": {
      "layer": 7,
      "businessLabel": {
        "ja": "Didi | 海外の配車",
        "en": "Didi | International ride-hailing"
      }
    },
    "Bolt": {
      "layer": 7,
      "businessLabel": {
        "ja": "Bolt | 地域別の配車",
        "en": "Bolt | Regional ride-hailing"
      }
    },
    "Ola": {
      "layer": 7,
      "businessLabel": {
        "ja": "Ola | インドの配車",
        "en": "Ola | Indian ride-hailing"
      }
    },
    "DASH": {
      "layer": 7,
      "businessLabel": {
        "ja": "DoorDash | 商品配送",
        "en": "DoorDash | Product delivery"
      }
    },
    "CHRW": {
      "layer": 7,
      "businessLabel": {
        "ja": "C.H. Robinson | 貨物仲介",
        "en": "C.H. Robinson | Freight brokerage"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Alphabet / Waymo｜配車協業",
        "en": "Alphabet / Waymo | ride partnership"
      }
    }
  },
  "APP": {
    "APP": {
      "layer": 7,
      "businessLabel": {
        "ja": "AppLovin｜広告技術",
        "en": "AppLovin | advertising technology"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google｜Cloud供給・広告技術",
        "en": "Google | Cloud supply / ad tech"
      }
    },
    "META": {
      "layer": 7,
      "businessLabel": {
        "ja": "Meta | 広告配信・利用者獲得",
        "en": "Meta | Advertising & user acquisition"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon | 広告配信",
        "en": "Amazon | Advertising platforms"
      }
    },
    "U": {
      "layer": 7,
      "businessLabel": {
        "ja": "Unity | 広告による利用者獲得",
        "en": "Unity | Advertising user acquisition"
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
        "ja": "Entegris｜材料・汚染管理",
        "en": "Entegris | materials / purity"
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
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC｜FY2025売上16%の顧客",
        "en": "TSMC | FY2025 customer, 16%"
      }
    }
  },
  "MTSI": {
    "MTSI": {
      "layer": 3,
      "businessLabel": {
        "ja": "MACOM Technology Solutions | RF・光接続・アナログ半導体",
        "en": "MACOM Technology Solutions | RF, optical connectivity & analog"
      }
    },
    "ADI": {
      "layer": 3,
      "businessLabel": {
        "ja": "Analog Devices | RF・高性能アナログ",
        "en": "Analog Devices | RF/high-performance analog"
      }
    },
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "Broadcom | 通信・光接続半導体",
        "en": "Broadcom | Communication/optical connectivity chips"
      }
    },
    "MRVL": {
      "layer": 3,
      "businessLabel": {
        "ja": "Marvell | 高速通信半導体",
        "en": "Marvell | High-speed communication chips"
      }
    },
    "SWKS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Skyworks Solutions | RF・旧Qorvo事業を含む",
        "en": "Skyworks Solutions | RF, including former Qorvo"
      }
    },
    "SMTC": {
      "layer": 3,
      "businessLabel": {
        "ja": "Semtech｜ACC-MSA共同議長",
        "en": "Semtech | ACC-MSA co-chair"
      }
    }
  },
  "POWI": {
    "POWI": {
      "layer": 3,
      "businessLabel": {
        "ja": "Power Integrations | 電源制御・モーター駆動半導体",
        "en": "Power Integrations | Power control & motor-drive chips"
      }
    },
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "Texas Instruments | PWM制御IC",
        "en": "Texas Instruments | PWM controllers"
      }
    },
    "NXPI": {
      "layer": 3,
      "businessLabel": {
        "ja": "NXP Semiconductors | PWM制御IC",
        "en": "NXP Semiconductors | PWM controllers"
      }
    },
    "ON": {
      "layer": 3,
      "businessLabel": {
        "ja": "onsemi | モーター駆動用モジュール",
        "en": "onsemi | Motor-drive power modules"
      }
    },
    "Infineon": {
      "layer": 3,
      "businessLabel": {
        "ja": "Infineon | 高電圧電源IC・駆動製品",
        "en": "Infineon | High-voltage power ICs/drivers"
      }
    },
    "STM": {
      "layer": 3,
      "businessLabel": {
        "ja": "STMicroelectronics | 高電圧電源IC・モーター駆動",
        "en": "STMicroelectronics | High-voltage power ICs/motor drives"
      }
    },
    "NVDA": {
      "layer": 5,
      "businessLabel": {
        "ja": "NVIDIA｜800VDC参照構成",
        "en": "NVIDIA | 800 VDC architecture"
      }
    },
    "Seiko Epson": {
      "layer": 1,
      "businessLabel": {
        "ja": "Seiko Epson｜ウエハー製造",
        "en": "Seiko Epson | wafer foundry"
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
    },
    "Infineon": {
      "layer": 3,
      "businessLabel": {
        "ja": "電力・アナログ半導体",
        "en": "Power & analog chips"
      }
    },
    "STM": {
      "layer": 3,
      "businessLabel": {
        "ja": "電力・アナログ半導体",
        "en": "Power & analog chips"
      }
    },
    "SONY": {
      "layer": 3,
      "businessLabel": {
        "ja": "画像センサー",
        "en": "Image sensors"
      }
    },
    "BMW AG": {
      "layer": 7,
      "businessLabel": {
        "ja": "BMW｜2023年SiC供給契約",
        "en": "BMW | 2023 SiC supply agreement"
      }
    },
    "Volkswagen AG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Volkswagen｜2024年SiC供給契約",
        "en": "Volkswagen | 2024 SiC supply deal"
      }
    },
    "NVDA": {
      "layer": 5,
      "businessLabel": {
        "ja": "NVIDIA｜800VDC電源技術の協業",
        "en": "NVIDIA | 800 VDC power collaboration"
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
    },
    "GRMN": {
      "layer": 5,
      "businessLabel": {
        "ja": "Garmin｜Venuスマートウォッチ",
        "en": "Garmin | Venu smartwatches"
      }
    },
    "SPOT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Spotify Premium｜音楽定額配信",
        "en": "Spotify Premium | music subscription"
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
  },
  "MSFT": {
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure・企業向けソフト・AI",
        "en": "Azure, enterprise software & AI"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "主要クラウド提携・非独占IP",
        "en": "Primary cloud partnership / non-exclusive IP"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure計算容量の購入を約束",
        "en": "Azure compute purchase commitment"
      }
    },
    "SNOW": {
      "layer": 6,
      "businessLabel": {
        "ja": "データ処理・分析",
        "en": "Data processing & analytics"
      }
    },
    "S": {
      "layer": 6,
      "businessLabel": {
        "ja": "端末防御",
        "en": "Endpoint protection"
      }
    },
    "PEGA": {
      "layer": 6,
      "businessLabel": {
        "ja": "顧客対応・業務自動化",
        "en": "Customer engagement & automation"
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
        "ja": "Google Cloudの計算・保存",
        "en": "Google Cloud compute / storage"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "macOS・PC用OS",
        "en": "macOS / PC operating system"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Dynamics 365 Salesと営業CRM",
        "en": "Sales CRM versus Dynamics 365 Sales"
      }
    },
    "SONY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Sony｜PlayStation 5ゲーム機",
        "en": "Sony | PlayStation 5 consoles"
      }
    },
    "Nintendo": {
      "layer": 7,
      "businessLabel": {
        "ja": "Nintendo｜Switch 2ゲーム機",
        "en": "Nintendo | Switch 2 consoles"
      }
    }
  },
  "ADBE": {
    "ADBE": {
      "layer": 7,
      "businessLabel": {
        "ja": "制作・文書・マーケティング",
        "en": "Creative, documents & marketing"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Fireflyへの生成AIモデル連携",
        "en": "Generative-model integration in Firefly"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "Fireflyの画像生成・編集連携",
        "en": "Firefly image generation / editing"
      }
    },
    "DOCU": {
      "layer": 7,
      "businessLabel": {
        "ja": "電子署名",
        "en": "Electronic signatures"
      }
    },
    "KVYO": {
      "layer": 7,
      "businessLabel": {
        "ja": "マーケティング自動化",
        "en": "Marketing automation"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Final Cut Proの動画編集",
        "en": "Final Cut Pro video editing"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Clipchampの動画作成",
        "en": "Clipchamp video creation"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "顧客データ・マーケティング",
        "en": "Customer data / marketing"
      }
    },
    "Nemetschek": {
      "layer": 7,
      "businessLabel": {
        "ja": "Nemetschek / Maxon｜3Dソフト提携",
        "en": "Nemetschek / Maxon | 3D software bundle"
      }
    }
  },
  "CRM": {
    "CRM": {
      "layer": 6,
      "businessLabel": {
        "ja": "CRM・Agentforce・Slack",
        "en": "CRM, Agentforce & Slack"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "ChatGPT・Agentforce連携",
        "en": "ChatGPT / Agentforce integration"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Claudeforce業務連携",
        "en": "Claudeforce workflow integration"
      }
    },
    "PEGA": {
      "layer": 6,
      "businessLabel": {
        "ja": "顧客対応・業務自動化",
        "en": "Customer engagement & automation"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Dynamics 365 Sales",
        "en": "Dynamics 365 Sales"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Oracle CXの営業・顧客対応",
        "en": "Oracle CX sales / service"
      }
    },
    "SAP": {
      "layer": 6,
      "businessLabel": {
        "ja": "Sales Cloud V2の営業支援",
        "en": "Sales Cloud V2 sales automation"
      }
    },
    "HUBS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Sales Hubの商談管理",
        "en": "Sales Hub pipeline management"
      }
    },
    "ADBE": {
      "layer": 6,
      "businessLabel": {
        "ja": "Experience Platformの顧客データ",
        "en": "Experience Platform customer data"
      }
    },
    "NOW": {
      "layer": 6,
      "businessLabel": {
        "ja": "ServiceNow｜顧客対応・ケース管理",
        "en": "ServiceNow | customer service cases"
      }
    }
  },
  "BOX": {
    "BOX": {
      "layer": 6,
      "businessLabel": {
        "ja": "企業コンテンツ管理・Box AI",
        "en": "Enterprise content management / Box AI"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "SharePoint・OneDrive競合／AI連携",
        "en": "SharePoint / OneDrive rivals; AI integration"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Drive競合／AI連携",
        "en": "Drive rival; AI integration"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Box AIモデル連携",
        "en": "Box AI model integration"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "ChatGPT内の権限付きファイル連携",
        "en": "Permission-governed files in ChatGPT"
      }
    },
    "ZM": {
      "layer": 7,
      "businessLabel": {
        "ja": "会議・資料共有連携",
        "en": "Meetings / shared-content integration"
      }
    },
    "DBX": {
      "layer": 6,
      "businessLabel": {
        "ja": "企業向けファイル共有",
        "en": "Enterprise file sharing"
      }
    },
    "OTEX": {
      "layer": 6,
      "businessLabel": {
        "ja": "Documentum文書管理",
        "en": "Documentum content management"
      }
    }
  },
  "WDAY": {
    "WDAY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Workday | 人事・財務・業務AI",
        "en": "Workday | HR, finance & workflow AI"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google | Sana・Gemini Enterprise連携",
        "en": "Google | Sana / Gemini Enterprise integration"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon | AWSクラウド提携",
        "en": "Amazon | AWS cloud partnership"
      }
    },
    "ADP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Automatic Data Processing | 給与連携・人事給与の競合",
        "en": "Automatic Data Processing | Payroll integration; HR / payroll rivalry"
      }
    },
    "ORCL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Oracle | 基幹人事・財務アプリ",
        "en": "Oracle | Core HR & finance applications"
      }
    },
    "SAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "SAP | 基幹人事・財務アプリ",
        "en": "SAP | Core HR & finance applications"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft｜Microsoft Dynamics 365 Finance",
        "en": "Microsoft Dynamics 365 Finance"
      }
    },
    "NOW": {
      "layer": 7,
      "businessLabel": {
        "ja": "ServiceNow｜ServiceNow HR Service Delivery",
        "en": "ServiceNow HR Service Delivery"
      }
    }
  },
  "DELL": {
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けサーバー・ラック",
        "en": "Enterprise servers & racks"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "GB300・Grace採用元",
        "en": "Adopted GB300 / Grace technology"
      }
    },
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "GB300ラックの納入先",
        "en": "GB300 rack customer"
      }
    },
    "SMCI": {
      "layer": 5,
      "businessLabel": {
        "ja": "サーバー・計算システム",
        "en": "Servers & compute systems"
      }
    }
  },
  "HPE": {
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "サーバー・ネットワーク",
        "en": "Servers & networking"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "AIサーバーのGPU採用元",
        "en": "Adopted AI-server GPU technology"
      }
    },
    "AMD": {
      "layer": 3,
      "businessLabel": {
        "ja": "ProLiant Gen12のEPYC採用元",
        "en": "Adopted EPYC in ProLiant Gen12"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けサーバー",
        "en": "Enterprise servers"
      }
    },
    "Lenovo": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けサーバー",
        "en": "Enterprise servers"
      }
    },
    "SMCI": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けサーバー",
        "en": "Enterprise servers"
      }
    },
    "CSCO": {
      "layer": 5,
      "businessLabel": {
        "ja": "企業向けネットワーク",
        "en": "Enterprise networking"
      }
    },
    "ANET": {
      "layer": 5,
      "businessLabel": {
        "ja": "データセンターネットワーク",
        "en": "Data-center networking"
      }
    },
    "CIEN": {
      "layer": 5,
      "businessLabel": {
        "ja": "ネットワーク基盤",
        "en": "Networking infrastructure"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS・Outposts",
        "en": "AWS / Outposts"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure・Azure Local",
        "en": "Azure / Azure Local"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud",
        "en": "Google Cloud"
      }
    }
  },
  "ADSK": {
    "ADSK": {
      "layer": 7,
      "businessLabel": {
        "ja": "Autodesk | 設計・製造・建設ソフト",
        "en": "Autodesk | Design, manufacturing & construction software"
      }
    },
    "SNX": {
      "layer": 5,
      "businessLabel": {
        "ja": "TD SYNNEX | 一部市場の販売・流通提携",
        "en": "TD SYNNEX | Selected-market sales / distribution"
      }
    },
    "BSY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Bentley Systems | 建築・インフラ設計",
        "en": "Bentley Systems | Building & infrastructure design"
      }
    },
    "PTC": {
      "layer": 7,
      "businessLabel": {
        "ja": "PTC | 製品設計・開発",
        "en": "PTC | Product design & development"
      }
    },
    "PCOR": {
      "layer": 7,
      "businessLabel": {
        "ja": "Procore | 建設プロジェクト管理",
        "en": "Procore | Construction project management"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon | AWS協業・Fusion販売経路の計画",
        "en": "Amazon | AWS alliance / Fusion channel plans"
      }
    },
    "Dassault Systèmes": {
      "layer": 7,
      "businessLabel": {
        "ja": "Dassault Systèmes｜SOLIDWORKS CAD",
        "en": "Dassault Systèmes | SOLIDWORKS CAD"
      }
    }
  },
  "TXN": {
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "アナログ・組み込み半導体",
        "en": "Analog & embedded chips"
      }
    },
    "NXPI": {
      "layer": 3,
      "businessLabel": {
        "ja": "アナログ・組み込みの競合",
        "en": "Analog / embedded rivalry"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "Jetson・Holoscanのロボット連携",
        "en": "Jetson / Holoscan robotics collaboration"
      }
    }
  },
  "ADI": {
    "ADI": {
      "layer": 3,
      "businessLabel": {
        "ja": "アナログ・信号処理",
        "en": "Analog & signal processing"
      }
    },
    "NXPI": {
      "layer": 3,
      "businessLabel": {
        "ja": "信号処理などで競合",
        "en": "Selected signal-processing rivalry"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "外部ウエハー製造",
        "en": "External wafer fabrication"
      }
    },
    "GM": {
      "layer": 7,
      "businessLabel": {
        "ja": "2020年発表のUltium無線BMS採用",
        "en": "2020 announced Ultium wBMS adoption"
      }
    }
  },
  "DDOG": {
    "DDOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "インフラ・アプリ監視",
        "en": "Infrastructure / application observability"
      }
    },
    "DT": {
      "layer": 6,
      "businessLabel": {
        "ja": "APM・性能監視",
        "en": "APM / performance monitoring"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "APM・ログ管理",
        "en": "APM / log management"
      }
    },
    "ESTC": {
      "layer": 6,
      "businessLabel": {
        "ja": "ログ管理・監視",
        "en": "Logs / observability"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS純正監視の競合・正式協業",
        "en": "AWS native-monitoring rival / strategic partner"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Azure純正監視",
        "en": "Azure native monitoring"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud純正監視",
        "en": "Google Cloud native monitoring"
      }
    }
  },
  "ZS": {
    "ZS": {
      "layer": 6,
      "businessLabel": {
        "ja": "ゼロトラスト・安全な接続",
        "en": "Zero Trust / secure access"
      }
    },
    "PANW": {
      "layer": 6,
      "businessLabel": {
        "ja": "クラウド型の安全な接続",
        "en": "Cloud-delivered secure access"
      }
    },
    "FTNT": {
      "layer": 6,
      "businessLabel": {
        "ja": "SASE・安全な接続",
        "en": "SASE / secure access"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Entra Agent ID早期対応",
        "en": "Entra Agent ID early adoption"
      }
    },
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "端末・運用連携（計画を含む）",
        "en": "Endpoint / SecOps integration including plans"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "TAC・防御AI利用",
        "en": "TAC / defensive-AI use"
      }
    }
  },
  "TSLA": {
    "Panasonic Holdings": {
      "layer": 2,
      "businessLabel": {
        "ja": "東証6752・傘下の電池事業",
        "en": "Tokyo 6752 / Energy business"
      }
    },
    "CATL": {
      "layer": 2,
      "businessLabel": {
        "ja": "香港3750・電池セル供給元",
        "en": "HKEX 3750 / battery-cell supplier"
      }
    }
  },
  "CRWD": {
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "重要インフラの防御研究プログラム",
        "en": "Critical-infrastructure defense program"
      }
    },
    "CRWD": {
      "layer": 6,
      "businessLabel": {
        "ja": "Falconの端末・クラウド防御",
        "en": "Falcon endpoint / cloud protection"
      }
    },
    "S": {
      "layer": 6,
      "businessLabel": {
        "ja": "端末防御の競合",
        "en": "Endpoint security rivalry"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "AWS Marketplaceでの提供",
        "en": "AWS Marketplace distribution"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud Marketplaceでの提供",
        "en": "Google Cloud Marketplace distribution"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "端末防御の競合・Marketplace計画",
        "en": "Endpoint rival / Marketplace distribution plans"
      }
    }
  },
  "NET": {
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "Web探索・索引の研究パイロット",
        "en": "Web discovery / indexing research pilot"
      }
    }
  },
  "INTU": {
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "金融ツール・モデル連携",
        "en": "Financial-tool / model integration"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Claudeエージェント・MCP連携計画",
        "en": "Claude-agent / MCP integration plans"
      }
    },
    "ADP": {
      "layer": 7,
      "businessLabel": {
        "ja": "ADP｜RUNの米国給与計算",
        "en": "ADP | RUN US payroll"
      }
    },
    "Experian": {
      "layer": 7,
      "businessLabel": {
        "ja": "Experian｜米国の信用スコア閲覧",
        "en": "Experian | US credit-score access"
      }
    }
  },
  "NTNX": {
    "NTAP": {
      "layer": 5,
      "businessLabel": {
        "ja": "ONTAP・NCPの統合計画",
        "en": "ONTAP / NCP integration plans"
      }
    },
    "AVGO": {
      "layer": 6,
      "businessLabel": {
        "ja": "VMware仮想化ソフト",
        "en": "VMware virtualization software"
      }
    }
  },
  "PTC": {
    "NVDA": {
      "layer": 6,
      "businessLabel": {
        "ja": "NVIDIA | Omniverseの設計・シミュレーション連携",
        "en": "NVIDIA | Omniverse design / simulation integration"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon | PLM・CAD等のAWS協業",
        "en": "Amazon | AWS alliance for PLM / CAD"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft | 製品情報・クラウド・AIの連携",
        "en": "Microsoft | Product-data, cloud & AI collaboration"
      }
    },
    "ADSK": {
      "layer": 7,
      "businessLabel": {
        "ja": "Autodesk",
        "en": "Autodesk"
      }
    },
    "PTC": {
      "layer": 7,
      "businessLabel": {
        "ja": "PTC",
        "en": "PTC"
      }
    },
    "Siemens": {
      "layer": 7,
      "businessLabel": {
        "ja": "Siemens",
        "en": "Siemens"
      }
    },
    "Dassault Systèmes": {
      "layer": 7,
      "businessLabel": {
        "ja": "Dassault Systèmes",
        "en": "Dassault Systèmes"
      }
    },
    "IBM": {
      "layer": 7,
      "businessLabel": {
        "ja": "IBM｜ソフト開発・要件・試験管理",
        "en": "IBM | engineering lifecycle management"
      }
    }
  },
  "BSY": {
    "NVDA": {
      "layer": 6,
      "businessLabel": {
        "ja": "NVIDIA | 2025年の都市デジタルツイン技術事例",
        "en": "NVIDIA | 2025 city digital-twin technology example"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft",
        "en": "Microsoft"
      }
    },
    "NBIS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Nebius",
        "en": "Nebius"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google",
        "en": "Google"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Oracle",
        "en": "Oracle"
      }
    },
    "ADSK": {
      "layer": 7,
      "businessLabel": {
        "ja": "Autodesk",
        "en": "Autodesk"
      }
    },
    "BSY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Bentley Systems",
        "en": "Bentley Systems"
      }
    },
    "TRMB": {
      "layer": 7,
      "businessLabel": {
        "ja": "Trimble",
        "en": "Trimble"
      }
    },
    "Schneider Electric": {
      "layer": 7,
      "businessLabel": {
        "ja": "Schneider Electric｜AVEVA産業ソフト",
        "en": "Schneider Electric | AVEVA industrial software"
      }
    }
  },
  "VEEV": {
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "VaultアプリとMicrosoft技術の連携",
        "en": "Vault / Microsoft technology collaboration"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA",
        "en": "NVIDIA"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon",
        "en": "Amazon"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Oracle",
        "en": "Oracle"
      }
    },
    "CRM": {
      "layer": 6,
      "businessLabel": {
        "ja": "Salesforce",
        "en": "Salesforce"
      }
    },
    "VEEV": {
      "layer": 7,
      "businessLabel": {
        "ja": "Veeva Systems",
        "en": "Veeva Systems"
      }
    },
    "IQV": {
      "layer": 7,
      "businessLabel": {
        "ja": "IQVIA",
        "en": "IQVIA"
      }
    },
    "Dassault Systèmes": {
      "layer": 7,
      "businessLabel": {
        "ja": "Dassault Systèmes｜Dassault Systèmes BIOVIA",
        "en": "Dassault Systèmes BIOVIA"
      }
    },
    "OTEX": {
      "layer": 7,
      "businessLabel": {
        "ja": "OpenText｜OpenText Documentum",
        "en": "OpenText Documentum"
      }
    }
  },
  "MANH": {
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google | Active稼働基盤・Marketplace共同販売",
        "en": "Google | Active hosting / Marketplace GTM"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA",
        "en": "NVIDIA"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Oracle",
        "en": "Oracle"
      }
    },
    "MANH": {
      "layer": 7,
      "businessLabel": {
        "ja": "Manhattan Associates",
        "en": "Manhattan Associates"
      }
    },
    "SAP": {
      "layer": 7,
      "businessLabel": {
        "ja": "SAP",
        "en": "SAP"
      }
    },
    "ACN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Accenture",
        "en": "Accenture"
      }
    },
    "Blue Yonder": {
      "layer": 7,
      "businessLabel": {
        "ja": "Blue Yonder",
        "en": "Blue Yonder"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce｜店舗POS",
        "en": "Salesforce | POS"
      }
    },
    "IBM": {
      "layer": 7,
      "businessLabel": {
        "ja": "IBM｜Sterling注文・履行管理",
        "en": "IBM | Sterling order fulfillment"
      }
    }
  },
  "HUBS": {
    "HUBS": {
      "layer": 7,
      "businessLabel": {
        "ja": "営業・マーケティングCRM",
        "en": "Sales / marketing CRM"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Sales Cloudの営業CRM",
        "en": "Sales Cloud sales CRM"
      }
    },
    "FRSH": {
      "layer": 7,
      "businessLabel": {
        "ja": "顧客対応・営業CRM",
        "en": "Customer-service / sales CRM"
      }
    },
    "MNDY": {
      "layer": 7,
      "businessLabel": {
        "ja": "営業・商談管理",
        "en": "Sales / deal management"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "ChatGPTのCRM・広告連携",
        "en": "ChatGPT CRM / advertising integration"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Claude CRMコネクター",
        "en": "Claude CRM connector"
      }
    }
  },
  "TEAM": {
    "TEAM": {
      "layer": 7,
      "businessLabel": {
        "ja": "案件・開発・情報共有",
        "en": "Work, development & knowledge"
      }
    },
    "MNDY": {
      "layer": 7,
      "businessLabel": {
        "ja": "案件管理",
        "en": "Work management"
      }
    },
    "GTLB": {
      "layer": 7,
      "businessLabel": {
        "ja": "開発・コード共同作業",
        "en": "Development / code collaboration"
      }
    },
    "FRSH": {
      "layer": 7,
      "businessLabel": {
        "ja": "ITサービス管理",
        "en": "IT service management"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "Teamwork Graph・Rovoのモデル連携",
        "en": "Teamwork Graph / Rovo model integration"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "対象プランのClaude Agent for Jira",
        "en": "Claude Agent for Jira on eligible plans"
      }
    }
  },
  "DT": {
    "DT": {
      "layer": 6,
      "businessLabel": {
        "ja": "性能・ログ・AIの監視",
        "en": "Performance, logs & AI observability"
      }
    },
    "DDOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "監視・分析の競合",
        "en": "Observability / analytics rivalry"
      }
    },
    "CSCO": {
      "layer": 6,
      "businessLabel": {
        "ja": "Splunk・AppDynamicsの監視",
        "en": "Splunk / AppDynamics observability"
      }
    },
    "ESTC": {
      "layer": 6,
      "businessLabel": {
        "ja": "ログ管理・監視",
        "en": "Logs / observability"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "AI Ecosystem Programの監視連携",
        "en": "AI Ecosystem Program observability"
      }
    }
  },
  "OTEX": {
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "文書管理・Vertex AI・Marketplace連携",
        "en": "Content, Vertex AI & Marketplace integration"
      }
    }
  },
  "COST": {
    "COST": {
      "layer": 7,
      "businessLabel": {
        "ja": "会員制の倉庫型小売",
        "en": "Membership warehouse retail"
      }
    },
    "WMT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Walmart・Sam’s Clubの小売",
        "en": "Walmart / Sam’s Club retail"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "総合通販・小売",
        "en": "General online commerce / retail"
      }
    },
    "Target": {
      "layer": 7,
      "businessLabel": {
        "ja": "総合小売",
        "en": "General merchandise retail"
      }
    },
    "BJ's Wholesale Club": {
      "layer": 7,
      "businessLabel": {
        "ja": "会員制の倉庫型小売",
        "en": "Membership warehouse retail"
      }
    },
    "C": {
      "layer": 6,
      "businessLabel": {
        "ja": "Citigroup / Citi｜米国提携カード",
        "en": "Citigroup / Citi | US co-brand card"
      }
    },
    "V": {
      "layer": 6,
      "businessLabel": {
        "ja": "Visa｜米国のカード決済網",
        "en": "Visa | US card-payment network"
      }
    },
    "CART": {
      "layer": 5,
      "businessLabel": {
        "ja": "Instacart｜通販基盤・即日配送",
        "en": "Instacart | commerce / same-day delivery"
      }
    },
    "UBER": {
      "layer": 5,
      "businessLabel": {
        "ja": "Uber Eats｜商品の配送提携",
        "en": "Uber Eats | merchandise delivery"
      }
    },
    "DASH": {
      "layer": 5,
      "businessLabel": {
        "ja": "DoorDash｜会員向け商品配送",
        "en": "DoorDash | member merchandise delivery"
      }
    }
  },
  "PEGA": {
    "PEGA": {
      "layer": 7,
      "businessLabel": {
        "ja": "Pegasystems | Pega｜業務自動化",
        "en": "Pegasystems | Pega | workflow automation"
      }
    },
    "NOW": {
      "layer": 7,
      "businessLabel": {
        "ja": "ServiceNow",
        "en": "ServiceNow"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce",
        "en": "Salesforce"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft",
        "en": "Microsoft"
      }
    },
    "ACN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Accenture",
        "en": "Accenture"
      }
    },
    "CTSH": {
      "layer": 7,
      "businessLabel": {
        "ja": "Cognizant",
        "en": "Cognizant"
      }
    },
    "INFY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Infosys",
        "en": "Infosys"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon AWS｜開発協業",
        "en": "Amazon AWS | development alliance"
      }
    },
    "IBM": {
      "layer": 7,
      "businessLabel": {
        "ja": "IBM｜業務フロー・案件管理",
        "en": "IBM | workflow / case management"
      }
    }
  },
  "NICE": {
    "NICE": {
      "layer": 7,
      "businessLabel": {
        "ja": "NiCE｜顧客対応・金融犯罪対策",
        "en": "NiCE | CX / financial crime"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon",
        "en": "Amazon"
      }
    },
    "FIVN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Five9",
        "en": "Five9"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce",
        "en": "Salesforce"
      }
    },
    "ORCL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Oracle",
        "en": "Oracle"
      }
    },
    "RNG": {
      "layer": 6,
      "businessLabel": {
        "ja": "RingCentral｜RingEX・CXone販売",
        "en": "RingCentral | RingEX / CXone sales"
      }
    },
    "FICO": {
      "layer": 7,
      "businessLabel": {
        "ja": "FICO｜Falcon決済不正検知",
        "en": "FICO | Falcon payment-fraud detection"
      }
    }
  },
  "DBX": {
    "DBX": {
      "layer": 7,
      "businessLabel": {
        "ja": "Dropbox｜保存・共有・検索",
        "en": "Dropbox | files / search"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft",
        "en": "Microsoft"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google",
        "en": "Google"
      }
    },
    "BOX": {
      "layer": 7,
      "businessLabel": {
        "ja": "Box",
        "en": "Box"
      }
    },
    "ADBE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Adobe",
        "en": "Adobe"
      }
    },
    "DOCU": {
      "layer": 7,
      "businessLabel": {
        "ja": "DocuSign",
        "en": "DocuSign"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon AWS｜一部の保存基盤",
        "en": "Amazon AWS | part of file hosting"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜ChatGPT文書連携",
        "en": "OpenAI | ChatGPT file integration"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Anthropic｜Claude文書連携",
        "en": "Anthropic | Claude file integration"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA",
        "en": "NVIDIA"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Apple｜Apple iCloud Drive",
        "en": "Apple iCloud Drive"
      }
    },
    "TEAM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Atlassian｜Atlassian Confluence",
        "en": "Atlassian Confluence"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce｜Salesforce傘下Slack",
        "en": "Salesforce Slack"
      }
    }
  },
  "FIVN": {
    "FIVN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Five9｜顧客対応プラットフォーム",
        "en": "Five9 | contact center"
      }
    },
    "NICE": {
      "layer": 7,
      "businessLabel": {
        "ja": "NiCE",
        "en": "NiCE"
      }
    },
    "RNG": {
      "layer": 7,
      "businessLabel": {
        "ja": "RingCentral",
        "en": "RingCentral"
      }
    },
    "ZM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Zoom",
        "en": "Zoom"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon",
        "en": "Amazon"
      }
    },
    "CRM": {
      "layer": 6,
      "businessLabel": {
        "ja": "Salesforce｜CRM連携",
        "en": "Salesforce | CRM integration"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft｜Microsoft Dynamics 365 Contact Center",
        "en": "Microsoft Dynamics 365 Contact Center"
      }
    },
    "NOW": {
      "layer": 6,
      "businessLabel": {
        "ja": "ServiceNow｜業務ソフト連携",
        "en": "ServiceNow | workflow integration"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜Gemini・Vertex AI・社内基盤",
        "en": "Google | Gemini / Vertex AI / hosting"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA",
        "en": "NVIDIA"
      }
    },
    "CSCO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Cisco｜Cisco Webex Contact Center",
        "en": "Cisco Webex Contact Center"
      }
    },
    "TWLO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Twilio｜Twilio Flex",
        "en": "Twilio Flex"
      }
    }
  },
  "RNG": {
    "RNG": {
      "layer": 7,
      "businessLabel": {
        "ja": "RingCentral｜企業通信・顧客対応",
        "en": "RingCentral | communications"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜製品・技術連携",
        "en": "Microsoft | product integrations"
      }
    },
    "ZM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Zoom",
        "en": "Zoom"
      }
    },
    "CSCO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Cisco",
        "en": "Cisco"
      }
    },
    "FIVN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Five9",
        "en": "Five9"
      }
    },
    "NICE": {
      "layer": 6,
      "businessLabel": {
        "ja": "NiCE｜CXone・RingEX協業",
        "en": "NiCE | CXone / RingEX alliance"
      }
    },
    "BAND": {
      "layer": 6,
      "businessLabel": {
        "ja": "Bandwidth｜通信・SMS基盤",
        "en": "Bandwidth | voice / SMS services"
      }
    },
    "T": {
      "layer": 6,
      "businessLabel": {
        "ja": "AT&T｜Office@Hand販売",
        "en": "AT&T | Office@Hand distribution"
      }
    }
  },
  "MNDY": {
    "MNDY": {
      "layer": 7,
      "businessLabel": {
        "ja": "monday.com｜業務管理",
        "en": "monday.com | work management"
      }
    },
    "ASAN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Asana",
        "en": "Asana"
      }
    },
    "TEAM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Atlassian",
        "en": "Atlassian"
      }
    },
    "HUBS": {
      "layer": 7,
      "businessLabel": {
        "ja": "HubSpot",
        "en": "HubSpot"
      }
    },
    "FRSH": {
      "layer": 7,
      "businessLabel": {
        "ja": "Freshworks",
        "en": "Freshworks"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon AWS｜稼働基盤",
        "en": "Amazon AWS | hosting"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google Cloud｜稼働基盤",
        "en": "Google Cloud | hosting"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜モデルAPI対応",
        "en": "OpenAI | model API access"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Anthropic｜モデルAPI対応",
        "en": "Anthropic | model API access"
      }
    }
  },
  "FRSH": {
    "FRSH": {
      "layer": 7,
      "businessLabel": {
        "ja": "Freshworks｜IT・顧客対応",
        "en": "Freshworks | IT / customer service"
      }
    },
    "NOW": {
      "layer": 7,
      "businessLabel": {
        "ja": "ServiceNow",
        "en": "ServiceNow"
      }
    },
    "TEAM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Atlassian",
        "en": "Atlassian"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce",
        "en": "Salesforce"
      }
    },
    "HUBS": {
      "layer": 7,
      "businessLabel": {
        "ja": "HubSpot",
        "en": "HubSpot"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft",
        "en": "Microsoft"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon AWS｜稼働・販売協業",
        "en": "Amazon AWS | hosting / distribution"
      }
    }
  },
  "KVYO": {
    "KVYO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Klaviyo｜顧客情報・販促",
        "en": "Klaviyo | customer marketing"
      }
    },
    "BRZE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Braze",
        "en": "Braze"
      }
    },
    "ADBE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Adobe",
        "en": "Adobe"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce",
        "en": "Salesforce"
      }
    },
    "Mailchimp": {
      "layer": 7,
      "businessLabel": {
        "ja": "Mailchimp",
        "en": "Mailchimp"
      }
    },
    "SHOP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Shopify｜製品連携・日付付き株式保有",
        "en": "Shopify | product integration / dated shareholding"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜製品・データ連携",
        "en": "Google | product / data integration"
      }
    },
    "META": {
      "layer": 6,
      "businessLabel": {
        "ja": "Meta｜製品・データ連携",
        "en": "Meta | product / data integration"
      }
    },
    "TOST": {
      "layer": 6,
      "businessLabel": {
        "ja": "Toast｜飲食店データ連携",
        "en": "Toast | restaurant data integration"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜ChatGPT情報連携",
        "en": "OpenAI | ChatGPT data connection"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Anthropic｜Claude・MCP接続",
        "en": "Anthropic | Claude / MCP connection"
      }
    },
    "INTU": {
      "layer": 7,
      "businessLabel": {
        "ja": "Intuit｜Intuit Mailchimp",
        "en": "Intuit Mailchimp"
      }
    }
  },
  "BRZE": {
    "BRZE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Braze｜顧客体験・配信",
        "en": "Braze | customer engagement"
      }
    },
    "ADBE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Adobe",
        "en": "Adobe"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce",
        "en": "Salesforce"
      }
    },
    "KVYO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Klaviyo",
        "en": "Klaviyo"
      }
    },
    "Iterable": {
      "layer": 7,
      "businessLabel": {
        "ja": "Iterable",
        "en": "Iterable"
      }
    },
    "SNOW": {
      "layer": 6,
      "businessLabel": {
        "ja": "Snowflake｜データ共有",
        "en": "Snowflake | data sharing"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜Azureへデータ出力",
        "en": "Microsoft | data export to Azure"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon｜AWSへデータ出力",
        "en": "Amazon | data export to AWS"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜Cloudへデータ出力",
        "en": "Google | cloud data export"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜利用者のAPIキー接続",
        "en": "OpenAI | customer API-key access"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Anthropic｜利用者のAPIキー接続",
        "en": "Anthropic | customer API-key access"
      }
    }
  },
  "SPT": {
    "SPT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Sprout Social｜SNS運用",
        "en": "Sprout Social | social management"
      }
    },
    "CXM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Sprinklr",
        "en": "Sprinklr"
      }
    },
    "Hootsuite": {
      "layer": 7,
      "businessLabel": {
        "ja": "Hootsuite",
        "en": "Hootsuite"
      }
    },
    "Khoros": {
      "layer": 7,
      "businessLabel": {
        "ja": "Khoros",
        "en": "Khoros"
      }
    },
    "META": {
      "layer": 6,
      "businessLabel": {
        "ja": "Meta｜Facebook・Instagram接続",
        "en": "Meta | Facebook / Instagram"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜LinkedIn接続",
        "en": "Microsoft | LinkedIn connectivity"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜YouTube接続",
        "en": "Google | YouTube connectivity"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon AWS｜主な稼働基盤",
        "en": "Amazon AWS | main hosting"
      }
    },
    "CRM": {
      "layer": 6,
      "businessLabel": {
        "ja": "Salesforce｜Service Cloud連携・採用",
        "en": "Salesforce | Service Cloud / adoption"
      }
    }
  },
  "WDC": {
    "STX": {
      "layer": 2,
      "businessLabel": {
        "ja": "Seagate｜HDD",
        "en": "Seagate | HDDs"
      }
    },
    "Toshiba Electronic Devices & Storage": {
      "layer": 2,
      "businessLabel": {
        "ja": "東芝｜HDD",
        "en": "Toshiba | HDDs"
      }
    },
    "MU": {
      "layer": 2,
      "businessLabel": {
        "ja": "Micron｜企業向けSSD",
        "en": "Micron | Enterprise SSDs"
      }
    },
    "Samsung Electronics": {
      "layer": 2,
      "businessLabel": {
        "ja": "Samsung｜企業向けSSD",
        "en": "Samsung | Enterprise SSDs"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜HDD資源回収協力",
        "en": "Microsoft | HDD recovery"
      }
    }
  },
  "STX": {
    "WDC": {
      "layer": 2,
      "businessLabel": {
        "ja": "Western Digital｜HDD",
        "en": "Western Digital | HDDs"
      }
    },
    "Toshiba Electronic Devices & Storage": {
      "layer": 2,
      "businessLabel": {
        "ja": "東芝｜HDD",
        "en": "Toshiba | HDDs"
      }
    },
    "MU": {
      "layer": 2,
      "businessLabel": {
        "ja": "Micron｜企業向けSSD",
        "en": "Micron | Enterprise SSDs"
      }
    },
    "Samsung Electronics": {
      "layer": 2,
      "businessLabel": {
        "ja": "Samsung｜企業向けSSD",
        "en": "Samsung | Enterprise SSDs"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜Xbox共同設計",
        "en": "Microsoft | Xbox co-design"
      }
    }
  },
  "ETN": {
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜電源・冷却設計",
        "en": "NVIDIA | power / cooling design"
      }
    }
  },
  "PLTR": {
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜Azure連携・分析競合",
        "en": "Microsoft | Azure / analytics"
      }
    },
    "NBIS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Nebius｜主権AI基盤の提携",
        "en": "Nebius | sovereign-AI alliance"
      }
    }
  },
  "KEYS": {
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "Broadcom｜1.6T試験協業",
        "en": "Broadcom | 1.6T test collaboration"
      }
    }
  },
  "FLEX": {
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜電源・ラック設計",
        "en": "NVIDIA | power / rack design"
      }
    }
  },
  "EGHT": {
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜音声モデル対応",
        "en": "OpenAI | voice-model support"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜Teams連携",
        "en": "Microsoft | Teams integration"
      }
    },
    "CRM": {
      "layer": 6,
      "businessLabel": {
        "ja": "Salesforce｜CRM連携",
        "en": "Salesforce | CRM integration"
      }
    },
    "TWLO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Twilio",
        "en": "Twilio"
      }
    },
    "ZM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Zoom",
        "en": "Zoom"
      }
    },
    "NICE": {
      "layer": 7,
      "businessLabel": {
        "ja": "NiCE",
        "en": "NiCE"
      }
    },
    "FIVN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Five9",
        "en": "Five9"
      }
    },
    "RNG": {
      "layer": 7,
      "businessLabel": {
        "ja": "RingCentral",
        "en": "RingCentral"
      }
    },
    "EGHT": {
      "layer": 7,
      "businessLabel": {
        "ja": "8x8",
        "en": "8x8"
      }
    },
    "CSCO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Cisco｜Cisco Webex",
        "en": "Cisco Webex"
      }
    }
  },
  "ICHR": {
    "ICHR": {
      "layer": 0,
      "businessLabel": {
        "ja": "Ichor｜流体システム",
        "en": "Ichor | fluid systems"
      }
    },
    "UCTT": {
      "layer": 0,
      "businessLabel": {
        "ja": "Ultra Clean｜流体システム競合",
        "en": "Ultra Clean | fluid systems"
      }
    },
    "BHE": {
      "layer": 0,
      "businessLabel": {
        "ja": "Benchmark｜精密加工競合",
        "en": "Benchmark | precision machining"
      }
    },
    "LRCX": {
      "layer": 1,
      "businessLabel": {
        "ja": "Lam Research｜装置顧客",
        "en": "Lam Research | equipment customer"
      }
    },
    "AMAT": {
      "layer": 1,
      "businessLabel": {
        "ja": "Applied Materials｜装置顧客",
        "en": "Applied Materials | customer"
      }
    },
    "ASML": {
      "layer": 1,
      "businessLabel": {
        "ja": "ASML｜装置顧客",
        "en": "ASML | equipment customer"
      }
    }
  },
  "UCTT": {
    "UCTT": {
      "layer": 0,
      "businessLabel": {
        "ja": "Ultra Clean｜サブシステム",
        "en": "Ultra Clean | subsystems"
      }
    },
    "ICHR": {
      "layer": 0,
      "businessLabel": {
        "ja": "Ichor｜流体システム競合",
        "en": "Ichor | fluid systems"
      }
    },
    "BHE": {
      "layer": 0,
      "businessLabel": {
        "ja": "Benchmark｜サブシステム競合",
        "en": "Benchmark | subsystems"
      }
    },
    "NPO": {
      "layer": 0,
      "businessLabel": {
        "ja": "Enpro｜洗浄・コーティング",
        "en": "Enpro | cleaning / coatings"
      }
    },
    "LRCX": {
      "layer": 1,
      "businessLabel": {
        "ja": "Lam Research｜装置顧客",
        "en": "Lam Research | equipment customer"
      }
    },
    "AMAT": {
      "layer": 1,
      "businessLabel": {
        "ja": "Applied Materials｜装置顧客",
        "en": "Applied Materials | customer"
      }
    }
  },
  "FORM": {
    "FORM": {
      "layer": 0,
      "businessLabel": {
        "ja": "FormFactor｜プローブ・計測",
        "en": "FormFactor | probes / measurement"
      }
    },
    "Technoprobe": {
      "layer": 0,
      "businessLabel": {
        "ja": "Technoprobe｜プローブカード",
        "en": "Technoprobe | probe cards"
      }
    },
    "Micronics Japan": {
      "layer": 0,
      "businessLabel": {
        "ja": "日本マイクロニクス｜プローブ",
        "en": "Micronics Japan | probes"
      }
    },
    "MPI": {
      "layer": 0,
      "businessLabel": {
        "ja": "MPI｜プローブ・計測",
        "en": "MPI | probes / measurement"
      }
    },
    "AEM": {
      "layer": 0,
      "businessLabel": {
        "ja": "AEM｜温度制御",
        "en": "AEM | thermal control"
      }
    },
    "SK hynix": {
      "layer": 2,
      "businessLabel": {
        "ja": "SK hynix｜FY2025顧客",
        "en": "SK hynix | FY2025 customer"
      }
    }
  },
  "AMKR": {
    "AMKR": {
      "layer": 2,
      "businessLabel": {
        "ja": "Amkor｜包装・検査受託",
        "en": "Amkor | packaging / test"
      }
    },
    "ASX": {
      "layer": 2,
      "businessLabel": {
        "ja": "ASE｜包装・検査競合",
        "en": "ASE | packaging / test"
      }
    },
    "JCET Group": {
      "layer": 2,
      "businessLabel": {
        "ja": "JCET｜包装・検査競合",
        "en": "JCET | packaging / test"
      }
    },
    "Powertech Technology": {
      "layer": 2,
      "businessLabel": {
        "ja": "Powertech｜包装・検査競合",
        "en": "Powertech | packaging / test"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC｜先端包装の協業",
        "en": "TSMC | packaging alliance"
      }
    },
    "QCOM": {
      "layer": 3,
      "businessLabel": {
        "ja": "Qualcomm｜FY2025顧客",
        "en": "Qualcomm | FY2025 customer"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Apple｜FY2025顧客",
        "en": "Apple | FY2025 customer"
      }
    }
  },
  "JBL": {
    "JBL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Jabil｜設計・製造受託",
        "en": "Jabil | design / manufacturing"
      }
    },
    "AMAT": {
      "layer": 0,
      "businessLabel": {
        "ja": "Applied Materials｜供給先",
        "en": "Applied Materials | customer"
      }
    },
    "COHU": {
      "layer": 0,
      "businessLabel": {
        "ja": "Cohu｜テスト装置の製造受託",
        "en": "Cohu | test-system customer"
      }
    }
  },
  "COHU": {
    "COHU": {
      "layer": 0,
      "businessLabel": {
        "ja": "Cohu｜テスト・自動化",
        "en": "Cohu | test / automation"
      }
    },
    "Advantest": {
      "layer": 0,
      "businessLabel": {
        "ja": "Advantest｜半導体テスト",
        "en": "Advantest | semiconductor test"
      }
    },
    "TER": {
      "layer": 0,
      "businessLabel": {
        "ja": "Teradyne｜半導体テスト",
        "en": "Teradyne | semiconductor test"
      }
    },
    "KLAC": {
      "layer": 0,
      "businessLabel": {
        "ja": "KLA｜検査・計測",
        "en": "KLA | inspection / metrology"
      }
    },
    "Hon Precision": {
      "layer": 0,
      "businessLabel": {
        "ja": "Hon Precision｜搬送・自動化",
        "en": "Hon Precision | handling"
      }
    },
    "JBL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Jabil｜テスト装置の製造委託",
        "en": "Jabil | test-system manufacturer"
      }
    },
    "Yamaichi Electronics": {
      "layer": 0,
      "businessLabel": {
        "ja": "山一電機｜テスト用コンタクター",
        "en": "Yamaichi | semiconductor test contactors"
      }
    }
  },
  "SANM": {
    "SANM": {
      "layer": 5,
      "businessLabel": {
        "ja": "Sanmina｜設計・製造受託",
        "en": "Sanmina | design / manufacturing"
      }
    },
    "NOK": {
      "layer": 4,
      "businessLabel": {
        "ja": "Nokia｜米国OLTの製造受託",
        "en": "Nokia | US OLT customer"
      }
    }
  },
  "ARW": {
    "ARW": {
      "layer": 5,
      "businessLabel": {
        "ja": "Arrow｜部品・IT流通",
        "en": "Arrow | components / IT distribution"
      }
    },
    "AVT": {
      "layer": 5,
      "businessLabel": {
        "ja": "Avnet｜電子部品流通",
        "en": "Avnet | components distribution"
      }
    },
    "SNX": {
      "layer": 5,
      "businessLabel": {
        "ja": "TD SYNNEX｜企業IT流通",
        "en": "TD SYNNEX | IT distribution"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜販売製品の供給元",
        "en": "NVIDIA | distribution supplier"
      }
    }
  },
  "AVT": {
    "AVT": {
      "layer": 5,
      "businessLabel": {
        "ja": "Avnet｜電子部品・設計支援",
        "en": "Avnet | components / design"
      }
    },
    "ARW": {
      "layer": 5,
      "businessLabel": {
        "ja": "Arrow｜電子部品流通",
        "en": "Arrow | components distribution"
      }
    },
    "RS": {
      "layer": 5,
      "businessLabel": {
        "ja": "RS｜電子部品流通",
        "en": "RS | components distribution"
      }
    },
    "AMD": {
      "layer": 3,
      "businessLabel": {
        "ja": "AMD｜EPYCの供給パートナー",
        "en": "AMD | EPYC supplier partner"
      }
    }
  },
  "PLAB": {
    "PLAB": {
      "layer": 0,
      "businessLabel": {
        "ja": "Photronics｜フォトマスク",
        "en": "Photronics | photomasks"
      }
    },
    "Tekscend Photomask": {
      "layer": 0,
      "businessLabel": {
        "ja": "Tekscend｜フォトマスク",
        "en": "Tekscend | photomasks"
      }
    },
    "Dai Nippon Printing": {
      "layer": 0,
      "businessLabel": {
        "ja": "大日本印刷｜合弁・域外競合",
        "en": "DNP | joint venture / competition"
      }
    },
    "SK-Electronics": {
      "layer": 0,
      "businessLabel": {
        "ja": "エスケーエレクトロニクス｜マスク",
        "en": "SK-Electronics | photomasks"
      }
    }
  },
  "ONTO": {
    "ONTO": {
      "layer": 0,
      "businessLabel": {
        "ja": "Onto｜検査・計測",
        "en": "Onto | inspection / metrology"
      }
    },
    "SK hynix": {
      "layer": 2,
      "businessLabel": {
        "ja": "SK hynix｜HBM生産の顧客",
        "en": "SK hynix | HBM customer"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC｜生産支援の顧客",
        "en": "TSMC | production-support customer"
      }
    }
  },
  "TER": {
    "TER": {
      "layer": 0,
      "businessLabel": {
        "ja": "Teradyne｜試験・ロボティクス",
        "en": "Teradyne | test / robotics"
      }
    },
    "FLEX": {
      "layer": 5,
      "businessLabel": {
        "ja": "Flex｜テスト装置の製造委託",
        "en": "Flex | test-system manufacturer"
      }
    },
    "PLXS": {
      "layer": 5,
      "businessLabel": {
        "ja": "Plexus｜テスト装置の製造委託",
        "en": "Plexus | test-system manufacturer"
      }
    },
    "Advantest": {
      "layer": 0,
      "businessLabel": {
        "ja": "Advantest｜半導体テスト",
        "en": "Advantest | semiconductor test"
      }
    },
    "COHU": {
      "layer": 0,
      "businessLabel": {
        "ja": "Cohu｜半導体テスト",
        "en": "Cohu | semiconductor test"
      }
    },
    "KEYS": {
      "layer": 0,
      "businessLabel": {
        "ja": "Keysight｜電子計測・試験",
        "en": "Keysight | electronic test"
      }
    },
    "Doosan Robotics": {
      "layer": 5,
      "businessLabel": {
        "ja": "Doosan Robotics｜協働ロボット",
        "en": "Doosan Robotics | cobots"
      }
    },
    "Omron": {
      "layer": 5,
      "businessLabel": {
        "ja": "Omron｜産業ロボット",
        "en": "Omron | industrial robots"
      }
    }
  },
  "CAMT": {
    "CAMT": {
      "layer": 0,
      "businessLabel": {
        "ja": "Camtek｜検査・計測",
        "en": "Camtek | inspection / metrology"
      }
    },
    "Chroma ATE": {
      "layer": 0,
      "businessLabel": {
        "ja": "Chroma｜出資元・技術協力",
        "en": "Chroma | investor / technology"
      }
    }
  },
  "ACLS": {
    "ACLS": {
      "layer": 0,
      "businessLabel": {
        "ja": "Axcelis｜イオン注入装置",
        "en": "Axcelis | ion implantation"
      }
    },
    "Semiconductor Manufacturing International": {
      "layer": 1,
      "businessLabel": {
        "ja": "SMIC｜成熟プロセスの顧客",
        "en": "SMIC | mature-process customer"
      }
    }
  },
  "ASX": {
    "ASX": {
      "layer": 2,
      "businessLabel": {
        "ja": "ASE｜包装・検査・製造受託",
        "en": "ASE | packaging / test / EMS"
      }
    },
    "AMKR": {
      "layer": 2,
      "businessLabel": {
        "ja": "Amkor｜包装・検査",
        "en": "Amkor | packaging / test"
      }
    },
    "JBL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Jabil｜電子機器の製造受託",
        "en": "Jabil | electronics manufacturing"
      }
    },
    "FLEX": {
      "layer": 5,
      "businessLabel": {
        "ja": "Flex｜電子機器の製造受託",
        "en": "Flex | electronics manufacturing"
      }
    },
    "Siemens": {
      "layer": 0,
      "businessLabel": {
        "ja": "Siemens｜VIPack設計の協業",
        "en": "Siemens | VIPack EDA collaboration"
      }
    }
  },
  "GFS": {
    "GFS": {
      "layer": 1,
      "businessLabel": {
        "ja": "GlobalFoundries｜半導体受託製造",
        "en": "GlobalFoundries | foundry"
      }
    },
    "Renesas Electronics": {
      "layer": 3,
      "businessLabel": {
        "ja": "Renesas｜製造提携の顧客",
        "en": "Renesas | manufacturing customer"
      }
    },
    "Semiconductor Manufacturing International": {
      "layer": 1,
      "businessLabel": {
        "ja": "SMIC｜半導体受託製造",
        "en": "SMIC | semiconductor foundry"
      }
    }
  },
  "TSEM": {
    "TSEM": {
      "layer": 1,
      "businessLabel": {
        "ja": "Tower｜特殊半導体の受託製造",
        "en": "Tower | specialty foundry"
      }
    },
    "INTC": {
      "layer": 1,
      "businessLabel": {
        "ja": "Intel｜300mm生産能力の調達先",
        "en": "Intel | 300mm capacity access"
      }
    },
    "STM": {
      "layer": 1,
      "businessLabel": {
        "ja": "STMicroelectronics｜Agrate工場共有",
        "en": "STMicroelectronics | shared fab"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜1.6T光技術の協業",
        "en": "NVIDIA | 1.6T optical collaboration"
      }
    }
  },
  "GLW": {
    "GLW": {
      "layer": 4,
      "businessLabel": {
        "ja": "Corning｜光接続・機能性ガラス",
        "en": "Corning | optical / glass"
      }
    },
    "META": {
      "layer": 6,
      "businessLabel": {
        "ja": "Meta｜光接続製品の顧客",
        "en": "Meta | optical-connectivity customer"
      }
    },
    "APH": {
      "layer": 4,
      "businessLabel": {
        "ja": "Amphenol｜光接続製品",
        "en": "Amphenol | optical connectivity"
      }
    },
    "AGC": {
      "layer": 4,
      "businessLabel": {
        "ja": "AGC｜表示ガラス・特殊材料",
        "en": "AGC | display glass / materials"
      }
    },
    "Nippon Electric Glass": {
      "layer": 4,
      "businessLabel": {
        "ja": "日本電気硝子｜表示ガラス",
        "en": "Nippon Electric Glass | display glass"
      }
    },
    "NGK Corporation": {
      "layer": 4,
      "businessLabel": {
        "ja": "NGK｜自動車用セラミック",
        "en": "NGK | automotive ceramics"
      }
    },
    "TMO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Thermo Fisher｜研究・医療製品",
        "en": "Thermo Fisher | lab / healthcare"
      }
    },
    "DHR": {
      "layer": 7,
      "businessLabel": {
        "ja": "Danaher｜研究・医療製品",
        "en": "Danaher | lab / healthcare"
      }
    }
  },
  "TEL": {
    "TEL": {
      "layer": 4,
      "businessLabel": {
        "ja": "TE Connectivity｜接続部品・センサー",
        "en": "TE Connectivity | connectivity / sensors"
      }
    },
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "Broadcom｜2023年800G AEC実演",
        "en": "Broadcom | 2023 800G AEC demo"
      }
    },
    "ST": {
      "layer": 4,
      "businessLabel": {
        "ja": "Sensata｜輸送機器向け圧力センサー",
        "en": "Sensata | transportation pressure sensors"
      }
    }
  },
  "UMC": {
    "UMC": {
      "layer": 1,
      "businessLabel": {
        "ja": "UMC｜半導体の受託製造",
        "en": "UMC | semiconductor foundry"
      }
    },
    "INTC": {
      "layer": 1,
      "businessLabel": {
        "ja": "Intel｜12nm開発協業",
        "en": "Intel | 12nm development"
      }
    }
  },
  "STM": {
    "STM": {
      "layer": 3,
      "businessLabel": {
        "ja": "STMicroelectronics｜半導体",
        "en": "STMicroelectronics | semiconductors"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon / AWS｜半導体の顧客",
        "en": "Amazon / AWS | chip customer"
      }
    },
    "Infineon Technologies": {
      "layer": 3,
      "businessLabel": {
        "ja": "Infineon｜電源・車載半導体",
        "en": "Infineon | power / automotive"
      }
    }
  },
  "HIMX": {
    "HIMX": {
      "layer": 3,
      "businessLabel": {
        "ja": "Himax｜表示・画像半導体",
        "en": "Himax | display / imaging"
      }
    },
    "FOCI Fiber Optic Communications": {
      "layer": 4,
      "businessLabel": {
        "ja": "FOCI｜CPOの共同開発",
        "en": "FOCI | CPO co-development"
      }
    },
    "Novatek Microelectronics": {
      "layer": 3,
      "businessLabel": {
        "ja": "Novatek｜表示半導体",
        "en": "Novatek | display chips"
      }
    },
    "FocalTech Systems": {
      "layer": 3,
      "businessLabel": {
        "ja": "FocalTech｜表示・タッチ",
        "en": "FocalTech | display / touch"
      }
    },
    "Ilitek": {
      "layer": 3,
      "businessLabel": {
        "ja": "Ilitek｜表示・タッチ",
        "en": "Ilitek | display / touch"
      }
    }
  },
  "CRUS": {
    "CRUS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Cirrus Logic｜音声・制御半導体",
        "en": "Cirrus Logic | audio / control"
      }
    },
    "GFS": {
      "layer": 1,
      "businessLabel": {
        "ja": "GlobalFoundries｜製造供給元",
        "en": "GlobalFoundries | wafer supplier"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC｜製造供給元",
        "en": "TSMC | wafer supplier"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Apple｜FY2026最終顧客",
        "en": "Apple | FY2026 end customer"
      }
    }
  },
  "SYNA": {
    "SYNA": {
      "layer": 3,
      "businessLabel": {
        "ja": "Synaptics｜エッジAI・接続",
        "en": "Synaptics | edge AI / connectivity"
      }
    },
    "GOOG": {
      "layer": 3,
      "businessLabel": {
        "ja": "Google｜MLコア技術協業",
        "en": "Google | ML-core collaboration"
      }
    },
    "Infineon Technologies": {
      "layer": 3,
      "businessLabel": {
        "ja": "Infineon｜IoT無線半導体",
        "en": "Infineon | IoT wireless"
      }
    }
  },
  "AMBA": {
    "AMBA": {
      "layer": 3,
      "businessLabel": {
        "ja": "Ambarella｜エッジAI映像SoC",
        "en": "Ambarella | edge-AI vision SoCs"
      }
    },
    "Samsung": {
      "layer": 1,
      "businessLabel": {
        "ja": "Samsung｜主要ファウンドリー",
        "en": "Samsung | principal foundry"
      }
    },
    "Novatek Microelectronics": {
      "layer": 3,
      "businessLabel": {
        "ja": "Novatek｜映像処理SoC",
        "en": "Novatek | vision SoCs"
      }
    }
  },
  "INDI": {
    "INDI": {
      "layer": 3,
      "businessLabel": {
        "ja": "indie｜車載半導体",
        "en": "indie | automotive chips"
      }
    },
    "GFS": {
      "layer": 1,
      "businessLabel": {
        "ja": "GlobalFoundries｜22FDX協業",
        "en": "GlobalFoundries | 22FDX collaboration"
      }
    }
  },
  "PI": {
    "PI": {
      "layer": 3,
      "businessLabel": {
        "ja": "Impinj｜RAIN RFID",
        "en": "Impinj | RAIN RFID"
      }
    },
    "AVY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Avery Dennison｜RFID製品採用",
        "en": "Avery Dennison | RFID adopter"
      }
    }
  },
  "LSCC": {
    "LSCC": {
      "layer": 3,
      "businessLabel": {
        "ja": "Lattice｜低消費電力FPGA",
        "en": "Lattice | low-power FPGAs"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜Halos開発協業",
        "en": "NVIDIA | Halos collaboration"
      }
    },
    "Altera": {
      "layer": 3,
      "businessLabel": {
        "ja": "Altera｜低消費電力FPGA",
        "en": "Altera | low-power FPGAs"
      }
    }
  },
  "MXL": {
    "MXL": {
      "layer": 3,
      "businessLabel": {
        "ja": "MaxLinear｜接続・通信半導体",
        "en": "MaxLinear | connectivity silicon"
      }
    },
    "Accton Technology": {
      "layer": 5,
      "businessLabel": {
        "ja": "Accton / Edgecore｜通信協業",
        "en": "Accton / Edgecore | networking"
      }
    }
  },
  "VIAV": {
    "VIAV": {
      "layer": 0,
      "businessLabel": {
        "ja": "VIAVI｜通信試験・光技術",
        "en": "VIAVI | network test / optics"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜AI-RAN共同デモ",
        "en": "NVIDIA | AI-RAN joint demos"
      }
    },
    "KEYS": {
      "layer": 0,
      "businessLabel": {
        "ja": "Keysight｜ネットワーク試験",
        "en": "Keysight | network test"
      }
    },
    "Anritsu": {
      "layer": 0,
      "businessLabel": {
        "ja": "Anritsu｜通信試験",
        "en": "Anritsu | network test"
      }
    },
    "CXT": {
      "layer": 4,
      "businessLabel": {
        "ja": "Crane NXT｜特殊光・認証技術",
        "en": "Crane NXT | optics / authentication"
      }
    },
    "COHR": {
      "layer": 4,
      "businessLabel": {
        "ja": "Coherent｜特殊光製品",
        "en": "Coherent | specialty optics"
      }
    }
  },
  "NFLX": {
    "NFLX": {
      "layer": 7,
      "businessLabel": {
        "ja": "Netflix｜動画配信",
        "en": "Netflix | streaming"
      }
    },
    "SPOT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Spotify｜動画ポッドキャスト協業",
        "en": "Spotify | video-podcast collaboration"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Apple Arcade｜モバイルゲーム定額利用",
        "en": "Apple Arcade | mobile-game subscription"
      }
    }
  },
  "SHOP": {
    "SHOP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Shopify｜コマース基盤",
        "en": "Shopify | commerce platform"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜UCP・AIコマース協業",
        "en": "Google | UCP / AI commerce"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜ChatGPT商品連携",
        "en": "OpenAI | ChatGPT commerce"
      }
    }
  },
  "ROKU": {
    "ROKU": {
      "layer": 7,
      "businessLabel": {
        "ja": "Roku｜TV配信・広告",
        "en": "Roku | TV streaming / ads"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon｜DSP協業・TV配信",
        "en": "Amazon | DSP collaboration / TV"
      }
    },
    "FOXA": {
      "layer": 7,
      "businessLabel": {
        "ja": "Fox｜条件付き買収契約",
        "en": "Fox | conditional acquisition agreement"
      }
    }
  },
  "TTD": {
    "TTD": {
      "layer": 7,
      "businessLabel": {
        "ja": "The Trade Desk｜広告購入DSP",
        "en": "The Trade Desk | advertising DSP"
      }
    },
    "SPOT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Spotify｜音声・動画広告在庫",
        "en": "Spotify | audio / video ad inventory"
      }
    }
  },
  "MELI": {
    "MELI": {
      "layer": 7,
      "businessLabel": {
        "ja": "Mercado Libre｜通販・金融",
        "en": "Mercado Libre | commerce / finance"
      }
    },
    "V": {
      "layer": 7,
      "businessLabel": {
        "ja": "Visa｜メキシコのカード連携",
        "en": "Visa | Mexico card network"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon｜ブラジルの通販",
        "en": "Amazon | Brazilian commerce"
      }
    },
    "SE": {
      "layer": 7,
      "businessLabel": {
        "ja": "Sea / Shopee｜ブラジルの通販",
        "en": "Sea / Shopee | Brazilian commerce"
      }
    },
    "NU": {
      "layer": 7,
      "businessLabel": {
        "ja": "Nu Holdings / Nubank | Nu Holdings｜個人向け金融",
        "en": "Nu Holdings / Nubank | Nu Holdings | Consumer finance"
      }
    }
  },
  "PYPL": {
    "PYPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "PayPal｜決済・ウォレット",
        "en": "PayPal | payments / wallet"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜ChatGPT決済連携",
        "en": "OpenAI | ChatGPT payments"
      }
    }
  },
  "XYZ": {
    "XYZ": {
      "layer": 7,
      "businessLabel": {
        "ja": "Block / Square｜店舗・決済",
        "en": "Block / Square | merchant payments"
      }
    },
    "DASH": {
      "layer": 7,
      "businessLabel": {
        "ja": "DoorDash｜Square注文連携",
        "en": "DoorDash | Square order integration"
      }
    }
  },
  "AKAM": {
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon",
        "en": "Amazon"
      }
    },
    "NET": {
      "layer": 6,
      "businessLabel": {
        "ja": "Cloudflare",
        "en": "Cloudflare"
      }
    },
    "AKAM": {
      "layer": 6,
      "businessLabel": {
        "ja": "Akamai Technologies",
        "en": "Akamai Technologies"
      }
    },
    "FFIV": {
      "layer": 6,
      "businessLabel": {
        "ja": "F5",
        "en": "F5"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜GPU供給元",
        "en": "NVIDIA | GPU supplier"
      }
    },
    "Anthropic": {
      "layer": 7,
      "businessLabel": {
        "ja": "Anthropic｜CPU容量の顧客",
        "en": "Anthropic | CPU capacity customer"
      }
    }
  },
  "TWLO": {
    "TWLO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Twilio",
        "en": "Twilio"
      }
    },
    "EGHT": {
      "layer": 7,
      "businessLabel": {
        "ja": "8x8",
        "en": "8x8"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜会話AI開発協業",
        "en": "Microsoft | conversational AI"
      }
    },
    "BAND": {
      "layer": 7,
      "businessLabel": {
        "ja": "Bandwidth｜プログラム可能な音声API",
        "en": "Bandwidth | programmable voice"
      }
    },
    "CRM": {
      "layer": 7,
      "businessLabel": {
        "ja": "Salesforce Data 360｜顧客データ統合",
        "en": "Salesforce Data 360 | unified customer data"
      }
    }
  },
  "SOFI": {
    "SOFI": {
      "layer": 7,
      "businessLabel": {
        "ja": "SoFi Technologies",
        "en": "SoFi Technologies"
      }
    },
    "HAPN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Happen Bank (formerly LendingClub)",
        "en": "Happen Bank (formerly LendingClub)"
      }
    },
    "HOOD": {
      "layer": 7,
      "businessLabel": {
        "ja": "Robinhood Markets",
        "en": "Robinhood Markets"
      }
    },
    "MQ": {
      "layer": 7,
      "businessLabel": {
        "ja": "Marqeta",
        "en": "Marqeta"
      }
    },
    "FI": {
      "layer": 7,
      "businessLabel": {
        "ja": "Fiserv",
        "en": "Fiserv"
      }
    },
    "MA": {
      "layer": 7,
      "businessLabel": {
        "ja": "Mastercard｜SoFiUSD清算協業",
        "en": "Mastercard | SoFiUSD settlement"
      }
    }
  },
  "DUOL": {
    "DUOL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Duolingo",
        "en": "Duolingo"
      }
    },
    "Babbel": {
      "layer": 7,
      "businessLabel": {
        "ja": "Babbel",
        "en": "Babbel"
      }
    },
    "Speakeasy Labs / Speak": {
      "layer": 7,
      "businessLabel": {
        "ja": "Speakeasy Labs / Speak",
        "en": "Speakeasy Labs / Speak"
      }
    },
    "PSO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Pearson",
        "en": "Pearson"
      }
    },
    "ETS": {
      "layer": 7,
      "businessLabel": {
        "ja": "ETS",
        "en": "ETS"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜MaxのAIモデル採用",
        "en": "OpenAI | models for Max"
      }
    }
  },
  "PAYC": {
    "PAYC": {
      "layer": 7,
      "businessLabel": {
        "ja": "Paycom Software",
        "en": "Paycom Software"
      }
    },
    "PAYX": {
      "layer": 7,
      "businessLabel": {
        "ja": "Paychex",
        "en": "Paychex"
      }
    },
    "ADP": {
      "layer": 7,
      "businessLabel": {
        "ja": "Automatic Data Processing",
        "en": "Automatic Data Processing"
      }
    },
    "PCTY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Paylocity",
        "en": "Paylocity"
      }
    },
    "V": {
      "layer": 7,
      "businessLabel": {
        "ja": "Visa｜Vault給与カード網",
        "en": "Visa | Vault payroll network"
      }
    },
    "WDAY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Workday｜Workday HCM",
        "en": "Workday HCM"
      }
    },
    "ORCL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Oracle｜Oracle Fusion Cloud HCM",
        "en": "Oracle Fusion Cloud HCM"
      }
    }
  },
  "APPF": {
    "APPF": {
      "layer": 7,
      "businessLabel": {
        "ja": "AppFolio",
        "en": "AppFolio"
      }
    },
    "Yardi": {
      "layer": 7,
      "businessLabel": {
        "ja": "Yardi",
        "en": "Yardi"
      }
    },
    "RealPage": {
      "layer": 7,
      "businessLabel": {
        "ja": "RealPage",
        "en": "RealPage"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon / AWS｜クラウド供給",
        "en": "Amazon / AWS | cloud provider"
      }
    },
    "Anthropic": {
      "layer": 6,
      "businessLabel": {
        "ja": "Anthropic｜Bedrock経由Claude",
        "en": "Anthropic | Claude via Bedrock"
      }
    }
  },
  "QLYS": {
    "PANW": {
      "layer": 7,
      "businessLabel": {
        "ja": "Palo Alto Networks",
        "en": "Palo Alto Networks"
      }
    },
    "CRWD": {
      "layer": 7,
      "businessLabel": {
        "ja": "CrowdStrike",
        "en": "CrowdStrike"
      }
    },
    "TENB": {
      "layer": 7,
      "businessLabel": {
        "ja": "Tenable",
        "en": "Tenable"
      }
    },
    "RPD": {
      "layer": 7,
      "businessLabel": {
        "ja": "Rapid7",
        "en": "Rapid7"
      }
    },
    "QLYS": {
      "layer": 7,
      "businessLabel": {
        "ja": "Qualys",
        "en": "Qualys"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google｜Google傘下Wiz",
        "en": "Google Wiz"
      }
    }
  },
  "WMT": {
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon | 通販・小売",
        "en": "Amazon | Retail / commerce"
      }
    },
    "COST": {
      "layer": 7,
      "businessLabel": {
        "ja": "Costco",
        "en": "Costco"
      }
    },
    "WMT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Walmart",
        "en": "Walmart"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜Geminiコマース協業",
        "en": "Google | Gemini commerce"
      }
    },
    "OpenAI": {
      "layer": 6,
      "businessLabel": {
        "ja": "OpenAI｜ChatGPT商品連携",
        "en": "OpenAI | ChatGPT commerce"
      }
    }
  },
  "SITM": {
    "MCHP": {
      "layer": 3,
      "businessLabel": {
        "ja": "Microchip Technology",
        "en": "Microchip Technology"
      }
    },
    "SITM": {
      "layer": 3,
      "businessLabel": {
        "ja": "SiTime",
        "en": "SiTime"
      }
    },
    "DIOD": {
      "layer": 3,
      "businessLabel": {
        "ja": "Diodes Incorporated",
        "en": "Diodes Incorporated"
      }
    },
    "Seiko Epson": {
      "layer": 3,
      "businessLabel": {
        "ja": "Seiko Epson",
        "en": "Seiko Epson"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC｜主要製造先",
        "en": "TSMC | principal foundry"
      }
    },
    "UMC": {
      "layer": 1,
      "businessLabel": {
        "ja": "UMC｜主要製造先",
        "en": "UMC | principal foundry"
      }
    }
  },
  "RMBS": {
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "Texas Instruments",
        "en": "Texas Instruments"
      }
    },
    "MPWR": {
      "layer": 3,
      "businessLabel": {
        "ja": "Monolithic Power Systems",
        "en": "Monolithic Power Systems"
      }
    },
    "CDNS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Cadence Design Systems",
        "en": "Cadence Design Systems"
      }
    },
    "SNPS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Synopsys",
        "en": "Synopsys"
      }
    },
    "RMBS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Rambus",
        "en": "Rambus"
      }
    },
    "Montage Technology": {
      "layer": 3,
      "businessLabel": {
        "ja": "Montage Technology",
        "en": "Montage Technology"
      }
    },
    "Samsung": {
      "layer": 3,
      "businessLabel": {
        "ja": "Samsung｜HBM4E開発協力方針",
        "en": "Samsung | HBM4E collaboration intent"
      }
    }
  },
  "DIOD": {
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "Texas Instruments",
        "en": "Texas Instruments"
      }
    },
    "ON": {
      "layer": 3,
      "businessLabel": {
        "ja": "onsemi",
        "en": "onsemi"
      }
    },
    "SITM": {
      "layer": 3,
      "businessLabel": {
        "ja": "SiTime",
        "en": "SiTime"
      }
    },
    "DIOD": {
      "layer": 3,
      "businessLabel": {
        "ja": "Diodes Incorporated",
        "en": "Diodes Incorporated"
      }
    },
    "AOSL": {
      "layer": 3,
      "businessLabel": {
        "ja": "Alpha and Omega Semiconductor",
        "en": "Alpha and Omega Semiconductor"
      }
    },
    "VSH": {
      "layer": 3,
      "businessLabel": {
        "ja": "Vishay Intertechnology",
        "en": "Vishay Intertechnology"
      }
    },
    "ARW": {
      "layer": 7,
      "businessLabel": {
        "ja": "Arrow Electronics｜販売代理店",
        "en": "Arrow Electronics | distributor"
      }
    },
    "AVT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Avnet｜販売代理店",
        "en": "Avnet | distributor"
      }
    }
  },
  "SLAB": {
    "TXN": {
      "layer": 3,
      "businessLabel": {
        "ja": "Texas Instruments",
        "en": "Texas Instruments"
      }
    },
    "SLAB": {
      "layer": 3,
      "businessLabel": {
        "ja": "Silicon Laboratories",
        "en": "Silicon Laboratories"
      }
    },
    "Nordic Semiconductor": {
      "layer": 3,
      "businessLabel": {
        "ja": "Nordic Semiconductor",
        "en": "Nordic Semiconductor"
      }
    },
    "Infineon Technologies": {
      "layer": 3,
      "businessLabel": {
        "ja": "Infineon Technologies",
        "en": "Infineon Technologies"
      }
    },
    "AMZN": {
      "layer": 7,
      "businessLabel": {
        "ja": "Amazon｜Sidewalk技術対応",
        "en": "Amazon | Sidewalk compatibility"
      }
    }
  },
  "CEVA": {
    "ARM": {
      "layer": 3,
      "businessLabel": {
        "ja": "Arm",
        "en": "Arm"
      }
    },
    "CDNS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Cadence Design Systems",
        "en": "Cadence Design Systems"
      }
    },
    "CEVA": {
      "layer": 3,
      "businessLabel": {
        "ja": "CEVA",
        "en": "CEVA"
      }
    },
    "Infineon": {
      "layer": 3,
      "businessLabel": {
        "ja": "Infineon",
        "en": "Infineon"
      }
    },
    "VeriSilicon": {
      "layer": 3,
      "businessLabel": {
        "ja": "VeriSilicon",
        "en": "VeriSilicon"
      }
    },
    "Samsung": {
      "layer": 3,
      "businessLabel": {
        "ja": "Samsung｜LTE向けDSP採用",
        "en": "Samsung | LTE DSP licensee"
      }
    }
  },
  "NVTS": {
    "ON": {
      "layer": 3,
      "businessLabel": {
        "ja": "onsemi",
        "en": "onsemi"
      }
    },
    "POWI": {
      "layer": 3,
      "businessLabel": {
        "ja": "Power Integrations",
        "en": "Power Integrations"
      }
    },
    "STM": {
      "layer": 3,
      "businessLabel": {
        "ja": "STMicroelectronics",
        "en": "STMicroelectronics"
      }
    },
    "NVTS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Navitas Semiconductor",
        "en": "Navitas Semiconductor"
      }
    },
    "Infineon Technologies": {
      "layer": 3,
      "businessLabel": {
        "ja": "Infineon Technologies",
        "en": "Infineon Technologies"
      }
    },
    "NVDA": {
      "layer": 5,
      "businessLabel": {
        "ja": "NVIDIA｜800VDC技術対応",
        "en": "NVIDIA | 800 VDC compatibility"
      }
    }
  },
  "IPGP": {
    "LITE": {
      "layer": 0,
      "businessLabel": {
        "ja": "Lumentum",
        "en": "Lumentum"
      }
    },
    "COHR": {
      "layer": 0,
      "businessLabel": {
        "ja": "Coherent",
        "en": "Coherent"
      }
    },
    "IPGP": {
      "layer": 0,
      "businessLabel": {
        "ja": "IPG Photonics",
        "en": "IPG Photonics"
      }
    },
    "ESAB": {
      "layer": 0,
      "businessLabel": {
        "ja": "ESAB｜FlexCell溶接構成",
        "en": "ESAB | FlexCell welding options"
      }
    }
  },
  "IONQ": {
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google｜Cloud利用窓口・量子計算",
        "en": "Google | Cloud access / quantum systems"
      }
    },
    "IBM": {
      "layer": 6,
      "businessLabel": {
        "ja": "IBM",
        "en": "IBM"
      }
    },
    "IONQ": {
      "layer": 6,
      "businessLabel": {
        "ja": "IonQ",
        "en": "IonQ"
      }
    },
    "RGTI": {
      "layer": 6,
      "businessLabel": {
        "ja": "Rigetti Computing",
        "en": "Rigetti Computing"
      }
    },
    "Quantinuum": {
      "layer": 7,
      "businessLabel": {
        "ja": "Quantinuum",
        "en": "Quantinuum"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon｜Braket量子利用窓口",
        "en": "Amazon | Braket quantum access"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft｜Azure量子利用窓口",
        "en": "Microsoft | Azure quantum access"
      }
    }
  },
  "RGTI": {
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google",
        "en": "Google"
      }
    },
    "IBM": {
      "layer": 6,
      "businessLabel": {
        "ja": "IBM",
        "en": "IBM"
      }
    },
    "IONQ": {
      "layer": 6,
      "businessLabel": {
        "ja": "IonQ",
        "en": "IonQ"
      }
    },
    "RGTI": {
      "layer": 6,
      "businessLabel": {
        "ja": "Rigetti Computing",
        "en": "Rigetti Computing"
      }
    },
    "Quantinuum": {
      "layer": 7,
      "businessLabel": {
        "ja": "Quantinuum",
        "en": "Quantinuum"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon｜Braket量子利用窓口",
        "en": "Amazon | Braket quantum access"
      }
    }
  },
  "QBTS": {
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google",
        "en": "Google"
      }
    },
    "IBM": {
      "layer": 6,
      "businessLabel": {
        "ja": "IBM",
        "en": "IBM"
      }
    },
    "QBTS": {
      "layer": 6,
      "businessLabel": {
        "ja": "D-Wave Quantum",
        "en": "D-Wave Quantum"
      }
    },
    "Quantinuum": {
      "layer": 7,
      "businessLabel": {
        "ja": "Quantinuum",
        "en": "Quantinuum"
      }
    },
    "NTT": {
      "layer": 7,
      "businessLabel": {
        "ja": "NTT / DOCOMO｜量子最適化の利用",
        "en": "NTT / DOCOMO | quantum optimization"
      }
    }
  },
  "QUBT": {
    "IBM": {
      "layer": 6,
      "businessLabel": {
        "ja": "IBM",
        "en": "IBM"
      }
    },
    "QBTS": {
      "layer": 6,
      "businessLabel": {
        "ja": "D-Wave Quantum",
        "en": "D-Wave Quantum"
      }
    },
    "QUBT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Quantum Computing Inc.",
        "en": "Quantum Computing Inc."
      }
    },
    "Xanadu": {
      "layer": 7,
      "businessLabel": {
        "ja": "Xanadu",
        "en": "Xanadu"
      }
    },
    "CIEN": {
      "layer": 4,
      "businessLabel": {
        "ja": "Ciena｜量子安全通信の共同実演",
        "en": "Ciena | quantum-safe communications"
      }
    }
  },
  "ASTS": {
    "ASTS": {
      "layer": 5,
      "businessLabel": {
        "ja": "AST SpaceMobile",
        "en": "AST SpaceMobile"
      }
    },
    "SpaceX": {
      "layer": 7,
      "businessLabel": {
        "ja": "SpaceX",
        "en": "SpaceX"
      }
    },
    "GSAT": {
      "layer": 5,
      "businessLabel": {
        "ja": "Globalstar",
        "en": "Globalstar"
      }
    },
    "T": {
      "layer": 7,
      "businessLabel": {
        "ja": "AT&T｜衛星携帯通信の提携先",
        "en": "AT&T | satellite-mobile partner"
      }
    },
    "VZ": {
      "layer": 7,
      "businessLabel": {
        "ja": "Verizon｜衛星携帯通信の提携先",
        "en": "Verizon | satellite-mobile partner"
      }
    },
    "VOD": {
      "layer": 7,
      "businessLabel": {
        "ja": "Vodafone｜衛星携帯通信の提携先",
        "en": "Vodafone | satellite-mobile partner"
      }
    }
  },
  "PL": {
    "PL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Planet Labs",
        "en": "Planet Labs"
      }
    },
    "BKSY": {
      "layer": 5,
      "businessLabel": {
        "ja": "BlackSky Technology",
        "en": "BlackSky Technology"
      }
    },
    "Vantor": {
      "layer": 7,
      "businessLabel": {
        "ja": "Vantor",
        "en": "Vantor"
      }
    },
    "Airbus": {
      "layer": 7,
      "businessLabel": {
        "ja": "Airbus",
        "en": "Airbus"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA｜GPU画像処理の開発協力",
        "en": "NVIDIA | GPU-imagery collaboration"
      }
    }
  },
  "BKSY": {
    "PL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Planet Labs",
        "en": "Planet Labs"
      }
    },
    "BKSY": {
      "layer": 5,
      "businessLabel": {
        "ja": "BlackSky Technology",
        "en": "BlackSky Technology"
      }
    },
    "Vantor": {
      "layer": 7,
      "businessLabel": {
        "ja": "Vantor",
        "en": "Vantor"
      }
    },
    "Airbus": {
      "layer": 7,
      "businessLabel": {
        "ja": "Airbus",
        "en": "Airbus"
      }
    },
    "RKLB": {
      "layer": 1,
      "businessLabel": {
        "ja": "Rocket Lab｜Electron打ち上げ供給",
        "en": "Rocket Lab | Electron launch provider"
      }
    }
  },
  "AVAV": {
    "AVAV": {
      "layer": 5,
      "businessLabel": {
        "ja": "AeroVironment",
        "en": "AeroVironment"
      }
    },
    "RDW": {
      "layer": 5,
      "businessLabel": {
        "ja": "Redwire",
        "en": "Redwire"
      }
    },
    "Anduril Industries": {
      "layer": 7,
      "businessLabel": {
        "ja": "Anduril Industries",
        "en": "Anduril Industries"
      }
    },
    "RTX": {
      "layer": 7,
      "businessLabel": {
        "ja": "RTX",
        "en": "RTX"
      }
    },
    "LHX": {
      "layer": 5,
      "businessLabel": {
        "ja": "L3Harris｜FY2024 Shryke搭載実証",
        "en": "L3Harris | FY2024 Shryke integration"
      }
    }
  },
  "KTOS": {
    "KTOS": {
      "layer": 5,
      "businessLabel": {
        "ja": "Kratos Defense",
        "en": "Kratos Defense"
      }
    },
    "Anduril Industries": {
      "layer": 7,
      "businessLabel": {
        "ja": "Anduril Industries",
        "en": "Anduril Industries"
      }
    },
    "General Atomics": {
      "layer": 7,
      "businessLabel": {
        "ja": "General Atomics",
        "en": "General Atomics"
      }
    },
    "LHX": {
      "layer": 7,
      "businessLabel": {
        "ja": "L3Harris Technologies",
        "en": "L3Harris Technologies"
      }
    },
    "Airbus": {
      "layer": 5,
      "businessLabel": {
        "ja": "Airbus｜U740開発・欧州飛行",
        "en": "Airbus | U740 development / flight"
      }
    }
  },
  "RDW": {
    "RKLB": {
      "layer": 5,
      "businessLabel": {
        "ja": "Rocket Lab",
        "en": "Rocket Lab"
      }
    },
    "AVAV": {
      "layer": 5,
      "businessLabel": {
        "ja": "AeroVironment",
        "en": "AeroVironment"
      }
    },
    "RDW": {
      "layer": 5,
      "businessLabel": {
        "ja": "Redwire",
        "en": "Redwire"
      }
    },
    "Shield AI": {
      "layer": 7,
      "businessLabel": {
        "ja": "Shield AI",
        "en": "Shield AI"
      }
    },
    "BA": {
      "layer": 5,
      "businessLabel": {
        "ja": "Boeing｜ISS太陽電池アレイの顧客",
        "en": "Boeing | ISS solar-array customer"
      }
    }
  },
  "SWKS": {
    "AVGO": {
      "layer": 3,
      "businessLabel": {
        "ja": "Broadcom",
        "en": "Broadcom"
      }
    },
    "QCOM": {
      "layer": 3,
      "businessLabel": {
        "ja": "Qualcomm",
        "en": "Qualcomm"
      }
    },
    "SWKS": {
      "layer": 3,
      "businessLabel": {
        "ja": "Skyworks Solutions",
        "en": "Skyworks Solutions"
      }
    },
    "Murata Manufacturing": {
      "layer": 7,
      "businessLabel": {
        "ja": "Murata Manufacturing",
        "en": "Murata Manufacturing"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Apple｜FY2025売上の67%を占める顧客",
        "en": "Apple | 67% of FY2025 revenue"
      }
    }
  },
  "BHE": {
    "JBL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Jabil",
        "en": "Jabil"
      }
    },
    "FLEX": {
      "layer": 5,
      "businessLabel": {
        "ja": "Flex",
        "en": "Flex"
      }
    },
    "SANM": {
      "layer": 5,
      "businessLabel": {
        "ja": "Sanmina",
        "en": "Sanmina"
      }
    },
    "BHE": {
      "layer": 5,
      "businessLabel": {
        "ja": "Benchmark Electronics",
        "en": "Benchmark Electronics"
      }
    },
    "HPE": {
      "layer": 5,
      "businessLabel": {
        "ja": "HPE｜液冷サーバーブレードの製造先",
        "en": "HPE | liquid-cooled server-blade customer"
      }
    }
  },
  "QTWO": {
    "LITE": {
      "layer": 4,
      "businessLabel": {
        "ja": "Lumentum",
        "en": "Lumentum"
      }
    },
    "COHR": {
      "layer": 4,
      "businessLabel": {
        "ja": "Coherent",
        "en": "Coherent"
      }
    },
    "VRT": {
      "layer": 5,
      "businessLabel": {
        "ja": "Vertiv",
        "en": "Vertiv"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft",
        "en": "Microsoft"
      }
    },
    "NBIS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Nebius",
        "en": "Nebius"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC",
        "en": "TSMC"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA",
        "en": "NVIDIA"
      }
    },
    "MU": {
      "layer": 2,
      "businessLabel": {
        "ja": "Micron",
        "en": "Micron"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google",
        "en": "Google"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon",
        "en": "Amazon"
      }
    },
    "META": {
      "layer": 6,
      "businessLabel": {
        "ja": "Meta",
        "en": "Meta"
      }
    },
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "CoreWeave",
        "en": "CoreWeave"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Oracle",
        "en": "Oracle"
      }
    },
    "SK hynix": {
      "layer": 2,
      "businessLabel": {
        "ja": "SK hynix",
        "en": "SK hynix"
      }
    },
    "Samsung": {
      "layer": 2,
      "businessLabel": {
        "ja": "Samsung",
        "en": "Samsung"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Dell",
        "en": "Dell"
      }
    },
    "SMCI": {
      "layer": 5,
      "businessLabel": {
        "ja": "Supermicro",
        "en": "Supermicro"
      }
    },
    "NCNO": {
      "layer": 7,
      "businessLabel": {
        "ja": "nCino",
        "en": "nCino"
      }
    },
    "QTWO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Q2 Holdings",
        "en": "Q2 Holdings"
      }
    },
    "ALKT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Alkami Technology",
        "en": "Alkami Technology"
      }
    },
    "FISV": {
      "layer": 7,
      "businessLabel": {
        "ja": "Fiserv",
        "en": "Fiserv"
      }
    },
    "Galileo Financial Technologies": {
      "layer": 7,
      "businessLabel": {
        "ja": "Galileo Financial Technologies",
        "en": "Galileo Financial Technologies"
      }
    },
    "SOFI": {
      "layer": 7,
      "businessLabel": {
        "ja": "SoFi｜SoFi Tech Solutions（旧Galileo）",
        "en": "SoFi Tech Solutions, formerly Galileo"
      }
    }
  },
  "TENB": {
    "LITE": {
      "layer": 4,
      "businessLabel": {
        "ja": "Lumentum",
        "en": "Lumentum"
      }
    },
    "COHR": {
      "layer": 4,
      "businessLabel": {
        "ja": "Coherent",
        "en": "Coherent"
      }
    },
    "VRT": {
      "layer": 5,
      "businessLabel": {
        "ja": "Vertiv",
        "en": "Vertiv"
      }
    },
    "MSFT": {
      "layer": 7,
      "businessLabel": {
        "ja": "Microsoft｜Microsoft Defender Vulnerability Management",
        "en": "Microsoft Defender Vulnerability Management"
      }
    },
    "NBIS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Nebius",
        "en": "Nebius"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC",
        "en": "TSMC"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA",
        "en": "NVIDIA"
      }
    },
    "MU": {
      "layer": 2,
      "businessLabel": {
        "ja": "Micron",
        "en": "Micron"
      }
    },
    "GOOG": {
      "layer": 7,
      "businessLabel": {
        "ja": "Google｜Google傘下Wiz",
        "en": "Google Wiz"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon",
        "en": "Amazon"
      }
    },
    "META": {
      "layer": 6,
      "businessLabel": {
        "ja": "Meta",
        "en": "Meta"
      }
    },
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "CoreWeave",
        "en": "CoreWeave"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Oracle",
        "en": "Oracle"
      }
    },
    "SK hynix": {
      "layer": 2,
      "businessLabel": {
        "ja": "SK hynix",
        "en": "SK hynix"
      }
    },
    "Samsung": {
      "layer": 2,
      "businessLabel": {
        "ja": "Samsung",
        "en": "Samsung"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Dell",
        "en": "Dell"
      }
    },
    "SMCI": {
      "layer": 5,
      "businessLabel": {
        "ja": "Supermicro",
        "en": "Supermicro"
      }
    },
    "PANW": {
      "layer": 7,
      "businessLabel": {
        "ja": "Palo Alto Networks",
        "en": "Palo Alto Networks"
      }
    },
    "CRWD": {
      "layer": 7,
      "businessLabel": {
        "ja": "CrowdStrike",
        "en": "CrowdStrike"
      }
    },
    "TENB": {
      "layer": 7,
      "businessLabel": {
        "ja": "Tenable",
        "en": "Tenable"
      }
    },
    "RPD": {
      "layer": 7,
      "businessLabel": {
        "ja": "Rapid7",
        "en": "Rapid7"
      }
    },
    "QLYS": {
      "layer": 7,
      "businessLabel": {
        "ja": "Qualys",
        "en": "Qualys"
      }
    }
  },
  "TTWO": {
    "LITE": {
      "layer": 4,
      "businessLabel": {
        "ja": "Lumentum",
        "en": "Lumentum"
      }
    },
    "COHR": {
      "layer": 4,
      "businessLabel": {
        "ja": "Coherent",
        "en": "Coherent"
      }
    },
    "VRT": {
      "layer": 5,
      "businessLabel": {
        "ja": "Vertiv",
        "en": "Vertiv"
      }
    },
    "MSFT": {
      "layer": 6,
      "businessLabel": {
        "ja": "Microsoft",
        "en": "Microsoft"
      }
    },
    "NBIS": {
      "layer": 6,
      "businessLabel": {
        "ja": "Nebius",
        "en": "Nebius"
      }
    },
    "TSM": {
      "layer": 1,
      "businessLabel": {
        "ja": "TSMC",
        "en": "TSMC"
      }
    },
    "NVDA": {
      "layer": 3,
      "businessLabel": {
        "ja": "NVIDIA",
        "en": "NVIDIA"
      }
    },
    "MU": {
      "layer": 2,
      "businessLabel": {
        "ja": "Micron",
        "en": "Micron"
      }
    },
    "GOOG": {
      "layer": 6,
      "businessLabel": {
        "ja": "Google",
        "en": "Google"
      }
    },
    "AMZN": {
      "layer": 6,
      "businessLabel": {
        "ja": "Amazon",
        "en": "Amazon"
      }
    },
    "META": {
      "layer": 6,
      "businessLabel": {
        "ja": "Meta",
        "en": "Meta"
      }
    },
    "CRWV": {
      "layer": 6,
      "businessLabel": {
        "ja": "CoreWeave",
        "en": "CoreWeave"
      }
    },
    "ORCL": {
      "layer": 6,
      "businessLabel": {
        "ja": "Oracle",
        "en": "Oracle"
      }
    },
    "SK hynix": {
      "layer": 2,
      "businessLabel": {
        "ja": "SK hynix",
        "en": "SK hynix"
      }
    },
    "Samsung": {
      "layer": 2,
      "businessLabel": {
        "ja": "Samsung",
        "en": "Samsung"
      }
    },
    "DELL": {
      "layer": 5,
      "businessLabel": {
        "ja": "Dell",
        "en": "Dell"
      }
    },
    "SMCI": {
      "layer": 5,
      "businessLabel": {
        "ja": "Supermicro",
        "en": "Supermicro"
      }
    },
    "AAPL": {
      "layer": 7,
      "businessLabel": {
        "ja": "Apple",
        "en": "Apple"
      }
    },
    "RBLX": {
      "layer": 7,
      "businessLabel": {
        "ja": "Roblox",
        "en": "Roblox"
      }
    },
    "SONY": {
      "layer": 7,
      "businessLabel": {
        "ja": "Sony Group",
        "en": "Sony Group"
      }
    },
    "TTWO": {
      "layer": 7,
      "businessLabel": {
        "ja": "Take-Two Interactive",
        "en": "Take-Two Interactive"
      }
    },
    "Nintendo": {
      "layer": 7,
      "businessLabel": {
        "ja": "Nintendo｜Nintendo",
        "en": "Nintendo"
      }
    },
    "Tencent": {
      "layer": 7,
      "businessLabel": {
        "ja": "Tencent｜Tencent",
        "en": "Tencent"
      }
    }
  },
  "TSM": {
    "UMC": {
      "layer": 1,
      "businessLabel": {
        "ja": "UMC｜成熟プロセス受託製造",
        "en": "UMC | mature-node foundry"
      }
    }
  },
  "JD": {
    "SF Holding": {
      "layer": 7,
      "businessLabel": {
        "ja": "SF Holding｜中国の契約倉庫・配送",
        "en": "SF Holding | China contract logistics"
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
  if (["PINS", "SNAP", "AMAT", "MRVL", "VRT", "ALAB", "ON", "AAPL", "AMZN", "GOOG", "META", "MSFT", "ADBE", "CRM", "BOX", "WDAY", "DELL", "HPE", "ADSK", "TXN", "ADI", "DDOG", "ZS", "TSLA", "IBM", "APH", "CRWD", "NET", "ORCL", "NOW", "SNOW", "INTU", "SAP", "ADP", "PAYX", "NTNX", "ADSK", "PTC", "BSY", "VEEV", "MANH", "HUBS", "TEAM", "DT", "OTEX", "COST", "PEGA", "NICE", "DBX", "FIVN", "RNG", "MNDY", "FRSH", "KVYO", "BRZE", "SPT", "CSCO", "ETN", "PLTR", "WDC", "STX", "CDNS", "KEYS", "FLEX", "FTNT", "EGHT", "CIEN", "ICHR", "UCTT", "FORM", "AMKR", "JBL", "COHU", "SANM", "ARW", "AVT", "PLAB", "ONTO", "TER", "ENTG", "CAMT", "ACLS", "ASX", "GFS", "TSEM", "GLW", "TEL", "UMC", "STM", "HIMX", "CRUS", "SYNA", "AMBA", "INDI", "PI", "LSCC", "MXL", "VIAV", "UBER", "NFLX", "SHOP", "APP", "ABNB", "SPOT", "ROKU", "TTD", "DASH", "MELI", "PYPL", "XYZ", "AKAM", "OKTA", "S", "CHKP", "TWLO", "DOCU", "SOFI", "DUOL", "APPF", "QLYS", "WMT", "PAYC", "MTSI", "POWI", "SITM", "RMBS", "DIOD", "SLAB", "CEVA", "NVTS", "IPGP", "IONQ", "RGTI", "QBTS", "QUBT", "ASTS", "PL", "BKSY", "AVAV", "KTOS", "RDW", "MPWR", "SWKS", "KVYO", "BHE"].includes(root)) {
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
