import {ClerkProvider} from '@clerk/nextjs';
import {membershipConfigured} from '@/lib/membership/server';
import ResoluteIdentity from '../identity';
import DiagnosisScreen from '../screen';
export const dynamic='force-dynamic';
export default function Page(){if(!membershipConfigured())return <DiagnosisScreen/>;return <ClerkProvider signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity/></ClerkProvider>;}
