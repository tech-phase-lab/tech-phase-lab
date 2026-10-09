import { classifyComments, type Verdict } from "./classify.ts";
import { isDryRun, loadConfig, loadNotifyConfig, stateFilePath, type Config } from "./config.ts";
import { notify } from "./notify.ts";
import { findNgWord } from "./rules.ts";
import { loadState, saveState, type State } from "./state.ts";
import {
  fillVideoTitles,
  getAccessToken,
  listHeldComments,
  setModerationStatus,
  type HeldComment,
} from "./youtube.ts";

// このリポジトリは公開されているため、Actions のログにはコメント本文や投稿者名を出さず件数だけを出す。

const LABEL: Record<Verdict["decision"], string> = {
  publish: "公開",
  reject: "非公開",
  ask: "要確認",
};

function truncate(text: string, max = 300): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function formatItem(comment: HeldComment, verdict: Verdict): string {
  return [
    `■ ${comment.author}${comment.isReply ? "（返信）" : ""}`,
    `「${truncate(comment.text)}」`,
    `動画: ${comment.videoTitle || comment.videoId}`,
    `判定: ${LABEL[verdict.decision]}（${verdict.category}）${verdict.reason}`,
  ].join("\n");
}

function section(title: string, items: [HeldComment, Verdict][]): string {
  if (items.length === 0) return "";
  return [`【${title}】${items.length}件`, ...items.map(([c, v]) => formatItem(c, v))].join("\n\n");
}

async function moderate(config: Config, state: State) {
  const accessToken = await getAccessToken(config.youtube);
  const held = await listHeldComments(accessToken, config.youtube.channelId);

  // 導入前から溜まっていたコメントは対象外にする
  const cutoff = config.ignoreBefore ? Date.parse(config.ignoreBefore) : Number.NaN;
  const target = Number.isNaN(cutoff) ? held : held.filter((c) => Date.parse(c.publishedAt) >= cutoff);

  // すでに通知済み（＝あなたの判断待ち）のコメントは判定し直さない
  const fresh = target.filter((c) => !state.notified[c.id]);
  console.log(
    `承認待ち ${held.length}件（うち対象外の過去分 ${held.length - target.length}件） / 新規 ${fresh.length}件 / モード ${config.mode}${config.dryRun ? " (DRY_RUN)" : ""}`,
  );
  if (fresh.length === 0) return;

  await fillVideoTitles(accessToken, fresh);

  const verdicts = new Map<string, Verdict>();
  const forAi: HeldComment[] = [];
  for (const comment of fresh) {
    const word = findNgWord(comment.text, config.ngWords);
    if (word) {
      verdicts.set(comment.id, { id: comment.id, decision: "reject", category: "NGワード", reason: `「${word}」を含む` });
    } else {
      forAi.push(comment);
    }
  }
  for (const verdict of await classifyComments(config.model, forAi)) {
    verdicts.set(verdict.id, verdict);
  }

  const grouped: Record<Verdict["decision"], [HeldComment, Verdict][]> = { publish: [], reject: [], ask: [] };
  for (const comment of fresh) {
    const verdict = verdicts.get(comment.id)!;
    grouped[verdict.decision].push([comment, verdict]);
  }
  console.log(
    `判定結果: 公開 ${grouped.publish.length}件 / 非公開 ${grouped.reject.length}件 / 要確認 ${grouped.ask.length}件`,
  );

  const studioUrl = `https://studio.youtube.com/channel/${config.youtube.channelId}/comments/inbox`;
  let message: string;
  let notifiedIds: string[];

  if (config.mode === "auto") {
    if (!config.dryRun) {
      await setModerationStatus(accessToken, grouped.publish.map(([c]) => c.id), "published");
      await setModerationStatus(accessToken, grouped.reject.map(([c]) => c.id), "rejected");
    }
    if (grouped.ask.length === 0 && grouped.reject.length === 0) return;

    message = [
      `🍭 コメント自動審査（公開 ${grouped.publish.length} / 非公開 ${grouped.reject.length} / 要確認 ${grouped.ask.length}）`,
      section("要確認・YouTube Studio で判断してください", grouped.ask),
      section("非公開にしました（誤判定がないか確認用）", grouped.reject),
      grouped.ask.length > 0 ? `YouTube Studio: ${studioUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    notifiedIds = grouped.ask.map(([c]) => c.id);
  } else {
    message = [
      `🍭 コメント審査の判定案（提案モード：YouTube 側はまだ何も変更していません）`,
      section("要確認", grouped.ask),
      section("非公開にする案", grouped.reject),
      section("公開する案", grouped.publish),
      `YouTube Studio: ${studioUrl}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    notifiedIds = fresh.map((c) => c.id);
  }

  await notify(config, message);

  if (!config.dryRun) {
    const now = new Date().toISOString();
    for (const id of notifiedIds) state.notified[id] = now;
    await saveState(config.stateFile, state);
  }
}

// 一時的な不調で毎回お知らせが飛ばないよう、3回連続で失敗したら知らせる（5〜10分おきの実行で15〜30分）
const ALERT_AFTER_FAILURES = 3;
// 同じ原因のお知らせは6時間に1回まで
const ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runUrl(): string {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : "";
}

async function alertIfStuck(state: State, message: string) {
  state.failures = (state.failures ?? 0) + 1;
  if (state.failures < ALERT_AFTER_FAILURES) return;

  const last = state.alert;
  if (last && last.message === message && Date.now() - Date.parse(last.at) < ALERT_INTERVAL_MS) return;

  const text = [
    "⚠️ コメント審査が止まっています",
    `原因: ${message}`,
    "止まっている間に来たコメントは承認待ちのまま残り、直ったあとに審査されます。",
    runUrl() ? `詳細: ${runUrl()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    await notify({ dryRun: isDryRun(), notify: loadNotifyConfig() }, text);
    state.alert = { message, at: new Date().toISOString() };
  } catch (notifyError) {
    // Gmail の設定自体が原因のときは知らせようがない。GitHub の「Run failed」メールが頼り
    console.error(`停止のお知らせも送れませんでした: ${notifyError instanceof Error ? notifyError.message : notifyError}`);
  }
}

/** 1回分のチェック。成功したら true を返す。 */
async function checkOnce(stateFile: string, state: State): Promise<boolean> {
  try {
    await moderate(loadConfig(), state);
    if (state.failures || state.alert) {
      state.failures = 0;
      delete state.alert;
      if (!isDryRun()) await saveState(stateFile, state);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await alertIfStuck(state, message);
    if (!isDryRun()) await saveState(stateFile, state);
    return false;
  }
}

function minutesFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function main() {
  const stateFile = stateFilePath();
  const state = await loadState(stateFile);

  // GitHub の定期実行は15〜30分遅れることがあるため、1回の起動の中で LOOP_MINUTES の間、
  // INTERVAL_MINUTES おきにチェックを繰り返す。0 なら1回だけ（手動実行用）。
  const loopMs = minutesFromEnv("LOOP_MINUTES", 0) * 60_000;
  const intervalMs = Math.max(minutesFromEnv("INTERVAL_MINUTES", 2), 0.5) * 60_000;
  const deadline = Date.now() + loopMs;

  let ok = await checkOnce(stateFile, state);
  while (Date.now() + intervalMs < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    ok = await checkOnce(stateFile, state);
  }

  if (!ok) process.exitCode = 1;
}

await main();
