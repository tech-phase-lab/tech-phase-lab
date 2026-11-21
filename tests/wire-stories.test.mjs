import test from 'node:test';
import assert from 'node:assert/strict';
import { wireStories, isNotNews, lawFirmSolicitation, staleResults, cleanTitle } from '../lib/research/wire-stories.ts';

const item = (id, titleEn, titleJa, publishedAt, origin = 'third-party') => ({ id, titleEn, titleJa, publisher: 'P', origin, url: `https://example.com/${id}`, publishedAt });
const WATCHED = new Set(['MU', 'SNDK', 'NVDA', 'CRWV']);

test('one story named by several companies is one row listing them all (owner, Oct 17)', () => {
  const wire = {
    MU: [item('a', 'Micron and SanDisk lead a memory chip rally as prices climb', 'マイクロンとサンディスクがメモリ株高を主導', '2026-10-17T05:33:00Z')],
    SNDK: [item('b', 'Micron and SanDisk lead a memory chip rally as prices climb', 'マイクロンとサンディスクがメモリ株高を主導', '2026-10-17T05:33:00Z')],
    NVDA: [item('c', 'Micron and SanDisk lead a memory chip rally as prices climb', 'マイクロンとサンディスクがメモリ株高を主導', '2026-10-17T05:50:00Z')],
  };
  const stories = wireStories(wire, 'ja', WATCHED);
  assert.equal(stories.length, 1);
  assert.deepEqual(stories[0].tickers, ['MU', 'NVDA', 'SNDK']);
  assert.equal(stories[0].at, '2026-10-17T05:33:00.000Z', 'the earliest posting time');
});

test('a reworded copy of the same story merges, and the company wire text wins', () => {
  const wire = {
    CRWV: [item('x', 'CoreWeave stock faces test of debt financing', 'コアウィーブ株は債務調達の試練に直面', '2026-10-17T05:18:00Z', 'wire')],
    NVDA: [item('y', 'CoreWeave stock faces a test of its debt financing', 'コアウィーブ株は負債調達の試練に直面', '2026-10-17T05:18:00Z')],
  };
  const [story, ...rest] = wireStories(wire, 'ja', WATCHED);
  assert.equal(rest.length, 0);
  assert.equal(story.title, 'コアウィーブ株は債務調達の試練に直面');
  assert.deepEqual(story.tickers, ['CRWV', 'NVDA']);
});

test('different stories, other days and unwatched companies stay apart', () => {
  const wire = {
    MU: [item('1', 'Micron raises its quarterly dividend', '配当を引き上げ', '2026-10-17T01:00:00Z'), item('2', 'Micron opens a new plant in Japan', '日本に新工場', '2026-10-17T02:00:00Z'),
         item('3', 'Micron raises its quarterly dividend', '配当を引き上げ', '2026-10-15T01:00:00Z')],
    ZZZ: [item('4', 'Unwatched company news', '対象外', '2026-10-17T03:00:00Z')],
  };
  const stories = wireStories(wire, 'ja', WATCHED);
  assert.deepEqual(stories.map(story => story.id), ['2', '1', '3']);
});

test('headlines that are not news about the company are left out', () => {
  for (const title of ['$NVIDIA (NVDA.US)$$SK hynix (SKHY.US)$ 私のお気に入りの恐竜はどこ？', 'Invesco QQQ Trust (QQQ) Sells NVIDIA and Apple on Oct. 14',
    '2 Tech Stocks to Buy Now and Hold for a Decade', 'Better AI Stock: SpaceX vs. Nvidia', "Don't miss these memory stocks", 'Lobbying Update: $110,000 of NVIDIA lobbying was just disclosed',
    'If the stock market crashes, history shows these 3 ETFs are the smartest buys',
    'If you only have $1,000 to invest, buy this one ETF and hold for 20 years',
    'Disney to pay 66 Character.AI employees $60M a year - Alphabet (NASDAQ:GOOGL)',
    'もし株式市場の暴落が来るなら、歴史が示すこれら3つのETFが最も賢い買いだ',
    'マイクロンとサンディスクを逃した？このメモリ株を見逃さないようにしよう。', 'コアウィーブ、オラクル：デフォルト懸念と買いの機会', 'CoreWeave, Oracle: Default Fears And A Buying Opportunity']) assert.equal(isNotNews(title), true, title);
  for (const title of ['Germany to unveil Nvidia AI agreement next week', 'StoneX maintains Buy rating on Microsoft, $600 price target', 'Micron raises its dividend']) assert.equal(isNotNews(title), false, title);
});

test('teaser headlines with no answer are left out', () => {
  for (const title of ['35 analysts cover SpaceX. Here\'s why their price targets have little to do with rockets', 'This is why Nvidia stock moved', 'The reason why memory prices keep rising',
    '35人のアナリストがスペースXをカバー。彼らの目標株価がロケットとはほとんど関係ない理由',
    'マイクロン・テクノロジー対サンディスク：どちらのAIメモリ株がより良い投資か？', 'Micron vs. Sandisk: Which AI Memory Stock Is the Better Buy?',
    'Why AMD, Micron, Sandisk and Nvidia stocks are falling in premarket today', 'なぜAMD、マイクロン、サンディスク、エヌビディアの株価が今日のプレマーケットで下落しているのか']) assert.equal(isNotNews(title), true, title);
});

test('Japanese headlines drop the comma after a bracket and keep a name with its ticker together', async () => {
  const { tidyJapanese } = await import('../lib/research/ja-text.ts');
  const out = tidyJapanese('アルファベット（GOOGL）、2028年までにトロントでロボタクシーサービスを計画');
  assert.ok(!out.includes('）、'));
  assert.equal(out.replaceAll('⁠', ''), 'アルファベット（GOOGL）2028年までにトロントでロボタクシーサービスを計画');
  assert.ok(out.startsWith('ア⁠ル'));
  assert.equal(tidyJapanese(out), out);
  // A long name leaves its front free to break, so no two-character stub is stranded on the first line.
  const lumentum = tidyJapanese('ルメンタム・ホールディングス（LITE）株価が急伸');
  assert.equal(lumentum.replaceAll('⁠', ''), 'ルメンタム・ホールディングス（LITE）株価が急伸');
  assert.ok(lumentum.startsWith('ルメンタム・ホール'));
  assert.equal(tidyJapanese(lumentum), lumentum);
  assert.equal(tidyJapanese('Alphabet (GOOGL), plans robotaxis'), 'Alphabet (GOOGL), plans robotaxis');
});

test('weekly digest headlines are not shown as news', () => {
  assert.equal(isNotNews('Washington bans DeepSeek, Microsoft drops UK project: This Week’s Key Developments'), true);
  assert.equal(isNotNews('ワシントン、DeepSeekを禁止：今週の主な動向'), true);
  assert.equal(isNotNews('Microsoft reports earnings this week'), false);
});

test('foreign-currency weekend price quotes are not news (owner, Oct 26)', () => {
  assert.equal(isNotNews('TSMC stock trades at 372.75 euros in weekend trading'), true);
  assert.equal(isNotNews('TSMC株は週末取引で372.75ユーロで取引される'), true);
  assert.equal(isNotNews('TSMC raises full-year revenue outlook after strong AI demand'), false);
});

test('a results headline is stale only days after the known release; other earnings news is kept', () => {
  assert.equal(staleResults('ASML', 'ASML Holding reports third-quarter results', '2026-10-25T16:48:02Z'), true); // released Oct 14
  assert.equal(staleResults('ASML', 'ASML Holding reports third-quarter results', '2026-10-14T08:00:00Z'), false); // same day
  assert.equal(staleResults('ASML', 'ASML orders surge as AI demand lifts outlook', '2026-10-25T16:48:02Z'), false); // not a results headline
  assert.equal(staleResults('ZZZZ', 'ZZZZ reports third-quarter results', '2026-10-25T16:48:02Z'), false); // no known date
});

test('teasers, foreign-currency quotes, law-firm notices are dropped; press-release labels are trimmed (owner, Oct 26)', () => {
  for (const title of ['ルメンタムがAIラック光学デモンストレーションを発表：ルメンタム株にとっての意味', 'アステラ・ラボ、Orionを発表：アステラ・ラボ株に与える影響とは', 'Lumentum unveils AI rack optics demo: what it means for LITE stock',
    'ネビウス、ライブGPU価格を拡大。ネビウス株はEUR 141.91で取引される', 'Nebius stock trades at EUR 141.91', 'Bloom Energy (BE) investigation: Bronstein, Gewirtz & Grossman urges shareholders to inquire'])
    assert.equal(isNotNews(title), true, title);
  for (const title of ['Nebius signs EUR 2 billion data center deal', 'ルメンタム、光学部品の新工場を発表', 'Lumentum raises outlook on AI demand'])
    assert.equal(isNotNews(title), false, title);
  assert.equal(cleanTitle('2026年10月25日｜ブルーム・エナジー、新契約を発表｜NYSE:BE｜プレスリリース'), 'ブルーム・エナジー、新契約を発表');
  assert.equal(cleanTitle('Bloom Energy signs deal | NYSE: BE | Press Release'), 'Bloom Energy signs deal');
  assert.equal(cleanTitle('Plain headline'), 'Plain headline');
  // A translated outlet name on the end (owner, Nov 5).
  assert.equal(cleanTitle('アリスタ・ネットワークス取締役マーク・テンプルトン、株式売却額829,255ドル 投資.com報'), 'アリスタ・ネットワークス取締役マーク・テンプルトン、株式売却額829,255ドル');
  // The outlet after a colon or dash (owner, Nov 5).
  assert.equal(cleanTitle('マイクロン、労使紛争で45億ドルの台湾工場の作業を停止：ブルームバーグ'), 'マイクロン、労使紛争で45億ドルの台湾工場の作業を停止');
  assert.equal(cleanTitle('Micron halts Taiwan fab work over labor dispute: Bloomberg'), 'Micron halts Taiwan fab work over labor dispute');
  assert.equal(cleanTitle('ブルームバーグが報じたニュースでMUが上昇'), 'ブルームバーグが報じたニュースでMUが上昇');
  assert.equal(cleanTitle('エヌビディア、新製品を発表 - 投資.com報'), 'エヌビディア、新製品を発表');
  assert.equal(cleanTitle('エヌビディア株が上昇 インベスティング.com'), 'エヌビディア株が上昇');
  assert.equal(cleanTitle('エヌビディア、増配を発表 ロイター報'), 'エヌビディア、増配を発表');
  assert.equal(cleanTitle('投資.comが新サービスを発表、エヌビディアは上昇'), '投資.comが新サービスを発表、エヌビディアは上昇', 'the name inside a headline stays');
  assert.equal(cleanTitle('米ロイター報告書、エヌビディアに言及'), '米ロイター報告書、エヌビディアに言及', 'only a name at the very end');
});

test('lead-plaintiff notices and other companies\' earnings round-ups are dropped; "(NYSE:XX)" is trimmed (owner, Oct 27)', () => {
  for (const title of ['GOOGL/GOOG 株主向け警告：2026年12月1日リード', 'Alphabet shareholder alert: lead plaintiff deadline December 1', 'AT&Tからシエナまで：2026年第3四半期の光学関連決算を追う', 'From AT&T to Ciena: tracking Q3 2026 optical earnings', 'AI銘柄の安定化でウォール街がラリー・モードに'])
    assert.equal(isNotNews(title), true, title);
  for (const title of ['Lumentum raises outlook on AI demand', 'ウォール街のアナリストがルメンタムの目標株価を引き上げ', 'Bloom Energy signs a new supply agreement'])
    assert.equal(isNotNews(title), false, title);
  assert.equal(cleanTitle('ブルーム・エナジー：リスク・リワードは改善も、依然として不安感残る (NYSE:BE)'), 'ブルーム・エナジー：リスク・リワードは改善も、依然として不安感残る');
  assert.equal(cleanTitle('Bloom Energy: risk-reward improves (NASDAQ: BE) as demand grows'), 'Bloom Energy: risk-reward improves as demand grows');
});

test('earnings previews and "what to expect" teasers are not news; the exchange code is trimmed from titles (owner, Oct 27)', () => {
  for (const title of ['アルファベット決算：GOOGLから注目すべき点', '注目の決算：Carvana（CVNA）が明日第3四半期の結果を発表', 'Frontier（ULCC）第3四半期決算：何を期待すべきか',
    'WEX決算：WEXの注目点は何か', 'マイクロソフト (MSFT) 第3四半期決算報告プレビュー：注目点', 'カーライル（CSL）が明日決算発表：予想される内容',
    'Alphabet earnings preview: what to watch', 'Carvana set to report third-quarter results tomorrow', 'Frontier Q3 earnings: What to expect']) assert.equal(isNotNews(title), true, title);
  for (const title of ['SKテレコムがSKハイニックスの工場をAI事業に転換する取り組みの内幕', 'Micron raises its dividend', 'Alphabet reports third-quarter results, cloud revenue up 34%']) assert.equal(isNotNews(title), false, title);
  assert.equal(cleanTitle('SKハイニックス（NasdaqGS:SKHY）16兆ウォンを投資'), 'SKハイニックス16兆ウォンを投資');
  assert.equal(cleanTitle('SK Hynix (NasdaqGS:SKHY) to invest 16 trillion won'), 'SK Hynix to invest 16 trillion won');
  assert.equal(cleanTitle('Bloom Energy (NYSE:BE) wins order'), 'Bloom Energy wins order');
});

test('vulnerability-database entries are not news; a trailing ": report" tag is trimmed (owner, Oct 27)', () => {
  assert.equal(isNotNews('アリスタ VeloCloud CVE-2026-114625：CVSS 9.9 [2026]'), true);
  assert.equal(isNotNews('Arista VeloCloud CVE-2026-114625: CVSS 9.9 [2026]'), true);
  assert.equal(isNotNews('Arista wins a $500M order from a hyperscaler'), false);
  assert.equal(cleanTitle('ネビウス、ネオクラウドの売却にもかかわらず資金調達を継続：レポート'), 'ネビウス、ネオクラウドの売却にもかかわらず資金調達を継続');
  assert.equal(cleanTitle('Nebius keeps raising funds despite neocloud sale: report'), 'Nebius keeps raising funds despite neocloud sale');
  assert.equal(cleanTitle('ネビウスの年次報告書'), 'ネビウスの年次報告書');
});

test('a bare SEC form notice is not news, and the wire service tag is trimmed from a headline (owner, Oct 28)', () => {
  for (const title of ['SKハイニックス株式会社のフォーム6-K：10月28日', 'SKハイニックス株式会社のフォーム 6-K：10月28日', 'GEベルノバ社のフォーム10-Q（9月30日分）',
    'SK hynix Inc. Form 6-K: October 28', 'GE Vernova Inc. Form 10-Q (September 30)', 'Form 8-K filed by Nebius']) assert.equal(isNotNews(title), true, title);
  for (const title of ['GEベルノバ株は業績上振れとガイダンス引き上げで上昇', 'Micron files its 10-Q showing record revenue', 'Nebius announces new Form factor servers', 'フォームファクターの小型化で受注拡大']) assert.equal(isNotNews(title), false, title);
  assert.equal(cleanTitle('GEベルノバ株は業績上振れとガイダンス引き上げで上昇（Investing.comより）'), 'GEベルノバ株は業績上振れとガイダンス引き上げで上昇');
  assert.equal(cleanTitle('GE Vernova stock rises on earnings beat and raised guidance (Investing.com)'), 'GE Vernova stock rises on earnings beat and raised guidance');
  assert.equal(cleanTitle('GE Vernova stock rises on earnings beat - Investing.com'), 'GE Vernova stock rises on earnings beat');
  assert.equal(cleanTitle('売上は予想を上回る（前年より）'), '売上は予想を上回る（前年より）');
});

test('the same feed, language and company set gives the same stories without grouping again', () => {
  const wire = { MU: [item('m1', 'Micron raises its dividend', 'マイクロン増配', '2026-10-17T05:33:00Z')] };
  const first = wireStories(wire, 'ja', WATCHED);
  assert.equal(wireStories(wire, 'ja', WATCHED), first);
  assert.notEqual(wireStories(wire, 'en', WATCHED), first);
  assert.notEqual(wireStories({ ...wire }, 'ja', WATCHED), first);
});

test('"how it was done" explainers are not news (owner, Oct 28)', () => {
  for (const title of ['研究者が明かす、ロジックバグのみでMicrosoft Edgeを175,000ドルのPwn2Own勝利で攻略した方法', 'AIが認知症患者5700万人のための新発見の速度を変革する方法',
    'How researchers took down Microsoft Edge with logic bugs alone', 'How AI Is Transforming the Pace of Discovery']) assert.equal(isNotNews(title), true, title);
  for (const title of ['Microsoft says Edge patch fixes the Pwn2Own bugs', 'マイクロソフト、Edgeの脆弱性を修正', 'Nebius adds capacity, and how much it costs is undisclosed']) assert.equal(isNotNews(title), false, title);
});

test('call transcripts, mover roundups, data pages, vendor bulletins and teasers are not news (owner, Oct 31)', () => {
  for (const title of [
    'WECエナジー・グループ（WEC）が第3四半期決算説明会で述べたこと', 'nVent Electric (NVT)、第3四半期決算説明会での発言内容',
    '正午に大きく動いた株式：インテル、ルメンタム、サンディスク、トゥイリオ、コインベースなど', 'アリスタ・ネットワークス社の総資産 – BSESOF:1170',
    'シマンテック脅威保護速報：9月の脅威状況レポート', 'SKハイニックスの記録的な四半期決算が投資家の唯一の疑問に答えられない',
    'What WEC Energy Group said on its third-quarter earnings call', 'Stocks making the biggest moves midday: Intel, Lumentum, SanDisk',
    'Arista Networks Total Assets – BSESOF:1170', 'Symantec Protection Bulletin: September Threat Landscape Report',
    'SK hynix record quarter fails to answer investors\' one question',
  ]) assert.equal(isNotNews(title), true, title);
  for (const title of [
    'ブロードコム、新しいAIネットワーク向けチップを発表', 'SKハイニックスが第3四半期の過去最高益を発表', 'アリスタ、通期見通しを引き上げ', 'インテルとサンディスクが上昇',
    'Vertiv CEOが決算説明会でAI需要の強さを強調', 'Broadcom unveils a new AI networking chip', 'Arista Networks raises full-year outlook', 'Microsoft stock rises after earnings call',
  ]) assert.equal(isNotNews(title), false, title);
});

test('"what X said" summaries, year-tagged teasers and PC trivia are not news (owner, Oct 31)', () => {
  for (const title of [
    'サム・アルトマンとサムスンの会議：50人の幹部、チップ【2026年】',
    '電源ボタンを長押しするとPCの電源が切れるだけでなく、Windows 11はマイクロソフト向けにクラッシュダンプを静かに保存する',
    'アマゾンとグーグルの両社がカスタムチップを持つ。両社がその将来について語った内容。(AMZN:NASDAQ)',
    'Amazon and Google both have custom chips. What both said about their future',
    'Sam Altman and Samsung meeting: 50 executives, chips [2026]',
    'Windows 11 quietly saves crash dumps for Microsoft when you hold the power button',
  ]) assert.equal(isNotNews(title), true, title);
  for (const title of [
    'グーグル、自社設計の新型AIチップを発表', 'アマゾン、新しいAIチップの出荷を開始', 'マイクロソフト、2026年度の売上見通しを引き上げ', 'Windows 11の利用者が10億人を突破',
    'サムスン、HBM4の供給でエヌビディアと合意', 'Microsoft raises fiscal 2026 revenue outlook', 'Google unveils a new AI chip',
  ]) assert.equal(isNotNews(title), false, title);
  assert.equal(cleanTitle('アマゾン、新しいAIチップの出荷を開始 (AMZN:NASDAQ)'), 'アマゾン、新しいAIチップの出荷を開始');
});

test('data-calendar teasers, company videos, teaser answers, Indian broker pages and hashtag tails are not news; a Japanese wire-service tag is trimmed (owner, Nov 2)', () => {
  for (const title of [
    '来週、雇用統計発表予定', 'Jobs report due next week', 'Radeon Vega Gfx Mobile - AMDがモバイルGPU Radeon Vega Mobileに関する動画を公開', 'AMD publishes a video about the Radeon Vega Mobile GPU',
    'マイクロンの受注残がCXMTのサーバー推進への真の答え', 'Micron backlog is the real answer to CXMT server push',
    'ナビンフルオライドからGEベルノバ第2四半期決算レビュー：IDBIキャピタルの修正目標株価をチェック', 'GE Vernova Q2 review from Navin Fluorine: check IDBI Capital revised target price',
    'Banyan Group Residences、プーケット限定レジデンス展示会で香港に再進出 #BanyanGroup', 'Banyan Group Residences returns to Hong Kong with a Phuket showcase #BanyanGroup',
  ]) assert.equal(isNotNews(title), true, title);
  for (const title of [
    'エヌビディア、新しいAIチップを発表', 'マイクロン、HBM4の量産を開始', 'アーム、新しいチップ設計を発表', 'ルメンタム社長が135万ドル超の自社株を売却', 'Nvidia unveils a new AI chip', 'Micron starts HBM4 volume production',
    'インテル、雇用を3割削減へ', 'Intel to cut jobs by 30%',
  ]) assert.equal(isNotNews(title), false, title);
  assert.equal(cleanTitle('ルメンタム社長の袁武本が135万ドル超の自社株売却（インベスティング・ドットコム）'), 'ルメンタム社長の袁武本が135万ドル超の自社株売却');
});

test("the one-line Japanese headline rides along with the story and reaches the band first (owner, Nov 5)", async () => {
  const { newsPulseItems } = await import("../lib/research/news-pulse-items.ts");
  const { bandItems } = await import("../lib/research/news-band.ts");
  const long = "マイクロン、労使紛争で45億ドルの台湾工場の作業を停止";
  const item = (shortJa) => ({ id: "w1", titleEn: "Micron halts Taiwan fab", titleJa: long, shortJa, publisher: "Bloomberg", origin: "unknown", url: "https://example.com/a", publishedAt: new Date().toISOString() });
  const at = Date.now();
  const withShort = bandItems(newsPulseItems(undefined, "ja", at, { MU: [item("マイクロン、台湾工場を停止")] }, 10), true);
  assert.deepEqual(withShort.map(x => x.band), ["マイクロン、台湾工場を停止"]);
  assert.deepEqual(bandItems(newsPulseItems(undefined, "ja", at, { MU: [item(null)] }, 10), true), []);
});

test("a law firm's shareholder-investigation solicitation is dropped whatever the firm; lawsuit news is kept (owner, Nov 15)", () => {
  // 注目トピック showed this Business Wire ad from a firm the old list did not name.
  for (const title of ["GIL T投資家にSBS法律事務所とジラット衛星ネットワーク詐欺調査参加の機会",
    "GILT Investors Have Opportunity to Join Gilat Satellite Networks Ltd. Fraud Investigation with SBS Law Firm",
    "Gilat Satellite Networks (GILT) Investors Encouraged to Contact SBS About Securities Fraud Investigation",
    "Kirby McInerney LLP Reminds Investors of Class Action Against Super Micro", "Levi & Korsinsky Announces Investigation on Behalf of Intel Shareholders",
    "Halper Sadeh LLC Encourages ARM Shareholders to Contact the Firm", "Securities Class Action Deadline Approaching for QBTS investors",
    "The Gross Law Firm Notifies Shareholders of Arista Networks", "Bragar Eagel & Squire Is Investigating Claims",
    "スーパー・マイクロの株主に集団訴訟への参加を呼びかけ", "クオンタム投資家、集団訴訟の締め切り迫る"]) {
    assert.equal(lawFirmSolicitation(title), true, title);
    assert.equal(isNotNews(title), true, title);
  }
  for (const title of ["SEC sues Nikola founder Trevor Milton for securities fraud", "Intel shareholders sue after 29% drop",
    "Intel shareholders file class action lawsuit after 29% drop", "SEC opens securities fraud investigation into Super Micro",
    "Musk urges Tesla shareholders to vote for pay package", "Apple faces class action over Siri recordings", "Nvidia sees opportunity to lead AI market",
    "Gilat Satellite Networks wins $50 million defense contract", "米SEC、ニコラ創業者を証券詐欺で提訴", "インテル株主が集団訴訟を提起、株価29%下落後"])
    assert.equal(lawFirmSolicitation(title), false, title);
});

test('an untranslated copy of a story is never shown on the Japanese screens, only in English (Nov 19)', () => {
  // The monitor skips a later copy of a story it already translated (PR #710 keeps it skipped for its whole 24 hours), so the
  // copy has no Japanese. The Japanese band, list and topics leave it out instead of showing its English headline.
  const wire = { NVDA: [item('t', 'Nvidia expands Nemotron family with two new models', null, '2026-11-18T05:00:00Z'),
                        item('u', 'Nvidia expands Nemotron family with two new open models', null, '2026-11-18T05:10:00Z')] };
  assert.deepEqual(wireStories(wire, 'ja', WATCHED), []);
  assert.equal(wireStories(wire, 'en', WATCHED).length, 1);
});

// Owner, Nov 20 (「いらないニュース全排除で」): the 速報 headlines the owner called unneeded, in English and as they were translated.
const LOW_VALUE_TITLES = [
  'Stock Market Today: Anthropic’s Mega-IPO Sends Stocks Lower for a Second Day',
  'Stock market today: Tech futures slide as Anthropic sinks 10% after IPO (live)',
  'Anthropic shares fall in pre-market trade as AI rout hits global markets - business live',
  'Dow Jones Futures: Techs Tumble, Anthropic Dives After Ugly Market Reversal To New Lows',
  'Market Open: Record Breaking IPO For Anthropic, Stocks Jump, Walmart Slides 11-19-2026',
  'Beyond TSMC: 3 Taiwanese Small-Cap Tech Stocks to Watch',
  'Marvell Technology And 2 Top AI Stocks To Watch',
  'Sandisk Stock Splits 8-for-1 — What It Means for Investors',
  "Sandisk’s stock split is almost here. This is what investors need to know.",
  'Intel 18A vs. TSMC N2: How to Read the Chip Claims',
  "Anthropic IPO: Here's What Its Spending Commitments Mean to Microsoft, SpaceX, Amazon, and Alphabet",
  'Prediction: Micron Stock Is Going to Soar After Its December Earnings Report',
  'Micron Is the Memory Stock I’d Buy',
  'Dear Sandisk Stock Fans, Mark Your Calendars for November 20',
  'Is Vertiv Stock a Buy After Its Earnings Beat? (Nov 15, 2026)',
  // HQ, Nov 20: "here's what it means / why / how" teasers stay dropped, and so does a broker-note teaser (the plain target change is kept below).
  "Anthropic files for IPO. Here's what it means for Alphabet", "Nvidia stock fell. Here's how to play it",
  "72% Upside for GE Vernova? Bernstein Thinks So, and Here's How It Gets to $1,298", 'Analysis: Anthropic IPO tests AI valuations',
  // HQ, Nov 20: MarketBeat price-move templates with no event.
  "Vertiv (NYSE:VRT) Stock Falls 5.1% - Here's What Happened",
  "Arista Networks (NYSE:ANET) Stock Price Down 5.5% - Here's Why",
  "Arista Networks (NYSE:ANET) Stock Price Breaks Below 50 Day Moving Average - Here's What Happened",
  'Bloom Energy (NYSE:BE) Shares Gap Up - Time to Buy?',
  'Lumentum (NASDAQ:LITE) Shares Gap Down',
  "NVIDIA (NASDAQ:NVDA) Trading 3.2% Higher - Here's Why",
  'Micron Technology (NASDAQ:MU) Stock Price Up 4.1% - Should You Buy?',
  "Lumentum (NASDAQ:LITE) Stock Falls 2.9% - What's Next?",
  '株式市場本日：AnthropicのIPO後株価10%急落でテック先物売られる（ライブ中継）',
  'TSMCを超えて：注目すべき台湾の小型テクノロジー株3銘柄',
  'サンディスク株が8分割—投資家にとっての意義とは',
  'インテル18A対TSMC N2：チップの主張の読み方',
  'AnthropicのIPO：その支出約束がマイクロソフト、スペースX、アマゾン、アルファベットに意味すること',
];
// Concrete company, analyst and regulatory news is never caught.
const REAL_NEWS = [
  'Microsoft announces general availability of Azure Cobalt 200', 'Azure Cobalt 200の一般提供開始を発表',
  'The U.S. Approved 879,000 Nvidia and AMD Chips for China in 6 Months', '米国は6ヶ月間で879,000枚のNVIDIAとAMDの中国向けチップを承認',
  'Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370', 'Stifel cuts Marvell stock price target on deal concerns to $280',
  'スティーフェル、取引懸念でマーベルの目標株価を280ドルに引き下げ', 'BMO Capital Markets Upgrades Bloom Energy (NYSE:BE) to Outperform',
  'Nvidia reports record third-quarter revenue of $115.8 billion', 'Micron raises guidance on HBM demand', 'Sandisk completes 8-for-1 stock split and increases authorized shares',
  'TSMC halts advanced chip orders from Chinese designers in Taiwan', 'SK Hynix to become Kioxia\'s largest shareholder after bond conversion',
  'Nvidia sells 10 million shares to SoftBank', 'Arista names new chief financial officer', 'Palantir wins $480 million Army contract',
  'Commerce approved sales of more than 879,000 AI chips to Chinese companies, Rep. Mast says', 'Live Nation shares jump after earnings',
  // HQ, Nov 20: "here's what" followed by what happened is a report of an event, not a teaser.
  "Microsoft CEO Satya Nadella calls Outlook outage a 'perfect storm.' Here's what went wrong", "Sandisk Stock Looked Like It Fell 87%. Here's What Really Happened.",
  "Nvidia board picks new CEO: here's what we know", 'Bernstein raises GE Vernova price target to $1,298',
];

test('market live blogs, stock lists, explainers and opinion are left out, and concrete news is kept (owner, Nov 20)', async () => {
  const { lowValue } = await import('../lib/research/wire-stories.ts');
  for (const title of LOW_VALUE_TITLES) assert.equal(isNotNews(title), true, title);
  for (const title of REAL_NEWS) { assert.equal(isNotNews(title), false, title); assert.equal(lowValue(title), false, title); }
});

// Nov 20 review: an explainer, "- live", "here's the" or bull-case phrase does not drop a headline that reports a concrete event.
const EVENT_NEWS = ['AMD launches MI400: what it means for Nvidia', 'Microsoft to invest $10 billion in Japan, what to know',
  'Intel names new CEO - live', 'Oracle surges 30% on cloud backlog - live', "Here's the full statement from Apple on the EU fine",
  "Nvidia to buy stake in Intel; here's the deal terms", "Palantir wins $10 billion Army contract — what's next", 'Morgan Stanley bull case for Tesla raised to $800'];
const STILL_LOW_VALUE = ['Stock Market Today live: Nasdaq slides as Anthropic sinks', 'Beyond TSMC: 3 Taiwan small-cap tech stocks',
  'Sandisk 8-for-1: what it means for investors', "Nvidia beats estimates - Here's why", 'Analysis: Nvidia names a new chief executive',
  "Lumentum (NASDAQ:LITE) Stock Surges 2.9% - What's Next?", 'Lumentum unveils AI rack optics demo: what it means for LITE stock'];
const GURUFOCUS = ['Marvell Technology (MRVL) Stock Down 11.7% — What the 84 GF Score Means for Investors',
  'Arm Holdings (ARM) after 14.1% drop — GF Value $207.57 vs price $152.18', 'Arista Networks (ANET) a bargain after 11.6% drop? GF rating',
  'マーベル・テクノロジー株が11.7%下落—GFスコア84が投資家に意味すること', 'アーム、14.1%下落後のGFバリューは207.57ドル', 'アリスタ、11.6%下落で割安か？GF評価'];

test('an explainer phrase does not drop an event headline; GuruFocus templates are dropped (Nov 20 review, owner Nov 21)', () => {
  for (const title of EVENT_NEWS) assert.equal(isNotNews(title), false, title);
  for (const title of STILL_LOW_VALUE) assert.equal(isNotNews(title), true, title);
  for (const title of GURUFOCUS) assert.equal(isNotNews(title), true, title);
  assert.equal(isNotNews('Micron, Sandisk, SK Hynix in focus as GF Securities cuts NAND price forecast, sees glut'), false);
  // A translated explainer phrase is kept when the English headline reports the event, and dropped when it does not.
  assert.equal(isNotNews('AMD、MI400を発表：エヌビディアにとっての意味', 'AMD launches MI400: what it means for Nvidia'), false);
  assert.equal(isNotNews('サンディスクの8分割：投資家にとっての意味', 'Sandisk 8-for-1: what it means for investors'), true);
  const wire = { AMD: [item('mi400', 'AMD launches MI400: what it means for Nvidia', 'AMD、MI400を発表：エヌビディアにとっての意味', '2026-11-20T13:00:00Z')] };
  assert.deepEqual(wireStories(wire, 'ja', new Set(['AMD'])).map(story => story.id), ['mi400']);
});

test('the same broker action from two outlets is one row, the first report (owner, Nov 20: MRVL twice)', async () => {
  const { analystActions } = await import('../lib/research/wire-stories.ts');
  assert.deepEqual(analystActions('Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370'), ['stifel|pt|280']);
  assert.deepEqual(analystActions('Stifel cuts Marvell stock price target on deal concerns to $280'), ['stifel|pt|280']);
  assert.deepEqual(analystActions('BMO Upgrades Bloom Energy to Outperform With $230 Price Target'), ['bmo|pt|230', 'bmo|rating|outperform']);
  assert.deepEqual(analystActions('Credo Technology price target lowered to $175 from $300 at TD Cowen'), ['cowen|pt|175']);
  assert.deepEqual(analystActions('Marvell agrees to buy Lumentum for $115 billion'), []);
  // Nov 20 review: an amount in billions or trillions is not the target, however the number is cut.
  assert.deepEqual(analystActions('Goldman Sachs keeps Nvidia price target, sees $500 billion AI opportunity'), []);
  assert.deepEqual(analystActions('UBS lifts Apple PT ahead of $1.5 trillion buyback'), []);
  assert.deepEqual(analystActions('Goldman Sachs keeps Nvidia price target at $250, sees $500 billion AI opportunity'), ['goldman|pt|250']);
  assert.deepEqual(analystActions('UBS lifts Apple PT, sees $1.5 trillion buyback and $300 shares'), ['ubs|pt|300']);
  const wire = { MRVL: [
    item('first', 'Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370', 'マーベル、スティーフェルが維持も目標株価を280ドルに引き下げ', '2026-11-20T13:31:00Z'),
    item('second', 'Stifel cuts Marvell stock price target on deal concerns to $280', 'スティーフェル、取引懸念でマーベルの目標株価を280ドルに引き下げ', '2026-11-20T14:24:00Z'),
    item('other', 'Oppenheimer Maintains Marvell Technology With Buy Rating, Maintains Target Price $425', 'オッペンハイマー、マーベルの目標株価425ドルを維持', '2026-11-20T05:59:00Z'),
    item('later-day', 'Stifel lowers Marvell price target to $280', 'スティーフェル、マーベル目標株価を280ドルに', '2026-11-22T14:24:00Z'),
  ] };
  const stories = wireStories(wire, 'ja', new Set(['MRVL']));
  assert.deepEqual(stories.map(story => story.id), ['later-day', 'first', 'other']);
  assert.equal(stories[1].at, '2026-11-20T13:31:00.000Z');
  // Another firm with the same target, or the same firm's action on another company, stays apart.
  const apart = wireStories({ MRVL: [item('a', 'Stifel cuts Marvell price target to $280', 'a', '2026-11-20T13:00:00Z'), item('b', 'Needham cuts Marvell price target to $280', 'b', '2026-11-20T13:10:00Z')],
    LITE: [item('c', 'Stifel cuts Lumentum price target to $300', 'c', '2026-11-20T13:20:00Z')] }, 'en', new Set(['MRVL', 'LITE']));
  assert.equal(apart.length, 3);
});
