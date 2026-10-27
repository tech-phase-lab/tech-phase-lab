import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { FIRST_VISIT_KEY, entryDecision, ownedGuardScript, signedInFromCookies } from "../lib/resolute/landing-gate.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const lp = ["landing.tsx", "alert-sample.tsx", "book.tsx"].map(file => read(`../app/resolute/lp/${file}`)).join("\n");
const css = read("../app/resolute/lp/lp.module.css");
const state = (owned, anon = false) => JSON.stringify({ owned, anon, at: Date.now() });

test("the landing copy is the owner's wording, unchanged", () => {
  const phrases = [
    "レゾリュート ｜ リゼル", "暴落の夜も", "急騰の夜も", "自分のルールを守る", "相場が荒れた日に立ち戻る場所を", "あなたのスマホに置いておくキットです。",
    "米商務省がAI半導体の対中規制を拡大へ", "発売記念価格 ・ 2027年2月末まで", "¥9,800", "¥7,980", "税込", "RESOLUTEを手に入れる", "ログインなしでも購入できます",
    "相場には判断を誤りやすい", "夜が2つあります。", "CRASH", "SURGE", "含み損が気になって眠れない。SNSを何度も開いては不安が大きくなる。気づけば朝まで売るかどうか迷っている。",
    "上がり続ける株を見て、もっと入れておけばと焦る。根拠より勢いで買い増したくなる。決めていた上限をつい忘れてしまう。", "判断を狂わせるのは", "その瞬間の感情",
    "どんな相場でも", "冷静に立ち回れる自分へ。", "RESOLUTEは相場が荒れる日でも冷静に立ち回るためのキットです。30問の診断で自分だけのルールを作り、壁紙と一冊の本にしていつも手元に置いておく。決めたラインに株価が届けばアラートが知らせてくれるので、感情で売り買いする前に立ち止まれます。",
    "暴落が来ても", "もう慌てない。", "30問の診断であなたのルールができあがる", "壁紙と一冊にして毎日目に入る場所へ", "相場が大きく動いた日はアラートが届く", "暴落の夜も急騰の夜もルールへ戻る",
    "の機能を", "ひとつのキットに。", "Q 7 / 30", "持っている株が1か月で20%下がりました。あなたはどうしますか?", "決めていた分だけ買い増す", "一部を売って様子を見る",
    "ボタンを押すだけの30問。終わるとあなた専用の投資ルールができあがります。", "下落した場合も上昇した場合も、資産がどう動くかを先に試せます。",
    "急騰で利益を確定する前に、手取りがいくらになるかが分かります。NISAと特定口座の違いや損失の繰り越しまで計算します。",
    "9:41", "許容できる下落", "資産の10%", "−10%までは何もしない", "ロック画面を開くたびに自分のルールが目に入ります。", "自分の写真も使えます", "あなたのルールをロック画面の壁紙にして持ち歩けます。",
    "診断の答えから、あなただけの一冊ができます", "診断で決めたルールを一冊にまとめました。迷った日に読み返す場所です。",
    "RESOLUTE ・ 終値アラート", "計画のラインに届いた銘柄があります", "NVDA −10.2% ・ PLTR +41.5%", "タップして詳細を見る", "閉じる",
    "【RESOLUTE】あなたの計画のラインと上昇の目安に届いた銘柄があります", "1月14日(米国市場)の終値を、あなたの計画と照らしました。", "終値 $118.40(基準から −10.2%)", "新しく届いたライン −10%",
    "終値 $96.10(基準から +41.5%)", "決めておいた上昇の目安に届きました", "下落のラインは立ち止まってルールを見直す合図。上昇の目安は持ち分の偏りを確かめる合図です。",
    "やや熱い", "NASDAQ100", "冷えている", "熱い", "自分で決めたラインに到達すると、選んだ朝の時間にメールでお知らせします。画面を見張る必要はありません。",
    "アラートが届いた翌朝に1通だけ。ひと晩おいた頭で読み返せます。", "いまの相場が冷えているか熱いかを5段階で表示します。急騰で浮かれそうな日にも役立ちます。",
    "すべて見る →", "米商務省がAI半導体の対中輸出規制を拡大する方針を発表", "大手クラウド企業がデータセンター投資の計画を下方修正", "今夜のひと息", "リゼルから", "1:40",
    "リゼルの短い動画と、あなたが決めた「やらないこと」を1画面に。今夜は決めなくていいと思い出せます。", "その日の市場を揺るがすニュースを選び、危険度を★5段階で整理します。大きなニュースがない日は公開しません。",
    "ニュースごとに、リゼル本人の見方をひと言添えて届けます。", "次に相場が荒れる夜のために", "いまルールを持っておく",
    "RESOLUTE 制作者", "暴落相場で不安になるのも急騰相場で浮かれるのも、誰にでもあることです。そのとき慌てずにいられるかは、静かな日に自分だけのルールを決めておいたかどうかで決まります。",
    "RESOLUTEは、私が相場と向き合うなかで大切にしてきた考え方を誰でも使える形にしたキットです。売買のタイミングを教えるものではありません。相場が急変しても冷静に立ち回れるように、ひとつひとつ魂を込めて作りました。",
    "もう暴落は怖くない。", "相場が荒れたら、RESOLUTEを思い出してください。",
    "終値アラート・翌朝のひとこと・危険度チェッカー・リゼルの一言は購入から1年間で、2年目以降は更新する形です。それ以外の機能は一度の購入でずっと使えます。",
    "5,980円です。Tech Phase PROの会員なら3,980円で更新できます。", "使えます。FREE会員の方でも、RESOLUTEを購入すればすべての機能を使えます。",
    "買えます。購入のあとにメールで案内が届くので、そこから受け取りの手続きをしてください。", "デジタル商品のため、購入後の返金はお受けしていません。内容をご確認のうえお申し込みください。",
    "特定商取引法に基づく表記", "利用規約", "プライバシー", "RESOLUTEは情報の提供であり、投資助言ではありません。", "画面はイメージです。",
    "THE PERSONAL EDITION", "相場に揺れない 私のルール", "自分の答えからつくる", "迷った日に立ち戻る一冊", "自分との約束", "MY RULES",
    "私が守りたい投資", "情報に背中を押されたら", "暮らしを相場に預けない", "下落した日に開くページ", "迷ったら この一冊に戻る",
  ];
  for (const phrase of phrases) assert.ok(lp.includes(phrase), `missing: ${phrase}`);
});

test("the alert sample shows the 7:00 morning notification", () => {
  assert.match(lp, /<time>7:00<\/time>/);
  assert.ok(!lp.includes("6:02"));
});

test("no wording that promises results", () => {
  for (const banned of ["負けない", "必ず", "絶対", "保証", "確実に", "リアルタイム"]) assert.ok(!lp.includes(banned), banned);
});

test("buying goes to the checkout and the page needs no sign-in", () => {
  assert.match(lp, /CHECKOUT = "\/resolute\/checkout"/);
  const page = read("../app/resolute/lp/page.tsx");
  assert.ok(!/clerk|auth\(/i.test(page) && !/clerk/i.test(lp));
});

test("the entry shows the landing page only when the device is sure the visitor has not bought", () => {
  assert.equal(entryDecision(state(true), false), "home");
  assert.equal(entryDecision(null, false), "landing");
  assert.equal(entryDecision(state(false, true), false), "landing");
  assert.equal(entryDecision(state(false), true), "landing");
  assert.equal(entryDecision(state(true), true), "home");
  // Signed in with nothing or only a signed-out answer remembered: wait, never guess.
  assert.equal(entryDecision(null, true), "unknown");
  assert.equal(entryDecision(state(false, true), true), "unknown");
  // Not known yet (server render): plain page.
  assert.equal(entryDecision(state(false), null), "unknown");
  assert.equal(entryDecision("{broken", true), "unknown");
});

test("sign-in is read from the Clerk cookie", () => {
  assert.equal(signedInFromCookies("a=1; __client_uat=1730000000"), true);
  assert.equal(signedInFromCookies("__client_uat_abc123=1730000000; b=2"), true);
  assert.equal(signedInFromCookies("__client_uat=0"), false);
  assert.equal(signedInFromCookies("a=1"), false);
});

test("the guard hides the landing page before paint on a device that remembers a purchase", () => {
  const run = stored => {
    const attributes = {};
    const sandbox = { localStorage: { getItem: () => stored }, document: { documentElement: { setAttribute: (k, v) => { attributes[k] = v; } } } };
    vm.runInNewContext(ownedGuardScript("tech-phase:resolute-bar-state:v1"), sandbox);
    return attributes;
  };
  assert.deepEqual(run(state(true)), { "data-resolute-owned": "1" });
  assert.deepEqual(run(state(false)), {});
  assert.deepEqual(run(null), {});
  assert.deepEqual(run("{broken"), {});
  assert.match(css, /html\[data-resolute-owned\]\) \.root \{ display:none; \}/);
});

test("the entry page routes through the gate and the quiz comes first, once", () => {
  const entry = read("../app/resolute/page.tsx");
  assert.match(entry, /<EntryGate landing=\{<Landing embedded \/>\}>/);
  const gate = read("../app/resolute/entry-gate.tsx");
  assert.match(gate, /router\.replace\("\/resolute\/diagnosis"\)/);
  assert.match(gate, /FIRST_VISIT_KEY/);
  assert.equal(FIRST_VISIT_KEY, "tech-phase:resolute-first-visit-done");
});

test("the book respects reduced motion and starts only when it scrolls into view", () => {
  assert.match(css, /prefers-reduced-motion:reduce\) \{ \.bookPlay, \.bookPlay \.leaf \{ animation:none !important; \} \}/);
  const book = read("../app/resolute/lp/book.tsx");
  assert.match(book, /IntersectionObserver/);
  assert.match(book, /prefers-reduced-motion: reduce/);
  assert.match(css, /backface-visibility:hidden/);
});
