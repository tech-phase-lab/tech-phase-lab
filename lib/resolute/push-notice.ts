// RESOLUTE ③④ のスマホ通知の文(オーナー指定 2026-11-17)。タイトルはいつも「RESOLUTE」、本文は1行で銘柄名とラインだけ。
// 詳しい数字は通知に入れない(押すと開く「今日のお知らせ」に出す)。売買を指示しない。将来を断定しない。
import type { AlertEvent } from "./alert-judge.ts";

export type PushLocale = "ja" | "en";
export type ResolutePushNotice = { title: "RESOLUTE"; body: string; url: string };

export const RESOLUTE_PUSH_TITLE = "RESOLUTE" as const;
/** 通知を押して開く画面。public/research-sw.js と lib/research/push-targets.json の一覧にも入っている。 */
export const RESOLUTE_ALERT_PAGE = "/resolute/alerts/latest";
export const RESOLUTE_MORNING_PAGE = "/resolute/morning";

/** 1銘柄が下落ラインに届いたとき、通知に出すライン: 今回新しく届いたうち、いちばん深いもの。 */
function deepestLine(event: AlertEvent): number {
  const lines = (event.newLines ?? []).filter((value) => Number.isFinite(value));
  if (!lines.length) throw new RangeError("line event without a line");
  return Math.max(...lines);
}

/** ③ の本文(1行)。items は判定結果(alert-judge)の並びのまま。先頭の銘柄の名前を出す。 */
export function resoluteAlertPushBody(items: AlertEvent[], locale: PushLocale): string {
  if (!items.length) throw new RangeError("items must not be empty");
  const first = items[0];
  const symbol = first.symbol;
  const hasLine = items.some((e) => e.kind === "line_reached");
  const hasSurge = items.some((e) => e.kind === "surge_cap");
  const ja = locale === "ja";
  if (items.length === 1) {
    if (first.kind === "line_reached") {
      const line = deepestLine(first);
      return ja ? `${symbol}が計画の下落ライン -${line}% に届きました` : `${symbol} reached the -${line}% level in your plan`;
    }
    return ja ? `${symbol}が決めておいた上昇の目安に届きました` : `${symbol} reached the rise alert level you set`;
  }
  const more = items.length - 1;
  if (hasLine && hasSurge) return ja ? `${symbol} ほか${more}銘柄が計画のラインと上昇の目安に届きました` : `${symbol} and ${more} more reached levels in your plan`;
  if (hasLine) return ja ? `${symbol} ほか${more}銘柄が計画のラインに届きました` : `${symbol} and ${more} more reached levels in your plan`;
  // 上昇の目安だけが2銘柄以上(表にない場面。上昇の1銘柄の文に合わせた)。
  return ja ? `${symbol} ほか${more}銘柄が決めておいた上昇の目安に届きました` : `${symbol} and ${more} more reached the rise alert levels you set`;
}

/** ④ の本文。 */
export function resoluteMorningPushBody(locale: PushLocale): string {
  return locale === "ja" ? "昨日のお知らせのあと、どうでしたか？" : "How are you feeling after yesterday's alert?";
}

export function resoluteAlertPush(items: AlertEvent[], locale: PushLocale): ResolutePushNotice {
  return { title: RESOLUTE_PUSH_TITLE, body: resoluteAlertPushBody(items, locale), url: RESOLUTE_ALERT_PAGE };
}
export function resoluteMorningPush(locale: PushLocale): ResolutePushNotice {
  return { title: RESOLUTE_PUSH_TITLE, body: resoluteMorningPushBody(locale), url: RESOLUTE_MORNING_PAGE };
}
