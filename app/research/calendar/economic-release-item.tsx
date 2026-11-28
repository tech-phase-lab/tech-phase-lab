"use client";

import type { ReactNode } from "react";
import { noBreakUnits } from "@/lib/research/no-break-units";
import type { ReleaseView } from "@/lib/research/economic-release-view";
import calendarStyles from "./event-calendar.module.css";

type Lang = "ja" | "en";
const arrows = { up: "↑", down: "↓", same: "→" } as const;

/** 「12/3（木）22:30」 / "Thu 12/3 22:30"; a day-only date (FOMC) without the time. */
function dayTime(at: string, zone: string, lang: Lang, dateOnly = false) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(at)).map(part => [part.type, part.value]));
  const day = lang === "ja" ? `${parts.month}/${parts.day}（${parts.weekday}）` : `${parts.weekday} ${parts.month}/${parts.day}`;
  return dateOnly ? day : `${day}${lang === "ja" ? "" : " "}${parts.hour}:${parts.minute}`;
}
const monthDay = (at: string, zone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "numeric", day: "numeric" }).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return `${parts.month}/${parts.day}`;
};

/**
 * One economic release (owner, Nov 28, mocks 02 and 03). The collapsed row is two lines high: the date and time, the indicator's
 * name (the target month in its parentheses, never the week), and on the right this release's number with an arrow and the previous
 * one; the arrow is green when the indicator moved the good way, red the bad way, a grey → when unchanged. A row that is not an
 * indicator (an election) carries a small framed 「イベント」 tag and its result in one line.
 * Opened, every indicator has the same shape: the number large with the change and the previous number beside it, the bars of up to
 * six stored releases (oldest on the left, this one green, heights from the six's own minimum to maximum), the other figures in one
 * line, one sentence on what the indicator is, and the next date with the official source. Withdrawing an automatic result is the
 * owner accounts' own small button, right of the source.
 */
export default function EconomicReleaseItem({ view, time, lang, zone, withdraw }: {
  view: ReleaseView; time: ReactNode; lang: Lang; zone: string; withdraw?: () => void;
}) {
  const ja = lang === "ja";
  const text = (value: string) => ja ? noBreakUnits(value) : value;
  const move = view.move;
  const right = view.display
    ? <span className={calendarStyles.releaseRight}>
      <strong className={calendarStyles.releaseValue}>{view.display}</strong>
      {view.previous && <small className={calendarStyles.releasePrevious}><span data-tone={move?.tone ?? "neutral"}>{arrows[move?.direction ?? "same"]}</span> {ja ? "前回" : "Prev"} {view.previous.display}</small>}
    </span>
    : <span className={`${calendarStyles.releaseRight} ${calendarStyles.releaseResult}`}>{text(view.summary)}</span>;
  const name = <span className={`${calendarStyles.eventName} ${calendarStyles.releaseRow}`}>
    <span className={calendarStyles.releaseName}>{view.name}{!view.known && <span className={calendarStyles.eventTag}>{ja ? "イベント" : "Event"}</span>}</span>
    {right}
  </span>;
  // Nothing to open but a link (owner, Nov 26: "開いて出典だけ、をなくす"): a plain row without ＋. The owner accounts still open it to withdraw.
  if (!view.expandable && !withdraw) return <li><div className={calendarStyles.plainRow}>{time}{name}</div></li>;
  const values = view.history.flatMap(item => item.value === null ? [] : [item.value]);
  const low = Math.min(...values), high = Math.max(...values);
  return <li><details className={calendarStyles.release}>
    <summary>{time}{name}<span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
    <div className={`${calendarStyles.eventDetails} ${calendarStyles.releaseDetails}`}>
      {view.display && <p className={calendarStyles.releaseHead}>
        <strong>{view.display}</strong>
        {view.label && <span>{view.label}</span>}
        {move && (move.direction === "same"
          ? <span><span data-tone="neutral">→</span> {ja ? "前回と同じ" : "Same as last time"}</span>
          : <span><span data-tone={move.tone}>{arrows[move.direction]}</span> {move.size}</span>)}
        {view.previous && move?.direction !== "same" && <span>{ja ? "前回" : "Prev"} {view.previous.display}</span>}
      </p>}
      {!!view.history.length && <ol className={calendarStyles.releaseBars} aria-label={ja ? "過去の推移" : "Recent releases"}>
        {view.history.map(item => <li key={item.id} data-current={item.current || undefined} data-empty={item.value === null || undefined}>
          {/* a period neither stored nor on FRED keeps its place and its label, with no bar (owner, Nov 28: never close the gap) */}
          {item.value !== null && <><b>{item.display}</b>
            <i style={{ height: `${high === low ? 40 : Math.round(10 + (item.value - low) / (high - low) * 50)}px` }} aria-hidden="true" /></>}
          <small>{item.label ?? monthDay(item.releasedAt, zone)}</small>
        </li>)}
      </ol>}
      {!!view.others.length && <p className={calendarStyles.releaseOthers}>{view.others.map(other => <span key={other.label}>{other.label} <b>{text(other.value)}</b>{other.note}</span>)}</p>}
      {!!view.facts.length && <ul className={calendarStyles.facts}>{view.facts.map(fact => <li key={fact}>{text(fact)}</li>)}</ul>}
      {view.about && <p className={calendarStyles.releaseAbout}>{view.about}</p>}
      {(view.next || view.link || withdraw) && <p className={calendarStyles.releaseFoot}>
        {view.next && <span>{ja ? "次回" : "Next"} {dayTime(view.next.at, zone, lang, view.next.dateOnly)}</span>}
        <span className={calendarStyles.releaseSource}>
          {view.link && <a href={view.link.url} target="_blank" rel="noreferrer">{ja ? "出典：" : "Source: "}{view.link.name}</a>}
          {withdraw && <button type="button" className={calendarStyles.withdraw} onClick={withdraw}>{ja ? "この結果を取り下げる" : "Withdraw this result"}</button>}
        </span>
      </p>}
    </div>
  </details></li>;
}
