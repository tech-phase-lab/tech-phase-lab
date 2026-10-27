import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const lp = ["landing-en.tsx", "alert-sample.tsx", "book.tsx"].map(file => read(`../app/resolute/lp/${file}`)).join("\n").replaceAll("&apos;", "'").replaceAll("\\'", "'");

test("the English landing copy is the owner's wording, unchanged", () => {
  const phrases = [
    "BY RIZEL", "When markets crash,", "when markets soar,", "stick to your rules.", "A kit that keeps your rules on your phone, ready for the days the market goes wild.",
    "Today's News Risk Meter", "All →", "US widens curbs on AI chip exports to China", "Market Gauge", "Hot", "Your Rulebook", "Rules Wallpaper",
    "Launch price · Through Feb 28, 2027", "$69", "$59", "Get RESOLUTE", "No account needed to buy",
    "TWO NIGHTS", "Two kinds of nights", "can cloud your judgment.", "CRASH", "When markets crash", "SURGE", "When markets soar",
    "Your portfolio is in the red, and you can't sleep. Every scroll through social media makes the fear louder. Before you know it, it's morning and you're still deciding whether to sell.",
    "A stock keeps climbing and you wish you'd bought more. You feel like buying more just because the price keeps rising. The limit you set quietly slips your mind.",
    "On either night,", "what throws you off", "is how you feel in the moment.",
    "Stay level-headed", "whatever the market does.",
    "RESOLUTE is a kit for keeping your head when the market gets wild. Build your own rules with a 30-question quiz, then keep them where you'll see them every day. When a stock’s closing price reaches one of your alert levels, an email prompts you to pause and revisit your rules.",
    "let your rules guide you.", "Define your rules with a 30-question quiz", "Keep your rules close with a wallpaper and a personal rulebook",
    "Email alerts based on your price levels and closing prices", "Return to your rules through market ups and downs",
    "10", "features", "in one kit.", "Q 7 / 30", "A stock you own is down 20% in a month. What do you do?", "Do nothing", "Buy more, but only if it fits my plan", "Sell some and wait",
    "Rules Quiz", "Tap your way through 30 questions to build a set of investing rules based on your answers.", "Portfolio Simulator", "See how your portfolio could move in a drop or a rally, before it happens.",
    "Thu, Jan 15", "9:41", "Decline I can tolerate", "Max per stock", "No action until −10%", "Every time you wake your phone, your rules are right there.", "3 styles. Customize the size and colors.", "Use your own photo too",
    "Turn your rules into a lock screen wallpaper and take them everywhere.", "Your quiz answers become a book of your own", "Every rule from your quiz, gathered in one book. Reread it on the days you waver.",
    "RESOLUTE · Closing-price alert", "7:00", "Your price alerts were triggered", "NVDA −10.2% · PLTR +41.5%", "Tap to see details", "Close",
    "[RESOLUTE] Your downside and upside alerts were triggered", "We checked January 14 closing prices in the U.S. market against your alert levels.",
    "NVDA closed at $118.40 (10.2% below your reference price)", "Downside alert triggered: −10%", "PLTR closed at $96.10 (41.5% above your reference price)", "Your upside alert level was reached",
    "A downside alert is your cue to pause and reread your rules. An upside alert is your cue to check whether one holding now makes up too much of your portfolio.",
    "Warm", "NASDAQ100", "Cold", "Closing-price Alerts",
    "When a stock’s closing price reaches a downside or upside level you’ve set, you get an email at your chosen morning delivery time (Japan Standard Time). No need to watch the market all day.",
    "Morning Note", "One short email the morning after an alert, to read with a rested mind.", "Shows how cool or hot the market is on a five-point scale. Helps you put market moves in perspective.",
    "See all →", "US Commerce Dept. plans wider limits on AI chip exports to China", "A major cloud provider scales back its data center spending plan", "A Moment to Breathe", "From RIZEL", "1:40",
    "When the Market Tumbles", "A short video from RIZEL and the \"won't do\" list you made, on one screen. A reminder that you don't have to decide tonight.",
    "News Risk Meter", "Highlights the day’s market-moving news and rates each story’s potential risk on a scale of 1 to 5 stars. No major news, no update.", "RIZEL's Take", "A one-line take from RIZEL on each story.",
    "Before the next market storm,", "have your rules ready.", "Creator of RESOLUTE",
    "It’s easy to feel anxious when markets crash and get carried away when prices soar. Having your own rules in place before emotions run high can help you stay grounded.",
    "RESOLUTE brings together what I’ve learned about staying grounded in the market in a kit anyone can use. It won’t tell you when to buy or sell. I designed every part to help you think clearly when markets move sharply.",
    "A market crash doesn’t have to throw you off course.", "When the market gets rough, remember RESOLUTE.",
    "Common questions", "I'm new to investing. Can I use it?", "Yes. Just tap to answer 30 straightforward questions. You don’t need any investing knowledge to get started.",
    "Will it tell me what to buy or when to sell?", "No. RESOLUTE doesn't recommend trades. It turns the rules you set into something you can hold onto, so you can come back to them when the market moves.",
    "Is it a one-time purchase?", "Your one-time purchase includes ongoing access to the core tools, plus one year of Closing-price Alerts, Morning Note, News Risk Meter, and RIZEL’s Take. After the first year, you can choose to renew these four features for another year. Renewal is optional and never automatic.",
    "How much does renewal cost?", "Renewal costs $39 per year, or $29 per year for active Tech Phase PRO members.", "Do I need Tech Phase PRO?",
    "No. You can purchase RESOLUTE without a Tech Phase PRO subscription. Every feature is included for the first year, with optional renewal for the four features listed above.",
    "Can I buy without an account?", "Yes. You don’t need an account to purchase. After payment, we’ll email you a link to create an account or sign in and activate your access.",
    "Can I get a refund?", "As a digital product, RESOLUTE can't be refunded after purchase. Please review the details before you buy.",
    "Legal Notice", "Terms of Service", "Privacy Policy", "RESOLUTE provides information, not investment advice.", "Screens shown are for illustrative purposes only.",
    "THE PERSONAL EDITION", "Rules that hold when markets shake", "Built from your answers, a book to return to", "A promise to myself", "MY RULES",
    "My investing approach", "When the news makes you want to act", "Don’t put your livelihood at the mercy of the market", "The page to open on a down day", "When in doubt, come back to this book",
    "Steady builder", "Time horizon", "10+ years", "Goal", "Steady growth", "You’re good at following a routine. Decide in advance whether to keep investing when prices fall, so you have a plan to follow.",
    "Know what makes you act", "When I buy:", "Same day each month", "Check prices:", "A few times a week", "Main holdings:", "Funds · ETFs", "Don’t let someone else’s recommendation replace your own rules.",
    "Decide what money to protect first", "Money to keep untouched", "$10,000", "Money needed within 3 years", "$0", "Available to invest", "$60,000", "Currently invested", "$20,000",
    "Never use money you need for living expenses to buy more investments.", "Use a 30% drop as the cue to review", "Loss I can tolerate", "$6,000", "3.6 months of living costs",
    "Don’t change your planned purchase amounts or limits because of one anxious day.",
  ];
  for (const phrase of phrases) assert.ok(lp.includes(phrase), `missing: ${phrase}`);
});

test("English differences: RIZEL, ten features, dollars, no tax feature, no tax or ¥ wording", () => {
  const page = read("../app/resolute/lp/landing-en.tsx");
  assert.equal((page.match(/<Feature /g) ?? []).length, 10);
  assert.ok(!/Tax|税|¥|リゼル/.test(lp));
  assert.ok(!/Real-time|real-time|guarantee|never lose/i.test(lp));
});

test("the English page buys through the English checkout and stays public", () => {
  const page = read("../app/resolute/lp/landing-en.tsx");
  assert.match(page, /CHECKOUT = "\/resolute\/checkout\?lang=en"/);
  assert.ok(!/clerk/i.test(page) && !/clerk|auth\(/i.test(read("../app/resolute/lp/en/page.tsx")));
  assert.match(read("../app/resolute/page.tsx"), /\(await searchParams\)\.lang === "en"/);
});
