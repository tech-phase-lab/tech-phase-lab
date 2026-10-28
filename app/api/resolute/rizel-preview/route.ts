import {RIZEL_LAYOUT_IDS} from '@/lib/resolute/rizel-private-registry';
import {auth} from '@clerk/nextjs/server';
import {membershipConfigured} from '@/lib/membership/server';
import {canReviewResolute} from '@/lib/resolute/review-policy';
import {readPrivateRizelPreview} from '@/lib/resolute/rizel-private-bank';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request) {
 try {
  if(!membershipConfigured())return Response.json({}, {status:503,headers});
  const {userId}=await auth();
  if(!userId||!canReviewResolute(userId,process.env.VERCEL_ENV))return Response.json({}, {status:403,headers});
  const stars=Number(new URL(request.url).searchParams.get('stars'));
  if(!Number.isInteger(stars)||stars<1||stars>5)return Response.json({}, {status:400,headers});
  const group=stars<=2?'A':stars===3?'B':'C',bank=await readPrivateRizelPreview();
  // Layout preview only: explicit fixed examples, NOT an AI article selection.
  const ids=RIZEL_LAYOUT_IDS.filter(id=>id.startsWith(group+'-'));
  const entries=ids.map(id=>bank.find(e=>e.id===id)!);
  if(entries.some(e=>!e))throw Error('MISSING_COPY');
  const copy=(locale:'ja'|'en')=>({title:locale==='ja'?entries[0].text:entries[0].english!.text,reasons:entries.slice(1).map(e=>locale==='ja'?e.text:e.english!.text)});
  return Response.json({quote:{id:'private-layout-preview',approved:true,minStars:stars,maxStars:stars,ja:copy('ja'),en:copy('en')}},{headers});
 }catch{return Response.json({error:'private_preview_unavailable'},{status:503,headers});}
}
