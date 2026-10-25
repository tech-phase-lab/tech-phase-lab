"use client";
import { SignIn, useAuth } from "@clerk/nextjs";
import { useDiagnosisSessionIdentity } from "../use-diagnosis-session";
import ReviewScreen from "./screen";
import styles from "../diagnosis.module.css";
export default function ReviewIdentity() {
 const { isLoaded, isSignedIn, sessionId, getToken } = useAuth();
 useDiagnosisSessionIdentity(isLoaded,sessionId);
 if (!isLoaded || !isSignedIn) return <main className={styles.page}><div className={styles.wrap}>
  <section className={styles.card}><h1>RESOLUTE</h1><p>RIZELさんの運営者アカウントでログインすると、購入前でも①〜⑥を操作できます。</p>
   {isLoaded ? <SignIn routing="hash" forceRedirectUrl="/resolute/review" signUpUrl="/research/account/sign-up"/> : <p role="status">ログインを確認しています…</p>}
  </section></div></main>;
 // A changed session discards the entire in-memory workspace immediately.
 return <ReviewScreen key={sessionId} getSessionToken={getToken} draftSession={sessionId ?? undefined}/>;
}
