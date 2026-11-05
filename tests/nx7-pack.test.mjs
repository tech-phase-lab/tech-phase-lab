import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installContext, popupKind, shouldShow, readFlag, SHOWN_KEY, CLOSED_KEY } from "../lib/research/home-install.ts";
import { THEMES, THEME_IDS, toggleTheme, readFavoriteThemes } from "../lib/research/favorite-themes.ts";
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
  assert.match(view, /aria-label="閉じる"/);
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

test("the first question: ten themes plus 'not decided', several can be picked, and only known themes are saved", () => {
  assert.equal(THEMES.length, 10);
  assert.deepEqual(THEMES.map(theme => theme.ja).slice(0, 4), ["AI半導体", "データセンター", "光通信", "メモリ"]);
  assert.deepEqual(toggleTheme([], "optical"), ["optical"]);
  assert.deepEqual(toggleTheme(["optical"], "ai-semis"), ["ai-semis", "optical"], "kept in list order");
  assert.deepEqual(toggleTheme(["optical", "memory"], "optical"), ["memory"]);
  assert.deepEqual(toggleTheme(["memory"], "unknown"), ["memory"]);
  assert.deepEqual(readFavoriteThemes(undefined), { asked: false, items: [] });
  assert.deepEqual(readFavoriteThemes({ asked: true, items: ["memory", "bogus"] }), { asked: true, items: ["memory"] });
  assert.deepEqual(readFavoriteThemes({ asked: false, items: ["memory"] }), { asked: false, items: [] });
  assert.deepEqual(profileInput({ themes: ["optical", "ai-semis"] }, false), { themes: ["ai-semis", "optical"] });
  assert.deepEqual(profileInput({ themes: [] }, false), { themes: [] });
  for (const bad of [{ themes: "memory" }, { themes: ["bogus"] }, { themes: [1] }, { themes: [...THEME_IDS, "memory"] }]) assert.throws(() => profileInput(bad, false), /invalid-input/);
});

test("the first question can be skipped with 'あとで' or 'まだ決めていない', and has no stock question", () => {
  const view = read("../app/research/first-question.tsx");
  assert.match(view, />あとで</);
  assert.match(view, /はじめる/);
  assert.match(view, /通知は、ホームの通知設定からいつでも選べます/);
  assert.match(read("../app/research/theme-tiles.tsx"), /まだ決めていない/);
  assert.doesNotMatch(view, /銘柄を選/);
  assert.match(read("../app/research/account/account-view.tsx"), /ThemesSheet/);
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
  assert.match(screen, /PROを再開する/);
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
  for (const expected of ["テーマランキング", "銘柄比較", "決算の深掘り", "PROのスマホ通知", "RIZEL'S DESK"]) assert.ok(names.includes(expected), expected);
  assert.ok(!names.some(name => /資本マップ/.test(name)), "Capital Map is FREE");
});
