/** Replace URLs with owner-supplied HTTPS video files. No automatic third-party embeds. */
export const TONIGHT_VIDEOS=[
 {id:'breathe',ja:{title:'深呼吸',url:null as string|null},en:{title:'Take a breath',url:null as string|null}},
 {id:'steady',ja:{title:'変わらないもの',url:null as string|null},en:{title:'What hasn’t changed',url:null as string|null}},
 {id:'history',ja:{title:'過去の下落',url:null as string|null},en:{title:'Past downturns',url:null as string|null}},
];
export function videoIndex(date:string){return Math.floor(Date.parse(date+'T00:00:00Z')/86400000)%TONIGHT_VIDEOS.length;}
