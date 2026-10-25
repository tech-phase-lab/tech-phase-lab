import type { ReactNode } from "react";
import styles from "./access-screen.module.css";

/** The same shell spans identity loading and access verification. */
export default function ReviewAccessScreen({loading=false,message,children}:{loading?:boolean;message?:string;children?:ReactNode}) {
 return <main className={styles.page} lang="ja">
  <section className={styles.panel} aria-label="RESOLUTE" aria-busy={loading}>
   <div className={styles.emblem} aria-hidden="true"><span>R</span></div>
   <h1 className={styles.brand}>RESOLUTE</h1>
   {loading ? <>
    <div className={styles.track} aria-hidden="true"><span/></div>
    <p className={styles.message} role="status">画面を準備しています</p>
   </> : <>
    {message ? <p className={styles.message} role="status">{message}</p> : null}
    {children ? <div className={styles.actions}>{children}</div> : null}
   </>}
  </section>
 </main>;
}
