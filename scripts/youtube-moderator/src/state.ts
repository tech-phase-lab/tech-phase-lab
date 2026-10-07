import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * 通知済みのコメントIDを覚えておくための小さな状態ファイル。
 * 要確認のコメントは承認待ちに残り続けるため、これがないと実行のたびに同じ通知が飛ぶ。
 * コメント本文や投稿者名は保存しない。
 */
type State = {
  notified: Record<string, string>;
};

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function loadState(path: string): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<State>;
    return { notified: parsed.notified ?? {} };
  } catch {
    return { notified: {} };
  }
}

export async function saveState(path: string, state: State): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  const notified = Object.fromEntries(
    Object.entries(state.notified).filter(([, at]) => Date.parse(at) >= cutoff),
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ notified }, null, 2));
}
