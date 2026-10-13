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
