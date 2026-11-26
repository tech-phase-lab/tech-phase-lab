"use client";
import { useDiagnosisSessionIdentity } from "../resolute/use-diagnosis-session";
import { waitForIdentity } from "@/lib/research/member-recovery";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const IdentityRefresh = createContext<(force?: boolean) => Promise<void>>(async () => {});
export function useIdentityRefresh() { return useContext(IdentityRefresh); }
const IdentitySignedIn = createContext<boolean | null>(false);
/** Whether a visitor is signed in: null while the identity SDK is still loading, false when sign-in is not configured.
 * Member-only APIs (favorites, saved research, deep analysis) are called only when this is true, so a signed-out page
 * no longer fills the console with 401 answers (production QA, Nov 24). The APIs still verify membership themselves. */
export function useIdentitySignedIn() { return useContext(IdentitySignedIn); }
function IdentitySession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, sessionId } = useAuth();
  useDiagnosisSessionIdentity(isLoaded,sessionId);
  const pending = useRef<{ sessionId: string | null | undefined; task: Promise<void> } | null>(null);
  const refresh = useCallback(async (force = false) => {
    if (!isLoaded) throw Error("identity-loading");
    if (!isSignedIn) return;
    // Never reuse a token refresh belonging to a previous signed-in session.
    if (pending.current && pending.current.sessionId === sessionId) return pending.current.task;
    const task = waitForIdentity(getToken({ skipCache: force }), AbortSignal.timeout(10_000)).then(() => {});
    pending.current = { sessionId, task };
    try { await task; } finally { if (pending.current?.task === task) pending.current = null; }
  }, [isLoaded, isSignedIn, getToken, sessionId]);
  return <IdentityRefresh.Provider value={refresh}><IdentitySignedIn.Provider value={isLoaded ? isSignedIn === true : null}>{children}</IdentitySignedIn.Provider></IdentityRefresh.Provider>;
}
import { useResearchLanguage } from "./use-research-language";

type Localization = NonNullable<Parameters<typeof ClerkProvider>[0]["localization"]>;
const localized: { ja?: Localization; en?: Localization } = {};
let loading: Promise<void> | null = null;
/** The sign-in screens' Japanese and English wording (about 55 KB compressed) is loaded beside the page instead of inside every
 * /research page's first script (speed, Nov 26): only the account, security and writer screens show Clerk's own forms, and they
 * wait for it (useIdentityWordingReady). The wording itself is unchanged. */
function loadLocalizations(): Promise<void> {
  return loading ??= Promise.all([import("@clerk/localizations/ja-JP"), import("@clerk/localizations/en-US")]).then(([{ jaJP }, { enUS }]) => {
    localized.ja = {
      ...jaJP,
      formFieldInputPlaceholder__emailAddress: "例：name@example.com",
      socialButtonsBlockButton: "{{provider|titleize}}でログイン",
      signIn: {...jaJP.signIn, start: {...jaJP.signIn?.start,
        title: "Tech Phaseにログイン", titleCombined: "Tech Phaseにログイン",
        subtitle: "", subtitleCombined: "", actionText: "初めての方はこちら", actionLink: "無料で会員登録"}},
      signUp: {...jaJP.signUp, start: {...jaJP.signUp?.start,
        title: "Tech Phaseの無料会員登録", titleCombined: "Tech Phaseの無料会員登録",
        subtitle: "", subtitleCombined: "", actionText: "登録済みの方はこちら", actionLink: "ログイン"}},
    };
    localized.en = enUS;
  }).catch(error => { loading = null; throw error; });
}
// Started as soon as this module runs in the browser, alongside the identity SDK's own download.
if (typeof window !== "undefined") void loadLocalizations().catch(() => {});
const WordingReady = createContext(true);
/** True once Clerk's forms have their Japanese/English wording; a screen that shows <SignIn>, <SignUp> or <UserProfile> waits for it. */
export function useIdentityWordingReady() { return useContext(WordingReady); }
/** Keep the identity SDK mounted across research navigation so session renewal continues. */
export default function ResearchIdentityProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [lang] = useResearchLanguage();
  // Starts false on the server and in hydration alike (the forms render nothing before the SDK loads, which takes longer).
  const [wordingReady, setWordingReady] = useState(false);
  useEffect(() => {
    if (wordingReady) return;
    let active = true, retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => loadLocalizations().then(() => { if (active) setWordingReady(true); }, () => { if (active) retry = setTimeout(load, 3_000); });
    void load();
    return () => { active = false; clearTimeout(retry); };
  }, [wordingReady]);
  if (!enabled) return children;
  return <ClerkProvider appearance={clerkAppearance} localization={wordingReady ? localized[lang === "ja" ? "ja" : "en"] : undefined} signInUrl="/research/account" signUpUrl="/research/account/sign-up"><WordingReady.Provider value={wordingReady}><IdentitySession>{children}</IdentitySession></WordingReady.Provider></ClerkProvider>;
}
