import type {Metadata} from 'next';
import {ClerkProvider} from '@clerk/nextjs';
import {membershipConfigured} from '@/lib/membership/server';
import ResoluteIdentity from '../identity';
import WallScreen from './screen';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'RESOLUTE | Your rules, close at hand',robots:{index:false,follow:false}};
export default function Page(){if(!membershipConfigured())return <WallScreen/>;return <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity extra="wall"/></ClerkProvider>;}
