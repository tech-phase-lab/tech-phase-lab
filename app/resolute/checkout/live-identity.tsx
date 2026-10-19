"use client";
import { SignIn, useAuth } from "@clerk/nextjs";
import { checkoutUrl } from "@/lib/resolute/live-checkout";
import type { CheckoutProps } from "./screen";
import LiveCheckoutScreen from "./live-screen";
import styles from "./styles.module.css";
export default function LiveCheckoutIdentity(props: CheckoutProps & {salesEnabled:boolean}) {
 const {isLoaded,isSignedIn,sessionId}=useAuth();
 const en=props.language==="en";
 if(!isLoaded || !isSignedIn)return <main className={styles.page}><section className={styles.card}>
  <h1>RESOLUTE</h1><p>{en?"Sign in to connect your purchase to your account.":"購入と利用権をアカウントに紐づけるため、ログインしてください。"}</p>
  {!isLoaded?<p role="status">{en?"Checking your account…":"ログインを確認しています…"}</p>:
   <SignIn routing="hash" forceRedirectUrl={checkoutUrl(props.language,props.orderId,props.cancelled)} signUpUrl="/research/account/sign-up"/>}
 </section></main>;
 return <LiveCheckoutScreen key={`${sessionId}:${props.orderId}`} {...props}/>;
}
