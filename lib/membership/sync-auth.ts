import { createHash, timingSafeEqual } from 'node:crypto';
export function validSyncToken(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(createHash('sha256').update(header.slice(7)).digest(), createHash('sha256').update(secret).digest());
}
