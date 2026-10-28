'use client';

import { useRef, useState } from 'react';

const labels = {
  authenticatedSession: '実ログイン認証', isolatedDatabase: '独立した検証DB',
  staleBackupVerified: '削除前のバックアップ', independentReadback: '保護記録の独立読み戻し',
  firstReplay: '1回目の復元保護', secondReplay: '2回目の復元保護',
  planErased: '診断の削除維持', notificationsStopped: '通知停止の維持',
  pendingQueueEmpty: '送信待ちゼロ',
} as const;

export default function Screen({ enabled }: { enabled: boolean }) {
  const started = useRef(false);
  const [state, setState] = useState<'idle' | 'running' | 'verified' | 'failed'>('idle');
  const [verifiedAt, setVerifiedAt] = useState('');
  async function run() {
    if (!enabled || started.current) return;
    started.current = true;
    setState('running');
    try {
      const response = await fetch('/api/resolute/recovery-check', {
        method: 'POST', headers: { 'X-Resolute-Recovery-Check': '1' },
        cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw Error('Unavailable');
      const report = await response.json();
      if (report.state !== 'verified' || Object.keys(labels).some(key => report.checks?.[key] !== true) ||
        !Number.isFinite(Date.parse(report.verifiedAt)) ||
        ['productionTouched', 'mailSent', 'livePayment', 'aiCalled'].some(key => report[key] !== false))
        throw Error('Incomplete');
      setVerifiedAt(report.verifiedAt);
      setState('verified');
    } catch { setState('failed'); }
  }
  return <main style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
    <h1>RESOLUTE 復元確認</h1>
    <p>運営者専用。独立した検証データで削除と通知停止の維持を確認します。</p>
    <p>本番保存・メール送信・決済・AI呼び出しは有効にしません。</p>
    <button type="button" disabled={!enabled || state !== 'idle'} onClick={run}>
      {state === 'running' ? '確認中…' : '復元確認を1回実行'}
    </button>
    <div role="status" aria-live="polite">
      {!enabled ? <p>確認は無効です。</p> : null}
      {state === 'running' ? <p>完了まで画面を開いたままお待ちください。</p> : null}
      {state === 'failed' ? <p>完了を確認できません。再実行せず、実行ログを確認してください。</p> : null}
      {state === 'verified' ? <><p>復元確認が完了しました。{verifiedAt}</p>
        <ul>{Object.entries(labels).map(([key, label]) => <li key={key}>{label}：確認済み</li>)}</ul>
        <p>本番の保存機能は引き続き無効です。</p></> : null}
    </div>
  </main>;
}
