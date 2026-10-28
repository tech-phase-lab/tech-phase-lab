import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import manifest from "../app/manifest.ts";

const png = async path => {
  const bytes = await readFile(new URL(`../public/${path}`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG", path);
  // IHDR: width, height, bit depth, colour type (2 = RGB without alpha: the picture is opaque).
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
};

test("Add to Home Screen: name, standalone display and icons", async () => {
  const m = manifest();
  assert.equal(m.short_name, "Tech Phase");
  assert.equal(m.name, "Tech Phase");
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/research");
  const byPurpose = Object.fromEntries(m.icons.map(icon => [`${icon.sizes}:${icon.purpose}`, icon.src]));
  assert.equal(byPurpose["192x192:any"], "/tech-phase-192.png");
  assert.equal(byPurpose["512x512:any"], "/tech-phase-512.png");
  assert.equal(byPurpose["512x512:maskable"], "/tech-phase-512-maskable.png");
  for (const icon of m.icons) {
    const size = Number(icon.sizes.split("x")[0]);
    assert.deepEqual(await png(icon.src.slice(1)), { width: size, height: size, colorType: 2 }, icon.src);
  }
});

test("apple-touch-icon is a 180x180 opaque PNG and both layouts point to it", async () => {
  assert.deepEqual(await png("apple-touch-icon.png"), { width: 180, height: 180, colorType: 2 });
  for (const file of ["../app/layout.tsx", "../app/research/layout.tsx"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /\/apple-touch-icon\.png/, file);
    assert.match(source, /appleWebApp: \{ capable: true, title: "Tech Phase" \}/, file);
  }
  assert.match(await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"), /manifest: "\/manifest\.webmanifest"/);
});

test("favicon.ico holds the mark at 16, 32 and 48 px", async () => {
  const ico = await readFile(new URL("../app/favicon.ico", import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16]);
  assert.deepEqual(sizes, [16, 32, 48]);
});
