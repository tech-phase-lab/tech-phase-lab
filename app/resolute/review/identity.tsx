"use client";
import { SignIn, useAuth } from "@clerk/nextjs";
import { useDiagnosisSessionIdentity } from "../use-diagnosis-session";
import ReviewScreen from "./screen";
import ReviewAccessScreen from "./access-screen";
export default function ReviewIdentity() {
 const { isLoaded, isSignedIn, sessionId, getToken } = useAuth();
 useDiagnosisSessionIdentity(isLoaded,sessionId);
 if (!isLoaded) return <ReviewAccessScreen loading/>;
 if (!isSignedIn) return <ReviewAccessScreen message="RIZELさんの運営者アカウントでログインすると、購入前でも①〜⑥を操作できます。">
  <SignIn routing="hash" forceRedirectUrl="/resolute/review" signUpUrl="/research/account/sign-up"/>
 </ReviewAccessScreen>;
 // A changed session discards the entire in-memory workspace immediately.
 return <ReviewScreen key={sessionId} getSessionToken={getToken} draftSession={sessionId ?? undefined}/>;
}
