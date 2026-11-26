/** Bound SDK work which does not itself accept an AbortSignal. */
export function waitForIdentity<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    task.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Renew the SDK session before asking the server for entitlements.
 * No browser role claims or token persistence: the server remains authoritative. */
export async function recoverMember(refresh: (force?: boolean) => Promise<void | boolean>, signal: AbortSignal, resume = false) {
  signal.throwIfAborted();
  // `false`: the identity SDK has loaded and holds no session, so a signed-out answer is final (no second /api/research/member read).
  const sdkSignedIn = await waitForIdentity(refresh(resume), signal);
  signal.throwIfAborted();
  async function read() {
    const response = await fetch("/api/research/member", { cache: "no-store", signal });
    return { response, member: await response.json() };
  }
  let result = await read();
  if (result.response.ok && result.member.status === "signed-out" && sdkSignedIn !== false) {
    await waitForIdentity(refresh(true), signal);
    signal.throwIfAborted();
    result = await read();
  }
  return result;
}
