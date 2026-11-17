import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { featureById, inLanguage, mediaUrl, nextFeature, proFeatures, readFeatures, videoFor } from "../lib/research/pro-experience.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("eight features, in the owner's order, each with its own address; Tech Alerts is not one of them", () => {
  // Nov 16 (owner's mockup 01-list): a new order; names unchanged.
  assert.deepEqual(proFeatures.map(feature => feature.name.ja), ["連関マップ", "テーマランキング", "銘柄比較", "監視22銘柄", "RIZEL'S DESK", "財務レーダー", "米国株の資産管理", "スマホ通知"]);
  assert.equal(new Set(proFeatures.map(feature => feature.id)).size, 8);
  assert.equal(proFeatures.some(feature => /ハイテク速報|厳選ニュース/.test(feature.name.ja)), false);
  assert.equal(featureById("watch-22").summary.ja, "22銘柄の動きと、決算後のまとめを確認");
});

test("the provisional text of the 22-stock page is the owner's sample; media starts empty so only text is drawn", () => {
  const feature = featureById("watch-22");
  assert.equal(feature.textBeforeImage.ja, "22銘柄の動きを、まとめて確認できます。決算が出たあとのまとめも読めます。");
  assert.equal(feature.textAfterImage.ja, "銘柄を探しにいく手間がなくなります。");
  // Nov 17: only phone notifications has a video (its own test below); images and thumbnails stay empty.
  for (const item of proFeatures) assert.deepEqual([item.id === "phone-alerts" ? "" : item.videoUrl, item.imageUrl, item.thumbnailUrl], ["", "", ""], item.id);
  const screen = read("../app/research/pro-experience/screen.tsx");
  // Nov 16: a feature with a fixed sample shows it instead; the others keep the video when one is set.
  assert.match(screen, /: feature\.videoUrl && <FeatureVideo/);
  assert.match(screen, /\{feature\.imageUrl && <figure/);
});

test("the next feature follows the list and wraps from the last to the first", () => {
  assert.equal(nextFeature("watch-22").id, "rizels-desk");
  assert.equal(nextFeature("relation-map").id, "theme-ranking");
  assert.equal(nextFeature("phone-alerts").id, "relation-map");
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

test("phone notifications carry the owner's two videos: Japanese 0:30, English 0:36, each with a first-frame poster (Nov 17)", () => {
  const raw = JSON.parse(read("../lib/research/pro-experience.json")).features.find(item => item.id === "phone-alerts");
  assert.deepEqual([raw.videoUrl, raw.videoLabel, raw.videoUrlEn, raw.videoLabelEn, raw.videoPosterUrl, raw.videoPosterUrlEn],
    ["/media/pro-experience/phone-alerts-ja.mp4", "0:30", "/media/pro-experience/phone-alerts-en.mp4", "0:36", "/media/pro-experience/phone-alerts-ja.jpg", "/media/pro-experience/phone-alerts-en.jpg"]);
  const feature = featureById("phone-alerts");
  assert.equal(feature.videoUrlEn, "/media/pro-experience/phone-alerts-en.mp4");
  assert.equal(feature.videoLabelEn, "0:36");
  // The media lives outside /research so the Clerk proxy (matcher on /research/*) never runs on it.
  const proxy = read("../proxy.ts");
  assert.doesNotMatch(proxy, /"\/media/);
});

test("the English view uses the English video; with none set it falls back to the Japanese video, label and poster", () => {
  const feature = featureById("phone-alerts");
  assert.deepEqual(videoFor(feature, "ja"), { src: "/media/pro-experience/phone-alerts-ja.mp4", label: "0:30", poster: "/media/pro-experience/phone-alerts-ja.jpg" });
  assert.deepEqual(videoFor(feature, "en"), { src: "/media/pro-experience/phone-alerts-en.mp4", label: "0:36", poster: "/media/pro-experience/phone-alerts-en.jpg" });
  const [jaOnly] = readFeatures({ features: [{ id: "only-ja", nameJa: "A", videoUrl: "/a.mp4", videoLabel: "0:10", videoPosterUrl: "/a.jpg", videoUrlEn: "", videoLabelEn: "0:12" }] });
  assert.deepEqual(videoFor(jaOnly, "en"), { src: "/a.mp4", label: "0:10", poster: "/a.jpg" });
  const [bad] = readFeatures({ features: [{ id: "bad-en", nameJa: "A", videoUrl: "/a.mp4", videoUrlEn: "javascript:x" }] });
  assert.equal(videoFor(bad, "en").src, "/a.mp4");
});

test("the video files exist under public/media, are MP4 (ftyp, moov before mdat) and the posters are JPEG", () => {
  for (const lang of ["ja", "en"]) {
    const video = readFileSync(new URL(`../public/media/pro-experience/phone-alerts-${lang}.mp4`, import.meta.url));
    assert.equal(video.subarray(4, 8).toString("latin1"), "ftyp", lang);
    const moov = video.indexOf("moov"), mdat = video.indexOf("mdat");
    assert.ok(moov > 0 && mdat > 0 && moov < mdat, `${lang}: moov before mdat so a tap starts playback without the whole file`);
    assert.ok(video.length < 2_000_000, lang);
    const poster = readFileSync(new URL(`../public/media/pro-experience/phone-alerts-${lang}.jpg`, import.meta.url));
    assert.deepEqual([...poster.subarray(0, 3)], [0xff, 0xd8, 0xff], lang);
    assert.ok(poster.length < 80_000, lang);
  }
});

test("the video does not start by itself: tap to play, inline on a phone, poster first, no cropping", () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  const tag = screen.match(/<video[^>]*\/>/)?.[0] ?? "";
  assert.ok(tag, "video tag");
  assert.doesNotMatch(tag, /autoPlay|autoplay/);
  for (const attribute of [/\bcontrols\b/, /\bplaysInline\b/, /preload="metadata"/, /poster=\{poster/, /src=\{src\}/]) assert.match(tag, attribute);
  assert.match(screen, /videoFor\(feature, lang\)/);
  const css = read("../app/research/pro-experience/styles.module.css");
  assert.match(css, /\.video\{[^}]*width:100%;height:auto;aspect-ratio:720\/1566;object-fit:contain/);
  assert.doesNotMatch(css.match(/\.video\{[^}]*\}/)[0], /max-height/);
});

test("「PROではじめる」 is for people who are not PRO, goes to the plan page, and the next-feature link follows it", () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.match(screen, /const showStart = showStartButton\(\{ settled, plan: plan \?\? null, ownerAccount: owner, ownerRole \}\);/);
  assert.match(screen, /\{showStart && <div className=\{styles\.start\}>\s*<Link className=\{styles\.go\} href="\/research\/account\?upgrade=1"/);
  assert.ok(screen.indexOf("PROではじめる") < screen.indexOf("次の機能"));
  // Nov 16 (second review): the button is gold and glowing, like the header's PRO button (owner's mockups 01/02).
  assert.match(read("../app/research/pro-experience/styles.module.css"), /\.go\{[^}]*background:linear-gradient\(135deg,#f1dca0,#d9b25f 55%,#b8893a\)/);
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
  assert.match(css, /\.row\{[^}]*grid-template-columns:56px[^}]*padding:10px 0/);
  assert.match(css, /\.thumb\{[^}]*width:56px;height:56px/);
  assert.match(css, /\.others::after\{[^}]*height:1px/);
  assert.match(css, /\.free\{[^}]*#6fe0b5/);
  assert.match(css, /\.pro\{[^}]*#e3c47e/);
});

test("the list follows the owner's mockup (Nov 16): heading like other pages without the crown tag, mini screens, 「動画で見る」 only on phone notifications", async () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  const list = screen.slice(screen.indexOf("export function ProExperienceList"), screen.indexOf("function FeatureVideo"));
  assert.match(list, /<p className=\{styles\.eyebrow\}>PRO PREVIEW<\/p>\s*<h1 className=\{styles\.listTitle\}>\{ja \? "PRO機能体験"/);
  assert.doesNotMatch(list, /<ProTag/, "no crown PRO pill beside the heading");
  assert.match(list, /PROの機能を、サンプルで実際に触って試せます。/);
  assert.match(list, /<FeatureIcon id=\{feature\.id\} \/>/);
  assert.match(list, /\{feature\.id === VIDEO_FEATURE && <span className=\{styles\.videoPill\}>\{ja \? "動画で見る"/);
  assert.match(screen, /export const VIDEO_FEATURE = "phone-alerts";/);
  assert.equal((list.match(/動画で見る/g) ?? []).length, 1);
  assert.match(list, /<span className=\{styles\.chev\} aria-hidden="true">›<\/span>/);
  assert.match(list, /href=\{`\/research\/pro-experience\/\$\{feature\.id\}`\}/);
  const icons = read("../app/research/pro-experience/feature-icons.tsx");
  for (const feature of proFeatures) assert.ok(icons.includes(`"${feature.id}": <>`) || icons.includes(`${feature.id}: <>`), `${feature.id} has a mini screen`);
  const css = read("../app/research/pro-experience/styles.module.css");
  assert.match(css, /\.eyebrow\{[^}]*font-size:11px;font-weight:600;[^}]*letter-spacing:\.16em;color:#8e9aaa/);
  assert.match(css, /\.thumb\{[^}]*border:1px solid #5c4a24;border-radius:14px;background:radial-gradient\(circle at 30% 20%,#2a2416,#0f141c 70%\);box-shadow:0 0 14px rgba\(226,194,122,\.12\)/);
  assert.match(css, /\.rowText\{[^}]*gap:3px/);
  assert.match(css, /\.name\{[^}]*font-size:16px/);
  assert.match(css, /\.videoPill\{[^}]*border:1px solid #2c3a4a;border-radius:999px;background:#1a2230;color:#aab6c4;font-size:11px;font-weight:700/);
  // Gold only inside the mini screens: the heading, lead and rows carry none.
  for (const rule of ["eyebrow", "listTitle", "lead", "row", "name", "summary", "chev", "row:focus-visible"]) {
    const body = css.match(new RegExp(`\\.${rule.replace(":", "\\:")}\\{([^}]*)\\}`))?.[1] ?? "";
    assert.doesNotMatch(body, /#e3c47e|#e2c27a|#c9a55a|#d9b56a/, rule);
  }
});
