import { notificationJson } from "./notification-json.ts";
const path="/resolute/unsubscribe";
const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","Referrer-Policy":"no-referrer",
 "X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const tokenShape=(token:unknown):token is string=>typeof token==="string"&&/^u1\.[A-Za-z0-9_-]{40,1000}$/.test(token);
function page(locale:string,kind:"confirm"|"done"|"invalid"|"unavailable",token="") {
 const en=locale==="en",title=en?"RESOLUTE email preferences":"RESOLUTEのメール通知";
 const message=kind==="confirm"?(en?"Stop closing-price alerts and morning follow-up emails.":"終値アラートと翌朝ひとことのメールを停止します。"):
  kind==="done"?(en?"Your RESOLUTE email notifications are stopped.":"RESOLUTEのメール通知を停止しました。"):
  kind==="invalid"?(en?"This link is invalid or has expired. You can stop emails in your notification settings after signing in.":"リンクが無効か期限切れです。ログイン後の通知設定から停止できます。"):
  (en?"We could not confirm the change. Please try again later or check your notification settings.":"変更の完了を確認できませんでした。時間をおいて再度お試しいただくか、通知設定をご確認ください。");
 const form=kind==="confirm"?`<form method="post" action="${path}?lang=${en?"en":"ja"}"><input type="hidden" name="token" value="${token}"><button name="confirm" value="stop" type="submit">${en?"Stop emails":"メール通知を停止する"}</button></form>`:"";
 return new Response(`<!doctype html><html lang="${en?"en":"ja"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p>${form}<p><a href="/resolute/alerts">${en?"Notification settings":"通知設定"}</a></p></main></body></html>`,{status:kind==="invalid"?400:kind==="unavailable"?503:200,headers});
}
async function formToken(request:Request) {
 if(request.headers.get("content-type")?.split(";",1)[0].toLowerCase()!=="application/x-www-form-urlencoded")throw new Error();
 const reader=request.body?.getReader();if(!reader)throw new Error();
 const decoder=new TextDecoder("utf-8",{fatal:true});let text="",size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw new Error();text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
 catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 const params=new URLSearchParams(text);
 if([...params.keys()].length!==2||params.getAll("token").length!==1||params.getAll("confirm").length!==1||params.get("confirm")!=="stop"||!tokenShape(params.get("token")))throw new Error();
 return params.get("token")!;
}
export function createMailStopPage(deps:{enabled:()=>boolean;forward:(token:string)=>Promise<boolean>}) {
 return {
  async GET(request:Request){
   const url=new URL(request.url),locale=url.searchParams.get("lang")??"ja";
   if(!deps.enabled())return page(locale,"unavailable");
   if(!["ja","en"].includes(locale)||url.searchParams.getAll("token").length!==1||url.searchParams.getAll("lang").length>1||[...url.searchParams.keys()].some(k=>!["token","lang"].includes(k))||!tokenShape(url.searchParams.get("token")))return page(locale,"invalid");
   // Link scanners and prefetches are read-only: no backend call and no mutation.
   return page(locale,"confirm",url.searchParams.get("token")!);
  },
  async POST(request:Request){
   const url=new URL(request.url),locale=url.searchParams.get("lang")??"ja";
   if(!deps.enabled())return page(locale,"unavailable");
   if(request.headers.get("origin")!==url.origin||!["ja","en"].includes(locale)||url.searchParams.getAll("lang").length>1||[...url.searchParams.keys()].some(k=>k!=="lang"))return page(locale,"invalid");
   let token:string;try{token=await formToken(request);}catch{return page(locale,"invalid");}
   try{return page(locale,await deps.forward(token)?"done":"invalid");}catch{return page(locale,"unavailable");}
  }
 };
}
export async function forwardMailStop(token:string,base:string|undefined,secret:string|undefined,fetcher:typeof fetch=fetch) {
 if(!tokenShape(token)||!base||!secret||secret.length<43)throw new Error("Stop unavailable");
 const url=new URL(base);
 if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash||url.pathname!=="/"||!url.hostname.endsWith(".up.railway.app"))throw new Error("Stop unavailable");
 url.pathname="/internal/v1/notification-stop";
 const response=await fetcher(url,{method:"POST",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000),
  headers:{"X-Resolute-Service-Token":secret,"Content-Type":"application/json"},body:JSON.stringify({token})});
 const body=await notificationJson(response);
 if(response.status===200&&body?.stopped===true&&Object.keys(body).length===1)return true;
 if(response.status===400&&body?.error==="INVALID_STOP_LINK")return false;
 throw new Error("Stop unavailable");
}
