/* eslint-disable @next/next/no-img-element -- Owner-provided external images render directly without a proxy. */
import type { ReactNode } from "react";
import styles from "./format.module.css";

/** Text-only markup: never interpret author content as HTML. */
export function inlineBody(text: string, depth = 0): ReactNode[] {
  if (depth > 8) return [text];
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^\n]+?)\*\*|==([^\n]+?)==|\[red\]([^\n]+?)\[\/red\]/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(start, match.index));
    const key = match.index;
    parts.push(match[1] !== undefined ? <strong key={key}>{inlineBody(match[1], depth + 1)}</strong> : match[2] !== undefined ? <mark className={styles.highlight} key={key}>{inlineBody(match[2], depth + 1)}</mark> : <span className={styles.red} key={key}>{inlineBody(match[3], depth + 1)}</span>);
    start = match.index + match[0].length;
  }
  parts.push(text.slice(start));
  return parts;
}
export function mediaSource(value: string, kind: string): { url: string; embed?: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || /\s/.test(value)) return null;
    if (kind === "image" && /\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) return { url: url.href };
    if (kind === "audio" && /\.(mp3|m4a|ogg|wav)$/i.test(url.pathname)) return { url: url.href };
    if (kind === "video" && /\.(mp4|webm)$/i.test(url.pathname)) return { url: url.href };
    if (kind === "video") {
      const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : ["youtube.com", "www.youtube.com"].includes(url.hostname) && url.pathname === "/watch" ? url.searchParams.get("v") : null;
      if (id && /^[\w-]{11}$/.test(id)) return { url: url.href, embed: `https://www.youtube-nocookie.com/embed/${id}` };
    }
  } catch { /* Invalid media stays visible as ordinary text. */ }
  return null;
}
export default function DeskBody({ text, media = false }: { text: string; media?: boolean }) {
  return <div className={styles.body}>{text.split("\n").map((line, index) => {
    const match = media ? /^\[(audio|video|image)\]\((https:\/\/[^\s]+)\)$/.exec(line.trim()) : null;
    const source = match && mediaSource(match[2], match[1]);
    if (source && match) return <div className={styles.media} key={index}>
      {match[1] === "image" ? <img src={source.url} alt="投稿画像 / Attached image" loading="lazy" referrerPolicy="no-referrer" /> : source.embed ? <details><summary>動画を開く / Open video</summary><iframe loading="lazy" src={source.embed} title="RIZEL video" referrerPolicy="no-referrer" allowFullScreen /></details> : match[1] === "audio" ? <audio controls preload="none" src={source.url} /> : <video controls preload="none" src={source.url} />}
      {match[1] !== "image" && <a href={source.url} target="_blank" rel="noopener noreferrer">{match[1] === "audio" ? "音声を開く / Open audio" : "動画を開く / Open video"}</a>}
    </div>;
    return <div key={index}>{line ? inlineBody(line) : <br />}</div>;
  })}</div>;
}
