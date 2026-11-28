"use client";

import type { ReactNode } from "react";
import { noBreakUnits } from "@/lib/research/no-break-units";
import type { ReleaseView } from "@/lib/research/economic-release-view";
import calendarStyles from "./event-calendar.module.css";

type Lang = "ja" | "en";
const badgeText = { ja: { above: "上振れ", below: "下振れ", inline: "予想どおり" }, en: { above: "Above forecast", below: "Below forecast", inline: "In line" } } as const;
const arrows = { up: "↑", down: "↓", same: "→" } as const;

/**
 * One economic release (owner, Nov 24): the collapsed row shows the number, the previous release and, when we hold a forecast,
 * a small above/below badge; the opened row shows one table like the earnings card (owner, Nov 27: 今回 / 前回 / 予想 when held /
 * 変化, one line per figure, an unchanged one muted), what the indicator is, a short history, the next date and one official link. Withdrawing an automatic result is the owner accounts' own small button.
 */
export default function EconomicReleaseItem({ view, title, time, lang, when, withdraw }: {
  view: ReleaseView; title: string; time: ReactNode; lang: Lang;
  when: (at: string, dateOnly?: boolean) => string; withdraw?: () => void;
}) {
  const ja = lang === "ja";
  // The heading's arrow is the table's own: an unchanged headline reads → (owner, Nov 27).
  const headline = view.table[0];
  const withPrevious = view.table.some(row => row.previous);
  const withForecast = view.table.some(row => row.forecast);
  const text = (value: string) => ja ? noBreakUnits(value) : value;
  const badge = view.forecast && <span className={calendarStyles.releaseBadge} data-vs={view.forecast.vs}>{badgeText[lang][view.forecast.vs]}</span>;
  // "前月比" / "前期比年率" belongs to a percentage; a job count or an index reads on its own.
  const pctLabel = view.label && view.unit === "pct" ? <span className={calendarStyles.releaseLabel}>{view.label}</span> : null;
  const name = <span className={calendarStyles.eventName}>{title}
      {view.display
        ? <span className={calendarStyles.releaseLine}>{pctLabel}<strong className={calendarStyles.releaseValue}>{view.display}</strong>
          {view.previous && <span className={calendarStyles.releasePrevious}>{arrows[headline?.change?.direction ?? "same"]} {ja ? "前回" : "Prev"} <span className={calendarStyles.nowrap}>{view.previous.display}</span></span>}
          {badge}</span>
        : <small>{text(view.summary)}</small>}
    </span>;
  // Nothing to open but a link (owner, Nov 26: "開いて出典だけ、をなくす"): a plain row without ＋. The owner accounts still open it to withdraw.
  if (!view.expandable && !withdraw) return <li><div className={calendarStyles.plainRow}>{time}{name}</div></li>;
  return <li><details>
    <summary>{time}{name}<span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
    <div className={`${calendarStyles.eventDetails} ${calendarStyles.releaseDetails}`}>
      {!!view.table.length && <table className={`${calendarStyles.resultTable} ${calendarStyles.releaseTable}`}>
        <thead><tr><th scope="col">{ja ? "項目" : "Item"}</th><th scope="col">{ja ? "今回" : "Actual"}</th>
          {withPrevious && <th scope="col">{ja ? "前回" : "Previous"}</th>}{withForecast && <th scope="col">{ja ? "予想" : "Forecast"}</th>}
          {withPrevious && <th scope="col">{ja ? "変化" : "Change"}</th>}</tr></thead>
        <tbody>{view.table.map(row => <tr key={row.key} data-same={row.change?.direction === "same" || undefined}>
          <th scope="row">{row.label}</th><td>{row.now}</td>
          {withPrevious && <td>{row.previous ?? "—"}</td>}{withForecast && <td>{row.forecast ?? "—"}</td>}
          {withPrevious && <td data-tone={row.change?.direction}>{row.change ? `${arrows[row.change.direction]} ${row.change.text}` : "—"}</td>}
        </tr>)}</tbody>
      </table>}
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
