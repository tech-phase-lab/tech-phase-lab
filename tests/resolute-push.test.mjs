// RESOLUTE ③④ by phone notification (owner, Nov 17): texts, the push-first provider with its email fallback, who may turn it on,
// the 「今日のお知らせ」 page, the notification list and the copy changes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resoluteAlertPush, resoluteAlertPushBody, resoluteMorningPush, RESOLUTE_ALERT_PAGE, RESOLUTE_MORNING_PAGE } from "../lib/resolute/push-notice.ts";
import { createMonitorPushSender, pushEvent, withPushFirst } from "../lib/resolute/notification-push.ts";
import { hasResolute, pushAccessDecision, resoluteNotificationUntil, resoluteOnlyPreferences } from "../lib/research/push-resolute-access.ts";
import { latestAlertFromDigest, latestAlertView, parseLatestAlert, fetchLatestAlert } from "../lib/resolute/latest-alert.ts";
import { createLatestAlertStore } from "../lib/resolute/latest-alert-database.ts";
import { NotificationAccessDenied } from "../lib/resolute/notification-database.ts";
import { openablePushPage, cleanPushServerNotice } from "../lib/research/push-server-notice.ts";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";
import { createHandler } from "../services/resolute-api/handler.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const line = (symbol, lines, dropPct = 10.4) => ({ kind: "line_reached", symbol, date: "2026-11-17", close: 171.2, referencePrice: 191, dropPct, newLines: lines });
const rise = symbol => ({ kind: "surge_cap", symbol, date: "2026-11-17", close: 250, referencePrice: 160, risePct: 56.2 });

test("notification texts follow the owner's table, title always RESOLUTE, one line", () => {
  const cases = [
    [[line("NVDA", [10])], "NVDAが計画の下落ライン -10% に届きました", "NVDA reached the -10% level in your plan"],
    [[line("NVDA", [10]), line("AMD", [15]), line("TSM", [20])], "NVDA ほか2銘柄が計画のラインに届きました", "NVDA and 2 more reached levels in your plan"],
    [[rise("AVGO")], "AVGOが決めておいた上昇の目安に届きました", "AVGO reached the rise alert level you set"],
    [[line("NVDA", [10]), rise("AVGO")], "NVDA ほか1銘柄が計画のラインと上昇の目安に届きました", "NVDA and 1 more reached levels in your plan"],
  ];
  for (const [items, ja, en] of cases) {
    assert.equal(resoluteAlertPushBody(items, "ja"), ja);
    assert.equal(resoluteAlertPushBody(items, "en"), en);
    for (const text of [ja, en]) assert.ok(!/\n/.test(text) && text.length <= 120);
  }
  // A jump past two lines at once names the deeper one.
  assert.equal(resoluteAlertPushBody([line("NVDA", [10, 20], 21.3)], "ja"), "NVDAが計画の下落ライン -20% に届きました");
  assert.deepEqual(resoluteAlertPush([line("NVDA", [10])], "ja"), { title: "RESOLUTE", body: "NVDAが計画の下落ライン -10% に届きました", url: "/resolute/alerts/latest" });
  assert.deepEqual(resoluteMorningPush("ja"), { title: "RESOLUTE", body: "昨日のお知らせのあと、どうでしたか？", url: "/resolute/morning" });
  assert.deepEqual(resoluteMorningPush("en"), { title: "RESOLUTE", body: "How are you feeling after yesterday's alert?", url: "/resolute/morning" });
  for (const text of ["買って", "売って", "買い時", "上がります", "下がります", "buy now", "sell now", "will rise", "will fall"]) {
    assert.ok(!JSON.stringify(cases).includes(text), text);
  }
});

function mailProvider(log) {
  return { name: "resend", send: async (input) => { log.push(["mail", input.key]); return { key: input.key, messageId: "mail-1", acceptedAt: new Date().toISOString() }; },
    lookup: async (key) => { log.push(["mail-lookup", key]); return null; } };
}
const input = { key: "user_free:2026-11-18:alerts", to: "a@example.test", mail: { subject: "s", text: "t" }, push: resoluteAlertPush([line("NVDA", [10])], "ja") };

test("email goes only when no device accepted the notice", async () => {
  const signal = AbortSignal.timeout(15000);
  for (const [result, mail] of [[{ devices: 1, accepted: 1, failed: 0 }, false], [{ devices: 2, accepted: 1, failed: 1 }, false],
    [{ devices: 0, accepted: 0, failed: 0 }, true], [{ devices: 2, accepted: 0, failed: 2 }, true], [new Error("monitor down"), true]]) {
    const log = [];
    const push = { send: async () => { if (result instanceof Error) throw result; return result; }, lookup: async () => ({ devices: 0, accepted: 0, failed: 0 }) };
    const receipt = await withPushFirst(mailProvider(log), push, "user_free").send(input, signal);
    assert.equal(log.length, mail ? 1 : 0, JSON.stringify(result));
    assert.match(receipt.messageId, mail ? /^mail-1$/ : /^web-push:\d+$/);
    assert.equal(receipt.key, input.key);
  }
  // Without the push configuration, or a notice without push words: email exactly as before.
  const log = [];
  await withPushFirst(mailProvider(log), undefined, "user_free").send(input, signal);
  await withPushFirst(mailProvider(log), { send: async () => assert.fail("no push words"), lookup: async () => assert.fail() }, "user_free").send({ ...input, push: undefined }, signal);
  assert.equal(log.length, 2);
});

test("reconciliation finds an earlier phone acceptance before asking the mail service", async () => {
  const log = [];
  const provider = withPushFirst(mailProvider(log), { send: async () => assert.fail(), lookup: async () => ({ devices: 1, accepted: 1, failed: 0 }) }, "user_free");
  assert.equal((await provider.lookup(input.key, AbortSignal.timeout(1000))).messageId, "web-push:1");
  assert.equal(log.length, 0);
  assert.equal(provider.name, "resend", "same provider name: the outbox reservation and the mail worker are unchanged");
});

test("the monitor request carries the member, a hash of the key, the words and the page; never the key or the email", async () => {
  assert.equal(createMonitorPushSender({ url: undefined, token: undefined }), undefined);
  assert.throws(() => createMonitorPushSender({ url: "http://monitor.example.test", token: "t".repeat(40) }));
  assert.throws(() => createMonitorPushSender({ url: "https://monitor.example.test", token: "short" }));
  let seen;
  const sender = createMonitorPushSender({ url: "https://monitor.example.test", token: "t".repeat(40), request: async (url, init) => {
    seen = { url: String(url), init }; return Response.json({ ok: true, devices: 1, accepted: 1, failed: 0 });
  } });
  assert.deepEqual(await sender.send({ userId: "user_free", key: input.key, notice: input.push }, AbortSignal.timeout(1000)), { devices: 1, accepted: 1, failed: 0 });
  assert.equal(seen.url, "https://monitor.example.test/internal/resolute/push");
  assert.equal(seen.init.headers.Authorization, "Bearer " + "t".repeat(40));
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body, { memberId: "user_free", event: pushEvent(input.key), title: "RESOLUTE", body: input.push.body, url: "/resolute/alerts/latest" });
  assert.match(body.event, /^[a-f0-9]{32}$/);
  assert.ok(!seen.init.body.includes(input.key) && !seen.init.body.includes("@"));
  const bad = createMonitorPushSender({ url: "https://monitor.example.test", token: "t".repeat(40), request: async () => Response.json({ ok: true, accepted: "1" }) });
  await assert.rejects(() => bad.send({ userId: "user_free", key: input.key, notice: input.push }, AbortSignal.timeout(1000)));
});

const snapshot = (receive, expiresAt = "2027-11-17T00:00:00.000Z") => async () => ({ canReceiveNotifications: receive, alerts: { status: receive ? "active" : "missing", expiresAt: receive ? expiresAt : null } });
test("eligibility: FREE+RESOLUTE gets RESOLUTE only, PRO without RESOLUTE gets none of it, owners get both everywhere", async () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const freeResolute = { pro: false, resoluteUntil: await resoluteNotificationUntil("user_free", snapshot(true), now) };
  assert.equal(freeResolute.resoluteUntil, Date.parse("2027-11-17T00:00:00Z") / 1000);
  assert.equal(pushAccessDecision(freeResolute, now), "allowed");
  assert.ok(hasResolute(freeResolute, now));
  const proOnly = { pro: true, resoluteUntil: await resoluteNotificationUntil("user_pro", snapshot(false), now) };
  assert.equal(proOnly.resoluteUntil, 0);
  assert.equal(pushAccessDecision(proOnly, now), "allowed");
  assert.ok(!hasResolute(proOnly, now));
  const free = { pro: false, resoluteUntil: await resoluteNotificationUntil("user_free", snapshot(false), now) };
  assert.equal(pushAccessDecision(free, now), "pro-required");
  // RESOLUTE could not be asked: no guess either way.
  const down = { pro: false, resoluteUntil: await resoluteNotificationUntil("user_free", async () => { throw Error("down"); }, now) };
  assert.equal(down.resoluteUntil, undefined);
  assert.equal(pushAccessDecision(down, now), "unavailable");
  const slow = await resoluteNotificationUntil("user_free", () => new Promise(() => {}), now, 10);
  assert.equal(slow, undefined);
  for (const owner of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) {
    const until = await resoluteNotificationUntil(owner, async () => assert.fail("owners are not asked"), now);
    assert.ok(until * 1000 > now);
    assert.equal(pushAccessDecision({ pro: false, resoluteUntil: until }, now), "allowed");
  }
  assert.ok(resoluteOnlyPreferences({ resolute: false }));
  assert.ok(!resoluteOnlyPreferences({ resolute: true, targets: true }));
  assert.ok(!resoluteOnlyPreferences(null));
});

test("the notifications route decides on the server and passes RESOLUTE rights to the monitor", () => {
  const route = read("../app/api/research/notifications/route.ts");
  assert.match(route, /getResoluteEntitlementsForSession\(token\)/);
  assert.match(route, /resoluteUntil: access\.resoluteUntil/);
  assert.match(route, /pro: access\.pro, resolute: hasResolute\(access\)/);
  assert.match(route, /!access\.pro && body\.preferences !== undefined && !resoluteOnlyPreferences\(body\.preferences\)/);
  assert.ok(!/body\.resoluteUntil|body\.resolute\b/.test(route), "never taken from the browser");
});

test("the notifications page shows the RESOLUTE row to buyers only, and only that row without PRO", () => {
  const view = read("../app/research/notification-page-view.tsx");
  assert.match(view, /\{resolute && <div[^]*?RESOLUTE（暴落アラート）/);
  assert.match(view, /"RESOLUTE \(crash alerts\)"/);
  assert.match(view, /prefs\.resolute \?\? true/, "starts on");
  assert.match(view, /\{pro && <><div className=\{on \? "" : styles\.rowsOff\}>\s*<p className=\{styles\.section\}>\{t\("銘柄", "STOCKS"\)\}/);
  assert.match(view, /\{pro && <ul className=\{`\$\{styles\.moreList\}/);
  const settings = read("../app/research/notification-settings.tsx");
  assert.match(settings, /setAccess\(\{ pro: config\.pro !== false, resolute: config\.resolute === true \}\)/);
  assert.match(settings, /resoluteScope \? t\("この端末で受け取る", "Get them on this device"\)/);
  const screen = read("../app/resolute/notifications-screen.tsx");
  assert.match(screen, /<DeviceNotifications lang=\{locale\} scope="resolute" initiallyOpen\/>/);
  assert.equal((screen.match(/スマホ通知をオンにしていない場合はメールで届きます/g) ?? []).length, 1, "the note, once");
});

const alert = { date: "2026-11-17", items: [line("NVDA", [10]), { ...line("AMD", [15], 15.2), close: 121.8 }] };
test("「今日のお知らせ」 shows the alert email's content, JA and EN, as in screens 02_alert_page_*", () => {
  const parsed = latestAlertFromDigest(alert);
  const ja = latestAlertView(parsed, "ja");
  assert.equal(ja.title, "今日のお知らせ");
  assert.equal(ja.date, "11月17日(米国市場)の終値");
  assert.deepEqual(ja.notes, ["あなたの計画では 下落のラインは決めておいたルールを見直す合図です"]);
  assert.deepEqual(ja.cards.map(c => [c.symbol, c.chip, c.text]), [["NVDA", "-10%", "終値 $171.20(基準から -10.4%)"], ["AMD", "-15%", "終値 $121.80(基準から -15.2%)"]]);
  assert.equal(ja.check, "計画に書いた買い増し額と買わない条件を確認してください");
  // The disclaimer is the lawyer-reviewed sentence (owner pack, Nov 17, section 6), from lib/legal/disclaimer.ts.
  assert.deepEqual([ja.openPlan, ja.tonight, ja.disclaimer], ["計画を開く", "今夜のひと息", "本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。"]);
  const en = latestAlertView(parsed, "en");
  assert.equal(en.title, "Today's alert");
  assert.equal(en.date, "Closing prices on Nov 17 (US market)");
  assert.deepEqual(en.notes, ["In your plan, a drop to this level is your cue to pause and reread the rules you wrote for yourself."]);
  assert.equal(en.cards[0].text, "Closed at $171.20, down 10.4% from your reference price");
  assert.equal(en.check, "Check your planned purchase amounts and conditions for not buying.");
  assert.deepEqual([en.openPlan, en.tonight, en.disclaimer], ["Open your plan", "A moment to breathe", "The Service and the Product are intended to provide information and to help you manage rules you set for yourself. They do not recommend buying or selling any particular security or the timing of trades. Please make your own investment decisions."]);
  const mixed = latestAlertView(latestAlertFromDigest({ date: "2026-11-17", items: [line("NVDA", [10]), rise("AVGO")] }), "ja");
  assert.equal(mixed.notes.length, 2);
  assert.match(mixed.check, /上昇時は1銘柄の上限も確認できます$/);
  // Only known fields reach the page.
  assert.equal(latestAlertFromDigest({ date: "2026-11-17", items: [{ ...line("NVDA", [10]), answers: "secret" }] }).items[0].answers, undefined);
  assert.equal(latestAlertFromDigest({ date: "bad", items: [] }), null);
  assert.throws(() => parseLatestAlert({ alert: null, extra: 1 }));
  const page = read("../app/resolute/alerts/latest/screen.tsx");
  for (const href of ['href="/resolute/notebook"', 'href="/resolute/tonight"']) assert.ok(page.includes(href), href);
});

test("the latest alert is the member's own newest delivered one, with the use right (owner always)", async () => {
  const calls = [];
  const pool = rights => ({ query: async (sql, args) => { calls.push([sql, args]);
    if (sql.includes("resolute.entitlements")) return { rows: rights ? [{}] : [], rowCount: rights ? 1 : 0 };
    return { rows: [{ digest: alert }] }; } });
  const read1 = await createLatestAlertStore(pool(true), "legacy")("user_free");
  assert.equal(read1.alert.items[0].symbol, "NVDA");
  const last = calls.at(-1)[0];
  assert.match(last, /clerk_user_id=\$1 AND kind='alerts' AND accepted_at IS NOT NULL/);
  assert.deepEqual(calls.at(-1)[1], ["user_free"]);
  await assert.rejects(() => createLatestAlertStore(pool(false), "legacy")("user_other"), NotificationAccessDenied);
  const handler = createHandler({}, async () => {}, async () => "user_free", undefined, undefined, undefined, undefined, undefined, undefined,
    async id => ({ alert: id === "user_free" ? latestAlertFromDigest(alert) : null }));
  const response = await handler(new Request("https://service/internal/v1/latest-alert"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).alert.items.length, 2);
  assert.equal((await handler(new Request("https://service/internal/v1/latest-alert", { method: "POST" }))).status, 405);
  const denied = createHandler({}, async () => {}, async () => "user_free", undefined, undefined, undefined, undefined, undefined, undefined, async () => { throw new NotificationAccessDenied(); });
  assert.equal((await denied(new Request("https://service/internal/v1/latest-alert"))).status, 403);
  const off = createHandler({}, async () => {}, async () => "user_free");
  assert.equal((await off(new Request("https://service/internal/v1/latest-alert"))).status, 503);
  const fetched = await fetchLatestAlert("jwt", "https://resolute.up.railway.app", "s".repeat(43), async (url, init) => {
    assert.equal(String(url), "https://resolute.up.railway.app/internal/v1/latest-alert");
    assert.equal(init.headers["X-Resolute-Service-Token"], "s".repeat(43));
    return Response.json({ alert: null });
  });
  assert.deepEqual(fetched, { status: 200, body: { alert: null } });
});

test("both pages are on the service worker's list and the iOS recent-notice fallback opens them", () => {
  const targets = JSON.parse(read("../lib/research/push-targets.json"));
  for (const page of [RESOLUTE_ALERT_PAGE, RESOLUTE_MORNING_PAGE]) {
    assert.ok(targets.openable.includes(page), page);
    assert.equal(openablePushPage(page), page);
    const notice = cleanPushServerNotice({ id: "a".repeat(32), kind: "resolute-alert", page, title: "RESOLUTE", sentAt: 1, ageMs: 10, state: "new" });
    assert.equal(notice.page, page);
  }
  assert.equal(openablePushPage("/resolute/alerts/latest?x=1"), null);
  assert.equal(openablePushPage("/resolute/home"), null);
  const sw = read("../public/research-sw.js");
  assert.match(sw, /"\/resolute\/alerts\/latest", "\/resolute\/morning"/);
  assert.match(sw, /url\.pathname\.startsWith\("\/resolute"\)/);
  for (const page of ["../app/resolute/alerts/latest/page.tsx", "../app/resolute/morning/page.tsx"]) assert.ok(read(page));
});

test("copy: phone notification wording across RESOLUTE screens, LP, diagnosis and legal pages (owner-approved)", () => {
  const files = {
    alerts: read("../app/resolute/notifications-screen.tsx"), tonight: read("../app/resolute/tonight/screen.tsx"),
    lp: read("../app/resolute/lp/landing.tsx"), lpEn: read("../app/resolute/lp/landing-en.tsx"), sample: read("../app/resolute/lp/alert-sample.tsx"),
    diagnosis: read("../lib/resolute/diagnosis.ts"), diagnosisEn: read("../lib/resolute/diagnosis-copy.ts"),
    privacy: read("../content/legal/privacy.ja.md"), privacyEn: read("../content/legal/privacy.en.md"), terms: read("../content/legal/terms.ja.md"), termsEn: read("../content/legal/terms.en.md"),
  };
  const gone = ["メールでお知らせ", "届くメールの例", "メールの内容はもう読みましたね。", "このメールは、昨日のお知らせ", "メール配信は準備中", "メールが届くので",
    "通知メールの送信", "通知機能のメールは", "An email when the closing price", "See an example email", "Example email", "an email prompts you",
    "Email alerts based on", "you get an email at your chosen", "One short email the morning", "alerts email you", "Sending notification emails", "Emails for the Notification"];
  for (const phrase of gone) for (const [name, text] of Object.entries(files)) assert.ok(!text.includes(phrase), `${name}: ${phrase}`);
  const present = [[files.alerts, "ラインに届いた日に、スマホ通知でお知らせ"], [files.alerts, "Get a phone notification on the day a line is hit"],
    [files.alerts, "届く通知の例を見る"], [files.alerts, "届く通知の例"], [files.tonight, "お知らせの内容はもう読みましたね。"], [files.tonight, "You’ve read the alert. Now take a breath."],
    [files.lp, "選んだ朝の時間にスマホ通知でお知らせします。"], [files.diagnosis, "スマホ通知が届くので"],
    // The legal pages are the lawyer-reviewed full texts since Nov 17; their notification wording is checked here.
    [files.privacy, "ブラウザ通知(Web Push)やスマートフォンへの通知に必要な端末の識別情報"], [files.terms, "ブラウザ通知やスマートフォンへの通知などは"]];
  for (const [text, phrase] of present) assert.ok(text.includes(phrase), phrase);
  // The email itself stays as it is (fallback): templates and unsubscribe unchanged.
  assert.match(read("../lib/resolute/mail-templates.ts"), /【RESOLUTE】あなたの計画のラインに届いた銘柄があります/);
  assert.match(read("../lib/resolute/mail-templates.ts"), /配信停止:\$\{i\.unsubscribeUrl\}/);
});

test("the LP sample is the push form and the 「今日のお知らせ」 page, worded by the real functions", () => {
  const sample = read("../app/resolute/lp/alert-sample.tsx");
  assert.match(sample, /resoluteAlertPushBody\(/);
  assert.match(sample, /latestAlertView\(SAMPLE, locale\)/);
  assert.equal(resoluteAlertPushBody([line("NVDA", [10]), rise("PLTR")], "ja"), "NVDA ほか1銘柄が計画のラインと上昇の目安に届きました");
});
