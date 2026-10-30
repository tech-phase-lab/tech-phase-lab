import { useId } from "react";

/** The Tech Phase PRO crown: gold gradient, orbs on the tips, red / green / blue gems, on a dark gold-rimmed seat. */
export default function Crown({ size = 36, bare = false }: { size?: number; bare?: boolean }) {
  const id = useId();
  const art = <svg width={bare ? size : size * .62} height={bare ? size : size * .62} viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fbeab8" /><stop offset=".55" stopColor="#e0b95c" /><stop offset="1" stopColor="#b98a2e" /></linearGradient></defs>
    <path d="M3.5 11l6.5 6L16 5.5 22 17l6.5-6-3 15H6.5z" fill={`url(#${id}g)`} stroke="#8a6a22" strokeWidth=".6" strokeLinejoin="round" />
    <path d="M6.5 23.5h19v3.2h-19z" fill="#a47d2c" stroke="#7a5a1c" strokeWidth=".5" />
    <circle cx="3.5" cy="10.5" r="1.9" fill="#fbeab8" /><circle cx="16" cy="5" r="2" fill="#fbeab8" /><circle cx="28.5" cy="10.5" r="1.9" fill="#fbeab8" />
    <circle cx="16" cy="18.6" r="2.1" fill="#e5535f" stroke="#7a1d26" strokeWidth=".4" />
    <circle cx="10.5" cy="20.6" r="1.4" fill="#5de0b0" stroke="#1d6b52" strokeWidth=".4" />
    <circle cx="21.5" cy="20.6" r="1.4" fill="#6fa8ff" stroke="#27468a" strokeWidth=".4" />
  </svg>;
  if (bare) return art;
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: size * .33, border: "1px solid #8a6f33", background: "radial-gradient(circle at 30% 20%,#2e2410,#120e06)", boxShadow: "0 0 18px rgba(217,181,106,.35),inset 0 0 10px rgba(217,181,106,.12)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{art}</span>;
}
