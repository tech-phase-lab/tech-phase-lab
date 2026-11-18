/** The quiet way back to Tech Phase on the RESOLUTE landing page (owner, Nov 18): shown only to a visitor who
 * came from Tech Phase, never to one who arrived from an ad or a direct link. Tech Phase marks this browser tab
 * when one of its links into RESOLUTE is tapped (all of them open `/resolute`, where the landing page is shown);
 * a same-origin referrer from a Tech Phase page covers a link that opened in a fresh view. */
export const TECH_PHASE_ENTRY_KEY = "tech-phase:resolute-entry:v1";
export const TECH_PHASE_HOME = "/research";

const resolutePath = /^\/resolute(?:\/|$)/;
const techPhasePath = /^\/research(?:\/|$)/;

function parse(href: string, base?: string): URL | null {
  try { return new URL(href, base); } catch { return null; }
}

/** A link on a Tech Phase page that leads into RESOLUTE (same site). */
export function entersResolute(href: string, origin: string): boolean {
  const url = parse(href, origin);
  return !!url && url.origin === origin && resolutePath.test(url.pathname);
}

/** Whether the landing page offers the way back: the tab was marked by Tech Phase, or the page was opened from a Tech Phase page. */
export function cameFromTechPhase(mark: string | null, referrer: string, origin: string): boolean {
  if (mark === "1") return true;
  if (!referrer) return false;
  const from = parse(referrer);
  return !!from && from.origin === origin && techPhasePath.test(from.pathname);
}
