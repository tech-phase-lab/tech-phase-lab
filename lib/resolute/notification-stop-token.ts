import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PURPOSE=Buffer.from("resolute-mail-stop-v1");
const LIFETIME=366*24*3600;
export class InvalidStopToken extends Error {constructor(){super("Invalid mail stop link");}}
export function createMailStopTokens(key:Buffer,now:()=>number=Date.now) {
 if(key.length!==32)throw new Error("Dedicated mail stop key required");
 const secret=Buffer.from(key);
 return {
  issue(userId:string,locale:"ja"|"en") {
   if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId)||!["ja","en"].includes(locale))throw new InvalidStopToken();
   const issued=Math.floor(now()/1000);if(!Number.isSafeInteger(issued)||issued<0)throw new InvalidStopToken();
   const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",secret,iv);cipher.setAAD(PURPOSE);
   const data=Buffer.from(JSON.stringify({v:1,sub:userId,locale,iat:issued,exp:issued+LIFETIME}));
   const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
   return "u1."+Buffer.concat([iv,encrypted,cipher.getAuthTag()]).toString("base64url");
  },
  verify(token:unknown) {
   try{
    if(typeof token!=="string"||!/^u1\.[A-Za-z0-9_-]{40,1000}$/.test(token))throw new Error();
    const raw=Buffer.from(token.slice(3),"base64url");if(raw.toString("base64url")!==token.slice(3))throw new Error();
    const decipher=createDecipheriv("aes-256-gcm",secret,raw.subarray(0,12));decipher.setAAD(PURPOSE);decipher.setAuthTag(raw.subarray(-16));
    const p=JSON.parse(Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()]).toString("utf8"));
    const time=Math.floor(now()/1000);
    if(!Number.isSafeInteger(time)||p?.v!==1||Object.keys(p).length!==5||!/^user_[A-Za-z0-9]{1,128}$/.test(p.sub)||
     !["ja","en"].includes(p.locale)||!Number.isSafeInteger(p.iat)||!Number.isSafeInteger(p.exp)||p.exp-p.iat!==LIFETIME||p.iat>time||time>=p.exp)throw new Error();
    return {userId:p.sub as string,locale:p.locale as "ja"|"en"};
   }catch{throw new InvalidStopToken();}
  }
 };
}
export function mailStopLinks(origin:string,tokens:ReturnType<typeof createMailStopTokens>,userId:string,locale:"ja"|"en") {
 const base=new URL(origin);if(base.protocol!=="https:"||base.origin!==origin||base.username||base.password)throw new Error("Invalid mail origin");
 const stop=new URL("/resolute/unsubscribe",base);stop.searchParams.set("token",tokens.issue(userId,locale));stop.searchParams.set("lang",locale);
 return {planUrl:origin+"/resolute/notebook",unsubscribeUrl:stop.href};
}
