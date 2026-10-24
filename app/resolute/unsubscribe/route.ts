import { createMailStopPage, forwardMailStop } from "@/lib/resolute/notification-stop-page";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const routes=createMailStopPage({
 enabled:()=>process.env.RESOLUTE_MAIL_STOP_PUBLIC_ENABLED==="true",
 forward:token=>forwardMailStop(token,process.env.RESOLUTE_API_URL,process.env.RESOLUTE_API_SERVICE_TOKEN),
});
export const GET=routes.GET;
export const POST=routes.POST;
