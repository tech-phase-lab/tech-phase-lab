import type { ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import { displayClock } from "@/lib/research/display-time";
import styles from "./general-news.module.css";

/** One row of the news timeline: time on the left, a rail with a dot (glowing
 * for fresh items), the story on the right. A date-only source shows just its date.
 * Times are Japan time in Japanese and U.S. Eastern in English (owner, Nov 17). */
export default function TimelineRow({ at, kind, fresh, lang, children }: { at: string; kind: "date" | "time"; fresh: boolean; lang: Language; children: ReactNode }) {
  let time: ReactNode;
  if (kind === "date") { const [, month, day] = at.split("-"); time = <time dateTime={at}>{Number(month)}/{Number(day)}</time>; }
  // The day is told by the divider above; the row shows only the hour and minute.
  else time = <time dateTime={at}>{displayClock(at, lang)}</time>;
  return <div className={`${styles.tlRow} ${fresh ? styles.tlFresh : ""}`}>
    <span className={styles.tlTime}>{time}</span>
    <span className={styles.tlRail} aria-hidden="true"><i /></span>
    <div className={styles.tlBody}>{children}</div>
  </div>;
}
