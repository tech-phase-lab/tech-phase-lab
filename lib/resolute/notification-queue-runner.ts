import type { Pool } from 'pg';
import { createNotificationOutboxJob } from './notification-outbox.ts';
import { jstSlot } from './notification-job.ts';
import { createClerkNotificationRecipient } from './notification-recipient.ts';
import { createCloseProvider } from './notification-closes.ts';

type Job = (userId: string) => Promise<{ kind: string; status: string }[]>;
type Recipient = ReturnType<typeof createClerkNotificationRecipient>;

/** 指定時刻(日本時間)の対象者を選び、1人ずつ、既存のoutboxジョブへ渡す。
 * 価格・宛先は実行時に取り直す。メールは送らない(送信は別のmail-worker)。既定は無効で、I/Oなし。
 * 1人の失敗が他の人を止めない。結果にはIDや例外本文を出さず、件数だけ。
 */
export function createNotificationQueueRunner(
  pool: Pick<Pool, 'connect'>,
  options: {
    enabled?: boolean;
    now?: () => Date;
    makeJob?: (resolveInputs: Parameters<typeof createNotificationOutboxJob>[1]) => Job;
    recipient: Recipient;
    closes: ReturnType<typeof createCloseProvider>;
    limit?: number;
  },
) {
  const now = options.now ?? (() => new Date());
  return async () => {
    const report = { enabled: !!options.enabled, users: 0, queued: 0, duplicate: 0, skipped: 0, errors: 0, incomplete: false, marketDate: null as string | null };
    if (!options.enabled) return report;
    const limit = options.limit ?? 200;
    const slot = jstSlot(now());
    const reader = await pool.connect();
    let rows: { clerk_user_id: string }[];
    try {
      rows = (
        await reader.query(
          `SELECT clerk_user_id FROM resolute.notification_settings
           WHERE settings->>'deliveryHourJst'=$1 AND (settings->>'alertsEnabled'='true' OR settings->>'morningEnabled'='true')
           ORDER BY clerk_user_id LIMIT $2`,
          [String(slot.hour), limit + 1],
        )
      ).rows;
    } finally {
      reader.release();
    }
    report.incomplete = rows.length > limit;
    const job: Job =
      (options.makeJob ?? ((resolveInputs) => createNotificationOutboxJob(pool, resolveInputs, now)))(async (userId, symbols) => {
        const who = await options.recipient(userId);
        const source = await options.closes(symbols);
        report.marketDate = source.marketDate;
        return {
          locale: who.locale,
          preferencesConfigured: who.preferencesConfigured,
          recipientVerified: who.verified,
          unsubscribed: who.unsubscribed,
          // 営業日が分からないときは、日付に見えない値にして、③の判定を行わない(想像で補わない)。
          marketDate: source.marketDate ?? 'unknown',
          closes: source.closes,
        };
      });
    for (const row of rows.slice(0, limit)) {
      report.users++;
      try {
        const results = await job(row.clerk_user_id);
        if (!results.length) report.skipped++;
        for (const r of results) r.status === 'queued' ? report.queued++ : report.duplicate++;
      } catch {
        report.errors++;
      }
    }
    return report;
  };
}
