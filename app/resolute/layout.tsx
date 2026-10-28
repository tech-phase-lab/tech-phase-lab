import localFont from "next/font/local";
import type { ReactNode } from "react";
const sans = localFont({src:"./fonts/noto-sans-jp.woff2",weight:"100 900",display:"swap",preload:false,variable:"--font-resolute-sans"});
const serif = localFont({src:"./fonts/noto-serif-jp.woff2",weight:"200 900",display:"swap",preload:false,variable:"--font-resolute-serif"});
export default function ResoluteLayout({children}:{children:ReactNode}) {
 return <div className={`${sans.variable} ${serif.variable}`}>{children}</div>;
}
