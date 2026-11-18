"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { TECH_PHASE_ENTRY_KEY, TECH_PHASE_HOME, cameFromTechPhase } from "@/lib/resolute/tech-phase-back";
import s from "./lp.module.css";

const subscribe = () => () => {};
function visible() {
 let mark: string | null = null;
 try { mark = sessionStorage.getItem(TECH_PHASE_ENTRY_KEY); } catch { /* storage may be blocked */ }
 return cameFromTechPhase(mark, document.referrer, location.origin);
}

/** "‹ Tech Phase" at the top left, for a visitor who came from Tech Phase only. Faint and laid over the corner,
 * so the landing page itself does not move or change (owner, Nov 18: barely noticeable). Tech Phase keeps the
 * reader's language on its own (saved on the device). */
export default function TechPhaseBack({ en }: { en: boolean }) {
 const show = useSyncExternalStore(subscribe, visible, () => false);
 if (!show) return null;
 return <Link href={TECH_PHASE_HOME} className={s.tpBack} aria-label={en ? "Back to Tech Phase" : "Tech Phaseへ戻る"} data-tech-phase-back="">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Tech Phase
 </Link>;
}
