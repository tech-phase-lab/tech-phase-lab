import Link from "next/link";
import { BAR_STATE_KEY } from "@/lib/research/resolute-bar-state";
import { ownedGuardScript } from "@/lib/resolute/landing-gate";
import AlertSample from "./alert-sample";
import Book from "./book";
import OwnedRedirect from "./owned-redirect";
import { Anchor, Feature, stars } from "./parts";
import s from "./lp.module.css";

const CHECKOUT = "/resolute/checkout";

function Price() {
 return <div className={s.price}>
  <p className={s.launch}>発売記念価格 ・ 2027年2月末まで</p>
  <p className={s.amount}><del>¥9,800</del><b>¥7,980</b><small>税込</small></p>
 </div>;
}
function Buy({ small = false }: { small?: boolean }) {
 return <div className={s.buy}>
  <Link href={CHECKOUT} className={small ? `${s.cta} ${s.ctaSmall}` : s.cta}>RESOLUTEを手に入れる</Link>
  <p className={s.guest}>ログインなしでも購入できます</p>
 </div>;
}
export default function Landing({ embedded = false }: { embedded?: boolean }) {
 return <div className={s.root}>
  {embedded ? null : <><script dangerouslySetInnerHTML={{ __html: ownedGuardScript(BAR_STATE_KEY) }} /><OwnedRedirect /></>}
  <main className={s.lp}>
   {/* 1 ファーストビュー */}
   <section className={s.hero}>
    <div className={s.mark}><Anchor className={s.anchor} /><span className={s.wordmark}>RESOLUTE</span></div>
    <p className={s.kana}>レゾリュート ｜ リゼル</p>
    <h1 className={s.catch}>暴落の夜も<br />急騰の夜も<br /><em>自分のルールを守る</em></h1>
    <p className={s.lead}>相場が荒れた日に立ち戻る場所を<br />あなたのスマホに置いておくキットです。</p>
    <div className={s.phone} aria-hidden="true"><div className={s.screen}>
     <p className={s.miniBrand}>RESOLUTE</p>
     <div className={s.miniCard}><span className={s.miniLab}>今日の危険度</span><p>米商務省がAI半導体の対中規制を拡大へ</p>{stars(4)}</div>
     <div className={s.miniCard}><span className={s.miniLab}>相場の温度計</span><div className={s.track}><i style={{ left: "66%" }} /></div></div>
     <div className={s.miniTiles}><span>迷った日の一冊</span><span>ルールのお守り</span></div>
    </div></div>
    <Price />
    <Buy />
   </section>

   {/* 2 TWO NIGHTS */}
   <section className={s.sec}>
    <p className={s.eyebrow}>TWO NIGHTS</p>
    <h2 className={s.h2}>相場には判断を誤りやすい<br />夜が2つあります。</h2>
    <article className={`${s.night} ${s.crash}`}><p className={s.tag}>CRASH</p><h3>暴落の夜</h3><p>含み損が気になって眠れない。SNSを何度も開いては不安が大きくなる。気づけば朝まで売るかどうか迷っている。</p></article>
    <article className={`${s.night} ${s.surge}`}><p className={s.tag}>SURGE</p><h3>急騰の夜</h3><p>上がり続ける株を見て、もっと入れておけばと焦る。根拠より勢いで買い増したくなる。決めていた上限をつい忘れてしまう。</p></article>
    <p className={s.closing}>どちらの夜も<br />判断を狂わせるのは<br /><em>その瞬間の感情</em>です<span className={s.hang}>。</span></p>
   </section>

   {/* 3 WHAT IS RESOLUTE */}
   <section className={s.sec}>
    <p className={s.eyebrow}>WHAT IS RESOLUTE</p>
    <h2 className={s.h2}>どんな相場でも<br />冷静に立ち回れる自分へ<span className={s.hang}>。</span></h2>
    <p className={s.body}>RESOLUTEは相場が荒れる日でも冷静に立ち回るためのキットです。30問の診断で自分だけのルールを作り、壁紙と一冊の本にしていつも手元に置いておく。<br />決めたラインに株価が届けばアラートが知らせてくれるので、感情で売り買いする前に立ち止まれます。</p>
    <p className={s.pull}>暴落が来ても<br />もう慌てない。</p>
    <ol className={s.steps}>
     <li><span>01</span><b>決める</b><p>30問の診断であなたのルールができあがる</p></li>
     <li><span>02</span><b>持ち歩く</b><p>壁紙と一冊にして毎日目に入る場所へ</p></li>
     <li><span>03</span><b>知らせる</b><p>相場が大きく動いた日はアラートが届く</p></li>
     <li><span>04</span><b>立ち戻る</b><p>暴落の夜も急騰の夜もルールへ戻る</p></li>
    </ol>
   </section>

   {/* 4 FEATURES */}
   <section className={s.sec}>
    <p className={s.eyebrow}>FEATURES</p>
    <h2 className={s.h2}><span className={s.big}>11</span> の機能を<br />ひとつのキットに。</h2>

    <div className={s.group}>
     <p className={s.groupNo}>01 <b>決める</b></p>
     <div className={s.sample} aria-hidden="true">
      <p className={s.q}>Q 7 / 30</p>
      <p className={s.qText}>持っている株が1か月で20%下がりました。あなたはどうしますか?</p>
      <ul className={s.choices}><li>何もしない</li><li className={s.picked}>決めていた分だけ買い増す</li><li>一部を売って様子を見る</li></ul>
     </div>
     <Feature title="ルール診断" text="ボタンを押すだけの30問。終わるとあなた専用の投資ルールができあがります。" />
     <Feature title="資産シミュレーション" text="下落した場合も上昇した場合も、資産がどう動くかを先に試せます。" />
     <Feature title="税金の目安" text="急騰で利益を確定する前に、手取りがいくらになるかが分かります。NISAと特定口座の違いや損失の繰り越しまで計算します。" />
    </div>

    <div className={s.group}>
     <p className={s.groupNo}>02 <b>持ち歩く</b></p>
     <div className={s.wallRow}>
      <div className={s.lock} aria-hidden="true"><p className={s.clock}>9:41</p><p className={s.lockBrand}>RESOLUTE</p><dl><dt>許容できる下落</dt><dd>−30%</dd><dt>1銘柄の上限</dt><dd>資産の10%</dd></dl><p className={s.lockRule}>−10%までは何もしない</p></div>
      <div className={s.wallNote}><p>ロック画面を開くたびに自分のルールが目に入ります。</p><small>タイプ3種 ・ 大きさ ・ 背景色<br />自分の写真も使えます</small></div>
     </div>
     <Feature title="ルールのお守り" text="あなたのルールをロック画面の壁紙にして持ち歩けます。" />
     <Book />
     <p className={s.bookNote}>診断の答えから、あなただけの一冊ができます</p>
     <Feature title="迷った日の一冊" text="診断で決めたルールを一冊にまとめました。迷った日に読み返す場所です。" />
    </div>

    <div className={s.group}>
     <p className={s.groupNo}>03 <b>知らせる</b></p>
     <AlertSample />
     <div className={s.thermo} aria-hidden="true"><p className={s.thermoWord}>やや熱い</p><p className={s.thermoIdx}>NASDAQ100</p><div className={s.track}><i style={{ left: "66%" }} /></div><p className={s.thermoEnds}><span>冷えている</span><span>熱い</span></p></div>
     <Feature title="終値アラート" text="自分で決めたラインに到達すると、選んだ朝の時間にメールでお知らせします。画面を見張る必要はありません。" />
     <Feature title="翌朝のひとこと" text="アラートが届いた翌朝に1通だけ。ひと晩おいた頭で読み返せます。" />
     <Feature title="相場の温度計" text="いまの相場が冷えているか熱いかを5段階で表示します。急騰で浮かれそうな日にも役立ちます。" />
    </div>

    <div className={s.group}>
     <p className={s.groupNo}>04 <b>立ち戻る</b></p>
     <div className={s.sample} aria-hidden="true">
      <div className={s.sampleHead}><span>今日の危険度</span><span className={s.all}>すべて見る →</span></div>
      <ul className={s.news}>
       <li>米商務省がAI半導体の対中輸出規制を拡大する方針を発表{stars(4)}</li>
       <li>大手クラウド企業がデータセンター投資の計画を下方修正{stars(3)}</li>
      </ul>
      <div className={s.video}><span className={s.play} /><div><b>今夜のひと息</b><small>リゼルから</small></div><em>1:40</em></div>
     </div>
     <Feature title="暴落の夜に開く" text="リゼルの短い動画と、あなたが決めた「やらないこと」を1画面に。今夜は決めなくていいと思い出せます。" />
     <Feature title="危険度チェッカー" text="その日の市場を揺るがすニュースを選び、危険度を★5段階で整理します。大きなニュースがない日は公開しません。" />
     <Feature title="リゼルの一言" text="ニュースごとに、リゼル本人の見方をひと言添えて届けます。" />
    </div>
   </section>

   {/* 5 購入 */}
   <section className={`${s.sec} ${s.final}`}>
    <Anchor className={s.anchor} />
    <h2 className={s.h2}>次に相場が荒れる夜のために<br /><em>いまルールを持っておく</em></h2>
    <Price />
    <Buy />
   </section>

   {/* 6 MESSAGE */}
   <section className={s.sec}>
    <p className={s.eyebrow}>MESSAGE</p>
    <div className={s.author}>
     {/* eslint-disable-next-line @next/next/no-img-element -- the photo is swapped for the owner's own file later */}
     <img src="/rizel-avatar.webp" alt="" width={72} height={72} />
     <div><b>リゼル</b><small>RESOLUTE 制作者</small></div>
    </div>
    <p className={s.body}>暴落相場で不安になるのも急騰相場で浮かれるのも、誰にでもあることです。そのとき慌てずにいられるかは、静かな日に自分だけのルールを決めておいたかどうかで決まります。</p>
    <p className={s.body}>RESOLUTEは、私が相場と向き合うなかで大切にしてきた考え方を誰でも使える形にしたキットです。売買のタイミングを教えるものではありません。相場が急変しても冷静に立ち回れるように、ひとつひとつ魂を込めて作りました。</p>
    <p className={s.bigGold}>もう暴落は怖くない。</p>
    <p className={s.body}>相場が荒れたら、RESOLUTEを思い出してください。</p>
    <p className={s.sign}>リゼル</p>
   </section>

   {/* 7 よくある質問 */}
   <section className={s.sec}>
    <p className={s.eyebrow}>FAQ</p>
    <h2 className={s.h2}>よくある質問</h2>
    <div className={s.faq}>
     <details><summary>投資を始めたばかりでも使えますか?</summary><p>使えます。診断はボタンを押していくだけの30問です。難しい言葉を知らなくても、最後まで進めるように作りました。</p></details>
     <details><summary>特定の銘柄や売買のタイミングを教えてくれますか?</summary><p>いいえ。RESOLUTEは売買をすすめるものではありません。あなたが自分で決めたルールを形にして、相場が動いた日にそこへ戻るための道具です。</p></details>
     <details><summary>買い切りですか?</summary><p>終値アラート・翌朝のひとこと・危険度チェッカー・リゼルの一言は購入から1年間で、2年目以降は更新する形です。それ以外の機能は一度の購入でずっと使えます。</p></details>
     <details><summary>2年目の更新はいくらですか?</summary><p>5,980円です。Tech Phase PROの会員なら3,980円で更新できます。</p></details>
     <details><summary>Tech Phase PROに入っていなくても使えますか?</summary><p>使えます。FREE会員の方でも、RESOLUTEを購入すればすべての機能を使えます。</p></details>
     <details><summary>ログインしなくても買えますか?</summary><p>買えます。購入のあとにメールで案内が届くので、そこから受け取りの手続きをしてください。</p></details>
     <details><summary>返金はできますか?</summary><p>デジタル商品のため、購入後の返金はお受けしていません。内容をご確認のうえお申し込みください。</p></details>
    </div>
    <Buy small />
   </section>

   {/* 8 フッター */}
   <footer className={s.foot}>
    <nav><Link href="/resolute/legal/commerce">特定商取引法に基づく表記</Link><Link href="/terms">利用規約</Link><Link href="/privacy">プライバシー</Link></nav>
    <p>RESOLUTEは情報の提供であり、投資助言ではありません。</p>
    <p>画面はイメージです。</p>
   </footer>
  </main>
 </div>;
}
