import type {Metadata} from 'next';
import {ClerkProvider} from '@clerk/nextjs';
import {clerkAppearance} from '@/lib/clerk-appearance';
import {membershipConfigured} from '@/lib/membership/server';
import {loadThermometerSnapshot} from '@/lib/resolute/thermometer-server';
import ResoluteIdentity from '../identity';
import TonightScreen from './screen';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'RESOLUTE | A moment to breathe',robots:{index:false,follow:false}};
/** Tonight's move and 「今日と似た日」 come from the stored thermometer snapshot (read only, never a provider call). */
export default async function Page(){
 const snapshot=await loadThermometerSnapshot();
 if(!membershipConfigured())return <TonightScreen snapshot={snapshot}/>;
 return <ClerkProvider appearance={clerkAppearance} signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity extra="tonight" thermometerSnapshot={snapshot}/></ClerkProvider>;
}
