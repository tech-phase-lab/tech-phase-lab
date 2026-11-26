import { Pool } from "pg";
import { hasOwnerAccess, type OwnerAccess } from "./owner-access.ts";
import { entitlementSource, readEntitlementSnapshot, type EntitlementSource } from "./entitlement-source.ts";
import { resoluteDatabaseConfig } from "./database-config.ts";
import { NotificationAccessDenied } from "./notification-database.ts";
import { validSessionDate } from "./thermometer.ts";
import { fixedTonightQuestions, isRoughNight, TONIGHT_ANSWERS, tonightFacts, type TonightAnswer, type TonightNight,
  type TonightQuestions, type TonightRecord } from "./tonight.ts";
import type { PlanInput } from "./plan-data.ts";
import type { NotificationSettings } from "./notification-settings.ts";

/** 今夜のひと息 (owner, Nov 25): the member's own rough nights (opens of this page on ★4+ or alert days), the answer they chose in the
 * next morning note, and tonight's three questions (made by the daily member job). The member's own rows only, with the same right as the settings screen.
 *
 * POST {action:"open", night, stars, direction, index, movePct}: records tonight when it is rough, returns the record and the questions.
 * POST {action:"answer", answer}: the morning note's answer (done / skipped / unsure), kept on the newest rough night of the last four days.
 * An alert day is one with a delivered ③ alert (notification_outbox accepted) dated from the night to three days after it (JST). */
export class TonightInputError extends Error { constructor() { super("Invalid tonight input"); } }
type Db = Pick<Pool, "query">;
export type TonightDeps = {
  readPlan: (userId: string, ownerAccess?: OwnerAccess) => Promise<PlanInput | null>;
  readSettings: (userId: string, ownerAccess?: OwnerAccess) => Promise<NotificationSettings | null>;
  today?: () => string;
};
export type TonightOpen = { action: "open"; night: string; stars: number | null; direction: "down" | "up" | null; index: "nas100" | "sox"; movePct: number | null };
export type TonightAnswerInput = { action: "answer"; answer: TonightAnswer };
const jstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function parseTonightInput(raw: unknown, today = jstToday()): TonightOpen | TonightAnswerInput {
  const v = raw as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new TonightInputError();
  const keys = Object.keys(v).sort().join(",");
  if (v.action === "answer") {
    if (keys !== "action,answer" || !TONIGHT_ANSWERS.includes(v.answer as TonightAnswer)) throw new TonightInputError();
    return { action: "answer", answer: v.answer as TonightAnswer };
  }
  if (v.action !== "open" || keys !== "action,direction,index,movePct,night,stars") throw new TonightInputError();
  // The night is the US session the page shows (at most four days before today in Japan, never after it).
  if (!validSessionDate(v.night) || v.night > today || v.night < addDays(today, -4)) throw new TonightInputError();
  if (!(v.stars === null || Number.isInteger(v.stars) && (v.stars as number) >= 0 && (v.stars as number) <= 5)) throw new TonightInputError();
  if (!(v.direction === null || v.direction === "down" || v.direction === "up") || !(v.index === "nas100" || v.index === "sox")) throw new TonightInputError();
  if (!(v.movePct === null || typeof v.movePct === "number" && Number.isFinite(v.movePct) && Math.abs(v.movePct) < 100)) throw new TonightInputError();
  if ((v.direction === null) !== (v.movePct === null)) throw new TonightInputError();
  return { action: "open", night: v.night as string, stars: v.stars as number | null, direction: v.direction as "down" | "up" | null, index: v.index, movePct: v.movePct as number | null };
}
export function createTonightStore(pool: Db, source: EntitlementSource, deps: TonightDeps) {
  return async (userId: string, input: TonightOpen | TonightAnswerInput, ownerAccess?: OwnerAccess) => {
    if (!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw new Error("Invalid identity");
    // The owner accounts always have every feature (owner, Nov 13); everyone else needs the RESOLUTE use right.
    if (!hasOwnerAccess(ownerAccess, userId)) {
      const allowed = source === "live" ? (await readEntitlementSnapshot(pool, userId, source)).view.canUseTools
        : (await pool.query(`SELECT 1 FROM resolute.entitlements WHERE clerk_user_id=$1 AND product_id='resolute_v1' AND kind='use'
           AND revoked_at IS NULL AND starts_at<=statement_timestamp() AND expires_at IS NULL`, [userId])).rowCount === 1;
      if (!allowed) throw new NotificationAccessDenied();
    }
    const today = deps.today?.() ?? jstToday();
    if (input.action === "answer") {
      const updated = await pool.query(`UPDATE resolute.tonight_nights SET answer=$2, answered_at=statement_timestamp()
        WHERE clerk_user_id=$1 AND night_date=(SELECT max(night_date) FROM resolute.tonight_nights WHERE clerk_user_id=$1
          AND night_date>=$3::date - 4 AND opened_at<statement_timestamp()) RETURNING night_date`, [userId, input.answer, today]);
      return { recorded: updated.rowCount === 1 };
    }
    const alert = (await pool.query(`SELECT 1 FROM resolute.notification_outbox WHERE clerk_user_id=$1 AND kind='alerts'
      AND accepted_at IS NOT NULL AND delivery_date_jst BETWEEN $2::date AND $2::date + 3 LIMIT 1`, [userId, input.night])).rowCount === 1;
    if (isRoughNight(input.stars, alert)) await pool.query(`INSERT INTO resolute.tonight_nights(clerk_user_id,night_date,stars,alert)
      VALUES($1,$2,$3,$4) ON CONFLICT(clerk_user_id,night_date) DO UPDATE SET stars=GREATEST(resolute.tonight_nights.stars,EXCLUDED.stars),
      alert=resolute.tonight_nights.alert OR EXCLUDED.alert`, [userId, input.night, input.stars, alert]);
    const counts = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE night_date=$2)::int AS tonight,
      count(*) FILTER (WHERE night_date<$2 AND answer IN ('done','skipped'))::int AS calm FROM resolute.tonight_nights WHERE clerk_user_id=$1`, [userId, input.night])).rows[0];
    const nights = (await pool.query(`SELECT to_char(night_date,'YYYY-MM-DD') AS night, stars, alert, answer FROM resolute.tonight_nights
      WHERE clerk_user_id=$1 AND night_date<$2 ORDER BY night_date DESC LIMIT 3`, [userId, input.night])).rows as TonightNight[];
    const record: TonightRecord = { total: counts.total, tonight: counts.tonight === 1, pastCalm: counts.calm,
      nights: nights.map(n => ({ night: n.night, stars: n.stars ?? null, alert: !!n.alert, answer: TONIGHT_ANSWERS.includes(n.answer as TonightAnswer) ? n.answer : null })) };
    return { record, questions: input.direction === null ? null : await questions(userId, input, ownerAccess) };
  };
  async function questions(userId: string, input: TonightOpen, ownerAccess?: OwnerAccess): Promise<TonightQuestions | null> {
    const [plan, settings] = await Promise.all([deps.readPlan(userId, ownerAccess).catch(() => null), deps.readSettings(userId, ownerAccess).catch(() => null)]);
    const facts = tonightFacts({ direction: input.direction!, index: input.index, movePct: input.movePct!, plan, settings });
    const fixed = fixedTonightQuestions(input.night, facts);
    // The AI's questions are made by the daily member job (today-plan-job.mjs → tonight-questions.mjs); this only reads them.
    const stored = (await pool.query(`SELECT state, questions FROM resolute.tonight_questions WHERE clerk_user_id=$1 AND night_date=$2`, [userId, input.night])).rows[0];
    return stored?.state === "ready" && stored.questions ? stored.questions as TonightQuestions : fixed;
  }
}
let store: ReturnType<typeof createTonightStore> | undefined;
/** Same switch, database and scoped role as the notification settings (RESOLUTE_NOTIFICATION_API_ENABLED, RESOLUTE_NOTIFICATION_DB_URL);
 * the role needs the grants in db/resolute/027_tonight.sql. Off unless RESOLUTE_TONIGHT_API_ENABLED=true. */
export async function operateTonight(userId: string, input: TonightOpen | TonightAnswerInput, ownerAccess: OwnerAccess | undefined, deps: TonightDeps) {
  if (process.env.RESOLUTE_TONIGHT_API_ENABLED !== "true" || process.env.RESOLUTE_NOTIFICATION_API_ENABLED !== "true") throw new Error("Tonight API not enabled");
  if (!store) {
    const config = resoluteDatabaseConfig(process.env.RESOLUTE_NOTIFICATION_DB_URL);
    if (new URL(config.connectionString).username !== "resolute_notification_writer") throw new Error("Scoped writer required");
    const pool = new Pool(config); pool.on("error", () => {}); store = createTonightStore(pool, entitlementSource(), deps);
  }
  return store(userId, input, ownerAccess);
}
