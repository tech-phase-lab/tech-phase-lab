// Regenerates lib/legal/*-ja.ts from content/legal/*.ja.md, byte for byte.
import { readFileSync, writeFileSync } from "node:fs";
for (const lang of ["ja", "en"]) for (const name of ["terms", "privacy"]) {
  const text = readFileSync(new URL(`../content/legal/${name}.${lang}.md`, import.meta.url), "utf8");
  writeFileSync(new URL(`../lib/legal/${name}-${lang}.ts`, import.meta.url), `// Generated verbatim from content/legal/${name}.${lang}.md (${lang === "ja" ? "owner's text" : "English translation of the Japanese text; the Japanese prevails"}). Do not edit by hand; edit the .md and run \`node scripts/legal-sync.mjs\`.\nconst source = ${JSON.stringify(text)};\nexport default source;\n`);
}
