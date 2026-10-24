import { launchBoot } from "@/lib/research/launch-boot";
import styles from "./launch-brand.module.css";

/** Server-rendered decoration: start before hydration, never replay on resume. */
export default function LaunchBrand() {
  return <>
    <div id="tech-phase-launch" aria-hidden="true" suppressHydrationWarning className={styles.launch}>
      <div className={styles.wordmark}>
        <svg className={styles.mark} viewBox="0 0 104 104" fill="currentColor"><path d="M2 32 72 2v28L2 60Z"/><path d="m27 56 19-8v50l-19-9Z"/><path d="m72 30 30 17v34l-49 21V65l19-9Z"/></svg>
        <strong>TECH PHASE</strong><span>RESEARCH</span><i />
      </div>
    </div>
    <script dangerouslySetInnerHTML={{ __html: launchBoot }} />
  </>;
}
