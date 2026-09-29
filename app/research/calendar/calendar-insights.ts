import type { Language } from "@/lib/research/data";

type Insight = { what: string; watch: string; reading: string };
const insights: Record<string, Record<Language, Insight>> = {
  jobs: {
    ja: { what: "米国の雇用の増減、失業率、賃金の伸びを確認する発表です。", watch: "非農業部門の雇用者数だけでなく、失業率・平均時給・過去2か月の改定をセットで確認。", reading: "失業率が下がっても、働く人の割合が下がった影響かもしれません。雇用の人数と賃金を分けて読み、見出しの数字だけで判断しないのがポイントです。" },
    en: { what: "A snapshot of U.S. hiring, unemployment and wage growth.", watch: "Check nonfarm payrolls, the unemployment rate, average hourly earnings and revisions to the previous two months.", reading: "A lower unemployment rate can reflect lower participation. Read hiring and wages separately rather than relying on the headline alone." },
  },
  cpi: {
    ja: { what: "消費者が購入するモノやサービスの価格変化を測る指標です。", watch: "総合と、食品・エネルギーを除くコアの前月比・前年比。住居費やサービス価格の内訳も確認。", reading: "前年比は1年前の水準にも左右されます。直近の勢いは前月比を併せて読み、一時的なエネルギー価格の変動と幅広い物価変化を区別します。" },
    en: { what: "Measures changes in prices paid by consumers for goods and services.", watch: "Headline and core CPI, month over month and year over year, plus shelter and services. Core excludes food and energy.", reading: "Year-over-year inflation also depends on last year's base. Use monthly changes to assess recent momentum and distinguish energy swings from broader price changes." },
  },
  ppi: {
    ja: { what: "国内の生産者が受け取る販売価格の変化を測る指標です。", watch: "最終需要の前月比・前年比と、モノ・サービスの内訳。一部の価格項目だけが全体を動かしていないか確認。", reading: "CPIとは対象も価格を測る段階も異なります。PPIの上昇がそのまま消費者物価へ移るとは限らないため、両者を同じ数字として扱わないようにします。" },
    en: { what: "Measures changes in selling prices received by domestic producers.", watch: "Monthly and annual final-demand changes, goods and services, and whether a small number of categories drive the headline.", reading: "PPI and CPI cover different prices and stages of the economy. Producer price increases do not necessarily pass through to consumers one for one." },
  },
  fomc: {
    ja: { what: "FRBが金融政策を決める会合です。金利の決定だけでなく、今後の判断方針も確認します。", watch: "政策金利、声明文の前回からの変更、反対票、議長会見。経済見通し・金利見通しは公表される会合で確認。", reading: "今回の決定と今後の見通しを分けて読みます。金利据え置きでも声明文が変わることがあり、見通しは将来の金利を約束するものではありません。" },
    en: { what: "The Federal Reserve's monetary-policy meeting. The decision and guidance both matter.", watch: "The policy rate, changes to the statement, dissents and the chair's press conference. Review economic and rate projections when released.", reading: "Separate today's decision from the outlook. A hold can still bring changes in language, and projections are not a promise of future rates." },
  },
};
export function calendarInsight(id: string, lang: Language): Insight | undefined {
  return insights[id.split("-")[0]]?.[lang];
}
