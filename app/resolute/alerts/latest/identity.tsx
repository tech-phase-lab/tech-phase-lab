"use client";
import { useAuth } from "@clerk/nextjs";
import { useDiagnosisSessionIdentity } from "../../use-diagnosis-session";
import { lastViewSession, viewSession } from "@/lib/resolute/view-memory";
import LatestAlertScreen from "./screen";
/** Same identity handling as app/resolute/identity.tsx (the screen is not rebuilt when sign-in finishes loading). */
export default function LatestAlertIdentity() {
  const { isLoaded, sessionId: loadedSession } = useAuth();
  useDiagnosisSessionIdentity(isLoaded, loadedSession);
  const known = lastViewSession();
  if (isLoaded) viewSession(loadedSession ?? null);
  const sessionId = isLoaded ? loadedSession : known;
  return <LatestAlertScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} />;
}
