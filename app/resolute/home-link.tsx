"use client";
import { ReviewLink as Link } from "./review-context";
import h from "./tool-shell.module.css";

/** The way back to the RESOLUTE home, at the top left of every page except the home itself (owner, Nov 17:
 * "there is no back button"; tapping RESOLUTE also still works). Prefetched, so going home is instant. */
export default function HomeLink({ en }: { en: boolean }) {
 return <nav className={h.homeRow} aria-label={en ? "RESOLUTE home" : "RESOLUTEホーム"}>
  <Link href="/resolute" prefetch className={h.home} data-resolute-home="">
   <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>{en ? "Home" : "ホーム"}
  </Link>
 </nav>;
}
