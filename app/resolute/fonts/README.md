# RESOLUTE fonts

Noto Sans JP and Noto Serif JP match Claude's reference HTML. They are served locally with `next/font/local`, so viewing the screens makes no Google Fonts request and production builds do not depend on downloading Japanese font subsets.

These variable WOFF2 files are subsets of Google Fonts' official sources under the adjacent SIL Open Font Licenses. They contain ASCII and the characters used in `app/resolute` and `lib/resolute` as of this change (814 supported code points each). Other characters fall back to the system Japanese font. If Japanese UI copy introduces new characters, regenerate the subset from the source fonts with FontTools and Brotli, using the union of those source files' characters and ASCII U+0020–U+007E; retain all layout features and name/license records.

- Sans source: https://github.com/google/fonts/blob/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf
  SHA-256: c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f
- Serif source: https://github.com/google/fonts/blob/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf
  SHA-256: 2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc

Do not replace these with remote stylesheet links or change Tech Phase's fonts outside RESOLUTE.
