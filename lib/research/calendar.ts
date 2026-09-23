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

export const calendarReviewedOn = "2026-09-23";
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
  return events.filter((event) => (kind === "all" || event.kind === kind) && (period === "upcoming" ? Date.parse(event.startsAt) >= now : calendarDateKey(event.startsAt, timezone).startsWith(period)));
}

// Date-only announcements must never be turned into fictitious midnight timestamps.
export const dateOnlyEvents: DateOnlyCalendarEvent[] = [
  {
    id: "asml-q3-2026-results", kind: "earnings", ticker: "ASML", date: "2026-10-14", sourceTimezone: "Europe/Amsterdam",
    title: { ja: "ASML 決算発表（2026年Q3）", en: "ASML Q3 2026 results" }, sourceName: "ASML IR",
    sourceUrl: "https://www.asml.com/en/investors/financial-calendar", checkedOn: "2026-09-23",
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
  return events.filter((event) => (kind === "all" || event.kind === kind) && (period === "upcoming"
    ? event.date >= calendarDateKey(new Date(now).toISOString(), event.sourceTimezone)
    : event.date.startsWith(period)));
}
export function selectDateOnlyEarnings(period: string, now: number) {
  return selectDateOnlyEvents(dateOnlyEarnings, "earnings", period, now);
}
