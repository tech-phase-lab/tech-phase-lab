import { createHash } from 'node:crypto';
import { serviceTokenMatches } from '../auth.mjs';

// Random 256-bit bearer capability, carried only by the trusted web proxy.
// Neither PayPal order IDs nor customer email addresses prove ownership.
export const isGuest = value => typeof value === 'string' && /^guest_[a-f0-9]{64}$/.test(value);
export function guestIdentity(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  return `guest_${createHash('sha256').update(token).digest('hex')}`;
}
export function authenticateGuest(headers, config) {
  if (!serviceTokenMatches(headers.get('x-resolute-service-token'), config.serviceToken)) return null;
  return guestIdentity(headers.get('x-resolute-guest-token'));
}
