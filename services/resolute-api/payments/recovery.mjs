import { createHmac, timingSafeEqual } from 'node:crypto';
import { reject } from './policy.mjs';

const uuid=v=>typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const RECOVERY_LIFETIME=30*86400000;
export function recoveryTokens(key, now=Date.now) {
  if(typeof key!=='string' || !/^[a-f0-9]{64}$/.test(key)) throw Error('Dedicated recovery key required');
  const sign=value=>createHmac('sha256',Buffer.from(key,'hex')).update('resolute-receive-v1\n'+value).digest();
  return {
    issue(order) {
      const paid=new Date(order.paid_at).getTime(),exp=paid+RECOVERY_LIFETIME;
      if(!uuid(order.id)||!Number.isSafeInteger(paid)||now()>=exp)reject('RECOVERY_EXPIRED',410);
      const body=Buffer.from(JSON.stringify({v:1,id:order.id,paid,exp})).toString('base64url');
      return body+'.'+sign(body).toString('base64url');
    },
    read(token) {
      if(typeof token!=='string'||token.length>512||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))reject('INVALID_RECOVERY_LINK',400);
      const [body,signature]=token.split('.'),mac=Buffer.from(signature,'base64url');
      if(mac.length!==32||mac.toString('base64url')!==signature||!timingSafeEqual(mac,sign(body)))reject('INVALID_RECOVERY_LINK',400);
      let value;try{value=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{reject('INVALID_RECOVERY_LINK',400);}
      if(value?.v!==1||!uuid(value.id)||!Number.isSafeInteger(value.paid)||value.paid>now()+5000||value.exp!==value.paid+RECOVERY_LIFETIME)reject('INVALID_RECOVERY_LINK',400);
      if(now()>=value.exp)reject('RECOVERY_EXPIRED',410);
      return value;
    },
  };
}

export function recoveryMail(order,token,origin) {
  const u=new URL(origin);
  if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password)throw Error('Public origin required');
  const en=order.quote.language==='en';
  // Fragment is not sent in HTTP requests, access logs, or referrer headers.
  const link=`${origin}/resolute/receive?lang=${en?'en':'ja'}#${token}`;
  return en ? {subject:'Your RESOLUTE purchase — activate your access',text:
    `Thank you for purchasing RESOLUTE.\n\nOpen the link below, sign in or create an account, then confirm which account should receive your purchase. Opening the link alone does not activate access.\n\n${link}\n\nThis link expires 30 days after payment. Keep it private. Your included year starts on the payment date.\nOrder: ${order.id}\n\nIf you have already connected your purchase, you do not need to do anything. If the link has expired, contact support with your order number. Do not purchase again.`}
    : {subject:'RESOLUTEのご購入ありがとうございます｜受け取りのご案内',text:
    `RESOLUTEをご購入いただき、ありがとうございます。\n\n下のリンクからログインまたはアカウントを作成し、受け取るアカウントを確認してください。リンクを開いただけでは紐づけられません。\n\n${link}\n\nリンクの有効期限は決済日から30日間です。他の人には共有しないでください。1年間の対象期間は決済日から始まります。\n注文番号：${order.id}\n\nすでに受け取り済みの場合、操作は不要です。期限が切れた場合は、再購入せずに注文番号を添えてお問い合わせください。`};
}
