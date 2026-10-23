import type { Metadata } from "next";
import "./geist-fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tech Phase Research Lab",
  description: "Real-time market intelligence delivery prototype.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preload" href="/fonts/geist/caa3a2e1cccd8315-s.p.09~u27dqhyhd6.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/geist/797e433ab948586e-s.p.08e28id.o-okb.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
