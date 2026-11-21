import "server-only";

/** A desk page's first data, read on the server through the page's own API route (same membership checks as the browser's request).
 * Only a successful JSON answer within the time limit is returned; a refusal, an error or a slow service returns undefined, and the
 * page asks from the browser as before, so a slow service never holds the page longer than its loading screen would. */
export async function firstAnswer(call: () => Promise<Response>, limitMs = 3_000): Promise<Record<string, unknown> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), limitMs); });
    const response = await Promise.race([call(), late]);
    if (!response || !response.ok) return undefined;
    const data = await Promise.race([response.json() as Promise<unknown>, late]);
    return data && typeof data === "object" ? data as Record<string, unknown> : undefined;
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}
