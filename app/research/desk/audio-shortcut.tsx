import styles from "./format.module.css";
export default function AudioShortcut() {
  return <details className={styles.audioReview}><summary>ボイスメモから送るための初回設定</summary><p>iPhoneの「ショートカット」を一度設定すると、ボイスメモの共有からこの画面を開けます。「ボイスメモから読み込む」で受け取り、試聴してから添付・公開します。</p><a href="/desk-voice-memo-shortcut.html" target="_blank" rel="noopener noreferrer">ショートカットの設定手順を開く</a><small>共有や読み込みだけではアップロード・公開されません。</small></details>;
}
