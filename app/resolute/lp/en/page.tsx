import type { Metadata } from "next";
import LandingEn from "../landing-en";

// Public, no sign-in. Kept out of search until sales open.
// Rendered per request so the price switches by itself at 2027-03-01 00:00 JST (see lib/resolute/price.ts).
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
 title: "RESOLUTE | When markets crash, when markets soar, stick to your rules",
 description: "A kit that keeps your rules on your phone, ready for the days the market goes wild.",
 robots: { index: false, follow: false },
};
export default function Page() { return <LandingEn />; }
