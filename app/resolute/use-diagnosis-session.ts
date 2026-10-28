"use client";
import { useEffect } from "react";
import { reconcileDiagnosisSession } from "@/lib/resolute/diagnosis-session-identity";
// Loading is not sign-out. Session replacement/sign-out removes tab drafts, including
// when the user logs out on the shared Tech Phase account page.
export function useDiagnosisSessionIdentity(loaded: boolean, session: string|null|undefined) {
 useEffect(()=>{if(loaded)reconcileDiagnosisSession(session ?? null);},[loaded,session]);
}
