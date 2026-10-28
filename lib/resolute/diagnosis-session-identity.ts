// Kept small: the shared sign-in provider must not load the diagnosis engine.
export const DIAGNOSIS_SESSION_TTL = 12 * 60 * 60 * 1000;
export const diagnosisSessionPrefix = "resolute:diagnosis-tab:v1:";
type StorageLike = Pick<Storage,"getItem"|"removeItem">;
function browserStorage(): StorageLike | undefined {
 try { return window.sessionStorage; } catch { return undefined; }
}
export function reconcileDiagnosisSession(session: string|null, storage=browserStorage(), now=Date.now()) {
 for(const channel of ["preview","live"]) {
  const key=diagnosisSessionPrefix+channel;
  try {
   const raw=storage?.getItem(key);if(!raw)continue;
   const value=JSON.parse(raw);
   if(!session || value?.session!==session || !Number.isFinite(value.expiresAt) || value.expiresAt<=now || value.expiresAt>now+DIAGNOSIS_SESSION_TTL) storage?.removeItem(key);
  } catch { try {storage?.removeItem(key);} catch { /* Storage may be unavailable. */ } }
 }
}
