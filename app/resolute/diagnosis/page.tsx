import {ClerkProvider} from '@clerk/nextjs';
import {clerkAppearance} from '@/lib/clerk-appearance';
import {membershipConfigured} from '@/lib/membership/server';
import ResoluteIdentity from '../identity';
import DiagnosisScreen from '../screen';
export const dynamic='force-dynamic';
export default function Page(){if(!membershipConfigured())return <DiagnosisScreen/>;return <ClerkProvider appearance={clerkAppearance} signInUrl="/research/account" signUpUrl="/research/account/sign-up"><ResoluteIdentity/></ClerkProvider>;}
