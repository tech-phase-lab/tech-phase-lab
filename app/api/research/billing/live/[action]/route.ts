import { handleLiveBilling as handle } from "@/lib/membership/billing-live";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  return handle(request, (await context.params).action);
}
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  return handle(request, (await context.params).action);
}
