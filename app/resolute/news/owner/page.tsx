import {auth} from '@clerk/nextjs/server';
import {membershipConfigured} from '@/lib/membership/server';
import {isOwnerAccount} from '@/lib/membership/entitlements';
import OwnerScreen from './screen';
import {editTarget} from '@/lib/resolute/shock-picks';
export const dynamic='force-dynamic';
export const metadata={title:'RESOLUTE | Shock Gauge owner controls',robots:{index:false,follow:false}};
/** Owner accounts only. `?edit=<story id>` (the morning mail's 「このニュースを直す」) opens just that story. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){if(!membershipConfigured())return <p>ログインを確認できません</p>;const {userId}=await auth();if(!isOwnerAccount(userId))return <p>オーナー専用です <a href="/research/account">ログイン</a></p>;const edit=editTarget((await searchParams).edit);return <OwnerScreen edit={edit}/>;}
