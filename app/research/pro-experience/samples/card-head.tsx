"use client";
import { CARD_HEAD } from "@/lib/research/pro-experience-samples";
import styles from "./samples.module.css";

/** 「サンプル」 and 「PRO機能体験」 at the very top of the PRO card (owner's mockups, Nov 22). */
export default function CardHead({ lang }: { lang: "ja" | "en" }) {
  return <p className={styles.cardHead}><b>{CARD_HEAD.tag[lang]}</b><span>{CARD_HEAD.label[lang]}</span></p>;
}
