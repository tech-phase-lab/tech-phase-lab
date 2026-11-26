/** Company-blog marketing and customer showcases are not news (owner, Nov 26: 速報 showed the GOOGL row
 * 「ジェミニ4ネオンを使って5社のビルダーが作っているものを見てみよう」, a "see what builders are making with Gemini 4 Neon" post): "see
 * what X are building with", "5 ways to use", "tips for", "how creators use", "meet the builders", "behind the scenes" and customer
 * spotlights carry no business fact. Product launches, partnerships with a named company and expansions are not matched, and a headline
 * that reports a concrete event (CONCRETE_EVENT in wire-stories.ts) is kept wherever these are used. MARKETING_SHOWCASE_EN is
 * MARKETING_SHOWCASE_EN in scripts/research/company_wire.py, which drops such headlines before translation; keep the two in step (a test
 * compares them). */
export const MARKETING_SHOWCASE_EN = new RegExp([
  String.raw`\bsee (?:what|how)\b.{0,80}\b(?:build(?:s|ing)?|built|mak(?:e|es|ing)|made|creat(?:e|es|ed|ing)|doing|us(?:e|es|ed|ing))\b`,
  String.raw`|^\s*(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:new |more |easy |simple |fun |creative |great |helpful |smart |quick )?(?:ways|tips|ideas|tricks|things you can do)\b`,
  String.raw`|\btips (?:for|to|on)\b|\btips\s*$`,
  String.raw`|\bhow (?:\d+ |these |our |real |some )?(?:[\w'’-]+ ){0,2}(?:creators|builders|developers|artists|filmmakers|students|teachers|educators|small businesses|businesses`,
  String.raw`|customers|teams|people|musicians|designers|founders|startups|nonprofits|researchers|scientists|doctors|farmers|kids|families|fans)`,
  String.raw` (?:are |is )?(?:us(?:e|es|ing)|build(?:s|ing)?|mak(?:e|es|ing)|creat(?:e|es|ing))\b`,
  String.raw`|^\s*meet (?:the |our |these )?(?:[\w'’-]+ ){0,3}(?:team|teams|people|builders|creators|developers|founders|winners|finalists|students|artists|women|engineers`,
  String.raw`|researchers|scientists|startups|class|cohort|recipients|honorees|fellows|makers)\b`,
  String.raw`|\bbehind[- ]the[- ]scenes\b|\bcustomer (?:stor(?:y|ies)|spotlights?|showcases?)\b|\b(?:builder|creator|developer|customer|partner|startup|community) spotlights?\b`,
  String.raw`|^\s*spotlight\s*[:|]|\bin their own words\b`,
  // Owner, Nov 26 (「Google Flowでインドの独立系映画製作者が大画面の物語を実現」): customer showcases built on the company's own product
  // ("X bring … to life with Google Flow", "how X uses …", "X builds … with Gemini") and brand promotions ("Holiday Magic").
  String.raw`|\bbrings? (?:[\w'’-]+ ){0,5}(?:to life|magic)\b|\bholiday magic\b`,
  String.raw`|\bhow [A-Z][\w&.'’-]*(?: [A-Z][\w&.'’-]*){0,3} (?:uses|is using|used|built|builds|is building|scaled|scales|transformed|transforms|cut|saved|boosted)\b`,
  String.raw`|\b(?:builds?|built|creates?|created|makes?|made|scales?|scaled|powers?|powered|transforms?|transformed|reimagines?|reimagined) (?:[\w'’-]+ ){1,5}with (?:Gemini|Vertex AI|Google Cloud|Google Flow|Flow|Veo|Imagen|NotebookLM|Azure(?: AI)?|Copilot|Microsoft Foundry|Amazon Bedrock|AWS|Omniverse|NVIDIA (?:AI Enterprise|Omniverse|NIM)|NIM|Llama|Meta AI|ChatGPT|Claude)\b`,
].join(""), "i");
/** The same posts as they were translated. */
export const MARKETING_SHOWCASE_JA = /を見てみよう|見てみましょう|が作っているもの|(?:\d+|[一二三四五六七八九十]+)つの(?:方法|使い方|ヒント|アイデア|活用法)|(?:使い方|活用法|活用術|ヒント)\d+選|舞台裏|のヒント(?:集)?$|活用事例|(?:で|を使って|を活用して).{0,40}(?:物語|作品|夢|ビジョン|アイデア)を(?:実現|形に)|命を吹き込|ホリデーマジック/;
