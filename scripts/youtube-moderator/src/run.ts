import { classifyComments, type Verdict } from "./classify.ts";
import { loadConfig } from "./config.ts";
import { notify } from "./notify.ts";
import { findNgWord } from "./rules.ts";
import { loadState, saveState } from "./state.ts";
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

async function main() {
  const config = loadConfig();
  const state = await loadState(config.stateFile);

  const accessToken = await getAccessToken(config.youtube);
  const held = await listHeldComments(accessToken, config.youtube.channelId);

  // すでに通知済み（＝あなたの判断待ち）のコメントは判定し直さない
  const fresh = held.filter((c) => !state.notified[c.id]);
  console.log(`承認待ち ${held.length}件 / 新規 ${fresh.length}件 / モード ${config.mode}${config.dryRun ? " (DRY_RUN)" : ""}`);
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
