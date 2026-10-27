// Regenerates lib/legal/*-ja.ts from content/legal/*.ja.md, byte for byte.
import { readFileSync, writeFileSync } from "node:fs";
for (const name of ["terms", "privacy"]) {
  const text = readFileSync(new URL(`../content/legal/${name}.ja.md`, import.meta.url), "utf8");
  writeFileSync(new URL(`../lib/legal/${name}-ja.ts`, import.meta.url), `// Generated verbatim from content/legal/${name}.ja.md (owner's text). Do not edit by hand; edit the .md and run \`node scripts/legal-sync.mjs\`.\nconst source = ${JSON.stringify(text)};\nexport default source;\n`);
}
