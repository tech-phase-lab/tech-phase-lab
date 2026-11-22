/** The fixed samples of the PRO feature tour (owner, Nov 16): which features have one, the frame's text. Light on purpose (no saved data
 * here), so the tour's list and pages carry none of it; the data is in pro-experience-sample-data.ts and pro-experience-samples/. */

/** The same made-up moment on every sample (owner: "日付は架空です。全機能で同じ日付にそろえてください"). */
export const SAMPLE_TIME = { ja: "2035/03/12 09:00 時点", en: "As of 2035/03/12 09:00" } as const;
/** The last U.S. close before that moment (2035-03-12 is a Monday): the date the samples' prices are "as of". */
export const SAMPLE_CLOSE_DAY = "2035-03-09";
/** The features that show a sample instead of a video. Phone notifications keep the video; RIZEL'S DESK has its sample since Nov 17;
 * トレジャーハント and クジラの足あと since Nov 22. */
export const SAMPLE_FEATURES = ["relation-map", "compare", "theme-ranking", "treasure-hunt", "whale-tracks", "watch-22", "rizels-desk", "financial-radar", "us-portfolio"] as const;
export type SampleFeature = typeof SAMPLE_FEATURES[number];
/** Samples whose 「サンプル」 mark sits inside the PRO card, beside 「PRO機能体験」, with the dates of their own data in place of the frame's
 * one time line (owner's mockups, Nov 22). */
export const CARD_HEAD_FEATURES: readonly SampleFeature[] = ["treasure-hunt", "whale-tracks"];
export const CARD_HEAD = { tag: { ja: "サンプル", en: "Sample" }, label: { ja: "PRO機能体験", en: "PRO feature tour" } } as const;
export const hasSample = (id: string): id is SampleFeature => (SAMPLE_FEATURES as readonly string[]).includes(id);

/** 「PROではじめる」 and 「PROなら好きな銘柄で使えます」 are for people who are not PRO. They wait for the membership check, so a PRO member never
 * sees them flash; the owner's accounts count as PRO in every environment (AGENTS.md, operator access). */
export function showStartButton(member: { settled: boolean; plan: string | null; ownerAccount: boolean; ownerRole: boolean }): boolean {
  return member.settled && member.plan !== "pro" && !member.ownerAccount && !member.ownerRole;
}

/** What a tap inside a sample may not do: leave for another screen. A link (or a control marked data-pro-only) that the sample did not handle
 * itself is stopped and answered with the small 「PROで使えます」. Returns the element to stop, or null to let the tap through. */
export const GUARDED = "a[href], [data-pro-only]";
export function guardedTarget<T>(target: { closest?: (selector: string) => T | null } | null, handled: boolean): T | null {
  if (handled || !target?.closest) return null;
  return target.closest(GUARDED);
}

/** One line under each sample: what you can do in it. */
export const SAMPLE_HINTS: Record<SampleFeature, { ja: string; en: string }> = {
  "relation-map": { ja: "企業をタップすると、NVDAとのつながりが見られます", en: "Tap a company to see how it connects to NVDA" },
  compare: { ja: "4銘柄から2つを選ぶと、結果ページが開きます", en: "Choose two of the four stocks to open the result" },
  "theme-ranking": { ja: "テーマをタップすると、中の銘柄が見られます", en: "Tap a theme to see its stocks" },
  "treasure-hunt": { ja: "ハイテクと全セクターを切り替えて、ある1日の順位を見られます", en: "Switch between Tech and All sectors to see one day's ranking" },
  "whale-tracks": { ja: "4つのタブを切り替えて、並び替えも試せます", en: "Switch between the four tabs and try the sort buttons" },
  "watch-22": { ja: "NVDAとAMDを切り替えて、決算の深掘りを読めます", en: "Switch between NVDA and AMD to read their earnings deep dive" },
  "financial-radar": { ja: "半導体6社を、稼ぐ力と守る力の点数で順位付けしています", en: "Six chipmakers, ranked by their cash-generation and resilience scores" },
  "us-portfolio": { ja: "押すと読み取りの動きのあと、サンプルの持ち株が表示されます", en: "Press it to watch the reading, then see the sample holdings" },
  "rizels-desk": { ja: "☺を押して、リアクションしてみましょう", en: "Tap ☺ to react to a note" },
};
/** RIZEL'S DESK has three tabs, each with its own line under the sample (owner's spec, Nov 17; the weekly line is not in the spec). */
export const DESK_HINTS = {
  notes: SAMPLE_HINTS["rizels-desk"],
  ask: { ja: "質問を送ると、リゼルの回答が届きます", en: "Send a question and get Rizel's answer" },
  weekly: { ja: "週刊PROのサンプル号を読めます", en: "Read a sample issue of PRO Weekly" },
} as const;
