"""Normalize stock logos into same-size rounded-square tiles with uniform padding (owner, Nov 25).
Usage: node --experimental-strip-types scripts/logos/fetch_logos.mts <src dir>, then python3 -I scripts/logos/normalize_logos.py <src dir> public/logos
Sources per ticker, in order: the ticker-keyed logo (financialmodelingprep image-stock), then Twelve Data's logo for the company's domain.
The mark is cut from its own background and put in a 72px tile (24 CSS px at 3x) with the same padding for every logo: a transparent mark on white,
or on the site's dark square when the mark is light; an opaque logo keeps its own background colour. A candidate is rejected when its mark is a wide
wordmark (unreadable at 24px), too faint against its tile, or empty; LETTERS lists logos that pass those checks but are still text too small to read
(checked by eye, Nov 25). A ticker with no tile shows its letters in the same square (app/research/watchlist/stock-logo.tsx)."""
import json, os, sys
from PIL import Image, ImageChops, ImageStat

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE, PAD = 72, 11            # 72px tile (24 CSS px at 3x), the mark fits in the inner 50px
DARK, LIGHT = (27, 37, 49), (255, 255, 255)
LETTERS = set("AEP ASTS CBRS CDE CSCO DOCU ENTG EQIX FSLR GFI GLDM GS HL HMY LEU LOW MDT MS PM SMCI TSM VRTX WFC".split())
os.makedirs(OUT, exist_ok=True)

def lum(c): return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def contrast(a, b):
    la, lb = (lum(a) / 255) ** 2.2, (lum(b) / 255) ** 2.2
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

def load(path):
    try:
        im = Image.open(path); im.load()
        return im.convert("RGBA")
    except Exception:
        return None

def analyse(im):
    """Returns (mark RGBA cropped, tile background RGB, reason or None)."""
    w, h = im.size
    alpha = im.getchannel("A")
    transparent = alpha.getextrema()[0] < 200 and sum(1 for p in alpha.getdata() if p < 40) > 0.05 * w * h
    if transparent:
        box = alpha.point(lambda a: 255 if a > 40 else 0).getbbox()
        if not box: return None, None, "empty"
        mark = im.crop(box)
        px = [p for p in mark.getdata() if p[3] > 128]
        if not px: return None, None, "empty"
        mean = tuple(sum(p[i] for p in px) / len(px) for i in range(3))
        bg = DARK if lum(mean) > 150 else LIGHT
        ink = mean
    else:
        rgb = im.convert("RGB")
        edge = [rgb.getpixel((x, y)) for x in range(w) for y in (0, h - 1)] + [rgb.getpixel((x, y)) for y in range(h) for x in (0, w - 1)]
        bg = max(set(edge), key=edge.count)
        diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg)).convert("L").point(lambda d: 255 if d > 48 else 0)
        box = diff.getbbox()
        if not box: return None, None, "empty"
        mark = im.crop(box)
        mask = diff.crop(box)
        px = [p for p, m in zip(mark.convert("RGB").getdata(), mask.getdata()) if m]
        ink = tuple(sum(p[i] for p in px) / len(px) for i in range(3))
    mw, mh = mark.size
    aspect = max(mw / mh, mh / mw)
    if aspect > 2.3: return None, None, f"wordmark {aspect:.1f}:1"
    if contrast(ink, bg) < 1.6: return None, None, f"faint {contrast(ink, bg):.2f}"
    if min(mw, mh) < 12: return None, None, "tiny"
    return mark, bg, None

def tile(mark, bg):
    inner = SIZE - 2 * PAD
    m = mark.copy(); m.thumbnail((inner, inner), Image.LANCZOS)
    t = Image.new("RGBA", (SIZE, SIZE), bg + (255,))
    t.alpha_composite(m, ((SIZE - m.width) // 2, (SIZE - m.height) // 2))
    return t.convert("RGB")

tickers = json.load(open(os.path.join(SRC, "tickers.json")))
report = {}
for t in tickers:
    if t in LETTERS:
        report[t] = "initials (text too small to read at 24px)"
        continue
    reasons = []
    for source in ("fmp", "td"):
        im = load(os.path.join(SRC, source, t))
        if im is None: continue
        mark, bg, why = analyse(im)
        if why: reasons.append(f"{source}: {why}"); continue
        out = tile(mark, bg).quantize(colors=48, method=Image.Quantize.MEDIANCUT)
        out.save(os.path.join(OUT, f"{t}.png"), optimize=True)
        report[t] = source
        break
    else:
        report[t] = "initials (" + "; ".join(reasons or ["no image"]) + ")"
json.dump(report, open(os.path.join(SRC, "report.json"), "w"), indent=1, ensure_ascii=False)
with open(os.path.join(OUT, "..", "..", "lib", "research", "stock-logos.ts"), "w") as f:
    have = sorted(k for k, v in report.items() if not v.startswith("initials"))
    f.write("/** Tickers with a normalized logo tile in public/logos/<TICKER>.png (scripts/logos/normalize_logos.py, Nov 25). Every other ticker shows its\n"
            " * letters in the same square. */\nexport const STOCK_LOGOS: ReadonlySet<string> = new Set(" + json.dumps(" ".join(have)) + ".split(\" \"));\n")
print(sum(1 for v in report.values() if not v.startswith("initials")), "tiles;", ", ".join(f"{k} [{v}]" for k, v in report.items() if v.startswith("initials")))
