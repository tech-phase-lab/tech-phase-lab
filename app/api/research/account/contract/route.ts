import {accountIdentity,readContract,reply,accountError} from '@/lib/account/server';
export const dynamic='force-dynamic';
export async function GET(){try{return reply(await readContract(await accountIdentity()));}catch(e){return accountError(e);}}
