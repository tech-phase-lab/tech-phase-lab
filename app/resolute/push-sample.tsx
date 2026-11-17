import s from "./push-sample.module.css";

/** How a RESOLUTE phone notification looks (screens/01_push_*): the title RESOLUTE and one line. A picture only; nothing is sent. */
export default function PushSample({ body, locale }: { body: string; locale: "ja" | "en" }) {
  return <div className={s.push} role="img" aria-label={`RESOLUTE: ${body}`}>
    <span className={s.icon} aria-hidden="true">⚓</span>
    <span className={s.text}><b>RESOLUTE</b><span>{body}</span></span>
    <small className={s.time} aria-hidden="true">{locale === "ja" ? "今" : "now"}</small>
  </div>;
}
