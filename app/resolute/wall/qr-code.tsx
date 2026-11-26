"use client";
import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A QR code drawn here, in the browser (owner, Nov 25: 「スマホで開く」). No external QR service sees the address. */
export default function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
 const path = useMemo(() => {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  let d = "";
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
  return { d, size: count + 8 };
 }, [value]);
 return <svg className={className} viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
  <rect width={path.size} height={path.size} fill="#fff" />
  <path d={path.d} fill="#000" />
 </svg>;
}
