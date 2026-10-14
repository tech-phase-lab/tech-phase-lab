"use client";
import { useState } from 'react';
import type { useSavedResearch } from './use-saved-research';
import styles from './research.module.css';
export default function SavedSyncStatus({ collection, lang }: { collection: ReturnType<typeof useSavedResearch>; lang: 'ja' | 'en' }) {
  const [confirm, setConfirm] = useState(false);
  const t = (ja: string, en: string) => lang === 'ja' ? ja : en;
  const labels = {
    loading: t('保存データを確認中…', 'Loading saved research…'), guest: t('このブラウザーに保存 · ログインすると端末間で同期できます', 'Saved in this browser · Sign in to sync devices'),
    synced: t('アカウントに同期済み', 'Synced to your account'), saving: t('同期中…', 'Syncing…'),
    error: t('同期できませんでした。未送信の変更はこの端末に保持しています。', 'Sync unavailable. Pending edits are kept on this device.'),
    conflict: t('同じ書き込みが別の端末で変更されています。この端末の内容は保持しています。', 'The same annotation changed on another device. Your local draft is retained.'),
  };
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(collection.document, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'saved-research-draft.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return <div className={styles.savedSync}>
    <span role="status">{labels[collection.status]}</span>
    {collection.status === 'error' && <button onClick={collection.retry}>{t('再試行', 'Retry')}</button>}
    {collection.canImport && <button onClick={collection.importLocal}>{t('このブラウザーの保存記事・メモを引き継ぐ', 'Import this browser’s articles and notes')}</button>}
    {collection.status === 'conflict' && <>
      <button onClick={downloadDraft}>{t('この端末の内容をダウンロード', 'Download this draft')}</button>
      {!confirm ? <button onClick={() => setConfirm(true)}>{t('同期先の内容を使う', 'Use account version')}</button> : <>
        <span>{t('この端末の未送信分を取り消しますか？必要なら先にダウンロードしてください。', 'Discard pending edits? Download them first if needed.')}</span>
        <button onClick={() => { collection.discardPending(); setConfirm(false); }}>{t('取り消して読み込む', 'Discard and reload')}</button>
        <button onClick={() => setConfirm(false)}>{t('戻る', 'Cancel')}</button>
      </>}
    </>}
  </div>;
}
