import type { ReactNode } from "react";
import styles from "./general-news.module.css";

const jst = (options: Intl.DateTimeFormatOptions, value: string | number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hourCycle: "h23", ...options }).format(new Date(value));

/** One row of the news timeline: time on the left, a rail with a dot (glowing
 * for fresh items), the story on the right. A date-only source shows just its date. */
export default function TimelineRow({ at, kind, fresh, now, foundAt, children }: { at: string; kind: "date" | "time"; fresh: boolean; now: number; foundAt?: string; children: ReactNode }) {
  let time: ReactNode;
  if (kind === "date") { const [, month, day] = at.split("-"); time = <time dateTime={at}>{Number(month)}/{Number(day)}{foundAt && <span className={styles.tlFound}>取得 {jst({ hour: "2-digit", minute: "2-digit" }, foundAt)}</span>}</time>; }
  else {
    const sameDay = jst({ year: "numeric", month: "numeric", day: "numeric" }, at) === jst({ year: "numeric", month: "numeric", day: "numeric" }, now);
    time = <time dateTime={at}>{!sameDay && <span>{jst({ month: "numeric", day: "numeric" }, at)}</span>}{jst({ hour: "2-digit", minute: "2-digit" }, at)}</time>;
  }
  return <div className={`${styles.tlRow} ${fresh ? styles.tlFresh : ""}`}>
    <span className={styles.tlTime}>{time}</span>
    <span className={styles.tlRail} aria-hidden="true"><i /></span>
    <div className={styles.tlBody}>{children}</div>
  </div>;
}
