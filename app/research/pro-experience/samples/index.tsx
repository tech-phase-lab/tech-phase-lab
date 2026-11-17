"use client";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { SampleFeature } from "@/lib/research/pro-experience-samples";
import SampleFrame from "./frame";
import styles from "./samples.module.css";

type Props = { lang: "ja" | "en" };
const loading = () => <div className={styles.loading} aria-hidden="true" />;
/** Each feature's sample is its own chunk, so a page carries only its own saved data. */
const samples: Record<SampleFeature, ComponentType<Props>> = {
  "relation-map": dynamic(() => import("./relation-map"), { loading }),
  compare: dynamic(() => import("./compare"), { loading }),
  "theme-ranking": dynamic(() => import("./theme-ranking"), { loading }),
  "watch-22": dynamic(() => import("./watch-22"), { loading }),
  "rizels-desk": dynamic(() => import("./rizels-desk"), { loading }),
  "financial-radar": dynamic(() => import("./financial-radar"), { loading }),
  "us-portfolio": dynamic(() => import("./us-portfolio"), { loading }),
};

export default function FeatureSample({ feature, lang }: { feature: SampleFeature; lang: "ja" | "en" }) {
  const Sample = samples[feature];
  return <SampleFrame feature={feature} lang={lang}><Sample lang={lang} /></SampleFrame>;
}
