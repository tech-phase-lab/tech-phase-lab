/** One look for every Clerk screen (sign-in, sign-up, two-step code, account security), so the pages the reader moves
 * through while logging in do not change style. Dark teal like the rest of the site; inputs are light text on a dark
 * field (the default left dark text on a dark field), buttons keep one line and a fixed minimum height. */
const text = "#eaf3f1", muted = "#adc0c6", field = "#0b151d", line = "#2c4450", accent = "#9bdec6";

export const clerkAppearance = {
  variables: {
    colorPrimary: accent, colorBackground: "#101e24", colorForeground: text, colorMutedForeground: muted,
    colorInput: field, colorInputForeground: text, colorNeutral: text, colorDanger: "#f08a93", borderRadius: "10px",
  },
  elements: {
    buttonArrowIcon: { display: "none" },
    rootBox: { width: "100%" },
    cardBox: { width: "100%", boxShadow: "none" },
    card: { padding: "24px", boxShadow: "none" },
    headerTitle: { fontSize: "20px", lineHeight: "1.5" },
    footerAction: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px" },
    footerActionText: { margin: 0, textAlign: "center" },
    footerActionLink: { display: "inline", margin: 0, color: accent },
    formFieldLabel: { color: muted },
    formFieldInput: { color: text, background: field, borderColor: line, minHeight: "44px" },
    otpCodeFieldInput: { color: text, background: field, borderColor: line, minHeight: "48px" },
    formButtonPrimary: { color: field, minHeight: "44px", height: "auto", whiteSpace: "nowrap", fontWeight: 600 },
    formButtonReset: { color: accent, minHeight: "40px", height: "auto", whiteSpace: "nowrap" },
    profileSectionPrimaryButton: { color: accent, whiteSpace: "nowrap", minHeight: "36px", height: "auto" },
    profileSectionTitleText: { color: text },
    socialButtonsBlockButton: { color: text, background: "#1c303b", border: `1px solid #55717c`, minHeight: "44px", height: "auto", "&:has(.cl-lastAuthenticationStrategyBadge)": { marginTop: "26px" } },
    socialButtonsBlockButtonText: { color: text },
    lastAuthenticationStrategyBadge: { top: "auto", bottom: "calc(100% + 7px)", insetInlineEnd: 0, transform: "none", height: "auto", maxWidth: "100%", fontSize: "11px", lineHeight: "16px", whiteSpace: "normal", background: "transparent", border: 0, boxShadow: "none", padding: 0 },
    // Account deletion is not offered from this screen (the app explains it is closed); never show the red section.
    profileSection__danger: { display: "none" },
  },
} as const;
