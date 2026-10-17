import type { Language } from "./data";
import type { GeneralNewsFeed, OfficialUpdate } from "./general-news.ts";
import type { OriginalPreviewItem } from "./original-preview-news.ts";
import { isEarningsRelated } from "./earnings-results.ts";
import { informativeOfficial, shownInLanguage } from "./news-presentation.ts";
import { officialTime } from "./news-time.ts";
import { calendarDateKey, calendarEvents, dateOnlyEvents, selectCalendarEvents, selectDateOnlyEvents } from "./calendar.ts";
import type { PriceTarget } from "./price-targets.ts";

/** The official stories the home list shows. The list and the TODAY count read
 * this one function, so the two cannot disagree. A story with no time stated
 * by its source is not listed (owner, Oct 10); earnings results live on the
 * calendar (owner, Oct 14). */
export function listedOfficialNews(data: GeneralNewsFeed | null, lang: Language): OfficialUpdate[] {
  return (data?.officialUpdates ?? []).filter(item => informativeOfficial(item) && !isEarningsRelated(item) && officialTime(item).kind !== "observed" && shownInLanguage(item, lang));
}

/** Test publications appear only once they carry a checked bilingual summary. */
export function listedOriginalPreviews(data: GeneralNewsFeed | null): OriginalPreviewItem[] {
  return (data?.originalPreviewItems ?? []).filter(item => "summary" in item && !!item.summary);
}

/** Today's date in the zone the screen uses for that figure. */
export function todayKey(now: number, zone: string) {
  return calendarDateKey(new Date(now).toISOString(), zone);
}

/** Stories published today in Japan time (owner, Oct 14). A story that states
 * only a date counts when that date is today. */
export function countTodayNews(data: GeneralNewsFeed | null, lang: Language, now: number): number | null {
  if (!data) return null;
  const today = todayKey(now, "Asia/Tokyo");
  const onToday = (at: string) => (/^\d{4}-\d{2}-\d{2}$/.test(at) ? at : calendarDateKey(at, "Asia/Tokyo")) === today;
  return listedOfficialNews(data, lang).filter(item => onToday(officialTime(item).at)).length
    + (data.items ?? []).filter(item => onToday(item.publishedAt)).length
    + (data.marketUpdates ?? []).filter(item => onToday(item.publishedAt)).length
    + listedOriginalPreviews(data).filter(item => onToday(item.previewPublishedAt)).length;
}

/** Today's earnings and economic events, counted from the same lists and the
 * same selectors as the calendar screen, in the zone that screen opens with. */
export function countTodayEvents(now: number, lang: Language): number {
  const zone = lang === "ja" ? "Asia/Tokyo" : "America/New_York";
  const period = todayKey(now, zone);
  return selectCalendarEvents(calendarEvents, "all", period, now, zone).length
    + selectDateOnlyEvents(dateOnlyEvents, "all", period, now).length;
}

/** Target price changes posted today, in the zone the price target cards show. */
export function countTodayTargets(items: PriceTarget[] | null, lang: Language, now: number): number | null {
  if (!items) return null;
  const zone = lang === "ja" ? "Asia/Tokyo" : "America/New_York";
  const today = todayKey(now, zone);
  return items.filter(item => calendarDateKey(item.publishedAt, zone) === today).length;
}
