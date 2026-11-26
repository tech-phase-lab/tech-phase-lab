/** Owner-supplied video files with BGM (Nov 17), served from public/media/resolute-tonight (H.264/AAC, moov first).
 * No third-party embeds. seconds: each file's length (ffprobe, rounded to the second), shown on its button. */
export const TONIGHT_VIDEOS=[
 {id:'breathe',ja:{title:'深呼吸',url:'/media/resolute-tonight/breathe-ja.mp4' as string|null,poster:'/media/resolute-tonight/breathe-ja.jpg' as string|null,seconds:63},en:{title:'Take a breath',url:'/media/resolute-tonight/breathe-en.mp4' as string|null,poster:'/media/resolute-tonight/breathe-en.jpg' as string|null,seconds:65}},
 {id:'steady',ja:{title:'変わらないもの',url:'/media/resolute-tonight/steady-ja.mp4' as string|null,poster:'/media/resolute-tonight/steady-ja.jpg' as string|null,seconds:80},en:{title:'What hasn’t changed',url:'/media/resolute-tonight/steady-en.mp4' as string|null,poster:'/media/resolute-tonight/steady-en.jpg' as string|null,seconds:81}},
 {id:'history',ja:{title:'過去の下落',url:'/media/resolute-tonight/history-ja.mp4' as string|null,poster:'/media/resolute-tonight/history-ja.jpg' as string|null,seconds:81},en:{title:'Past downturns',url:'/media/resolute-tonight/history-en.mp4' as string|null,poster:'/media/resolute-tonight/history-en.jpg' as string|null,seconds:83}},
];
export function videoIndex(date:string){return Math.floor(Date.parse(date+'T00:00:00Z')/86400000)%TONIGHT_VIDEOS.length;}
