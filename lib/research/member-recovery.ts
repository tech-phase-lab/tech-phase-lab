/** Renew the SDK session before asking the server for entitlements.
 * No browser role claims or token persistence: the server remains authoritative. */
export async function recoverMember(refresh: (force?: boolean) => Promise<void>, signal: AbortSignal, resume = false) {
  await refresh(resume);
  signal.throwIfAborted();
  async function read() {
    const response = await fetch("/api/research/member", { cache: "no-store", signal });
    return { response, member: await response.json() };
  }
  let result = await read();
  if (result.response.ok && result.member.status === "signed-out") {
    await refresh(true);
    signal.throwIfAborted();
    result = await read();
  }
  return result;
}
