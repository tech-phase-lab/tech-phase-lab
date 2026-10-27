import Link from "next/link";
import { BAR_STATE_KEY } from "@/lib/research/resolute-bar-state";
import { ownedGuardScript } from "@/lib/resolute/landing-gate";
import AlertSample from "./alert-sample";
import Book from "./book";
import OwnedRedirect from "./owned-redirect";
import { Anchor, Feature, stars } from "./parts";
import s from "./lp.module.css";

// The English page buys through the English checkout.
const CHECKOUT = "/resolute/checkout?lang=en";

function Price() {
 return <div className={s.price}>
  <p className={s.launch}>Launch price · Through Feb 28, 2027</p>
  <p className={s.amount}><del>$69</del><b>$59</b></p>
 </div>;
}
function Buy({ small = false }: { small?: boolean }) {
 return <div className={s.buy}>
  <Link href={CHECKOUT} className={small ? `${s.cta} ${s.ctaSmall}` : s.cta}>Get RESOLUTE</Link>
  <p className={s.guest}>No account needed to buy</p>
 </div>;
}

export default function LandingEn({ embedded = false }: { embedded?: boolean }) {
 return <div className={`${s.root} ${s.en}`} lang="en">
  {embedded ? null : <><script dangerouslySetInnerHTML={{ __html: ownedGuardScript(BAR_STATE_KEY) }} /><OwnedRedirect /></>}
  <main className={s.lp}>
   {/* 1 Hero */}
   <section className={s.hero}>
    <div className={s.mark}><Anchor className={s.anchor} /><span className={s.wordmark}>RESOLUTE</span></div>
    <p className={s.kana}>BY RIZEL</p>
    <h1 className={s.catch}>When markets crash,<br />when markets soar,<br /><em>stick to your rules.</em></h1>
    <p className={s.lead}>A kit that keeps your rules on your phone, ready for the days the market goes wild.</p>
    <div className={s.phone} aria-hidden="true"><div className={s.screen}>
     <p className={s.miniBrand}>RESOLUTE</p>
     <div className={s.miniCard}><span className={s.miniHead}><span className={s.miniLab}>Today&apos;s News Risk Meter</span><span className={s.miniAll}>All →</span></span><p>US widens curbs on AI chip exports to China</p>{stars(4)}</div>
     <div className={s.miniCard}><span className={s.miniHead}><span className={s.miniLab}>Market Gauge</span><span className={s.miniAll}>Hot</span></span><div className={s.track}><i style={{ left: "66%" }} /></div></div>
     <div className={s.miniTiles}><span>Your Rulebook</span><span>Rules Wallpaper</span></div>
    </div></div>
    <Price />
    <Buy />
   </section>

   {/* 2 TWO NIGHTS */}
   <section className={s.sec}>
    <p className={s.eyebrow}>TWO NIGHTS</p>
    <h2 className={s.h2}>Two kinds of nights<br />can cloud your judgment.</h2>
    <article className={`${s.night} ${s.crash}`}><p className={s.tag}>CRASH</p><h3>When markets crash</h3><p>Your portfolio is in the red, and you can&apos;t sleep. Every scroll through social media makes the fear louder. Before you know it, it&apos;s morning and you&apos;re still deciding whether to sell.</p></article>
    <article className={`${s.night} ${s.surge}`}><p className={s.tag}>SURGE</p><h3>When markets soar</h3><p>A stock keeps climbing and you wish you&apos;d bought more. You feel like buying more just because the price keeps rising. The limit you set quietly slips your mind.</p></article>
    <p className={s.closing}>On either night,<br />what throws you off<br /><em>is how you feel in the moment.</em></p>
   </section>

   {/* 3 WHAT IS RESOLUTE */}
   <section className={s.sec}>
    <p className={s.eyebrow}>WHAT IS RESOLUTE</p>
    <h2 className={s.h2}>Stay level-headed<br />whatever the market does.</h2>
    <p className={s.body}>RESOLUTE is a kit for keeping your head when the market gets wild. Build your own rules with a 30-question quiz, then keep them where you&apos;ll see them every day. When a stock’s closing price reaches one of your alert levels, an email prompts you to pause and revisit your rules.</p>
    <p className={s.pull}>When markets crash,<br />let your rules guide you.</p>
    <ol className={s.steps}>
     <li><span>01</span><b>Decide</b><p>Define your rules with a 30-question quiz</p></li>
     <li><span>02</span><b>Carry</b><p>Keep your rules close with a wallpaper and a personal rulebook</p></li>
     <li><span>03</span><b>Alert</b><p>Email alerts based on your price levels and closing prices</p></li>
     <li><span>04</span><b>Return</b><p>Return to your rules through market ups and downs</p></li>
    </ol>
   </section>

   {/* 4 FEATURES */}
   <section className={s.sec}>
    <p className={s.eyebrow}>FEATURES</p>
    <h2 className={s.h2}><span className={s.big}>10</span> features<br />in one kit.</h2>

    <div className={s.group}>
     <p className={s.groupNo}>01 <b>Decide</b></p>
     <div className={s.sample} aria-hidden="true">
      <p className={s.q}>Q 7 / 30</p>
      <p className={s.qText}>A stock you own is down 20% in a month. What do you do?</p>
      <ul className={s.choices}><li>Do nothing</li><li className={s.picked}>Buy more, but only if it fits my plan</li><li>Sell some and wait</li></ul>
     </div>
     <Feature title="Rules Quiz" text="Tap your way through 30 questions to build a set of investing rules based on your answers." />
     <Feature title="Portfolio Simulator" text="See how your portfolio could move in a drop or a rally, before it happens." />
    </div>

    <div className={s.group}>
     <p className={s.groupNo}>02 <b>Carry</b></p>
     <div className={s.wallRow}>
      <div className={s.lock} aria-hidden="true"><p className={s.lockDate}>Thu, Jan 15</p><p className={s.clock}>9:41</p><p className={s.lockBrand}>RESOLUTE</p><dl><dt>Decline I can tolerate</dt><dd>−30%</dd><dt>Max per stock</dt><dd>10%</dd></dl><p className={s.lockRule}>No action until −10%</p></div>
      <div className={s.wallNote}><p>Every time you wake your phone, your rules are right there.</p><small>3 styles. Customize the size and colors.<br />Use your own photo too</small></div>
     </div>
     <Feature title="Rules Wallpaper" text="Turn your rules into a lock screen wallpaper and take them everywhere." />
     <Book locale="en" />
     <p className={s.bookNote}>Your quiz answers become a book of your own</p>
     <Feature title="Your Rulebook" text="Every rule from your quiz, gathered in one book. Reread it on the days you waver." />
    </div>

    <div className={s.group}>
     <p className={s.groupNo}>03 <b>Alert</b></p>
     <AlertSample locale="en" />
     <div className={s.thermo} aria-hidden="true"><p className={s.thermoLab}>Market Gauge</p><p className={s.thermoWord}>Warm</p><p className={s.thermoIdx}>NASDAQ100</p><div className={s.track}><i style={{ left: "66%" }} /></div><p className={s.thermoEnds}><span>Cold</span><span>Hot</span></p></div>
     <Feature title="Closing-price Alerts" text="When a stock’s closing price reaches a downside or upside level you’ve set, you get an email at your chosen morning delivery time (Japan Standard Time). No need to watch the market all day." />
     <Feature title="Morning Note" text="One short email the morning after an alert, to read with a rested mind." />
     <Feature title="Market Gauge" text="Shows how cool or hot the market is on a five-point scale. Helps you put market moves in perspective." />
    </div>

    <div className={s.group}>
     <p className={s.groupNo}>04 <b>Return</b></p>
     <div className={s.sample} aria-hidden="true">
      <div className={s.sampleHead}><span>Today&apos;s News Risk Meter</span><span className={s.all}>See all →</span></div>
      <ul className={s.news}>
       <li>US Commerce Dept. plans wider limits on AI chip exports to China{stars(4)}</li>
       <li>A major cloud provider scales back its data center spending plan{stars(3)}</li>
      </ul>
      <div className={s.video}><span className={s.play} /><div><b>A Moment to Breathe</b><small>From RIZEL</small></div><em>1:40</em></div>
     </div>
     <Feature title="When the Market Tumbles" text={'A short video from RIZEL and the "won\'t do" list you made, on one screen. A reminder that you don\'t have to decide tonight.'} />
     <Feature title="News Risk Meter" text="Highlights the day’s market-moving news and rates each story’s potential risk on a scale of 1 to 5 stars. No major news, no update." />
     <Feature title="RIZEL's Take" text="A one-line take from RIZEL on each story." />
    </div>
   </section>

   {/* 5 Purchase */}
   <section className={`${s.sec} ${s.final}`}>
    <Anchor className={s.anchor} />
    <h2 className={s.h2}>Before the next market storm,<br /><em>have your rules ready.</em></h2>
    <Price />
    <Buy />
   </section>

   {/* 6 MESSAGE */}
   <section className={s.sec}>
    <p className={s.eyebrow}>MESSAGE</p>
    <div className={s.author}>
     {/* eslint-disable-next-line @next/next/no-img-element -- the photo is swapped for the owner's own file later */}
     <img src="/rizel-avatar.webp" alt="" width={72} height={72} />
     <div><b>RIZEL</b><small>Creator of RESOLUTE</small></div>
    </div>
    <p className={s.body}>It’s easy to feel anxious when markets crash and get carried away when prices soar. Having your own rules in place before emotions run high can help you stay grounded.</p>
    <p className={s.body}>RESOLUTE brings together what I’ve learned about staying grounded in the market in a kit anyone can use. It won’t tell you when to buy or sell. I designed every part to help you think clearly when markets move sharply.</p>
    <p className={s.bigGold}>A market crash doesn’t have to throw you off course.</p>
    <p className={s.body}>When the market gets rough, remember RESOLUTE.</p>
    <p className={s.sign}>RIZEL</p>
   </section>

   {/* 7 FAQ */}
   <section className={s.sec}>
    <p className={s.eyebrow}>FAQ</p>
    <h2 className={s.h2}>Common questions</h2>
    <div className={s.faq}>
     <details><summary>I&apos;m new to investing. Can I use it?</summary><p>Yes. Just tap to answer 30 straightforward questions. You don’t need any investing knowledge to get started.</p></details>
     <details><summary>Will it tell me what to buy or when to sell?</summary><p>No. RESOLUTE doesn&apos;t recommend trades. It turns the rules you set into something you can hold onto, so you can come back to them when the market moves.</p></details>
     <details><summary>Is it a one-time purchase?</summary><p>Your one-time purchase includes ongoing access to the core tools, plus one year of Closing-price Alerts, Morning Note, News Risk Meter, and RIZEL’s Take. After the first year, you can choose to renew these four features for another year. Renewal is optional and never automatic.</p></details>
     <details><summary>How much does renewal cost?</summary><p>Renewal costs $39 per year, or $29 per year for active Tech Phase PRO members.</p></details>
     <details><summary>Do I need Tech Phase PRO?</summary><p>No. You can purchase RESOLUTE without a Tech Phase PRO subscription. Every feature is included for the first year, with optional renewal for the four features listed above.</p></details>
     <details><summary>Can I buy without an account?</summary><p>Yes. You don’t need an account to purchase. After payment, we’ll email you a link to create an account or sign in and activate your access.</p></details>
     <details><summary>Can I get a refund?</summary><p>As a digital product, RESOLUTE can&apos;t be refunded after purchase. Please review the details before you buy.</p></details>
    </div>
    <Buy small />
   </section>

   {/* 8 Footer */}
   <footer className={s.foot}>
    <nav className={s.footWide}><Link href="/resolute/legal/commerce?lang=en">Legal Notice</Link><Link href="/resolute/legal/terms?lang=en">Terms of Service</Link><Link href="/resolute/legal/privacy?lang=en">Privacy Policy</Link></nav>
    <p>RESOLUTE provides information, not investment advice.</p>
    <p>Screens shown are for illustrative purposes only.</p>
   </footer>
  </main>
 </div>;
}
