export const companyIntroductionFields = ["business", "revenue", "strength", "competition", "relationships", "risks"] as const;
export type CompanyIntroductionField = typeof companyIntroductionFields[number];
export type CompanyIntroduction = {
  cik: number;
  tickers: string[];
  name: string;
  reviewedOn: string;
  sources: { label: string; url: string }[];
  ja: Record<CompanyIntroductionField, string>;
  en: Record<CompanyIntroductionField, string>;
};

// Editorial records, independent of the monitored-stock list. Keep this registry
// on the server: the profile response includes only the selected issuer.
export const companyIntroductions: CompanyIntroduction[] = [
  {
    cik: 789019, tickers: ["MSFT"], name: "Microsoft", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2026 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm" }],
    ja: {
      business: "WindowsやMicrosoft 365、企業向けクラウドAzureなどを提供する会社。AIサービスやゲームも展開する。",
      revenue: "業務ソフトの契約料やAzureの利用料、Windowsのライセンス、ゲームなどの販売。",
      strength: "企業が日常的に使う業務ソフトとクラウドを組み合わせ、既存の仕事にAIを取り入れやすい。",
      competition: "クラウドや業務ソフト、AIの各事業者。無料で使えるソフトや公開されたAIモデルとも競う。",
      relationships: "パソコンメーカー、ソフト開発者、企業のシステム導入を支援する販売・技術パートナーとつながる。",
      risks: "データセンターへの巨額投資、AIサービスの価格競争、サイバー攻撃や情報流出。",
    },
    en: {
      business: "Provides Windows, Microsoft 365 and Azure cloud services, alongside AI and gaming products.",
      revenue: "Business-software subscriptions, Azure usage fees, Windows licenses and gaming sales.",
      strength: "Combines widely used workplace software and cloud services to bring AI into existing workflows.",
      competition: "Cloud, business-software and AI providers, including free software and open AI models.",
      relationships: "Works with PC makers, software developers, resellers and enterprise technology partners.",
      risks: "Heavy data-center investment, AI pricing pressure, cyberattacks and data breaches.",
    },
  },
  {
    cik: 1513845, tickers: ["NBIS"], name: "Nebius", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Form 20-F · Business / Risk factors / Customer agreements", url: "https://www.sec.gov/Archives/edgar/data/1513845/000110465926052948/nbis-20251231x20f.htm" }],
    ja: {
      business: "AIの学習や実行に必要な計算設備を、クラウド経由で企業や開発者に提供する会社。",
      revenue: "GPUなどの計算設備、データ保存、関連サービスの利用料。専用設備を長期契約で提供する事業もある。",
      strength: "AI向けに設計した設備と自社開発ソフトを組み合わせ、計算環境の構築から運用まで支える。",
      competition: "CoreWeave、Crusoe、LambdaなどのAIクラウド。AWSやGoogle Cloudなどの大手とも競う。",
      relationships: "NVIDIAのGPUを採用し、技術面でも協力。MicrosoftやMetaには契約に基づき計算設備を提供する。",
      risks: "設備拡張に多額の資金と電力が必要。建設・供給の遅れや大口契約の履行が業績を左右する。",
    },
    en: {
      business: "Provides cloud computing infrastructure for AI training and inference.",
      revenue: "Charges for GPU capacity, storage and related services, including long-term dedicated-capacity contracts.",
      strength: "Combines AI-focused infrastructure with in-house software to support deployment and operations.",
      competition: "CoreWeave, Crusoe, Lambda and major clouds such as AWS and Google Cloud.",
      relationships: "Uses NVIDIA GPUs and collaborates with NVIDIA; supplies contracted capacity to Microsoft and Meta.",
      risks: "Large funding and power needs, construction or supply delays, and execution of major customer contracts.",
    },
  },
  {
    cik: 1046179, tickers: ["TSM"], name: "TSMC", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Form 20-F · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm" }, { label: "NVIDIA FY2026 Form 10-K · Manufacturing", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm" }],
    ja: {
      business: "顧客が設計した半導体を工場で製造する会社。自社ブランドの半導体で顧客と競わない受託生産が基本。",
      revenue: "半導体の製造代金が中心。複数のチップを組み合わせる先端パッケージングなども手がける。",
      strength: "微細な回路を大量生産する技術と生産規模。設計会社が製品を量産するための仕組みも整える。",
      competition: "ほかの半導体受託生産会社や、外部顧客向けにも製造する半導体メーカー。",
      relationships: "NVIDIAなどの設計会社から製造を受託。製造装置、材料、設計ソフトの企業とも連携する。",
      risks: "台湾への生産集中、地震や電力・水の供給障害、大口顧客の需要変動と設備投資の負担。",
    },
    en: {
      business: "Manufactures chips designed by customers rather than competing with them through its own chip brand.",
      revenue: "Primarily wafer fabrication, plus advanced packaging and related services.",
      strength: "Leading-edge manufacturing expertise, production scale and support for customers moving designs into volume production.",
      competition: "Other foundries and integrated chipmakers offering manufacturing to external customers.",
      relationships: "Manufactures for designers including NVIDIA and works with equipment, materials and design-software providers.",
      risks: "Taiwan concentration, earthquakes, utility disruptions, major-customer demand changes and high capital spending.",
    },
  },
  {
    cik: 937966, tickers: ["ASML"], name: "ASML", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Annual Report · Products / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/937966/000162828026011378/asml-20251231.htm" }],
    ja: {
      business: "半導体に微細な回路の模様を光で転写する「露光装置」を作る会社。検査・計測装置も扱う。",
      revenue: "半導体工場への装置販売と、稼働中の装置の保守や性能向上サービス。",
      strength: "非常に短い波長の光を使うEUV露光を実用化し、先端半導体の製造を支える。",
      competition: "従来型のDUV露光装置ではNikonやCanon。計測・検査などでは別の装置メーカーとも競う。",
      relationships: "半導体メーカーに装置を供給。Carl Zeiss SMTが重要なレンズやミラーなどの光学部品を担う。",
      risks: "輸出規制、少数の大口顧客の設備投資、重要部品の供給制約や新型装置の開発遅延。",
    },
    en: {
      business: "Builds lithography machines that transfer tiny circuit patterns onto chips, plus metrology and inspection tools.",
      revenue: "Equipment sales, maintenance and upgrades for installed systems.",
      strength: "Commercial EUV lithography uses extremely short-wavelength light to support advanced chip manufacturing.",
      competition: "Nikon and Canon in DUV lithography; other equipment suppliers in measurement and inspection.",
      relationships: "Supplies chipmakers; Carl Zeiss SMT provides critical optical components such as lenses and mirrors.",
      risks: "Export controls, concentrated customer spending, critical-part shortages and development delays.",
    },
  },
  {
    cik: 1730168, tickers: ["AVGO"], name: "Broadcom", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1730168/000173016825000121/avgo-20251102.htm" }],
    ja: {
      business: "通信やAI向けの半導体と、VMwareなど企業のシステムを動かす基盤ソフトを提供する会社。",
      revenue: "半導体の販売と、企業向けソフトのライセンス・契約料や保守サービス。",
      strength: "高速通信の技術と、顧客の用途に合わせた専用AI半導体の設計。基盤ソフトにも事業を持つ。",
      competition: "通信・AI半導体各社や顧客の内製チップ。ソフトではクラウドや企業向けソフトの事業者。",
      relationships: "クラウド事業者などと専用半導体を開発し、製造の多くをTSMCなどに委託する。",
      risks: "大口顧客や製造委託先への依存、専用チップの計画変更、ソフト契約の更新・移行に伴う顧客離れ。",
    },
    en: {
      business: "Supplies networking and AI chips alongside infrastructure software, including VMware.",
      revenue: "Chip sales, software licenses and subscriptions, and support services.",
      strength: "High-speed networking and custom AI-chip design, alongside an established infrastructure-software business.",
      competition: "Chip suppliers, customers' in-house designs, cloud providers and enterprise-software vendors.",
      relationships: "Develops custom silicon with cloud and other customers; outsources much of manufacturing to TSMC and others.",
      risks: "Customer and supplier concentration, custom-project changes and customer losses during software renewals or transitions.",
    },
  },
  {
    cik: 2488, tickers: ["AMD"], name: "AMD", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/amd-20251227.htm" }],
    ja: {
      business: "パソコンやサーバーのCPU、映像処理やAIの計算を担うGPUなどを設計する会社。",
      revenue: "EPYCやRyzenなどのCPU、AI・ゲーム向けGPU、機器に組み込む半導体の販売。",
      strength: "CPUとGPUを幅広く持ち、用途に応じて組み合わせられる。AI向けの開発ソフトも整備する。",
      competition: "CPUではIntel、GPUではNVIDIAなど。顧客が独自開発する半導体とも競う。",
      relationships: "TSMCなどに製造を委託し、クラウド事業者やパソコン・サーバーメーカーへ供給する。",
      risks: "競合との性能・ソフト面の競争、製造委託先の供給制約、輸出規制やパソコン需要の変動。",
    },
    en: {
      business: "Designs CPUs for PCs and servers, GPUs for graphics and AI, and other computing chips.",
      revenue: "Sales of EPYC and Ryzen CPUs, AI and gaming GPUs, and embedded chips.",
      strength: "Combines a broad CPU and GPU portfolio with supporting AI software.",
      competition: "Intel in CPUs, NVIDIA in GPUs, and customers developing their own chips.",
      relationships: "Uses manufacturers including TSMC and supplies cloud providers, PC makers and server vendors.",
      risks: "Performance and software competition, manufacturing constraints, export controls and PC-demand swings.",
    },
  },
  {
    cik: 1973239, tickers: ["ARM"], name: "Arm", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2026 Form 20-F · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm" }, { label: "June 2026 quarterly report · Arm-designed silicon", url: "https://www.sec.gov/Archives/edgar/data/1973239/000197323926000114/arm-20260630.htm" }],
    ja: {
      business: "半導体の計算の仕組みやCPU設計を他社に提供する会社。自社設計のチップ製品にも事業を広げている。",
      revenue: "設計技術のライセンス料と、その技術を使ったチップの出荷に応じて受け取る利用料。",
      strength: "省電力の設計と、対応するソフト・開発者の広い基盤。スマホからサーバーへ用途を広げる。",
      competition: "IntelやAMDが使うx86方式、公開規格のRISC-V、顧客が独自に開発する技術。",
      relationships: "半導体メーカーや機器メーカーが技術を採用。設計ソフトや製造の企業とも連携し、SoftBankが支配株主。",
      risks: "大口顧客やスマホ需要への依存、利用料・契約をめぐる争い、自社チップ展開による顧客との競合。",
    },
    en: {
      business: "Licenses processor architecture and CPU designs, and is expanding into Arm-designed chip products.",
      revenue: "Technology-license fees and royalties tied to shipments of chips using its designs.",
      strength: "Power-efficient designs supported by a broad software and developer ecosystem, extending from phones to servers.",
      competition: "The x86 architecture used by Intel and AMD, open RISC-V and proprietary customer technologies.",
      relationships: "Works with chipmakers, device makers and design or manufacturing partners; SoftBank is the controlling shareholder.",
      risks: "Customer and smartphone exposure, licensing disputes and competing with customers through its own chips.",
    },
  },
  {
    cik: 1807794, tickers: ["CRDO"], name: "Credo", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2026 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1807794/000162828026043303/crdo-20260502.htm" }],
    ja: {
      business: "データセンターの機器同士を高速につなぐ半導体や、信号を整える回路入りケーブルを開発する会社。",
      revenue: "接続用の半導体・ケーブルなどの販売と、高速通信の設計技術を使うためのライセンス料。",
      strength: "大量のデータを低い消費電力で安定して送る技術。機器間の接続不良を減らす仕組みも提供する。",
      competition: "Broadcom、Marvell、Astera Labsのほか、ケーブルや光通信部品のメーカー。",
      relationships: "クラウド事業者や機器メーカーへ供給。Oracleとは光接続の安定性を高める製品を共同開発した。",
      risks: "少数の大口顧客への売上集中、採用計画の変更、製造委託先への依存や接続方式の変化。",
    },
    en: {
      business: "Develops chips and cables with signal-conditioning electronics that connect data-center systems at high speed.",
      revenue: "Connectivity-product sales and licenses for high-speed signaling technology.",
      strength: "Combines energy-efficient data transfer with tools that improve connection reliability.",
      competition: "Broadcom, Marvell, Astera Labs, and cable or optical-component suppliers.",
      relationships: "Supplies cloud and equipment companies; developed optical-reliability products with Oracle.",
      risks: "Concentrated customers, changing adoption plans, outsourced manufacturing and shifts in connectivity technology.",
    },
  },
  {
    cik: 1045810, tickers: ["NVDA"], name: "NVIDIA", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2026 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm" }],
    ja: {
      business: "AIの計算やゲームの映像処理を担うGPUと、関連ソフトを開発する会社。",
      revenue: "データセンター向けの半導体・通信機器と、ゲーム向けGPUなどの販売。",
      strength: "GPUと開発基盤CUDAを組み合わせ、機器からソフトまで一体で提供できる。",
      competition: "AMDやIntelに加え、独自のAI半導体を開発するGoogleやAmazonなど。",
      relationships: "製造はTSMCなどに委託。メモリーはSK hynix、Micron、Samsungから調達する。",
      risks: "輸出規制や製造委託先の供給制約、大手顧客による独自半導体への切り替え。",
    },
    en: {
      business: "Develops GPUs for AI computing and gaming, alongside supporting software.",
      revenue: "Sells data-center chips, networking equipment and gaming GPUs.",
      strength: "Combines GPUs with CUDA development tools and integrated systems.",
      competition: "AMD, Intel and custom AI chips developed by Google, Amazon and others.",
      relationships: "TSMC and others manufacture its chips; SK hynix, Micron and Samsung supply memory.",
      risks: "Export restrictions, constrained manufacturing capacity and customers adopting their own chips.",
    },
  },
  {
    cik: 723125, tickers: ["MU"], name: "Micron", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2026 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/723125/000072312526000023/mu-20260903.htm" }, { label: "NVIDIA FY2026 Form 10-K · Manufacturing", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm" }],
    ja: {
      business: "データを一時的に扱うDRAMや、保存するNANDなどのメモリー半導体を作る会社。",
      revenue: "データセンター、スマホ、パソコンなどのメーカーにメモリーや記憶装置を販売する。",
      strength: "設計から製造まで手がけ、AI向けの高速メモリーHBMも展開する。",
      competition: "Samsung、SK hynix。データ保存用のNANDではKioxiaやSandiskなど。",
      relationships: "NVIDIAのメモリー調達先の一社。クラウド事業者や機器メーカーともつながる。",
      risks: "メモリー価格の上下が業績に響きやすい。供給過剰や巨額の設備投資も負担になる。",
    },
    en: {
      business: "Makes DRAM for working memory and NAND for data storage.",
      revenue: "Sells memory and storage products for data centers, phones, PCs and other devices.",
      strength: "Designs and manufactures memory, including high-bandwidth memory (HBM) for AI.",
      competition: "Samsung and SK hynix; Kioxia and Sandisk also compete in NAND.",
      relationships: "Supplies memory to NVIDIA and serves cloud and device manufacturers.",
      risks: "Memory-price cycles, oversupply and heavy factory investment can pressure earnings.",
    },
  },
  {
    cik: 1652044, tickers: ["GOOG", "GOOGL"], name: "Google", reviewedOn: "2026-10-13",
    sources: [{ label: "Alphabet FY2025 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm" }],
    ja: {
      business: "Alphabet傘下で、検索、YouTube、Android、クラウドなどを展開する。上場株は親会社Alphabetの株式。",
      revenue: "検索やYouTubeの広告が中心。クラウド利用料や有料会員サービスも収益源。",
      strength: "検索・動画・スマホを通じて利用者に届き、広告主や開発者を集められる。",
      competition: "検索やAIのサービス、SNS広告、企業向けクラウドの各事業者。",
      relationships: "YouTubeの制作者や広告主、Android端末メーカーなどと事業を広げる。",
      risks: "AIによる検索習慣の変化、広告への依存、競争法や個人情報をめぐる規制。",
    },
    en: {
      business: "Alphabet's Google operates Search, YouTube, Android and cloud services. The listed shares represent parent Alphabet.",
      revenue: "Primarily advertising, plus cloud usage fees and subscriptions.",
      strength: "Search, video and mobile reach connect users with advertisers and developers.",
      competition: "Search and AI services, social advertising platforms and enterprise cloud providers.",
      relationships: "Works with YouTube creators, advertisers and Android device manufacturers.",
      risks: "AI-driven changes in search habits, advertising dependence and competition or privacy regulation.",
    },
  },
  {
    cik: 320193, tickers: ["AAPL"], name: "Apple", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm" }],
    ja: {
      business: "iPhoneやMacなどの端末と、それらを動かすソフト・サービスを作る会社。",
      revenue: "iPhoneなどの製品販売と、App Store、クラウド、音楽・動画などのサービス。",
      strength: "端末・基本ソフト・サービスを一体で設計し、製品同士を使いやすく連携させる。",
      competition: "スマホ、パソコン、ウェアラブル端末やデジタルサービスの各メーカー・事業者。",
      relationships: "部品・組立の委託先、携帯通信会社、アプリ開発者やコンテンツ提供者とつながる。",
      risks: "iPhoneの需要変動、海外の製造網への依存、アプリ配信などをめぐる規制。",
    },
    en: {
      business: "Creates iPhone, Mac and other devices, with their software and services.",
      revenue: "Device sales and services including the App Store, cloud storage, music and video.",
      strength: "Integrates hardware, operating systems and services across its products.",
      competition: "Phone, PC and wearable manufacturers, plus digital-service providers.",
      relationships: "Relies on manufacturing partners, mobile carriers, app developers and content providers.",
      risks: "iPhone demand shifts, overseas manufacturing dependence and regulation of its platforms.",
    },
  },
  {
    cik: 1018724, tickers: ["AMZN"], name: "Amazon", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/amzn-20251231.htm" }],
    ja: {
      business: "ネット通販に加え、企業向けクラウドAWSや広告、動画配信などを展開する会社。",
      revenue: "商品販売、出品者の手数料、AWS利用料、広告、Primeなどの会費。",
      strength: "品揃えと配送網を組み合わせた通販と、幅広い機能を持つAWS。",
      competition: "小売店・通販各社、クラウド事業者、広告や動画配信のサービス。",
      relationships: "出品者、配送の協力会社、AWSを使う企業や開発者、広告主をつなぐ。",
      risks: "激しい価格競争、物流・人件費の上昇、データセンター投資の負担。",
    },
    en: {
      business: "Runs online retail, AWS cloud computing, advertising and streaming services.",
      revenue: "Product sales, seller fees, AWS usage, advertising and subscriptions such as Prime.",
      strength: "Combines retail selection and delivery infrastructure with a broad AWS service range.",
      competition: "Retailers, cloud providers, advertising platforms and streaming services.",
      relationships: "Connects sellers, delivery partners, cloud customers, developers and advertisers.",
      risks: "Price competition, logistics and labor costs, and heavy data-center investment.",
    },
  },
  {
    cik: 1326801, tickers: ["META"], name: "Meta", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2025 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/meta-20251231.htm" }],
    ja: {
      business: "Facebook、Instagram、WhatsAppなどを運営し、AIやスマートグラスも開発する会社。",
      revenue: "SNSなどに表示する広告が収益の中心。端末やソフトも販売する。",
      strength: "多くの利用者が集まるアプリと、投稿や広告を届けるAIの仕組み。",
      competition: "利用者の時間や広告予算を取り合うSNS、動画、検索などのサービス。",
      relationships: "広告主や投稿するクリエイターに加え、スマホの基本ソフト・アプリ配信基盤とも関わる。",
      risks: "広告への依存、個人情報の規制やスマホ側の仕様変更、AI・次世代端末への投資負担。",
    },
    en: {
      business: "Operates Facebook, Instagram and WhatsApp, and develops AI and smart glasses.",
      revenue: "Primarily advertising on its apps, with additional hardware and software sales.",
      strength: "Large app audiences and AI systems for content discovery and advertising.",
      competition: "Social, video and search services competing for attention and advertising budgets.",
      relationships: "Works with advertisers and creators while depending on mobile operating systems and app distribution.",
      risks: "Advertising dependence, privacy rules, mobile-platform changes and expensive AI and hardware investments.",
    },
  },
  {
    cik: 909832, tickers: ["COST"], name: "Costco", reviewedOn: "2026-10-13",
    sources: [{ label: "FY2026 Form 10-K · Business / Risk factors", url: "https://www.sec.gov/Archives/edgar/data/909832/000090983226000093/cost-20260830.htm" }],
    ja: {
      business: "会員制の大型倉庫店と通販で、食品や日用品などを販売する会社。",
      revenue: "商品の販売代金と会員の年会費。ガソリンや薬局なども展開する。",
      strength: "品数を絞った大量仕入れと効率的な物流で低価格を支える。自社ブランドはKirkland Signature。",
      competition: "会員制倉庫店、スーパー、ディスカウント店やネット通販。",
      relationships: "メーカーなどから直接仕入れ、物流拠点を通じて各店舗に商品を届ける。",
      risks: "薄い商品利益率のため仕入れ・人件費の上昇が響く。会員の継続や価格への信頼も重要。",
    },
    en: {
      business: "Runs membership warehouses and online stores selling groceries and everyday goods.",
      revenue: "Merchandise sales and membership fees, alongside services such as gasoline and pharmacies.",
      strength: "Limited selection, volume buying and efficient logistics support low prices; Kirkland Signature is its own brand.",
      competition: "Warehouse clubs, supermarkets, discount retailers and online stores.",
      relationships: "Buys directly from suppliers and distributes goods through its depot network.",
      risks: "Thin merchandise margins expose earnings to rising costs; membership retention and price trust matter.",
    },
  },
];

export function companyIntroductionFor(issuer: { cik: number; ticker: string }): CompanyIntroduction | null {
  const ticker = issuer.ticker.trim().toUpperCase();
  return companyIntroductions.find(item => item.cik === issuer.cik && item.tickers.includes(ticker)) ?? null;
}
