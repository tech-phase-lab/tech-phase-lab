"use client";
import { SignIn, useAuth } from "@clerk/nextjs";
import { OWNER_ACCOUNT_ID } from "@/lib/membership/entitlements";
import CheckoutScreen, { type CheckoutProps } from "./screen";
import styles from "./styles.module.css";
export default function CheckoutIdentity(props: CheckoutProps) {
 const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
 const en = props.language === "en";
 const returnPath = `/resolute/checkout?lang=${props.language}${props.orderId ? `&order=${props.orderId}` : ""}${props.cancelled ? "&cancel=1" : ""}`;
 if (!isLoaded || !isSignedIn || userId !== OWNER_ACCOUNT_ID) return <main className={styles.page}><section className={styles.card}>
  <h1>RESOLUTE</h1><p>{en ? "Sandbox checkout is for the owner account only." : "テスト購入は運営者アカウント専用です。"}</p>
  {!isLoaded ? <p role="status">{en ? "Checking your account…" : "ログインを確認しています…"}</p> : !isSignedIn ?
   <SignIn routing="hash" forceRedirectUrl={returnPath} signUpUrl="/research/account/sign-up"/> :
   <a href="/research/account">{en ? "Check your account" : "ログイン中のアカウントを確認する"}</a>}
 </section></main>;
 return <CheckoutScreen key={`${sessionId}:${props.orderId}`} {...props}/>;
}
