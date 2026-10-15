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
