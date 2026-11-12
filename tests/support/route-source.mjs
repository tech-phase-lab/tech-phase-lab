import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
/** Loads a route file with its "@/lib/research/*" imports pointed at the real files; the membership-dependent module is the PRO stand-in. */
export function routeImport(routePath) {
  let source = readFileSync(new URL(`../../${routePath}`, import.meta.url), "utf8");
  source = source.replace(/(["'])@\/lib\/research\/([\w-]+)\1/g, (_, _quote, name) => JSON.stringify(
    name === "tech-news-server" ? new URL("./tech-news-server-full.mjs", import.meta.url).href : new URL(`../../lib/research/${name}.ts`, import.meta.url).href));
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
}
