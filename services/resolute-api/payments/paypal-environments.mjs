import { reject } from './policy.mjs';
const environments = Object.freeze({
  sandbox: Object.freeze({base:'https://api-m.sandbox.paypal.com', approvalOrigin:'https://www.sandbox.paypal.com',
    apiHosts:Object.freeze(['api.sandbox.paypal.com','api-m.sandbox.paypal.com'])}),
  live: Object.freeze({base:'https://api-m.paypal.com', approvalOrigin:'https://www.paypal.com',
    apiHosts:Object.freeze(['api.paypal.com','api-m.paypal.com'])}),
});
export function paypalEnvironment(name) {
  if (!Object.hasOwn(environments,name)) reject('PAYMENT_UNAVAILABLE',503);
  return environments[name];
}
export function paypalEnvironmentForBase(base) {
  const name=Object.keys(environments).find(name=>environments[name].base===base);
  if (!name) reject('PAYMENT_UNAVAILABLE',503);
  return name;
}
export function liveReturnUrl(origin) {
  let url; try { url=new URL(origin); } catch { reject('PAYMENT_UNAVAILABLE',503); }
  if (url.protocol!=='https:' || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) ||
      /(?:^|\.)(localhost|internal|test|invalid|example|vercel\.app)$/.test(url.hostname)) reject('PAYMENT_UNAVAILABLE',503);
  return `${url.origin}/resolute/checkout`;
}
