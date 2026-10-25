import { draftToPlan, isQuestionVisible, questions, validateQuestion, type DiagnosisDraft } from "./diagnosis-form.ts";
import { parsePlanAnswers, parsePlanFx } from "./plan-answers.ts";

// Deliberately separate from the optional, persistent owner-preview store.
import { DIAGNOSIS_SESSION_TTL, diagnosisSessionPrefix as prefix } from "./diagnosis-session-identity.ts";
export { DIAGNOSIS_SESSION_TTL } from "./diagnosis-session-identity.ts";
export type DiagnosisChannel = "preview" | "live";
export type DiagnosisSession = {
 session: string; channel: DiagnosisChannel; expiresAt: number;
 draft: DiagnosisDraft; baseline: string; mode: "intro" | "questions" | "result";
 index: number; locked: boolean; active: boolean; locale: "ja" | "en";
};
type StorageLike = Pick<Storage,"getItem"|"setItem"|"removeItem">;
function browserStorage(): StorageLike | undefined {
 try { return window.sessionStorage; } catch { return undefined; }
}
function parse(raw: string, now: number): DiagnosisSession {
 if(raw.length > 32000) throw Error("invalid-draft");
 const v = JSON.parse(raw) as DiagnosisSession;
 if(!v || typeof v.session!=="string" || !v.session || !["live","preview"].includes(v.channel) ||
  !Number.isFinite(v.expiresAt) || v.expiresAt<=now || v.expiresAt>now+DIAGNOSIS_SESSION_TTL ||
  typeof v.baseline!=="string" || v.baseline.length>16000 ||
  !["intro","questions","result"].includes(v.mode) || !Number.isInteger(v.index) || v.index<0 || v.index>=30 ||
  typeof v.locked!=="boolean" || typeof v.active!=="boolean" || !["ja","en"].includes(v.locale)) throw Error("invalid-draft");
 const d=v.draft;
 if(!d || !["JPY","USD"].includes(d.currency) || !d.numbers || typeof d.numbers!=="object" || Array.isArray(d.numbers) ||
  Object.entries(d.numbers).some(([key,value])=>!questions.some(q=>q.id===key) || typeof value!=="string" || value.length>100) ||
  [d.noBuyConditions,d.haltConditions].some(lines=>!Array.isArray(lines)||lines.length>100||lines.some(line=>typeof line!=="string"||line.length>2000)) ||
  !(d.stopLossPct===undefined||d.stopLossPct===null||typeof d.stopLossPct==="number"&&Number.isFinite(d.stopLossPct)&&d.stopLossPct>0&&d.stopLossPct<100)) throw Error("invalid-draft");
 const draft: DiagnosisDraft = {currency:d.currency,answers:parsePlanAnswers(d.answers),numbers:d.numbers,
  noBuyConditions:d.noBuyConditions,haltConditions:d.haltConditions,fx:parsePlanFx(d.fx),
  ...(d.stopLossPct===undefined?{}:{stopLossPct:d.stopLossPct})};
 const visible=questions.filter(q=>isQuestionVisible(q.id,draft.answers));
 if(v.index>=visible.length) throw Error("invalid-draft");
 // A partially typed current answer is valid; completed previous steps must still be valid.
 if(v.mode!=="intro") visible.slice(0,v.index).forEach(q=>validateQuestion(q,draft));
 if(v.mode==="result") draftToPlan(draft);
 return {...v,draft};
}
export function clearDiagnosisSession(channel: DiagnosisChannel, storage=browserStorage()): boolean {
 try { if(!storage)return false; storage.removeItem(prefix+channel);return true; } catch {return false;}
}
export function readDiagnosisSession(session: string, channel: DiagnosisChannel, storage=browserStorage(), now=Date.now()): DiagnosisSession|null {
 try {
  const raw=storage?.getItem(prefix+channel);if(!raw)return null;
  const value=parse(raw,now);
  if(value.session!==session || value.channel!==channel) throw Error("wrong-session");
  return value;
 } catch { clearDiagnosisSession(channel,storage);return null; }
}
export function writeDiagnosisSession(value: DiagnosisSession, storage=browserStorage(), now=Date.now()): boolean {
 try {
  if(!storage)return false;
  const raw=JSON.stringify(value);parse(raw,now);storage.setItem(prefix+value.channel,raw);return true;
 } catch {
  // Never leave an older answer looking like the latest one after a failed write.
  clearDiagnosisSession(value.channel,storage);return false;
 }
}
