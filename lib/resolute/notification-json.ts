export class NotificationHttpError extends Error {
 readonly status:number;
 constructor(status:number) {super("Notification request failed");this.status=status;}
}
export async function notificationJson(input: Request|Response) {
 if(input.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json") throw new NotificationHttpError(415);
 const reader=input.body?.getReader();if(!reader)throw new NotificationHttpError(400);
 const decoder=new TextDecoder("utf-8",{fatal:true});let text="",size=0;
 try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>8192)throw new NotificationHttpError(413);text+=decoder.decode(value,{stream:true});}
  return JSON.parse(text+decoder.decode());
 }catch(e){await reader.cancel();if(e instanceof NotificationHttpError)throw e;throw new NotificationHttpError(400);}
 finally{reader.releaseLock();}
}
