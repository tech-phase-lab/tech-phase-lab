import type { ReactNode } from "react";

/** How to put RESOLUTE on the phone's home screen. Presentational only (used on the home card and on the landing page). */
export const ADD_TO_HOME_JA: ReactNode[] = [
  <>iPhoneは<b>Safari</b>で、このページを開きます(LINEやメールの中で開いた画面ではなく)。</>,
  <>画面の下の<b>「共有」ボタン</b>(四角に上向きの矢印)を押します。</>,
  <>一覧から<b>「ホーム画面に追加」</b>を選び、右上の<b>「追加」</b>を押します。</>,
  <>ホーム画面に、<b>錨のアイコン</b>のRESOLUTEが入ります。そこから開くと、Tech Phaseを通らず、すぐ開けます。</>,
];
export const ADD_TO_HOME_EN: ReactNode[] = [
  <>On iPhone, open this page in <b>Safari</b> (not inside LINE or an email).</>,
  <>Tap the <b>Share</b> button at the bottom (a square with an up arrow).</>,
  <>Choose <b>Add to Home Screen</b>, then tap <b>Add</b> at the top right.</>,
  <>RESOLUTE is added with an <b>anchor icon</b>. Open it from there, without going through Tech Phase.</>,
];
export const ADD_TO_HOME_ANDROID_JA = "Androidは、Chromeの右上のメニュー(︙)から「ホーム画面に追加」を選びます。";
export const ADD_TO_HOME_ANDROID_EN = "On Android, use the Chrome menu (⋮) and choose Add to Home screen.";

export default function AddToHomeSteps({ en = false, className }: { en?: boolean; className?: string }) {
  const steps = en ? ADD_TO_HOME_EN : ADD_TO_HOME_JA;
  return <div className={className}>
    <ol>{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    <p>{en ? ADD_TO_HOME_ANDROID_EN : ADD_TO_HOME_ANDROID_JA}</p>
  </div>;
}
