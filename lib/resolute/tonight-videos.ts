/** Owner-supplied video files (Nov 17), served from public/media/resolute-tonight (H.264/AAC, moov first). No third-party embeds. */
export const TONIGHT_VIDEOS=[
 {id:'breathe',ja:{title:'深呼吸',url:'/media/resolute-tonight/breathe-ja.mp4' as string|null},en:{title:'Take a breath',url:'/media/resolute-tonight/breathe-en.mp4' as string|null}},
 {id:'steady',ja:{title:'変わらないもの',url:'/media/resolute-tonight/steady-ja.mp4' as string|null},en:{title:'What hasn’t changed',url:'/media/resolute-tonight/steady-en.mp4' as string|null}},
 {id:'history',ja:{title:'過去の下落',url:'/media/resolute-tonight/history-ja.mp4' as string|null},en:{title:'Past downturns',url:'/media/resolute-tonight/history-en.mp4' as string|null}},
];
export function videoIndex(date:string){return Math.floor(Date.parse(date+'T00:00:00Z')/86400000)%TONIGHT_VIDEOS.length;}
