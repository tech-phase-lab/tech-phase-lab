"use client";
import { THEMES, toggleTheme } from "@/lib/research/favorite-themes";
import styles from "./theme-tiles.module.css";

const check = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5de0b0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

/** The theme tiles of the first question and of the Account setting: several can be picked; "まだ決めていない" is the same as none. */
export default function ThemeTiles({ selected, onChange, ja, disabled = false }: { selected: readonly string[]; onChange: (next: string[]) => void; ja: boolean; disabled?: boolean }) {
  return <ul className={styles.grid} aria-label={ja ? "気になるテーマ" : "Themes"}>
    {THEMES.map(theme => { const on = selected.includes(theme.id); return <li key={theme.id}>
      <button type="button" className={styles.tile} aria-pressed={on} disabled={disabled} onClick={() => onChange(toggleTheme(selected, theme.id))}>{ja ? theme.ja : theme.en}{on && check}</button></li>; })}
    <li><button type="button" className={styles.tile} aria-pressed={selected.length === 0} disabled={disabled} onClick={() => onChange([])}>{ja ? "まだ決めていない" : "Not decided yet"}{selected.length === 0 && check}</button></li>
  </ul>;
}
