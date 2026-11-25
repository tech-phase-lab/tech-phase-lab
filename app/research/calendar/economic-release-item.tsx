"use client";

import type { ReactNode } from "react";
import { noBreakUnits } from "@/lib/research/no-break-units";
import type { ReleaseView } from "@/lib/research/economic-release-view";
import calendarStyles from "./event-calendar.module.css";

type Lang = "ja" | "en";
const badgeText = { ja: { above: "上振れ", below: "下振れ", inline: "予想どおり" }, en: { above: "Above forecast", below: "Below forecast", inline: "In line" } } as const;
const arrow = (now: number, before: number) => now > before ? "↑" : now < before ? "↓" : "→";

/**
 * One economic release (owner, Nov 24): the collapsed row shows the number, the previous release and, when we hold a forecast,
 * a small above/below badge; the opened row shows this time / last time / forecast, the change, what the indicator is, a short
 * history, the next date and one official link. Withdrawing an automatic result is the owner accounts' own small button.
 */
export default function EconomicReleaseItem({ view, title, time, lang, when, withdraw }: {
  view: ReleaseView; title: string; time: ReactNode; lang: Lang;
  when: (at: string, dateOnly?: boolean) => string; withdraw?: () => void;
}) {
  const ja = lang === "ja";
  const text = (value: string) => ja ? noBreakUnits(value) : value;
  const badge = view.forecast && <span className={calendarStyles.releaseBadge} data-vs={view.forecast.vs}>{badgeText[lang][view.forecast.vs]}</span>;
  // "前月比" / "前期比年率" belongs to a percentage; a job count or an index reads on its own.
  const pctLabel = view.label && view.unit === "pct" ? <span className={calendarStyles.releaseLabel}>{view.label}</span> : null;
  return <li><details>
    <summary>{time}<span className={calendarStyles.eventName}>{title}
      {view.display
        ? <span className={calendarStyles.releaseLine}>{pctLabel}<strong className={calendarStyles.releaseValue}>{view.display}</strong>
          {view.previous && <span className={calendarStyles.releasePrevious}>{arrow(view.value!.value, view.previous.value.value)} {ja ? "前回" : "Prev"} <span className={calendarStyles.nowrap}>{view.previous.display}</span></span>}
          {badge}</span>
        : <small>{text(view.summary)}</small>}
    </span><span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
    <div className={`${calendarStyles.eventDetails} ${calendarStyles.releaseDetails}`}>
      {view.display && <dl className={calendarStyles.releaseFigures}>
        <div><dt>{ja ? "今回" : "Actual"}</dt><dd>{view.display}</dd></div>
        {view.previous && <div><dt>{ja ? "前回" : "Previous"}</dt><dd>{view.previous.display}</dd></div>}
        {view.forecast && <div><dt>{ja ? "予想" : "Forecast"}</dt><dd>{view.forecast.display}</dd></div>}
      </dl>}
      {(view.change || badge) && <p className={calendarStyles.releaseChange}>{view.change && <span>{arrow(view.value!.value, view.previous!.value.value)} {view.change}</span>}{badge && <span>{ja ? "予想比" : "vs forecast"} {badge}</span>}</p>}
      {!!view.facts.length && <ul className={calendarStyles.facts}>{view.facts.map(fact => <li key={fact}>{text(fact)}</li>)}</ul>}
      {view.about && <p className={calendarStyles.releaseAbout}>{view.about}</p>}
      {!!view.history.length && (() => {
        const top = Math.max(...view.history.map(item => Math.abs(item.value))) || 1;
        return <div className={calendarStyles.releaseHistory}>
          <span>{ja ? "最近の推移" : "Recent releases"}</span>
          <ol>{view.history.map(item => <li key={item.id} data-current={item.current || undefined}>
            <i style={{ height: `${Math.max(3, Math.round(Math.abs(item.value) / top * 28))}px` }} data-negative={item.value < 0 || undefined} aria-hidden="true" />
            <b>{item.display}</b><small>{item.label ?? when(item.releasedAt, true)}</small>
          </li>)}</ol>
        </div>;
      })()}
      {view.forecast && <p className={calendarStyles.releaseNote}>{ja ? "予想は報道の見出しが伝えた数字で、公式の数字ではありません。" : "The forecast is the figure given in news headlines (not an official figure)."}</p>}
      {(view.next || view.link || withdraw) && <p className={calendarStyles.releaseFoot}>
        {view.next && <span>{ja ? "次回発表" : "Next release"} {when(view.next.at, view.next.dateOnly)}</span>}
        {view.link && <a href={view.link.url} target="_blank" rel="noreferrer">{ja ? "出典：" : "Source: "}{view.link.name} ↗</a>}
        {withdraw && <button type="button" className={calendarStyles.withdraw} onClick={withdraw}>{ja ? "この結果を取り下げる" : "Withdraw this result"}</button>}
      </p>}
    </div>
  </details></li>;
}
