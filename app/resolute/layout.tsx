import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
const sans = localFont({src:"./fonts/noto-sans-jp.woff2",weight:"100 900",display:"swap",preload:false,variable:"--font-resolute-sans"});
const serif = localFont({src:"./fonts/noto-serif-jp.woff2",weight:"200 900",display:"swap",preload:false,variable:"--font-resolute-serif"});
/** RESOLUTE can be put on the home screen as its own app (own name, icon and scope), separate from Tech Phase. */
export const metadata: Metadata = {
 manifest: "/resolute.webmanifest",
 icons: { icon: [{ url: "/resolute-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/resolute-180.png", sizes: "180x180", type: "image/png" }] },
 appleWebApp: { capable: true, title: "RESOLUTE" },
};
export default function ResoluteLayout({children}:{children:ReactNode}) {
 return <div className={`${sans.variable} ${serif.variable}`}>{children}</div>;
}
