import {auth} from '@clerk/nextjs/server';
import {membershipConfigured} from '@/lib/membership/server';
import {isOwnerAccount} from '@/lib/membership/entitlements';
import OwnerScreen from './screen';
export const dynamic='force-dynamic';
export const metadata={title:'RESOLUTE | News owner controls',robots:{index:false,follow:false}};
export default async function Page(){if(!membershipConfigured())return <p>ログインを確認できません</p>;const {userId}=await auth();if(!isOwnerAccount(userId))return <p>オーナー専用です <a href="/research/account">ログイン</a></p>;return <OwnerScreen/>;}
