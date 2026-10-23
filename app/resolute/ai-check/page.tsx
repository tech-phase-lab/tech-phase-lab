import {auth} from '@clerk/nextjs/server';
import {membershipConfigured} from '@/lib/membership/server';
import {isOwnerAccount} from '@/lib/membership/entitlements';
import Screen from './screen';
export const dynamic='force-dynamic';
export const metadata={title:'RESOLUTE | AI接続確認',robots:{index:false,follow:false}};
export default async function Page(){
 const userId=membershipConfigured()?(await auth()).userId:null;
 if(!isOwnerAccount(userId))return <main><h1>運営者専用</h1><a href="/research/account">Tech Phaseにログインする</a></main>;
 return <Screen/>;
}
