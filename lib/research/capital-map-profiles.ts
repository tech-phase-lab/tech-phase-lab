// Public biographies reviewed 2026-10-12. Roles describe the person, not who made each trade.
export type CapitalProfile = {
  person: [string, string]; role: [string, string]; description: [string, string]; source: string;
  leadership?: [string, string];
  portrait?: { url: string; source: string; credit: string; license: string; licenseUrl: string };
};
export const capitalProfiles: Record<string, CapitalProfile> = {
  berkshire: {
    person: ["ウォーレン・バフェット", "Warren Buffett"], role: ["名誉会長", "Chairman Emeritus"],
    leadership: ["現CEO：グレッグ・アベル", "Current CEO: Greg Abel"],
    description: ["保険や鉄道などの事業を持ち、上場企業にも長期投資する複合企業。", "A conglomerate with insurance and railroad businesses, alongside long-term investments in public companies."],
    source: "https://www.berkshirehathaway.com/news/sep1826.pdf",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/d/d4/Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg", source: "https://commons.wikimedia.org/wiki/File:Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_(cropped).jpg", credit: "USA International Trade Administration", license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
  },
  pershing: {
    person: ["ビル・アックマン", "Bill Ackman"], role: ["創業者・CEO", "Founder & CEO"],
    description: ["企業を深く調べ、少数の投資先を長期保有する運用会社。", "An investment firm built around in-depth research and long-term stakes in a concentrated portfolio."],
    source: "https://pershingsquareinc.com/about-us/",
    portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/5/56/Bill_Ackman%2C_2016.jpg", source: "https://commons.wikimedia.org/wiki/File:Bill_Ackman,_2016.jpg", credit: "Senate Democrats", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/" },
  },
  bridgewater: { person: ["レイ・ダリオ", "Ray Dalio"], role: ["創業者", "Founder"], description: ["世界の経済や市場の動きを分析し、幅広い資産に投資する運用会社。", "An investment firm that studies global economies and markets and invests across asset classes."], source: "https://www.bridgewater.com/our-founder", portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/9/95/Ray_Dalio%2C_Bridgewater_Associates.jpg", source: "https://commons.wikimedia.org/wiki/File:Ray_Dalio,_Bridgewater_Associates.jpg", credit: "Hedge Funds", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/" } },
  appaloosa: { person: ["デビッド・テッパー", "David Tepper"], role: ["創業者", "Founder"], description: ["デビッド・テッパーが1993年に設立した投資運用会社。", "An investment firm founded by David Tepper in 1993."], source: "https://tepperfoundation.org/about/our-founder/", portrait: { url: "https://upload.wikimedia.org/wikipedia/commons/3/3d/David_Tepper_01.jpg", source: "https://commons.wikimedia.org/wiki/File:David_Tepper_01.jpg", credit: "Appaloosa Management", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" } },
  coatue: { person: ["フィリップ・ラフォン", "Philippe Laffont"], role: ["創業者・ポートフォリオマネジャー", "Founder & Portfolio Manager"], description: ["テクノロジー企業を中心に、上場企業と未上場企業の両方に投資する運用会社。", "A technology-focused firm investing in both public and private companies."], source: "https://www.coatue.com/ctek/why-ctek" },
  tiger: { person: ["チェイス・コールマン", "Chase Coleman"], role: ["創業者", "Founder"], description: ["世界の成長企業を調べ、上場・未上場を問わず長期的に投資する運用会社。", "A research-driven firm investing for the long term in public and private growth companies worldwide."], source: "https://www.tigerglobal.com/chase-coleman" },
  viking: { person: ["アンドレアス・ハルヴォルセン", "Andreas Halvorsen"], role: ["共同創業者・CEO", "Co-Founder & CEO"], description: ["企業ごとの調査をもとに、世界の上場・未上場企業へ投資する運用会社。", "An investment firm using company-level research to invest in public and private businesses worldwide."], source: "https://vikingglobal.com/our-team/" },
  fundsmith: { person: ["テリー・スミス", "Terry Smith"], role: ["創業者", "Founder"], description: ["質の高い企業を選び、長期保有する方針の運用会社。", "An investment firm focused on buying high-quality businesses and holding them for the long term."], source: "https://www.fundsmith.co.uk/sef/about-us/" },
};
