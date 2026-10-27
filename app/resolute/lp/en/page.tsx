import type { Metadata } from "next";
import LandingEn from "../landing-en";

// Public, no sign-in. Kept out of search until sales open.
export const metadata: Metadata = {
 title: "RESOLUTE | When markets crash, when markets soar, stick to your rules",
 description: "A kit that keeps your rules on your phone, ready for the days the market goes wild.",
 robots: { index: false, follow: false },
};
export default function Page() { return <LandingEn />; }
