import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { installContext, popupKind, shouldShow, readFlag, SHOWN_KEY, CLOSED_KEY } from "../lib/research/home-install.ts";
import { profileInput } from "../lib/account/profile.ts";
import { monthDay } from "../lib/research/month-day.ts";
import { PRO_ONLY_FEATURES } from "../lib/research/pro-features.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };

test("iPhone Safari gets the Safari popup; other iPhone browsers get the copy-address one; added apps and other devices get none", () => {
  assert.equal(installContext(SAFARI, false), "ios-safari");
  assert.equal(installContext(SAFARI, true), "none", "already on the Home Screen");
  for (const mark of ["CriOS/120.0", "FxiOS/120", "EdgiOS/120", "Line/14.0", "Instagram 300", "FBAN/FBIOS", "Twitter for iPhone", "GSA/300"])
    assert.equal(installContext(SAFARI.replace("Version/18.0", mark), false), "ios-other", mark);
  assert.equal(installContext("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile", false), "none");
  assert.equal(installContext("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", false), "none");
  assert.equal(popupKind("none", true), "android");
  assert.equal(popupKind("ios-safari", true), "ios-safari");
  assert.equal(popupKind("none", false), "none");
});

test("the popup shows once per browser; × means never again; only the notification button shows it again", () => {
  const store = memory();
  assert.equal(shouldShow("ios-safari", store), true);
  store.setItem(SHOWN_KEY, "1");
  assert.equal(shouldShow("ios-safari", store), false, "seen once");
  assert.equal(shouldShow("ios-safari", store, true), true, "the notification button forces it");
  const closed = memory(); closed.setItem(CLOSED_KEY, "1");
  assert.equal(shouldShow("ios-other", closed), false);
  assert.equal(shouldShow("none", memory(), true), false, "never on a device that cannot add it");
  assert.equal(readFlag({ getItem() { throw new Error("blocked"); } }, SHOWN_KEY), false, "blocked storage does not break");
});

test("the popup follows the design: no 'わかりました' button, × below the frame, 330px wide, steps 0.15s apart, motion off when reduced", () => {
  const view = read("../app/research/home-install-prompt.tsx");
  const css = read("../app/research/home-install-prompt.module.css");
  assert.doesNotMatch(view, /わかりました/);
  assert.match(view, /aria-label=\{ja \? "閉じる" : "Close"\}/);
  assert.match(view, /共有<\/b>ボタンをタップ/);
  assert.match(view, /アドレスをコピー/);
  assert.match(view, /Safari以外のブラウザでは追加できません/);
  assert.match(view, /Safariに貼り付けて開いてください/);
  assert.match(css, /\.box\{width:330px/);
  assert.match(css, /animation-delay:\.25s.*animation-delay:\.4s.*animation-delay:\.55s/);
  assert.match(css, /border:2\.5px solid #12203a/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(read("../app/research/layout.tsx"), /<HomeInstallPrompt \/>/);
});

test("the notification button asks for the popup again on an iPhone that has not added the app; the FAQ starts with it", () => {
  assert.match(read("../app/research/notification-page-view.tsx"), /dispatchEvent\(new Event\(SHOW_EVENT\)\)/);
  const faq = read("../app/research/faq/faq.tsx");
  assert.ok(faq.indexOf('id="add-to-home"') > 0 && faq.indexOf('id="add-to-home"') < faq.indexOf("{questions.map("), "drawn before the other questions");
});

test("the 'themes you follow' question is gone: no screen, no tiles, no saving (owner, Nov 5)", () => {
  assert.equal(existsSync(new URL("../app/research/first-question.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/research/theme-tiles.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../lib/research/favorite-themes.ts", import.meta.url)), false);
  assert.doesNotMatch(read("../app/research/layout.tsx"), /FirstQuestion/);
  assert.doesNotMatch(read("../app/research/account/account-view.tsx"), /ThemesSheet|気になるテーマ/);
  assert.doesNotMatch(read("../app/api/research/account/profile/route.ts"), /favoriteThemes|themes/);
  assert.throws(() => profileInput({ themes: ["memory"] }, false), /invalid-input/);
});

test("the cancellation page: same-size buttons, the real renewal date, only real PRO features, no reason asked, no pause link", () => {
  const screen = read("../app/research/account/cancel/screen.tsx");
  const css = read("../app/research/account/cancel/styles.module.css");
  assert.match(screen, /PROを続ける/);
  assert.match(screen, /解約する/);
  assert.match(css, /\.big\{[^}]*height:62px/);
  assert.doesNotMatch(css, /\.stop\{[^}]*(height|font-size|display:none)/, "解約する is never smaller or hidden");
  assert.match(screen, /monthDay\(contract\?\.accessExpiresAt \?\? contract\?\.nextBillingAt/);
  assert.doesNotMatch(screen, /1か月だけ休む|理由/);
  assert.match(screen, /お気に入りと通知の設定は残ります/);
  assert.match(screen, /また使いたくなったら、PayPalから申し込めます/);
  assert.doesNotMatch(screen, /そのまま再開/);
  assert.match(screen, /PROを再開する/);
  assert.match(screen, /再開すると、その日から新しく1か月分が請求されます。いまの期間の残りは延長されません。/);
  assert.match(screen, /ホームへ戻る/);
  assert.match(read("../app/research/account/account-view.tsx"), /href="\/research\/account\/cancel"/);
});

test("the day PRO ends is the real date in Japan time, and the loss list names only PRO-only features", () => {
  assert.equal(monthDay("2026-12-05T00:00:00+09:00", true), "12月5日");
  assert.equal(monthDay("2026-12-04T16:00:00Z", true), "12月5日", "16:00 UTC is already Dec 5 in Japan");
  assert.equal(monthDay("2026-12-05T00:00:00+09:00", false), "December 5");
  assert.equal(monthDay(null, true), null);
  assert.equal(monthDay("not a date", true), null);
  const names = PRO_ONLY_FEATURES.map(feature => feature.ja);
  for (const expected of ["テーマランキング", "監視22銘柄", "銘柄比較", "PROのスマホ通知", "RIZEL'S DESK"]) assert.ok(names.includes(expected), expected);
  assert.ok(!names.some(name => /資本マップ/.test(name)), "Capital Map is FREE");
  assert.ok(!names.includes("決算の深掘り"), "the earnings summaries are read inside 監視22銘柄 (owner, Nov 5)");
});

test("FOMC, ISM, GDP and retail sales have result readers wired into the monitor and the notification list; only jobless claims is skipped", () => {
  const service = read("../scripts/research/service.py");
  assert.match(service, /import indicator_results/);
  assert.match(service, /indicator_results\.run_once\(self\.db_path\)/);
  assert.match(service, /wait = min\(wait, indicator_results\.next_wait\(\)\)/);
  const sources = JSON.parse(read("../scripts/research/indicator_sources.json"));
  assert.equal(sources.notes.skipped[0].indicator, "claims");
  assert.ok(sources.fomcMeetings.includes("2026-12-09"));
  const watches = JSON.parse(read("../scripts/research/event_watches.json")).watches.map(watch => watch.id);
  for (const id of ["ism-2026-11", "ism-2026-12", "ism-2027-01", "ism-2027-02"]) assert.ok(watches.includes(id), id);
  const view = read("../app/research/notification-page-view.tsx");
  for (const key of ["fomc", "ism", "gdp", "retail"]) assert.match(view, new RegExp(`key: "${key}"[^\\n]*ready: true`));
  assert.match(view, /key: "claims"[^\n]*ready: false/);
});

test("plan cards: 財務レーダー is on the PRO card, and 厳選ニュース moved to the FREE card (owner, Nov 5)", () => {
  const cards = read("../app/research/plan-cards.tsx");
  const free = cards.slice(cards.indexOf("const free"), cards.indexOf("const pro"));
  const pro = cards.slice(cards.indexOf("const pro"), cards.indexOf("const groups"));
  assert.match(free, /厳選ニュース/);
  assert.doesNotMatch(pro, /厳選ニュース/);
  assert.match(pro, /財務レーダー.*守る力と稼ぐ力を一望/);
});
