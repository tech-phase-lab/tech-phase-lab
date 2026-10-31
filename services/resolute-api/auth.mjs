import {OWNER_ISSUER,OWNER_ORIGIN,ownerAccessFromVerifiedSession} from '../../lib/resolute/owner-access.ts';
import { timingSafeEqual } from 'node:crypto';
import { verifyToken } from '@clerk/backend';

export function serviceTokenMatches(candidate, expected) {
  if (!expected || expected.length < 43 || typeof candidate !== 'string') return false;
  const a=Buffer.from(candidate), b=Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b);
}
export function authConfig(env) {
  const issuer = new URL(env.RESOLUTE_CLERK_ISSUER);
  const parties = JSON.parse(env.RESOLUTE_CLERK_AUTHORIZED_PARTIES);
  if (issuer.protocol !== 'https:' || issuer.origin !== env.RESOLUTE_CLERK_ISSUER ||
      !Array.isArray(parties) || !parties.length || parties.some(p=> {
        const u=new URL(p); return u.protocol!=='https:' || u.origin!==p;
      }) || !env.RESOLUTE_CLERK_JWT_PUBLIC_KEY?.includes('BEGIN PUBLIC KEY') ||
      !serviceTokenMatches(env.RESOLUTE_API_SERVICE_TOKEN,env.RESOLUTE_API_SERVICE_TOKEN)) {
    throw Error('Invalid RESOLUTE authentication configuration');
  }
  const productionToken=env.RESOLUTE_PRODUCTION_API_SERVICE_TOKEN;
  const productionKey=env.RESOLUTE_PRODUCTION_CLERK_JWT_PUBLIC_KEY;
  if((productionToken||productionKey)&&(!serviceTokenMatches(productionToken,productionToken)||!productionKey?.includes('BEGIN PUBLIC KEY')))
    throw Error('Incomplete production RESOLUTE authentication');
  return { issuer:issuer.origin, parties, jwtKey:env.RESOLUTE_CLERK_JWT_PUBLIC_KEY,
    serviceToken:env.RESOLUTE_API_SERVICE_TOKEN,
    ...(productionToken?{production:{issuer:OWNER_ISSUER,parties:[OWNER_ORIGIN],jwtKey:productionKey,serviceToken:productionToken}}:{}) };

}
export async function authenticateSession(headers, config) {
  if(config.production&&serviceTokenMatches(headers.get('x-resolute-service-token'),config.production.serviceToken))config=config.production;
  if (!serviceTokenMatches(headers.get('x-resolute-service-token'),config.serviceToken)) return null;
  const authorization=headers.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization) || authorization.length>16384) return null;
  const token=authorization.slice(7);
  try {
    const data=await verifyToken(token,{jwtKey:config.jwtKey,
      authorizedParties:config.parties,clockSkewInMs:0});
    if (!data || data.iss!==config.issuer || !config.parties.includes(data.azp) ||
        !/^user_[A-Za-z0-9]{1,128}$/.test(data.sub ?? '') ||
        !/^sess_[A-Za-z0-9]+$/.test(data.sid ?? '') ||
        !Number.isFinite(data.exp) || !Number.isFinite(data.nbf) || !Number.isFinite(data.iat) ||
        data.iat > Date.now()/1000 || (data.sts && data.sts!=='active')) return null;
    return data;
  } catch { return null; }
}

export async function authenticate(headers,config) {
  return (await authenticateSession(headers,config))?.sub ?? null;
}
export async function authenticatePrincipal(headers,config) {
  const claims=await authenticateSession(headers,config);
  return claims?{userId:claims.sub,ownerAccess:ownerAccessFromVerifiedSession(claims)}:null;
}
