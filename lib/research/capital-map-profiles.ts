// Public biographies reviewed 2026-10-12. Roles describe the person, not who made each trade.
export type CapitalProfile = {
  person: [string, string]; role: [string, string]; description: [string, string]; source: string;
  leadership?: [string, string];
  portrait?: { url: string; source: string; credit: string; license: string; licenseUrl: string };
};
export const capitalProfiles: Record<string, CapitalProfile> = {
  nvidia: {
    person: ["ジェンスン・フアン", "Jensen Huang"], role: ["共同創業者・CEO", "Co-Founder & CEO"],
    description: ["GPUやAI向け半導体を開発するテック企業。", "A GPU and AI chip company."],
    source: "https://nvidianews.nvidia.com/bios/jensen-huang",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/e/e4/P20250430JB-0891_%28cropped%29.jpg", source: "https://commons.wikimedia.org/wiki/File:P20250430JB-0891_(cropped).jpg", credit: "Joyce N. Boghosian / The White House", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
  alphabet: {
    person: ["スンダー・ピチャイ", "Sundar Pichai"], role: ["CEO", "CEO"],
    description: ["検索やYouTubeを展開するテック企業。", "The company behind Search and YouTube."],
    source: "https://blog.google/authors/sundar-pichai/",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/7/7b/Mateusz_Morawiecki_spotka%C5%82_si%C4%99_z_CEO_Google_Sundar_Pichai_w_KPRM_%282022.03.29%29_01_%28cropped%29.jpg", source: "https://commons.wikimedia.org/wiki/File:Mateusz_Morawiecki_spotka%C5%82_si%C4%99_z_CEO_Google_Sundar_Pichai_w_KPRM_(2022.03.29)_01_(cropped).jpg", credit: "Krystian Maj", license: "CC BY 3.0 PL", licenseUrl: "https://creativecommons.org/licenses/by/3.0/pl/" },
  },
  amazon: {
    person: ["アンディ・ジャシー", "Andy Jassy"], role: ["社長・CEO", "President & CEO"],
    description: ["通販やAWSを展開するテック企業。", "An e-commerce and cloud company."],
    source: "https://ir.aboutamazon.com/officers-and-directors/default.aspx",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/0/07/Andy_Jassy.jpg", source: "https://commons.wikimedia.org/wiki/File:Andy_Jassy.jpg", credit: "Lisi Mezistrano Wolf", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  },
  intel: {
    person: ["リップブー・タン", "Lip-Bu Tan"], role: ["CEO", "CEO"],
    description: ["CPUなどの半導体を設計・製造する企業。", "A chip designer and manufacturer."],
    source: "https://newsroom.intel.com/corporate/my-commitment-to-you-and-our-company",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/5/5b/Intel_CEO_Lip-Bu_Tan_%282025%29_%28cropped%29.jpg", source: "https://commons.wikimedia.org/wiki/File:Intel_CEO_Lip-Bu_Tan_(2025)_(cropped).jpg", credit: "United States Department of Commerce", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
  cisco: {
    person: ["チャック・ロビンス", "Chuck Robbins"], role: ["会長・CEO", "Chair & CEO"],
    description: ["通信やセキュリティを手がけるテック企業。", "A networking and security company."],
    source: "https://newsroom.cisco.com/c/r/newsroom/en/us/executives/robbins-chuck.html",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/5/59/Charles_H._Robbins.jpg", source: "https://commons.wikimedia.org/wiki/File:Charles_H._Robbins.jpg", credit: "U.S. Army Sgt. James K. McCann / Chairman of the Joint Chiefs of Staff", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/" },
  },
  berkshire: {
    person: ["ウォーレン・バフェット", "Warren Buffett"], role: ["名誉会長", "Chairman Emeritus"],
    leadership: ["現CEO：グレッグ・アベル", "Current CEO: Greg Abel"],
    description: ["保険や鉄道を営み、上場企業にも投資。", "Insurance, railroads and stock investing."],
    source: "https://www.berkshirehathaway.com/news/sep1826.pdf",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/d/d4/Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg", source: "https://commons.wikimedia.org/wiki/File:Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_(cropped).jpg", credit: "USA International Trade Administration", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
  pershing: {
    person: ["ビル・アックマン", "Bill Ackman"], role: ["創業者・CEO", "Founder & CEO"],
    description: ["少数の企業を厳選し、長期保有する運用会社。", "A concentrated, long-term investor."],
    source: "https://pershingsquareinc.com/about-us/",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/5/56/Bill_Ackman%2C_2016.jpg", source: "https://commons.wikimedia.org/wiki/File:Bill_Ackman,_2016.jpg", credit: "Senate Democrats", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/" },
  },
  bridgewater: { person: ["レイ・ダリオ", "Ray Dalio"], role: ["創業者", "Founder"], description: ["世界経済を分析し、幅広い資産に投資。", "Investing across global asset classes."], source: "https://www.bridgewater.com/our-founder", portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Ray_Dalio_Sept_23_2017_NYC.jpg", source: "https://commons.wikimedia.org/wiki/File:Ray_Dalio_Sept_23_2017_NYC.jpg", credit: "Grameen America", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/" } },
  appaloosa: { person: ["デビッド・テッパー", "David Tepper"], role: ["創業者", "Founder"], description: ["テッパーが1993年に設立した運用会社。", "Founded by David Tepper in 1993."], source: "https://tepperfoundation.org/about/our-founder/", portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/3/3d/David_Tepper_01.jpg", source: "https://commons.wikimedia.org/wiki/File:David_Tepper_01.jpg", credit: "Appaloosa Management", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" } },
  coatue: { person: ["フィリップ・ラフォン", "Philippe Laffont"], role: ["創業者・ポートフォリオマネジャー", "Founder & Portfolio Manager"], description: ["テック企業を中心に投資する運用会社。", "An investment firm focused on tech."], source: "https://www.coatue.com/ctek/why-ctek" },
  tiger: { person: ["チェイス・コールマン", "Chase Coleman"], role: ["創業者", "Founder"], description: ["世界の成長企業に長期投資する運用会社。", "A long-term investor in growth companies."], source: "https://www.tigerglobal.com/chase-coleman" },
  viking: { person: ["アンドレアス・ハルヴォルセン", "Andreas Halvorsen"], role: ["共同創業者・CEO", "Co-Founder & CEO"], description: ["企業調査をもとに世界へ投資する運用会社。", "A research-driven global investor."], source: "https://vikingglobal.com/our-team/" },
  fundsmith: { person: ["テリー・スミス", "Terry Smith"], role: ["創業者", "Founder"], description: ["質の高い企業を選び、長期保有する運用会社。", "Investing in quality for the long term."], source: "https://www.fundsmith.co.uk/sef/about-us/" },
};
