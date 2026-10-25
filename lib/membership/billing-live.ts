import "server-only";
import {auth} from "@clerk/nextjs/server";
import {liveGateway} from "@/services/tech-phase-billing/live-transport.mjs";
export const handleLiveBilling=liveGateway({env:process.env,identity:async()=>(await auth()).userId});
