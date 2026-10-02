type Copy = { ja: string; en: string };
export type CalendarEvent = {
  id: string;
  kind: "earnings" | "economic";
  title: Copy;
  startsAt: string;
  sourceTimezone: string;
  sourceName: string;
  sourceUrl: string;
  ticker?: string;
  note?: Copy;
};
export type DateOnlyCalendarEvent = {
  id: string;
  kind: CalendarEvent["kind"];
  ticker?: string;
  date: string;
  sourceTimezone: string;
  title: Copy;
  sourceName: string;
  sourceUrl: string;
  checkedOn: string;
  note?: Copy;
};

export const calendarReviewedOn = "2026-10-02";
const blsUrl = "https://www.bls.gov/schedule/2026/";
const labels: Record<string, Copy> = {
  jobs: { ja: "米国雇用統計", en: "U.S. employment report" },
  cpi: { ja: "米国CPI（消費者物価指数）", en: "U.S. Consumer Price Index" },
  ppi: { ja: "米国PPI（生産者物価指数）", en: "U.S. Producer Price Index" },
};

// Dates and Eastern Time from the BLS annual schedule, checked on calendarReviewedOn.
const blsReleases = [
  ["jobs", "2026-10-02T08:30:00-04:00"],
  ["cpi", "2026-10-14T08:30:00-04:00"],
  ["ppi", "2026-10-15T08:30:00-04:00"],
  ["jobs", "2026-11-06T08:30:00-05:00"],
  ["cpi", "2026-11-10T08:30:00-05:00"],
  ["ppi", "2026-11-13T08:30:00-05:00"],
  ["jobs", "2026-12-04T08:30:00-05:00"],
  ["cpi", "2026-12-10T08:30:00-05:00"],
  ["ppi", "2026-12-15T08:30:00-05:00"],
];
export const calendarEvents: CalendarEvent[] = [
  ...blsReleases.map(([type, startsAt]) => ({ id: `${type}-${startsAt.slice(0, 10)}`, kind: "economic" as const, title: labels[type], startsAt, sourceTimezone: "America/New_York", sourceName: "BLS", sourceUrl: blsUrl })),
  ...[
    ["2026-08", "2026-09-30T08:30:00-04:00"],
    ["2026-09", "2026-10-29T08:30:00-04:00"],
    ["2026-10", "2026-11-25T08:30:00-05:00"],
    ["2026-11", "2026-12-23T08:30:00-05:00"],
  ].map(([period, startsAt]) => ({
    id: `pce-${period}`, kind: "economic" as const,
    title: { ja: `米国PCE物価指数（${Number(period.slice(5))}月）`, en: `U.S. PCE price index (${period})` },
    startsAt, sourceTimezone: "America/New_York", sourceName: "BEA",
    sourceUrl: "https://www.bea.gov/news/schedule/full",
    note: { ja: "個人所得・消費支出の発表に含まれます。総合・コアの前月比と前年比を確認します。", en: "Part of Personal Income and Outlays. Check headline and core monthly and annual changes." },
  })),
  {
    id: "mu-fq4-2026-call", ticker: "MU", kind: "earnings" as const, title: { ja: "MU 決算説明会（2026年度Q4）", en: "MU fiscal Q4 2026 earnings call" },
    startsAt: "2026-09-30T14:30:00-06:00", sourceTimezone: "America/Denver", sourceName: "Micron IR",
    sourceUrl: "https://investors.micron.com/news/press-release/2026/Micron-Technology-to-Report-Fiscal-Fourth-Quarter-Results-on-September-30-2026/default.aspx",
    note: { ja: "説明会の開始予定です。決算資料の公開時刻を示すものではありません。", en: "Scheduled call start, not the publication time of the earnings release." },
  },
  {
    id: "nflx-q3-2026-release", ticker: "NFLX", kind: "earnings" as const, title: { ja: "Netflix 決算発表（2026年Q3）", en: "Netflix Q3 2026 results release" },
    startsAt: "2026-10-20T13:01:00-07:00", sourceTimezone: "America/Los_Angeles", sourceName: "Netflix IR",
    sourceUrl: "https://ir.netflix.net/investor-news-and-events/financial-releases/press-release-details/2026/Netflix-to-Announce-Third-Quarter-2026-Financial-Results/default.aspx",
    note: { ja: "公開は予定時刻の前後です。経営陣インタビューは44分後を予定しています。", en: "Approximate release time. The management interview is scheduled 44 minutes later." },
  },
  {
    id: "asml-q3-2026-release", ticker: "ASML", kind: "earnings" as const, title: { ja: "ASML 決算発表（2026年Q3）", en: "ASML Q3 2026 results release" },
    startsAt: "2026-10-14T07:00:00+02:00", sourceTimezone: "Europe/Amsterdam", sourceName: "ASML IR",
    sourceUrl: "https://investor.asml.com/quarterly-results",
    note: { ja: "公式IRが示す決算資料の公開予定時刻です。ウェブ掲載はその直後を予定しています。", en: "Official scheduled results release time; website publication is expected shortly afterward." },
  },
  {
    id: "asml-q3-2026-call", ticker: "ASML", kind: "earnings" as const, title: { ja: "ASML 決算説明会（2026年Q3）", en: "ASML Q3 2026 investor call" },
    startsAt: "2026-10-14T15:00:00+02:00", sourceTimezone: "Europe/Amsterdam", sourceName: "ASML IR",
    sourceUrl: "https://investor.asml.com/quarterly-results",
    note: { ja: "説明会の開始予定です。決算資料の公開時刻とは別です。", en: "Scheduled investor call start, separate from the results release time." },
  },
  {
    id: "sndk-fq1-2027-call", ticker: "SNDK", kind: "earnings" as const, title: { ja: "Sandisk 決算説明会（2027年度Q1）", en: "Sandisk fiscal Q1 2027 earnings call" },
    startsAt: "2026-10-29T16:30:00-04:00", sourceTimezone: "America/New_York", sourceName: "Sandisk IR",
    sourceUrl: "https://investor.sandisk.com/news-events/events",
    note: { ja: "説明会の開始予定です。決算資料の公開時刻を示すものではありません。", en: "Scheduled call start, not the publication time of the earnings release." },
  },
  {
    id: "tsm-q3-2026-call", ticker: "TSM", kind: "earnings" as const, title: { ja: "TSMC 決算説明会（2026年Q3）", en: "TSMC Q3 2026 earnings conference and call" },
    startsAt: "2026-10-15T14:00:00+08:00", sourceTimezone: "Asia/Taipei", sourceName: "TSMC IR",
    sourceUrl: "https://investor.tsmc.com/english/financial-calendar",
    note: { ja: "公式カレンダーに掲載された説明会の開始予定です。決算資料の公開時刻を示すものではありません。", en: "Scheduled conference start from the official calendar, not the publication time of the earnings release." },
  },
  {
    id: "lrcx-september-2026-call", ticker: "LRCX", kind: "earnings" as const, title: { ja: "Lam Research 決算説明会（2026年9月期）", en: "Lam Research September 2026 quarter earnings call" },
    startsAt: "2026-10-21T14:00:00-07:00", sourceTimezone: "America/Los_Angeles", sourceName: "Lam Research IR",
    sourceUrl: "https://investor.lamresearch.com/2026-09-30-Lam-Research-Corporation-Announces-September-Quarter-Financial-Conference-Call",
    note: { ja: "説明会の開始予定です。決算資料の公開時刻を示すものではありません。", en: "Scheduled call start, not the publication time of the earnings release." },
  },
  {
    id: "klac-fq1-2027-call", ticker: "KLAC", kind: "earnings" as const, title: { ja: "KLA 決算説明会（2027年度Q1）", en: "KLA fiscal Q1 2027 earnings webcast" },
    startsAt: "2026-10-28T14:00:00-07:00", sourceTimezone: "America/Los_Angeles", sourceName: "KLA IR",
    sourceUrl: "https://ir.kla.com/news-events/press-releases/detail/522/kla-announces-first-quarter-fiscal-year-2027-earnings-date",
    note: { ja: "説明会の開始予定です。決算資料は同日の米国市場終了後に公開予定ですが、正確な公開時刻は公表されていません。", en: "Scheduled webcast start. Results are due after the U.S. market closes that day, but no exact publication time was announced." },
  },
  {
    id: "gev-q3-2026-webcast", ticker: "GEV", kind: "earnings" as const, title: { ja: "GE Vernova 決算説明会（2026年Q3）", en: "GE Vernova Q3 2026 earnings webcast" },
    startsAt: "2026-10-28T07:30:00-04:00", sourceTimezone: "America/New_York", sourceName: "GE Vernova IR",
    sourceUrl: "https://www.gevernova.com/investors/events/3rd-quarter-2026-earnings-webcast",
    note: { ja: "ウェブキャストの開始予定です。決算資料の公開時刻を示すものではありません。", en: "Scheduled webcast start, not the publication time of the earnings release." },
  },
  {
    id: "adbe-fq4-2026-call", ticker: "ADBE", kind: "earnings" as const, title: { ja: "Adobe 決算説明会（2026年度Q4・通期）", en: "Adobe fiscal Q4 and FY2026 earnings call" },
    startsAt: "2026-12-09T14:00:00-08:00", sourceTimezone: "America/Los_Angeles", sourceName: "Adobe IR",
    sourceUrl: "https://www.adobe.com/investor-relations/events-presentations.html",
    note: { ja: "説明会の開始予定です。決算資料の公開時刻を示すものではありません。", en: "Scheduled call start, not the publication time of the earnings release." },
  },
].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

export function calendarDateKey(startsAt: string, timezone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(startsAt));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}
export function selectCalendarEvents(events: CalendarEvent[], kind: "all" | CalendarEvent["kind"], period: string, now: number, timezone = "Asia/Tokyo") {
  return events.filter((event) => (kind === "all" || event.kind === kind) && (period === "today-upcoming" ? calendarDateKey(event.startsAt, timezone) >= calendarDateKey(new Date(now).toISOString(), timezone) : period === "upcoming" ? Date.parse(event.startsAt) >= now : calendarDateKey(event.startsAt, timezone).startsWith(period)));
}

// Date-only announcements must never be turned into fictitious midnight timestamps.
export const dateOnlyEvents: DateOnlyCalendarEvent[] = [
  {
    id: "klac-fq1-2027-results", kind: "earnings", ticker: "KLAC", date: "2026-10-28", sourceTimezone: "America/Los_Angeles",
    title: { ja: "KLA 決算発表（2027年度Q1）", en: "KLA fiscal Q1 2027 results" }, sourceName: "KLA IR",
    sourceUrl: "https://ir.kla.com/news-events/press-releases/detail/522/kla-announces-first-quarter-fiscal-year-2027-earnings-date", checkedOn: "2026-10-01",
    note: { ja: "米国市場終了後の公開予定です。公式発表に正確な公開時刻がないため、日付のみ掲載しています。", en: "Due after the U.S. market closes. Only the date is shown because the announcement does not give an exact publication time." },
  },
  ...["2026-10-28", "2026-12-09"].map((date): DateOnlyCalendarEvent => ({
    id: `fomc-${date}`, kind: "economic", date, sourceTimezone: "America/New_York",
    title: { ja: "FOMC会合 最終日", en: "FOMC meeting final day" }, sourceName: "Federal Reserve",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", checkedOn: calendarReviewedOn,
    note: { ja: "公式会合予定で確認できる日付のみを掲載しています。政策発表・会見の時刻は未公表です。", en: "Only the official meeting date is shown. Policy announcement and press-conference times have not been published." },
  })),
];
export const dateOnlyEarnings = dateOnlyEvents.filter((event) => event.kind === "earnings");
export function selectDateOnlyEvents(events: DateOnlyCalendarEvent[], kind: "all" | CalendarEvent["kind"], period: string, now: number) {
  return events.filter((event) => (kind === "all" || event.kind === kind) && ((period === "upcoming" || period === "today-upcoming")
    ? event.date >= calendarDateKey(new Date(now).toISOString(), event.sourceTimezone)
    : event.date.startsWith(period)));
}
export function selectDateOnlyEarnings(period: string, now: number) {
  return selectDateOnlyEvents(dateOnlyEarnings, "earnings", period, now);
}

// Confirmed official releases, separate from scheduled future events.
export const economicResults = [{
  id: "adp-2026-09", title: { ja: "ADP雇用統計（9月）", en: "ADP employment report (September)" },
  sourceName: "ADP",
  releasedAt: "2026-09-30T08:15:00-04:00",
  result: { ja: "民間雇用 +9万人", en: "Private employment +90,000" },
  detail: { ja: "基本給は前年比3.2%増。", en: "Base pay rose 3.2% year over year." },
  sourceUrl: "https://mediacenter.adp.com/2026-09-30-ADP-National-Employment-Report-Private-Sector-Employment-Increased-by-90,000-Jobs-in-September",
  verifiedOn: "2026-09-30",
}, {
  id: "pce-2026-08", title: { ja: "米国PCE物価指数（8月）", en: "U.S. PCE price index (August)" },
  sourceName: "BEA", releasedAt: "2026-09-30T08:30:00-04:00",
  result: { ja: "総合：前月比+0.3%・前年比+3.4%", en: "Headline: +0.3% month over month; +3.4% year over year" },
  detail: { ja: "コア（食品・エネルギー除く）：前月比+0.2%・前年比+3.0%。BEA公式発表を確認して掲載。", en: "Core (excluding food and energy): +0.2% month over month; +3.0% year over year. Checked against the official BEA release." },
  sourceUrl: "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026",
  verifiedOn: "2026-09-30",
}];
