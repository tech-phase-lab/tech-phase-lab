import test from 'node:test';
import assert from 'node:assert/strict';
import { wireStories, isNotNews, staleResults, cleanTitle } from '../lib/research/wire-stories.ts';

const item = (id, titleEn, titleJa, publishedAt, origin = 'third-party') => ({ id, titleEn, titleJa, publisher: 'P', origin, url: `https://example.com/${id}`, publishedAt });
const WATCHED = new Set(['MU', 'SNDK', 'NVDA', 'CRWV']);

test('one story named by several companies is one row listing them all (owner, Oct 17)', () => {
  const wire = {
    MU: [item('a', 'Did you miss Micron and SanDisk? Memory stocks to watch this week', 'メモリ株の注目点', '2026-10-17T05:33:00Z')],
    SNDK: [item('b', 'Did you miss Micron and SanDisk? Memory stocks to watch this week', 'メモリ株の注目点', '2026-10-17T05:33:00Z')],
    NVDA: [item('c', 'Did you miss Micron and SanDisk? Memory stocks to watch this week', 'メモリ株の注目点', '2026-10-17T05:50:00Z')],
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
