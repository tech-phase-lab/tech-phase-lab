"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { parsePreferences } from "@/lib/resolute/preferences-data";
import { PreferencesError, requestPreferences } from "@/lib/resolute/preferences-client";
import styles from "./settings.module.css";

const copy = {
  ja: { title: "言語とタイムゾーン", intro: "RESOLUTEで使う言語と、日時を表示する地域を設定します。",
    language: "言語", choose: "選択してください", zone: "タイムゾーン", zoneHint: "例：Asia/Tokyo（日本）、America/New_York（米国東部）",
    device: "端末のタイムゾーンを使う", deviceError: "端末の地域を取得できませんでした。入力してください。",
    save: "設定を保存", saving: "保存しています…", loading: "設定を読み込んでいます…",
    unset: "設定がまだ保存されていません。言語とタイムゾーンを選んで保存してください。",
    saved: "設定を保存しました。", changed: "変更はまだ保存されていません。", invalid: "言語と有効なタイムゾーンを選んでください。",
    loadError: "設定を読み込めませんでした。時間をおいて再読込してください。",
    saveError: "保存を確認できませんでした。保存済みの設定を再読込して確認してください。",
    reload: "保存済みの設定を再読込", login: "設定を保存するにはログインしてください。",
    account: "ログイン画面へ", afterLogin: "ログイン後にこの画面へ戻り、設定を再読込してください。",
    note: "設定の保存だけではメール配信は始まりません。", back: "Tech Phaseへ戻る" },
  en: { title: "Language and time zone", intro: "Choose the language for RESOLUTE and the time zone used to display dates and times.",
    language: "Language", choose: "Please select", zone: "Time zone", zoneHint: "For example: Asia/Tokyo (Japan) or America/New_York (US Eastern)",
    device: "Use this device’s time zone", deviceError: "Could not detect your time zone. Please enter it.",
    save: "Save settings", saving: "Saving…", loading: "Loading settings…",
    unset: "Your settings have not been saved yet. Choose a language and time zone, then save.",
    saved: "Settings saved.", changed: "Your changes have not been saved yet.", invalid: "Choose a language and a valid time zone.",
    loadError: "Could not load your settings. Please wait and reload.",
    saveError: "Could not confirm the save. Reload your saved settings to check.",
    reload: "Reload saved settings", login: "Sign in to save your settings.", account: "Go to sign-in",
    afterLogin: "After signing in, return here and reload your settings.",
    note: "Saving settings does not start email delivery.", back: "Back to Tech Phase" },
};
type Phase = "loading" | "ready" | "saving" | "saved" | "signed-out" | "error";
type Message = "unset" | "saved" | "changed" | "invalid" | "loadError" | "saveError" | "deviceError" | null;

export default function SettingsScreen({ identityReady = true }: { identityReady?: boolean }) {
  const [viewLocale, setViewLocale] = useState<"ja" | "en">("ja");
  const [locale, setLocale] = useState("");
  const [timezone, setTimezone] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<Message>(null);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const c = copy[viewLocale];
  const busy = !identityReady || phase === "loading" || phase === "saving";

  function load(controller: AbortController) {
    return requestPreferences(undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setLocale(value.locale ?? ""); setTimezone(value.timezone ?? "");
      if (value.locale) setViewLocale(value.locale);
      setLoaded(true); setPhase("ready"); setMessage(value.configured ? null : "unset");
    }, error => {
      if (controller.signal.aborted) return;
      setLoaded(false);
      const signedOut = error instanceof PreferencesError && error.kind === "signed-out";
      setPhase(signedOut ? "signed-out" : "error"); setMessage(signedOut ? null : "loadError");
    });
  }

  useEffect(() => {
    if (!identityReady) return;
    const controller = new AbortController(); pending.current = controller;
    void load(controller);
    return () => { pending.current?.abort(); };
  }, [identityReady]);

  function reload() {
    pending.current?.abort();
    setPhase("loading"); setMessage(null);
    const controller = new AbortController(); pending.current = controller;
    void load(controller);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !loaded) return;
    const preferences = parsePreferences({ locale, timezone });
    if (!preferences) { setMessage("invalid"); return; }
    setPhase("saving"); setMessage(null);
    const controller = new AbortController(); pending.current = controller;
    try {
      const result = await requestPreferences(preferences, controller.signal);
      if (controller.signal.aborted) return;
      setLocale(result.locale ?? ""); setTimezone(result.timezone ?? "");
      if (result.locale) setViewLocale(result.locale);
      setPhase("saved"); setMessage("saved");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof PreferencesError && error.kind === "signed-out") {
        setLoaded(false); setPhase("signed-out"); setMessage(null);
      } else {
        setPhase("ready"); setMessage(error instanceof PreferencesError && error.kind === "invalid" ? "invalid" : "saveError");
      }
    }
  }

  function useDeviceZone() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const value = parsePreferences({ locale: "ja", timezone: zone });
    if (!value) { setMessage("deviceError"); return; }
    setTimezone(value.timezone); setMessage("changed");
  }

  return <main className={styles.page} lang={viewLocale}>
    <div className={styles.top}><span className={styles.brand}>RESOLUTE</span>
      <div className={styles.languages} aria-label="Display language">
        <button type="button" aria-pressed={viewLocale === "ja"} onClick={() => setViewLocale("ja")}>日本語</button>
        <button type="button" aria-pressed={viewLocale === "en"} onClick={() => setViewLocale("en")}>English</button>
      </div></div>
    <section className={styles.card} aria-labelledby="settings-heading" aria-busy={busy}>
      <h1 id="settings-heading">{c.title}</h1><p className={styles.intro}>{c.intro}</p>
      {phase === "loading" || !identityReady ? <p role="status">{c.loading}</p> : null}
      {phase === "signed-out" ? <div className={styles.notice}><p>{c.login}</p>
        <Link href="/research/account" prefetch={false}>{c.account}</Link><p>{c.afterLogin}</p></div> : null}
      <form onSubmit={save}>
        <fieldset disabled={!loaded || busy} className={styles.fields}>
          <legend className={styles.srOnly}>{c.title}</legend>
          <label htmlFor="resolute-locale">{c.language}</label>
          <select id="resolute-locale" name="locale" required value={locale}
            onChange={event => { setLocale(event.target.value); setMessage("changed"); }}>
            <option value="">{c.choose}</option><option value="ja">日本語</option><option value="en">English</option>
          </select>
          <label htmlFor="resolute-timezone">{c.zone}</label>
          <input id="resolute-timezone" name="timezone" required maxLength={100} list="resolute-zones"
            autoComplete="off" spellCheck={false} value={timezone} aria-describedby="zone-hint"
            onChange={event => { setTimezone(event.target.value); setMessage("changed"); }} />
          <datalist id="resolute-zones"><option value="Asia/Tokyo" /><option value="America/New_York" />
            <option value="America/Los_Angeles" /><option value="Europe/London" /><option value="UTC" /></datalist>
          <p id="zone-hint" className={styles.hint}>{c.zoneHint}</p>
          <button type="button" className={styles.secondary} onClick={useDeviceZone}>{c.device}</button>
          <button type="submit" className={styles.save}>{phase === "saving" ? c.saving : c.save}</button>
        </fieldset>
      </form>
      <p role="status" aria-live="polite" className={styles.status}>{message ? c[message] : ""}</p>
      <button type="button" className={styles.secondary} disabled={busy} onClick={reload}>{c.reload}</button>
      <p className={styles.note}>{c.note}</p>
    </section>
    <Link className={styles.back} href="/research" prefetch={false}>{c.back}</Link>
  </main>;
}
