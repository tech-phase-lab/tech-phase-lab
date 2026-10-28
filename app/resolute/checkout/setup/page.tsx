import { auth } from '@clerk/nextjs/server';
import { OWNER_ACCOUNT_ID } from '@/lib/membership/entitlements';
import { sandboxTester } from '@/lib/resolute/sandbox-access';
import SetupButton from './setup-button';
import styles from '../styles.module.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'RESOLUTE | テスト会員のPRO設定', robots: { index: false, follow: false } };
export default async function SetupPage() {
 const { userId } = await auth();
 const allowed = process.env.VERCEL_ENV === 'preview' && userId === OWNER_ACCOUNT_ID && sandboxTester(process.env);
 return <main className={styles.page}><section className={styles.card}>
  <h1>テスト会員のPRO設定</h1>
  {allowed ? <><p>登録済みのテスト会員だけに、期限付きのPRO資格を設定します。料金は発生しません。</p>
   <p>有効期限：{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'long', timeStyle: 'short' }).format(new Date(process.env.RESOLUTE_SANDBOX_TEST_UNTIL!))}（日本時間）</p>
   <SetupButton /></> : <><p>この操作は運営者アカウント専用です。運営者でログインしている通常のブラウザから開いてください。</p><a href="/research/account">ログイン中のアカウントを確認する</a></>}
 </section></main>;
}
