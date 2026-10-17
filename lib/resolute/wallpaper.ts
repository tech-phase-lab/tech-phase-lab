import type { PlanInput } from './plan-data.ts';
export type WallpaperOptions={type:number;size:number;background:number;locale:'ja'|'en'};
export function wallpaperRules(plan:PlanInput,en:boolean){
 return {tolerance:plan.tolerancePct===null?(en?'Not set':'未設定'):`−${plan.tolerancePct}%`,cap:`${plan.perStockCapPct}%`,
 lines:plan.buyMode==='none'?(en?'No adding to positions':'買い増ししない'):plan.buyLines.length?plan.buyLines.map(x=>`−${x.dropPct}%`).join(en?' / ':' と '):(en?'Not set':'未設定')};
}
/** Paint the reference DOM's measured layout into a local canvas, excluding preview clock/date.
 * No remote images, SVG foreignObject, external renderer or network request. */
export async function drawWallpaper(canvas:HTMLCanvasElement,phone:HTMLElement,background:number,photo:HTMLImageElement|null){
 await document.fonts.ready;
 canvas.width=1080;canvas.height=2279;
 const context=canvas.getContext('2d');if(!context)throw Error('Canvas unavailable');const ctx:CanvasRenderingContext2D=context;
 ctx.scale(3.6,2279/633);
 const bounds=phone.getBoundingClientRect(),scale=bounds.width/300,computed=getComputedStyle(phone),gold=computed.getPropertyValue('--g2').trim();
 const grad=ctx.createLinearGradient(0,0,0,633);grad.addColorStop(0,['#16263f','#141414','#f6f1e6','#0a1018'][background]);grad.addColorStop(background===2?.8:.75,['#0a1018','#030303','#e3d8bf','#0a1018'][background]);ctx.fillStyle=grad;ctx.fillRect(0,0,300,633);
 if(background===3&&photo){const scale=Math.max(300/photo.naturalWidth,633/photo.naturalHeight);ctx.drawImage(photo,(300-photo.naturalWidth*scale)/2,(633-photo.naturalHeight*scale)/2,photo.naturalWidth*scale,photo.naturalHeight*scale);const shade=ctx.createLinearGradient(0,0,0,633);shade.addColorStop(0,'rgba(5,8,12,.35)');shade.addColorStop(1,'rgba(5,8,12,.72)');ctx.fillStyle=shade;ctx.fillRect(0,0,300,633);}
 else{ctx.strokeStyle=background===2?'rgba(125,95,34,.06)':'rgba(216,179,106,.045)';ctx.lineWidth=1;for(let x=-640;x<640;x+=10){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+633,633);ctx.stroke();}}
 const box=(r:DOMRect)=>({x:(r.left-bounds.left)/scale,y:(r.top-bounds.top)/scale,w:r.width/scale,h:r.height/scale});
 const visible=(el:Element)=>!!el.getClientRects().length&&!el.closest('[data-preview-only]');
 // Borders, rounded rule cards and the double-frame decoration use actual layout sizes.
 for(const el of phone.querySelectorAll<HTMLElement>('*')){if(!visible(el))continue;const style=getComputedStyle(el),r=box(el.getBoundingClientRect());
  const diamond=el.hasAttribute('data-wall-emblem');
  if(diamond){const width=parseFloat(style.width),height=parseFloat(style.height);ctx.save();ctx.translate(r.x+r.w/2,r.y+r.h/2);ctx.rotate(Math.PI/4);ctx.strokeStyle=gold;ctx.lineWidth=1;ctx.strokeRect(-width/2,-height/2,width,height);ctx.globalAlpha=.5;ctx.strokeRect(-17,-17,34,34);ctx.restore();continue;}
  const radius=parseFloat(style.borderTopLeftRadius)||0;
  if(style.backgroundColor!=='rgba(0, 0, 0, 0)'){ctx.fillStyle=style.backgroundColor;ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,radius);ctx.fill();}
  const sides=[['Top',r.x,r.y,r.x+r.w,r.y],['Right',r.x+r.w,r.y,r.x+r.w,r.y+r.h],['Bottom',r.x,r.y+r.h,r.x+r.w,r.y+r.h],['Left',r.x,r.y,r.x,r.y+r.h]] as const;
  if(radius&&parseFloat(style.borderTopWidth)){ctx.strokeStyle=style.borderTopColor;ctx.lineWidth=parseFloat(style.borderTopWidth);ctx.beginPath();ctx.roundRect(r.x+.5,r.y+.5,r.w-1,r.h-1,radius);ctx.stroke();}
  else for(const [side,x,y,x2,y2] of sides){const width=parseFloat(style.getPropertyValue('border-'+side.toLowerCase()+'-width'));if(width){ctx.strokeStyle=style.getPropertyValue('border-'+side.toLowerCase()+'-color');ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();}}
  if(el.hasAttribute('data-wall-frame')){const pseudo=getComputedStyle(el,'::before');if(pseudo.display!=='none'&&pseudo.content!=='none'){ctx.save();ctx.globalAlpha=Number(pseudo.opacity);ctx.strokeStyle=pseudo.borderTopColor;ctx.lineWidth=1;ctx.strokeRect(r.x+6,r.y+6,r.w-12,r.h-12);ctx.restore();}}
 }
 const walker=document.createTreeWalker(phone,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){const node=walker.currentNode,el=node.parentElement;if(!el||!visible(el))continue;const style=getComputedStyle(el),fontSize=parseFloat(style.fontSize);ctx.font=`${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;ctx.textAlign='left';ctx.textBaseline='alphabetic';
  if(style.backgroundClip==='text'){const gradient=ctx.createLinearGradient(0,0,300,633);gradient.addColorStop(0,computed.getPropertyValue('--g1').trim());gradient.addColorStop(.6,gold);gradient.addColorStop(1,computed.getPropertyValue('--g3').trim());ctx.fillStyle=gradient;}else ctx.fillStyle=style.color;
  const value=node.textContent??'';let offset=0;for(const char of value){const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+char.length);offset+=char.length;const rect=box(range.getBoundingClientRect());if(!rect.w||!rect.h)continue;const metrics=ctx.measureText(char);ctx.fillText(char,rect.x,rect.y+(metrics.fontBoundingBoxAscent??fontSize*.88));}
 }
}
