// The market gauge's fixed wording (owner pack, Nov 17, section 2, after the lawyer's review).
// THERMOMETER_METHOD describes what thermometer-basket.ts, thermometer-provider.ts and thermometer.ts actually do;
// change it together with the calculation.

/** The one line next to the gauge: what it is and what it is not. */
export const THERMOMETER_NOTE = {
  ja: "過去の値動きの大きさを示すもので、割安・割高や売買の時期を示すものではありません。",
  en: "Based on the size of past price moves. It doesn't show whether stocks are cheap or expensive, or when to buy or sell.",
} as const;

type Row = { term: string; text: string };
/** A short, collapsible outline of the calculation: constituents, the equal-weight average, and how volatility is measured. */
export const THERMOMETER_METHOD: readonly { ja: Row; en: Row }[] = [
  {
    ja: { term: "対象銘柄", text: "TP大型株100は、NASDAQが公表する米国の大型株100銘柄です。TP半導体40は、米国上場の半導体関連企業のうち時価総額が大きい40社で、3・6・9・12月に見直します。" },
    en: { term: "Stocks included", text: "TP Large Cap 100 uses the 100 large U.S. stocks on the list Nasdaq publishes. TP Semiconductor 40 uses the 40 largest U.S.-listed semiconductor companies by market cap, reviewed in March, June, September and December." },
  },
  {
    ja: { term: "同じ重みの平均", text: "毎日、各銘柄の前日比を同じ重みで平均し、100から始めた数値につなげていきます。その日に株価がない銘柄は計算に入れず、10銘柄以上そろった日だけ計算します。株価は株式分割を調整した終値です。" },
    en: { term: "Equal-weight average", text: "Each day, every stock's change from the previous close counts equally; the average is chained into a level that starts at 100. A stock without a price that day is left out, and a day is used only when at least 10 stocks have prices. Prices are split-adjusted closes." },
  },
  {
    ja: { term: "値動きの荒さ(TP恐怖指数)", text: "TP大型株100の直近20営業日の日々の値動き(対数収益率)のばらつき(標準偏差)を、年率に直した数値(%)です。過去10年の値と比べた位置も示します。温度の判定には含めません。" },
    en: { term: "Volatility (TP Fear Index)", text: "The spread (standard deviation) of TP Large Cap 100's daily moves (log returns) over the last 20 trading days, annualised and shown in percent. We also show where it sits against the past 10 years. It is not part of the temperature." },
  },
  {
    ja: { term: "温度", text: "高値からの下落率と200日移動平均からの離れ具合を、それぞれ2008年を含む過去約20年と比べ、同じ重みでまとめて5段階で示します。" },
    en: { term: "Temperature", text: "The fall from the high and the distance from the 200-day moving average are each compared with about the past 20 years (including 2008), combined with equal weight, and shown in five bands." },
  },
];
