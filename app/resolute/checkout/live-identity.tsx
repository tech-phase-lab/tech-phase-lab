"use client";
import { SignIn, SignUp, useAuth, useUser } from "@clerk/nextjs";
import { checkoutUrl } from "@/lib/resolute/live-checkout";
import type { CheckoutProps } from "./screen";
import LiveCheckoutScreen from "./live-screen";
import styles from "./styles.module.css";
export default function LiveCheckoutIdentity(props: CheckoutProps & {salesEnabled:boolean;guestEnabled?:boolean;guestOrder?:boolean;signingUp?:boolean}) {
 const {isLoaded,isSignedIn,sessionId}=useAuth();
 const {user}=useUser();
 const en=props.language==="en";
 if(isLoaded && props.guestEnabled) return <LiveCheckoutScreen key={`${sessionId ?? "guest"}:${props.orderId}`} {...props}
  guest={Boolean(props.guestOrder || !isSignedIn)} signedIn={Boolean(isSignedIn)} accountLabel={user?.primaryEmailAddress?.emailAddress}
  signIn={id=>{
   const target=checkoutUrl(props.language,id,false,Boolean(id));
   return props.signingUp ? <SignUp routing="hash" forceRedirectUrl={target} signInUrl={target}/>
    : <SignIn routing="hash" forceRedirectUrl={target} signUpForceRedirectUrl={target} signUpUrl={`${target}&signup=1`}/>;
  }}/>;
 if(!isLoaded || !isSignedIn)return <main className={styles.page}><section className={styles.card}>
  <h1>RESOLUTE</h1><p>{en?"Sign in to connect your purchase to your account.":"購入と利用権をアカウントに紐づけるため、ログインしてください。"}</p>
  {!isLoaded?<p role="status">{en?"Checking your account…":"ログインを確認しています…"}</p>:
   <SignIn routing="hash" forceRedirectUrl={checkoutUrl(props.language,props.orderId,props.cancelled,props.guestOrder)} signUpUrl="/research/account/sign-up"/>}
 </section></main>;
 return <LiveCheckoutScreen key={`${sessionId}:${props.orderId}`} {...props}/>;
}
