// Shared by the tests that load a screen by transpiling it and resolving its imports by hand: the real agree button
// (app/legal/agree-button.tsx) and disclaimer (app/resolute/disclaimer.tsx) those screens now import (owner pack, Nov 17).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cache = new Map();
function compile(path) {
  if (!cache.has(path)) {
    const out = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", out)(id => id === "@/lib/legal/disclaimer" ? require("../lib/legal/disclaimer.ts") : require(id), mod, mod.exports);
    cache.set(path, mod.exports);
  }
  return cache.get(path);
}
/** The module for an import specifier ending in legal/agree-button or resolute/disclaimer (or ./disclaimer, ../disclaimer), else undefined. */
export function legalModule(id) {
  if (/(^|\/)legal\/agree-button$/.test(id)) return compile("../app/legal/agree-button.tsx");
  if (/(^|\/)resolute\/disclaimer$/.test(id) || id === "./disclaimer" || id === "../disclaimer") return compile("../app/resolute/disclaimer.tsx");
  if (id === "@/lib/legal/disclaimer" || /(^|\/)lib\/legal\/disclaimer(\.ts)?$/.test(id)) return require("../lib/legal/disclaimer.ts");
  return undefined;
}
