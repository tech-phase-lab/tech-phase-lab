"use client";
import { waitForIdentity } from "@/lib/research/member-recovery";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { jaJP, enUS } from "@clerk/localizations";
import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

const IdentityRefresh = createContext<(force?: boolean) => Promise<void>>(async () => {});
export function useIdentityRefresh() { return useContext(IdentityRefresh); }
function IdentitySession({ children }: { children: ReactNode }) {
  const { isLoaded, getToken, sessionId } = useAuth();
  const pending = useRef<{ sessionId: string | null | undefined; task: Promise<void> } | null>(null);
  const refresh = useCallback(async (force = false) => {
    if (!isLoaded) throw Error("identity-loading");
    // Never reuse a token refresh belonging to a previous signed-in session.
    if (pending.current?.sessionId === sessionId) return pending.current.task;
    const task = waitForIdentity(getToken({ skipCache: force }), AbortSignal.timeout(10_000)).then(() => {});
    pending.current = { sessionId, task };
    try { await task; } finally { if (pending.current?.task === task) pending.current = null; }
  }, [isLoaded, getToken, sessionId]);
  return <IdentityRefresh.Provider value={refresh}>{children}</IdentityRefresh.Provider>;
}
import { useResearchLanguage } from "./use-research-language";

const japanese = {
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
/** Keep the identity SDK mounted across research navigation so session renewal continues. */
export default function ResearchIdentityProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [lang] = useResearchLanguage();
  if (!enabled) return children;
  return <ClerkProvider appearance={{
    variables: {colorPrimary:"#9bdec6", colorBackground:"#101e24", colorForeground:"#eaf3f1", colorMutedForeground:"#adc0c6", colorInput:"#0b151d", colorInputForeground:"#eaf3f1", borderRadius:"10px"},
    elements: {buttonArrowIcon:{display:"none"},footerAction:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"6px"},footerActionText:{margin:0,textAlign:"center"},socialButtonsBlockButton:{color:"#eaf3f1",background:"#1c303b",border:"1px solid #55717c"},socialButtonsBlockButtonText:{color:"#eaf3f1"},rootBox:{width:"100%"},cardBox:{width:"100%",boxShadow:"none"},card:{padding:"24px",boxShadow:"none"},headerTitle:{fontSize:"20px",lineHeight:"1.5"},formButtonPrimary:{color:"#0b151d"},footerActionLink:{display:"inline",margin:0,color:"#9bdec6"}}
  }} localization={lang === "ja" ? japanese : enUS} signInUrl="/research/account" signUpUrl="/research/account/sign-up"><IdentitySession>{children}</IdentitySession></ClerkProvider>;
}
