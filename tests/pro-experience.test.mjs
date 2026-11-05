import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { featureById, inLanguage, mediaUrl, nextFeature, proFeatures, readFeatures } from "../lib/research/pro-experience.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("eight features, in the owner's order, each with its own address; Tech Alerts is not one of them", () => {
  assert.deepEqual(proFeatures.map(feature => feature.name.ja), ["RIZEL'S DESK", "監視22銘柄", "テーマランキング", "銘柄比較", "財務レーダー", "スマホ通知", "連関マップ", "米国株の資産管理"]);
  assert.equal(new Set(proFeatures.map(feature => feature.id)).size, 8);
  assert.equal(proFeatures.some(feature => /ハイテク速報|厳選ニュース/.test(feature.name.ja)), false);
  assert.equal(featureById("watch-22").summary.ja, "22銘柄の動きと、決算後のまとめを確認");
});

test("the provisional text of the 22-stock page is the owner's sample; media starts empty so only text is drawn", () => {
  const feature = featureById("watch-22");
  assert.equal(feature.textBeforeImage.ja, "22銘柄の動きを、まとめて確認できます。決算が出たあとのまとめも読めます。");
  assert.equal(feature.textAfterImage.ja, "銘柄を探しにいく手間がなくなります。");
  for (const item of proFeatures) assert.deepEqual([item.videoUrl, item.imageUrl, item.thumbnailUrl], ["", "", ""], item.id);
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.match(screen, /\{feature\.videoUrl && <FeatureVideo/);
  assert.match(screen, /\{feature\.imageUrl && <figure/);
});

test("the next feature follows the list and wraps from the last to the first", () => {
  assert.equal(nextFeature("watch-22").id, "theme-ranking");
  assert.equal(nextFeature("relation-map").id, "us-portfolio");
  assert.equal(nextFeature("us-portfolio").id, "rizels-desk");
  assert.equal(nextFeature("unknown"), undefined);
});

test("English text falls back to the Japanese until it is written", () => {
  assert.equal(inLanguage({ ja: "日本語", en: "" }, "en"), "日本語");
  assert.equal(inLanguage({ ja: "日本語", en: "English" }, "en"), "English");
  assert.equal(inLanguage({ ja: "日本語", en: "English" }, "ja"), "日本語");
});

test("a video or image address is a path on the site or https; anything else counts as not set", () => {
  assert.equal(mediaUrl("/pro/a.mp4"), "/pro/a.mp4");
  assert.equal(mediaUrl("https://cdn.example.com/a.mp4"), "https://cdn.example.com/a.mp4");
  for (const bad of ["http://cdn.example.com/a.mp4", "javascript:alert(1)", "//evil.example/a.mp4", "https://user:pw@cdn.example.com/a", "", "  ", 5, null]) assert.equal(mediaUrl(bad), "", String(bad));
  const features = readFeatures({ features: [{ id: "a-1", nameJa: "A", videoUrl: "javascript:x", imageUrl: "/a.png" }, { id: "a-1", nameJa: "dup" }, { id: "Bad Id", nameJa: "B" }, { id: "no-name" }] });
  assert.deepEqual(features.map(feature => [feature.id, feature.videoUrl, feature.imageUrl]), [["a-1", "", "/a.png"]]);
});

test("the video is silent, loops, plays on a phone and has a button to stop it", () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.match(screen, /<video[^>]*\bmuted\b[^>]*\bloop\b[^>]*\bplaysInline\b[^>]*\bautoPlay\b/);
  assert.match(screen, /動画を止める/);
  assert.match(screen, /動画を再生/);
});

test("「PROではじめる」 is for people who are not PRO, goes to the plan page, and the next-feature link follows it", () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.match(screen, /const showStart = settled && plan !== "pro" && !owner && !ownerRole;/);
  assert.match(screen, /\{showStart && <Link className=\{styles\.go\} href="\/research\/account\?upgrade=1"/);
  assert.ok(screen.indexOf("PROではじめる") < screen.indexOf("次の機能"));
  assert.match(read("../app/research/pro-experience/styles.module.css"), /\.go\{[^}]*linear-gradient\(180deg,#e3c47e,#c79f4c\)/);
});

test("the FREE menu has 「PRO機能体験」 with a gold-crown PRO tag; the page opens for FREE and PRO alike", () => {
  const header = read("../app/research/site-header.tsx");
  assert.match(header, /\{!member && <div className=\{styles\.grp\}>\s*\{item\("\/research\/pro-experience", "crown"/);
  assert.match(header, /PRO機能体験/);
  assert.match(read("../app/research/pro-experience/pro-tag.tsx"), /M3 8l4\.5 4L12 5l4\.5 7L21 8l-2 11H5z/);
  const detail = read("../app/research/pro-experience/[id]/page.tsx");
  assert.doesNotMatch(detail, /getMembership|redirect|plan/);
  assert.match(detail, /generateStaticParams/);
});

test("below the list: 'そのほかのPROの違い' with the Tech Alerts difference in words only, and a compact row (owner, Nov 5)", () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  const css = read("../app/research/pro-experience/styles.module.css");
  assert.match(screen, /そのほかのPROの違い/);
  assert.match(screen, /30分遅れ・新着5件まで/);
  assert.match(screen, /リアルタイム・件数の制限なし/);
  assert.doesNotMatch(screen.slice(screen.indexOf("そのほかのPROの違い"), screen.indexOf("function FeatureVideo")), /<Link|href=/);
  assert.match(css, /\.row\{[^}]*grid-template-columns:80px[^}]*padding:9px 0/);
  assert.match(css, /\.thumb\{[^}]*width:80px;height:50px/);
  assert.match(css, /\.others::after\{[^}]*height:1px/);
  assert.match(css, /\.free\{[^}]*#6fe0b5/);
  assert.match(css, /\.pro\{[^}]*#e3c47e/);
});
