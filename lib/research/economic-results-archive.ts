/**
 * Every stored economic indicator result (Nov 28: rows vanished from the calendar after the news feed's seven days, and the feed carries
 * only the newest 20 event results). The monitor keeps each official result in event_results for good (scripts/research/economic_archive.py)
 * and answers them all at /economic-results; the calendar adds them under the live feed's. The hand-kept rows in lib/research/calendar.ts
 * are only a fallback: a stored result of the same id replaces one (lib/research/pce-results.ts).
 * Pure helpers; the read is server-only (economic-results-server.ts).
 */
import { parseEventResults, type EventResult } from "./general-news.ts";

export const ARCHIVE_LIMIT = 400;

/** The monitor's answer, each row checked like the news feed's event results; a row that does not pass is left out. */
export function parseArchive(value: unknown): EventResult[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, ARCHIVE_LIMIT).flatMap(raw => { try { return parseEventResults([raw]); } catch { return []; } });
}

/** The live feed's results, then the stored ones it no longer carries. */
export function withArchive(live: EventResult[], archive: EventResult[]): EventResult[] {
  const ids = new Set(live.map(item => item.id));
  return [...live, ...archive.filter(item => !ids.has(item.id))];
}
