// Public biographies reviewed 2026-10-12; manager names and descriptions rewritten 2026-11-18 as short
// factual firm descriptions (founding, base, business) from public references. No opinions or performance claims.
export type CapitalProfile = {
  person: [string, string]; role: [string, string]; description: [string, string]; source: string;
  /** Firm name [ja, en]. Every fund manager has one; Japanese mode shows the katakana name with the English name as a sub-label. */
  name?: [string, string];
  /** Reference for the factual firm description when it differs from the person/role source. */
  descriptionSource?: string;
  leadership?: [string, string];
  checkedOn?: string;
  /** A Commons photo carries its license; a photo the owner supplied (owner, Nov 14) has no license line and is credited as such. */
  portrait?: { url: string; source: string; credit: string; license?: string; licenseUrl?: string; sourceLabel?: string };
};
export const capitalProfiles: Record<string, CapitalProfile> = {
  thiel: { name: ["ティール・マクロ", "Thiel Macro"], descriptionSource: "https://www.sec.gov/Archives/edgar/data/1810747/000182912625005082/simplifyexchange_485apos.htm", checkedOn: "2026-11-18",
    person: ["ピーター・ティール", "Peter Thiel"], role: ["起業家・投資家", "Entrepreneur & investor"],
    description: ["ピーター・ティールの個人資金を運用する投資会社。米ロサンゼルスを拠点とする。", "An investment firm that manages Peter Thiel’s personal capital. It is based in Los Angeles."],
    source: "https://en.wikipedia.org/wiki/Peter_Thiel",
    portrait: { url: "/capital-map/thiel.webp", source: "https://commons.wikimedia.org/wiki/File:Peter_Thiel_by_Gage_Skidmore.jpg", credit: "Gage Skidmore", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" },
  },
  soros: { name: ["ソロス・ファンド・マネジメント", "Soros Fund Management"], descriptionSource: "https://en.wikipedia.org/wiki/Soros_Fund_Management", checkedOn: "2026-11-18",
    person: ["ジョージ・ソロス", "George Soros"], role: ["創業者", "Founder"],
    description: ["1970年にジョージ・ソロスが設立した、ニューヨークの投資会社。2010年代初めからファミリーオフィスとして運営されている。", "A New York investment firm founded by George Soros in 1970. It has been structured as a family office since the early 2010s."],
    source: "https://sorosfundmgmt.com/about/",
    portrait: { url: "/capital-map/soros.webp", source: "https://commons.wikimedia.org/wiki/File:George_Soros_-_May_31,_2017.jpg", credit: "Aris Oikonomou - European Commission", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
  },
  ark: { name: ["アーク・インベストメント・マネジメント", "ARK Investment Management"], descriptionSource: "https://en.wikipedia.org/wiki/ARK_Invest", checkedOn: "2026-11-18",
    person: ["キャシー・ウッド", "Cathie Wood"], role: ["創業者", "Founder"],
    description: ["2014年にキャシー・ウッドが設立した、米フロリダ州セントピーターズバーグの資産運用会社。アクティブ運用のETFを中心に運用する。", "An investment manager in St. Petersburg, Florida, founded by Cathie Wood in 2014. It mainly manages actively managed ETFs."],
    source: "https://www.ark-invest.com/board-of-directors",
    portrait: { url: "/capital-map/ark.webp", source: "https://commons.wikimedia.org/wiki/File:Cathie_Wood_ARK_Invest_Photo.jpg", credit: "Caroline Wood", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  },
  jpmorgan: { name: ["JPモルガン・チェース", "JPMorgan Chase"], descriptionSource: "https://en.wikipedia.org/wiki/JPMorgan_Chase", checkedOn: "2026-11-18",
    person: ["ジェイミー・ダイモン", "Jamie Dimon"], role: ["会長・CEO", "Chairman & CEO"],
    description: ["ニューヨークに本社を置く米国の金融持株会社。投資銀行や商業銀行、資産運用などの事業を営む。", "A U.S. financial holding company headquartered in New York. Its businesses include investment banking, commercial banking and asset management."],
    source: "https://en.wikipedia.org/wiki/JPMorgan_Chase",
  },
  blackrock: { name: ["ブラックロック", "BlackRock"], descriptionSource: "https://en.wikipedia.org/wiki/BlackRock", checkedOn: "2026-11-18",
    person: ["ラリー・フィンク", "Larry Fink"], role: ["共同創業者・会長・CEO", "Co-Founder, Chairman & CEO"],
    description: ["1988年に設立された、ニューヨークに本社を置く資産運用会社。ETFシリーズ「iShares」を運用する。", "An asset manager headquartered in New York, founded in 1988. It manages the iShares family of ETFs."],
    source: "https://en.wikipedia.org/wiki/BlackRock",
  },

  nvidia: {
    person: ["ジェンスン・フアン", "Jensen Huang"], role: ["共同創業者・CEO", "Co-Founder & CEO"],
    description: ["GPUを軸にAIの計算基盤を支える。", "GPUs powering AI computing."],
    source: "https://nvidianews.nvidia.com/bios/jensen-huang",
    portrait: { url: "/capital-map/nvidia.webp", source: "https://commons.wikimedia.org/wiki/File:P20250430JB-0891_(cropped).jpg", credit: "Joyce N. Boghosian / The White House", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
  alphabet: {
    person: ["スンダー・ピチャイ", "Sundar Pichai"], role: ["CEO", "CEO"],
    description: ["Alphabet傘下で検索やYouTube、クラウドを展開。", "Part of Alphabet, offering search, YouTube and cloud services."],
    source: "https://blog.google/authors/sundar-pichai/",
    portrait: { url: "/capital-map/alphabet.webp", source: "https://commons.wikimedia.org/wiki/File:Mateusz_Morawiecki_spotka%C5%82_si%C4%99_z_CEO_Google_Sundar_Pichai_w_KPRM_(2022.03.29)_01_(cropped).jpg", credit: "Krystian Maj", license: "CC BY 3.0 PL", licenseUrl: "https://creativecommons.org/licenses/by/3.0/pl/" },
  },
  amazon: {
    person: ["アンディ・ジャシー", "Andy Jassy"], role: ["社長・CEO", "President & CEO"],
    description: ["通販とクラウドのAWSが主力。", "Online retail and AWS cloud computing."],
    source: "https://ir.aboutamazon.com/officers-and-directors/default.aspx",
    portrait: { url: "/capital-map/amazon.webp", source: "https://commons.wikimedia.org/wiki/File:Andy_Jassy.jpg", credit: "Lisi Mezistrano Wolf", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  },
  intel: {
    person: ["リップブー・タン", "Lip-Bu Tan"], role: ["CEO", "CEO"],
    description: ["CPUなどの半導体を設計・製造。", "Designing and manufacturing chips."],
    source: "https://newsroom.intel.com/corporate/my-commitment-to-you-and-our-company",
    portrait: { url: "/capital-map/intel.webp", source: "https://commons.wikimedia.org/wiki/File:Intel_CEO_Lip-Bu_Tan_(2025)_(cropped).jpg", credit: "United States Department of Commerce", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
  cisco: {
    person: ["チャック・ロビンス", "Chuck Robbins"], role: ["会長・CEO", "Chair & CEO"],
    description: ["ネットワーク機器とセキュリティを提供。", "Networking equipment and security."],
    source: "https://newsroom.cisco.com/c/r/newsroom/en/us/executives/robbins-chuck.html",
    portrait: { url: "/capital-map/cisco.webp", source: "https://commons.wikimedia.org/wiki/File:Charles_H._Robbins.jpg", credit: "U.S. Army Sgt. James K. McCann / Chairman of the Joint Chiefs of Staff", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/" },
  },
  berkshire: { name: ["バークシャー・ハサウェイ", "Berkshire Hathaway"], descriptionSource: "https://en.wikipedia.org/wiki/Berkshire_Hathaway",
    person: ["ウォーレン・バフェット", "Warren Buffett"], role: ["名誉会長", "Chairman Emeritus"],
    leadership: ["現CEO：グレッグ・アベル", "Current CEO: Greg Abel"],
    description: ["米ネブラスカ州オマハに本社を置く持株会社。保険や鉄道、エネルギーなどの事業を傘下に持ち、上場株式にも投資する。", "A holding company based in Omaha, Nebraska. Its subsidiaries include insurance, railroad and energy businesses, and it also invests in listed stocks."],
    source: "https://www.berkshirehathaway.com/news/sep1826.pdf",
    portrait: { url: "/capital-map/berkshire.webp", source: "https://commons.wikimedia.org/wiki/File:Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_(cropped).jpg", credit: "USA International Trade Administration", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
  pershing: { name: ["パーシング・スクエア", "Pershing Square"], descriptionSource: "https://en.wikipedia.org/wiki/Pershing_Square_Capital_Management", checkedOn: "2026-11-18",
    person: ["ビル・アックマン", "Bill Ackman"], role: ["創業者・CEO", "Founder & CEO"],
    description: ["2004年にビル・アックマンが設立した、ニューヨークの投資会社。株主として経営に働きかけるアクティビスト投資を専門とする。", "A New York investment firm founded by Bill Ackman in 2004. It specializes in activist investing, engaging with company management as a shareholder."],
    source: "https://pershingsquareinc.com/about-us/",
    portrait: { url: "/capital-map/pershing.webp", source: "https://commons.wikimedia.org/wiki/File:Bill_Ackman,_2016.jpg", credit: "Senate Democrats", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/" },
  },
  bridgewater: { name: ["ブリッジウォーター・アソシエイツ", "Bridgewater Associates"], descriptionSource: "https://en.wikipedia.org/wiki/Bridgewater_Associates", checkedOn: "2026-11-18", person: ["レイ・ダリオ", "Ray Dalio"], role: ["創業者", "Founder"], description: ["1975年にレイ・ダリオが設立した、米コネチカット州ウェストポートの資産運用会社。年金基金や各国政府、中央銀行などの機関投資家を顧客とする。", "An investment manager in Westport, Connecticut, founded by Ray Dalio in 1975. Its clients are institutions such as pension funds, governments and central banks."], source: "https://www.bridgewater.com/our-founder", portrait: { url: "/capital-map/bridgewater.webp", source: "https://commons.wikimedia.org/wiki/File:Ray_Dalio_Sept_23_2017_NYC.jpg", credit: "Grameen America", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/" } },
  appaloosa: { name: ["アパルーサ", "Appaloosa"], descriptionSource: "https://en.wikipedia.org/wiki/Appaloosa_Management", checkedOn: "2026-11-18", person: ["デビッド・テッパー", "David Tepper"], role: ["創業者", "Founder"], description: ["1993年にデビッド・テッパーらが設立した米国の投資会社。ヘッジファンドとして始まった。", "A U.S. investment firm founded in 1993 by David Tepper and Jack Walton. It began as a hedge fund."], source: "https://tepperfoundation.org/about/our-founder/", portrait: { url: "/capital-map/appaloosa.webp", source: "https://commons.wikimedia.org/wiki/File:David_Tepper_01.jpg", credit: "Appaloosa Management", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" } },
  coatue: { name: ["コーチュー・マネジメント", "Coatue Management"], descriptionSource: "https://en.wikipedia.org/wiki/Coatue_Management", checkedOn: "2026-11-18", person: ["フィリップ・ラフォン", "Philippe Laffont"], role: ["創業者・ポートフォリオマネジャー", "Founder & Portfolio Manager"], description: ["1999年にフィリップ・ラフォンが設立した、ニューヨークの投資会社。テクノロジー分野を中心に、上場・未上場の企業に投資する。", "A New York investment firm founded by Philippe Laffont in 1999. It invests in public and private companies, with a focus on technology."], source: "https://www.coatue.com/ctek/why-ctek", portrait: { url: "/capital-map/coatue.webp", source: "https://www.coatue.com/ctek/why-ctek", credit: "運営者提供", sourceLabel: "Coatue" } },
  tiger: { name: ["タイガー・グローバル・マネジメント", "Tiger Global Management"], descriptionSource: "https://en.wikipedia.org/wiki/Tiger_Global_Management", checkedOn: "2026-11-18", person: ["チェイス・コールマン", "Chase Coleman"], role: ["創業者", "Founder"], description: ["2001年にチェイス・コールマンが設立した、ニューヨークの投資会社。インターネットやソフトウェア、消費関連、フィンテックの企業を中心に投資する。", "A New York investment firm founded by Chase Coleman in 2001. It mainly invests in internet, software, consumer and financial technology companies."], source: "https://www.tigerglobal.com/chase-coleman", portrait: { url: "/capital-map/tiger.webp", source: "https://www.tigerglobal.com/chase-coleman", credit: "運営者提供", sourceLabel: "Tiger Global" } },
  viking: { name: ["バイキング・グローバル・インベスターズ", "Viking Global Investors"], descriptionSource: "https://en.wikipedia.org/wiki/Viking_Global_Investors", checkedOn: "2026-11-18", person: ["アンドレアス・ハルヴォルセン", "Andreas Halvorsen"], role: ["共同創業者・CEO", "Co-Founder & CEO"], description: ["1999年にアンドレアス・ハルヴォルセンらが設立した、米コネチカット州スタンフォードの投資会社。上場株式とプライベート・エクイティに投資する。", "An investment firm in Stamford, Connecticut, co-founded by Andreas Halvorsen in 1999. It invests in listed equities and private equity."], source: "https://vikingglobal.com/our-team/" },
  fundsmith: { name: ["ファンドスミス", "Fundsmith"], descriptionSource: "https://en.wikipedia.org/wiki/Fundsmith", checkedOn: "2026-11-18", person: ["テリー・スミス", "Terry Smith"], role: ["創業者", "Founder"], description: ["2010年にテリー・スミスが設立した、ロンドンの資産運用会社。株式ファンドなどを運用する。", "A London investment manager founded by Terry Smith in 2010. It manages equity funds and investment trusts."], source: "https://www.fundsmith.co.uk/sef/about-us/", portrait: { url: "/capital-map/fundsmith.webp", source: "https://commons.wikimedia.org/wiki/File:Terry_Smith_MNZM_investiture.jpg", credit: "New Zealand Government, Office of the Governor-General", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" } },

  // Added 2026-11-18 with their SEC 13F-HR reports; roles checked against each company's reference page.
  amd: { person: ["リサ・スー", "Lisa Su"], role: ["会長・CEO", "Chair & CEO"], description: ["CPUやGPUなどの半導体を設計。", "Designs CPUs, GPUs and other chips."], source: "https://en.wikipedia.org/wiki/AMD", checkedOn: "2026-11-18" },
  uber: { person: ["ダラ・コスロシャヒ", "Dara Khosrowshahi"], role: ["CEO", "CEO"], description: ["配車や宅配、貨物輸送のサービスを展開。", "Ride-hailing, delivery and freight services."], source: "https://en.wikipedia.org/wiki/Uber", checkedOn: "2026-11-18" },
  walmart: { person: ["ジョン・ファーナー", "John Furner"], role: ["社長・CEO", "President & CEO"], description: ["米国を中心にスーパーなどの小売店を展開。", "Retail stores, mainly in the U.S."], source: "https://en.wikipedia.org/wiki/Walmart", checkedOn: "2026-11-18" },
  jnj: { person: ["ホアキン・デュアト", "Joaquin Duato"], role: ["会長・CEO", "Chairman & CEO"], description: ["医薬品と医療機器を手がける。", "Medicines and medical technology."], source: "https://en.wikipedia.org/wiki/Johnson_%26_Johnson", checkedOn: "2026-11-18" },
  pfizer: { person: ["アルバート・ブーラ", "Albert Bourla"], role: ["会長・CEO", "Chairman & CEO"], description: ["医薬品やワクチンを開発・販売。", "Develops medicines and vaccines."], source: "https://en.wikipedia.org/wiki/Pfizer", checkedOn: "2026-11-18" },
  merck: { person: ["ロバート・デービス", "Robert M. Davis"], role: ["会長・社長・CEO", "Chairman, President & CEO"], description: ["医薬品やワクチン、動物用医薬品を展開。", "Medicines, vaccines and animal health products."], source: "https://en.wikipedia.org/wiki/Merck_%26_Co.", checkedOn: "2026-11-18" },
  regeneron: { person: ["レナード・シュライファー", "Leonard Schleifer"], role: ["共同創業者・CEO", "Co-Founder & CEO"], description: ["バイオ医薬品を開発。", "Develops biotech medicines."], source: "https://en.wikipedia.org/wiki/Regeneron_Pharmaceuticals", checkedOn: "2026-11-18" },
  gilead: { person: ["ダニエル・オデイ", "Daniel O’Day"], role: ["会長・CEO", "Chairman & CEO"], description: ["HIVや肝炎などの抗ウイルス薬を開発。", "Develops antiviral drugs, including for HIV and hepatitis."], source: "https://en.wikipedia.org/wiki/Gilead_Sciences", checkedOn: "2026-11-18" },
  ge: { person: ["ラリー・カルプ", "Larry Culp"], role: ["会長・CEO", "Chairman & CEO"], description: ["航空機エンジンを製造。", "Makes aircraft engines."], source: "https://en.wikipedia.org/wiki/GE_Aerospace", checkedOn: "2026-11-18" },
};

/** The portfolio name to show: the Japanese firm name in Japanese mode when one exists; English mode keeps the filed name. */
export function capitalPortfolioName(id: string, fallback: string, lang: string) {
  const name = capitalProfiles[id.split("-")[0]]?.name;
  return lang === "ja" && name ? name[0] : fallback;
}
