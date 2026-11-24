import { jaJP } from "@clerk/localizations";

/** Japanese Clerk wording for RESOLUTE sign-in screens (production QA, Nov 24: /resolute/review showed English).
 * Plain strings only, so a server page can hand it to ClerkProvider. */
export const resoluteClerkJa = {
  ...jaJP,
  formFieldInputPlaceholder__emailAddress: "例：name@example.com",
  socialButtonsBlockButton: "{{provider|titleize}}でログイン",
};
