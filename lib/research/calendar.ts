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

export const calendarReviewedOn = "2026-09-22";
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
    id: "tsm-q3-2026-call", ticker: "TSM", kind: "earnings" as const, title: { ja: "TSMC 決算説明会（2026年Q3）", en: "TSMC Q3 2026 earnings call" },
    startsAt: "2026-10-15T14:00:00+08:00", sourceTimezone: "Asia/Taipei", sourceName: "TSMC IR",
    sourceUrl: "https://investor.tsmc.com/english/quarterly-results/2026/q3",
    note: { ja: "説明会の開始予定です。決算資料の公開時刻とは区別しています。", en: "Scheduled conference call, not the earnings release publication time." },
  },
  {
    id: "nflx-q3-2026-release", ticker: "NFLX", kind: "earnings" as const, title: { ja: "Netflix 決算発表（2026年Q3）", en: "Netflix Q3 2026 results release" },
    startsAt: "2026-10-20T13:01:00-07:00", sourceTimezone: "America/Los_Angeles", sourceName: "Netflix IR",
    sourceUrl: "https://ir.netflix.net/investor-news-and-events/financial-releases/press-release-details/2026/Netflix-to-Announce-Third-Quarter-2026-Financial-Results/default.aspx",
    note: { ja: "公開は予定時刻の前後です。経営陣インタビューは44分後を予定しています。", en: "Approximate release time. The management interview is scheduled 44 minutes later." },
  },
  ...["2026-10-28T14:00:00-04:00", "2026-12-09T14:00:00-05:00"].map((startsAt) => ({
    id: `fomc-${startsAt.slice(0, 10)}`, kind: "economic" as const, title: { ja: "FOMC 政策発表", en: "FOMC policy announcement" }, startsAt,
    sourceTimezone: "America/New_York", sourceName: "Federal Reserve",
    sourceUrl: `https://www.federalreserve.gov/newsevents/2026-${startsAt.includes("-10-") ? "october" : "december"}.htm`,
    note: { ja: "会合最終日の予定。議長会見は30分後の予定です。", en: "Final meeting day. The press conference is scheduled 30 minutes later." },
  })),
].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

export function calendarDateKey(startsAt: string, timezone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(startsAt));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}
export function selectCalendarEvents(events: CalendarEvent[], kind: "all" | CalendarEvent["kind"], period: string, now: number, timezone = "Asia/Tokyo") {
  return events.filter((event) => (kind === "all" || event.kind === kind) && (period === "upcoming" ? Date.parse(event.startsAt) >= now : calendarDateKey(event.startsAt, timezone).startsWith(period)));
}

// Date-only announcements must never be turned into fictitious midnight timestamps.
export const dateOnlyEarnings = [{
  ticker: "ASML", date: "2026-10-14", sourceTimezone: "Europe/Amsterdam",
  title: { ja: "ASML 決算発表（2026年Q3）", en: "ASML Q3 2026 results" },
  sourceUrl: "https://www.asml.com/en/investors/financial-calendar",
  checkedOn: "2026-09-22",
}];
export function selectDateOnlyEarnings(period: string, now: number) {
  return dateOnlyEarnings.filter((event) => period === "upcoming"
    ? event.date >= calendarDateKey(new Date(now).toISOString(), event.sourceTimezone)
    : event.date.startsWith(period));
}
