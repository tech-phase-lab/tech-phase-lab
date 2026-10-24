'use client';
import { useState } from 'react';
export default function SetupButton() {
 const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
 async function prepare() {
  setState('busy');
  try {
   const response = await fetch('/api/resolute/sandbox-pro', { method: 'POST', headers: { 'x-resolute-test-setup': '1' } });
   const result = await response.json();
   setState(response.ok && result.ok ? 'done' : 'error');
  } catch { setState('error'); }
 }
 return <><button type="button" disabled={state === 'busy' || state === 'done'} onClick={() => void prepare()}>
  {state === 'busy' ? '設定を確認しています…' : state === 'done' ? 'PRO設定が完了しました' : 'テスト会員をPROに設定する'}
 </button><p role="status">{state === 'done' ? '設定とサーバーでの再確認が完了しました。テスト会員の購入ページで「1年間の更新」を選んでください。' : state === 'error' ? '設定を確認できませんでした。購入へ進まず、この表示をお知らせください。' : ''}</p></>;
}
