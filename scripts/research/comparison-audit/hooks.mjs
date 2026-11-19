// Module hooks for the comparison audit (audit.mjs): run the comparison API's own server modules in plain Node.
// - "server-only", "next/cache", "next/server" become small stubs (no Next.js runtime is needed);
// - the provider store (twelve-store, twelve-data-collector) becomes the audit's stub (no Twelve Data credits are spent);
// - "@/..." and extensionless relative imports resolve to the .ts/.tsx files; JSON imports work without import attributes.
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.COMPARISON_AUDIT_ROOT ? path.resolve(process.env.COMPARISON_AUDIT_ROOT) : path.resolve(here, "../../..");
const stub = name => pathToFileURL(path.join(here, "stubs", name)).href;
const STUBS = { "server-only": stub("empty.mjs"), "next/cache": stub("next-cache.mjs"), "next/server": stub("next-server.mjs") };
const PROVIDER = /\/lib\/research\/(?:twelve-store|twelve-data-collector)(?:\.ts)?$/;
const isFile = p => existsSync(p) && statSync(p).isFile();

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  let target = null;
  if (specifier.startsWith("@/")) target = path.join(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  if (target) {
    if (PROVIDER.test(target.replaceAll(path.sep, "/"))) return { url: stub("provider.mjs"), shortCircuit: true };
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
      if (isFile(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  }
  return next(url, context);
}
