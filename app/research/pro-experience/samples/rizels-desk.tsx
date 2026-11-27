"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { DESK_HINTS } from "@/lib/research/pro-experience-samples";
import sample from "@/lib/research/pro-experience-samples/desk.json";
import { shortDate } from "@/lib/research/weekly-format";
import DeskBody, { inlineBody } from "../../desk/body";
import { ReactionBadge, ReactionFace, type Reactions } from "../../desk/reactions";
import type { ReactionCounts } from "../../desk/reaction-state";
import { newNoteId } from "../../desk/use-minute";
import { IssueView, type Issue } from "../../weekly/issues";
import columnStyles from "../../columns/styles.module.css";
import questionStyles from "../../qa/styles.module.css";
import weeklyStyles from "../../weekly/issues.module.css";
import { useProOnly, useSampleHint } from "./frame";
import styles from "./rizels-desk.module.css";

type Lang = "ja" | "en";
type Note = (typeof sample.notes)[number];
type Answered = (typeof sample.answered)[number];
export type DeskTab = "notes" | "ask" | "weekly";
/** The ask flow: the example button, the question being typed, ready to send, sent (waiting), Rizel answering, answered. */
export type AskPhase = "idle" | "typing" | "typed" | "sent" | "answering" | "answered";

/** The owner's spec (Nov 27, replacing Nov 17's 1 s): the page opens on the list as it is; about 5 s later the banner comes down, about 1 s
 * after that the new note is added on top, gently and without moving the view; the banner goes up by itself 3 s after it came (or on a tap).
 * Once per visit. */
export const BANNER_DELAY_MS = 5000;
export const NOTE_AFTER_BANNER_MS = 1000;
export const BANNER_SHOW_MS = 3000;
/** How long the new note's entrance (it opens its room and fades in) runs; the mark is then taken off so it never plays again. */
export const NOTE_ENTER_MS = 600;
const BANNER_LEAVE_MS = 350;
/** The example question is typed in about 1.2 s; 「リゼルが回答中…」 about 1.5 s after sending, the answer about 2 s after that. */
export const TYPE_MS = 1200;
export const ANSWERING_MS = 1500;
export const ANSWER_MS = 2000;
/** The samples' made-up moment (2035/03/12 09:00 JST): N1 (08:52) is within the real 30 minutes of NEW, the others are not. */
export const SAMPLE_NOW = Date.parse("2035-03-12T00:00:00.000Z");
export const REACTION_KEYS = ["like", "smile", "sad", "angry", "fire"] as const;
const TOASTS = {
  reacted: { ja: "リアクションしました", en: "Reaction sent" },
  answered: { ja: "リゼルから回答が届きました", en: "Rizel answered your question" },
};
const notes = sample.notes;
const weekly = sample.weekly as unknown as Record<Lang, Issue>;
const NEW_ID = newNoteId(notes, SAMPLE_NOW);

/** The real one-reaction-per-note rule, without a server: choosing an emoji adds it (and takes back another one of mine); choosing my own again
 * takes it back. `added` is true when this choice added a reaction. */
export function toggleReaction(counts: ReactionCounts, key: string): { counts: ReactionCounts; added: boolean } {
  if (!Object.hasOwn(counts, key)) return { counts, added: false };
  const adding = !counts[key].selected;
  const next = Object.fromEntries(Object.entries(counts).map(([name, value]) => {
    const selected = adding && name === key;
    return [name, { selected, count: Math.max(0, value.count + Number(selected) - Number(value.selected)) }];
  }));
  return { counts: next, added: adding };
}
const startCounts = (note: Note): ReactionCounts => {
  const saved: Partial<Record<string, number>> = note.reactions;
  return Object.fromEntries(REACTION_KEYS.map(key => [key, { count: saved[key] ?? 0, selected: false }]));
};
const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pen = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.800 2.800 0 0 0-4-4L4 15z" /></svg>;
const check = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500" /></svg>;
const Avatar = ({ size, alt = "" }: { size: number; alt?: string }) => <Image src="/rizel-avatar.webp" alt={alt} width={size} height={size} unoptimized />;

/** RIZEL'S DESK as a sample (owner's spec and mockups, Nov 17): the real notes, reactions, questions and weekly issue, from saved made-up text.
 * Everything happens on this page only: nothing is sent, nothing is stored, and opening the page again starts from the beginning. */
export default function RizelsDeskSample({ lang }: { lang: Lang }) {
  const ja = lang === "ja";
  const toast = useProOnly();
  const setHint = useSampleHint();
  const [tab, setTab] = useState<DeskTab>("notes");
  const [arrived, setArrived] = useState(false);
  const [entering, setEntering] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  /** Where the first older note was on screen before the new one went in, when the list's top was already scrolled out of view. */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const [banner, setBanner] = useState<"before" | "in" | "out" | "gone">("before");
  const [reactions, setReactions] = useState<Record<string, ReactionCounts>>(() => Object.fromEntries(notes.map(note => [note.id, startCounts(note)])));
  const [phase, setPhase] = useState<AskPhase>("idle");
  const [typed, setTyped] = useState(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const typing = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const later = (run: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); run(); }, ms);
    timers.current.add(id);
    return id;
  };

  useEffect(() => {
    const all = timers.current;
    const id = setTimeout(() => {
      setBanner("in");
      bannerTimer.current = setTimeout(() => leave(), BANNER_SHOW_MS);
      later(arrive, NOTE_AFTER_BANNER_MS);
    }, BANNER_DELAY_MS);
    return () => { clearTimeout(id); clearTimeout(bannerTimer.current); clearInterval(typing.current); all.forEach(clearTimeout); all.clear(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the sample opens
  }, []);
  useEffect(() => { setHint(DESK_HINTS[tab]); }, [tab, setHint]);
  useEffect(() => () => setHint(null), [setHint]);

  // The new note goes in on top. With the list in view it opens its own room and fades in (no animation with reduced motion); with the list
  // scrolled above the screen it goes in at once and the page is moved by the same height, so what is on screen stays where it was.
  function arrive() {
    const list = notesRef.current, first = list?.querySelector<HTMLElement>("[data-note]");
    const above = !!list && list.getBoundingClientRect().top < 0;
    anchor.current = above && first ? { id: first.dataset.note!, top: first.getBoundingClientRect().top } : null;
    const animate = !!list && !above && !reducedMotion();
    setArrived(true); setEntering(animate);
    if (animate) later(() => setEntering(false), NOTE_ENTER_MS);
  }
  useLayoutEffect(() => {
    const saved = anchor.current;
    if (!arrived || !saved) return;
    anchor.current = null;
    const now = notesRef.current?.querySelector<HTMLElement>(`[data-note="${saved.id}"]`);
    const moved = now ? now.getBoundingClientRect().top - saved.top : 0;
    if (moved) window.scrollBy(0, moved);
  }, [arrived]);
  function leave() {
    clearTimeout(bannerTimer.current);
    setBanner(current => (current === "in" ? "out" : current));
    later(() => setBanner("gone"), reducedMotion() ? 0 : BANNER_LEAVE_MS);
  }
  const react = (id: string) => (key: string) => {
    const result = toggleReaction(reactions[id], key);
    setReactions(current => ({ ...current, [id]: result.counts }));
    if (result.added) toast(TOASTS.reacted);
  };
  const question = ja ? sample.ask.bodyJa : sample.ask.bodyEn;
  function startTyping() {
    if (phase !== "idle") return;
    if (reducedMotion()) { setTyped(question.length); setPhase("typed"); return; }
    setPhase("typing"); setTyped(0);
    const step = TYPE_MS / question.length;
    let count = 0;
    typing.current = setInterval(() => {
      count += 1; setTyped(count);
      if (count >= question.length) { clearInterval(typing.current); setPhase("typed"); }
    }, step);
  }
  function send() {
    if (phase !== "typed") return;
    setPhase("sent");
    later(() => {
      setPhase("answering");
      later(() => { setPhase("answered"); toast(TOASTS.answered); }, ANSWER_MS);
    }, ANSWERING_MS);
  }

  const tabs: { id: DeskTab; label: string }[] = [
    { id: "notes", label: ja ? "ひとりごと" : "Notes" },
    { id: "ask", label: ja ? "リゼルに聞く" : "Ask Rizel" },
    { id: "weekly", label: ja ? "週刊PRO" : "Weekly" },
  ];
  const shown = arrived ? notes : notes.filter(note => note.id !== NEW_ID);
  return <div className={styles.desk}>
    {(banner === "in" || banner === "out") && <button type="button" className={styles.banner} data-state={banner} onClick={leave}
      aria-label={ja ? "リゼルのひとりごと：新しいひとりごとが届きました（タップで閉じる）" : "RIZEL's Notes: A new note just arrived (tap to close)"}>
      <span className={styles.bannerAvatar}><Avatar size={30} /></span>
      <span className={styles.bannerText}><b>{ja ? "リゼルのひとりごと" : "RIZEL's Notes"}</b><span>{ja ? "新しいひとりごとが届きました" : "A new note just arrived"}</span></span>
    </button>}
    <p className={styles.eyebrow}>RIZEL&apos;S DESK</p>
    <h2 className={styles.title}>{ja ? "リゼルのひとりごと" : "RIZEL’s Notes"}</h2>
    <p className={styles.tagline}>{ja ? "PRO会員だけに、本音を。" : "Candid thoughts, for PRO members only."}</p>
    <div className={styles.tabs} role="tablist" aria-label={ja ? "RIZEL’S DESKメニュー" : "RIZEL’S DESK navigation"}>
      {tabs.map(item => <button key={item.id} type="button" role="tab" id={`desk-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`desk-panel-${item.id}`}
        className={styles.tab} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>
    <div role="tabpanel" id={`desk-panel-${tab}`} aria-labelledby={`desk-tab-${tab}`} className={styles.panel}>
      {tab === "notes" && <div className={styles.notes} ref={notesRef}>{shown.map(note => {
        const card = <NoteCard key={note.id} note={note} lang={lang} fresh={note.id === NEW_ID} reactions={{ counts: reactions[note.id], error: false, react: react(note.id) }} />;
        return note.id === NEW_ID ? <div key={note.id} className={styles.arrive} data-entering={entering || undefined}><div className={styles.arriveInner}>{card}</div></div> : card;
      })}</div>}
      {tab === "ask" && <Ask lang={lang} phase={phase} typed={question.slice(0, typed)} onTry={startTyping} onSend={send} />}
      {tab === "weekly" && <div className={styles.weekly}>
        <div className={weeklyStyles.bar}><span className={`${weeklyStyles.picker} ${styles.issueTag}`}>{ja ? "サンプル号" : "Sample issue"} · {shortDate(weekly[lang].date)}</span></div>
        <IssueView issue={weekly[lang]} lang={lang} format={text => inlineBody(text)} />
      </div>}
    </div>
  </div>;
}

/** One note as on the real page: Rizel's icon, the date line and the face button, the text, the badge with the counts. */
function NoteCard({ note, lang, fresh, reactions }: { note: Note; lang: Lang; fresh: boolean; reactions: Reactions }) {
  const ja = lang === "ja";
  const meta = <p className={columnStyles.meta}><span className={columnStyles.stamp}><time dateTime={note.publishedAt}>{note.date[lang]}</time><small className={columnStyles.zone}> JST</small></span></p>;
  return <article className={`${columnStyles.article} ${columnStyles.note} ${styles.note}`} data-note={note.id} data-fresh={fresh || undefined}>
    <div className={columnStyles.noteHeader}><div className={columnStyles.noteAvatar}><Avatar size={46} alt={ja ? "リゼル" : "RIZEL"} /></div></div>
    <div className={`${columnStyles.noteBubble} ${styles.bubble}`}>
      <ReactionFace reactions={reactions} ja={ja}>{meta}</ReactionFace>
      <div className={`${columnStyles.text} ${styles.text}`}><DeskBody text={ja ? note.bodyJa : note.bodyEn} /></div>
      <ReactionBadge reactions={reactions} ja={ja} />
    </div>
  </article>;
}

function Ask({ lang, phase, typed, onTry, onSend }: { lang: Lang; phase: AskPhase; typed: string; onTry: () => void; onSend: () => void }) {
  const ja = lang === "ja";
  const heading = <><span className={questionStyles.askBarIcon}>{pen}</span><b>{ja ? "リゼルに質問する" : "Ask Rizel a question"}</b></>;
  const composing = phase === "typing" || phase === "typed";
  const sent = phase === "sent" || phase === "answering" || phase === "answered";
  const example = (ja ? sample.ask.bodyJa : sample.ask.bodyEn).replace(/\n/g, "");
  return <>
    {phase === "idle" && <section className={`${questionStyles.askPanel} ${styles.ask}`} aria-label={ja ? "リゼルに質問する" : "Ask Rizel a question"}>
      <p className={styles.askHead}>{heading}</p>
      <button type="button" className={styles.example} onClick={onTry}><small>{ja ? "タップして質問してみる" : "Tap to try asking"}</small><span>{example}</span></button>
    </section>}
    {composing && <section className={`${questionStyles.askPanel} ${styles.ask}`} aria-label={ja ? "リゼルに質問する" : "Ask Rizel a question"}>
      <p className={styles.askHead}>{heading}</p>
      {/* The sample types the question itself, so this is a read-only box (as in the mockup) that grows with the text, not a field. */}
      <div className={styles.input} role="textbox" aria-readonly="true" aria-multiline="true" aria-label={ja ? "質問" : "Question"} data-typed>{typed}</div>
      <div className={styles.sendRow}><button type="button" className={`${questionStyles.askSend} ${styles.send}`} data-ready={phase === "typed" || undefined} disabled={phase !== "typed"} onClick={onSend}>{ja ? "送信" : "Send"}</button></div>
    </section>}
    {sent && <button type="button" className={`${questionStyles.askBar} ${styles.askDone}`} disabled>{heading}<small>{ja ? "今日は終わりました" : "Done for today"}</small></button>}
    <div className={`${questionStyles.askList} ${styles.list}`} data-dim={composing || undefined}>
      {sent && <QuestionCard key={sample.ask.id} item={sample.ask} lang={lang} state={phase === "answered" ? "answered" : phase === "answering" ? "answering" : "waiting"} />}
      {sample.answered.map(item => <QuestionCard key={item.id} item={item} lang={lang} state="answered" settled />)}
    </div>
  </>;
}

/** A question card as on the real リゼルに聞く page; the sample's own question also shows 「回答待ち」 and 「リゼルが回答中…」 before its answer. */
function QuestionCard({ item, lang, state, settled = false }: { item: Answered | typeof sample.ask; lang: Lang; state: "waiting" | "answering" | "answered"; settled?: boolean }) {
  const ja = lang === "ja";
  const done = state === "answered";
  const answerHead = <header><Avatar size={34} /><b>{ja ? "リゼルの回答" : "RIZEL’s answer"}</b>{done && <time>{item.answeredAt}</time>}</header>;
  return <article className={`${questionStyles.q} ${styles.q}`} data-question={item.id} data-state={state}>
    <header><time>{item.date[lang]}</time>
      <span className={`${questionStyles.tag} ${done ? questionStyles.tagDone : styles.tagWait}`}>{done && check}{done ? (ja ? "回答済み" : "Answered") : (ja ? "回答待ち" : "Waiting")}</span></header>
    <p className={questionStyles.qText}>{ja ? item.bodyJa : item.bodyEn}</p>
    {state === "answering" && <div className={`${questionStyles.a} ${styles.answer}`}>{answerHead}
      <p className={styles.answering} role="status"><span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>{ja ? "リゼルが回答中…" : "Rizel is answering…"}</p></div>}
    {done && <div className={`${questionStyles.a} ${styles.answer}`} data-reveal={settled ? undefined : true}>{answerHead}<p>{ja ? item.answerJa : item.answerEn}</p></div>}
  </article>;
}
