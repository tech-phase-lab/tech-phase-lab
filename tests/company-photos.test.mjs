import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { companyPhotos } from "../lib/research/company-photos.ts";

const ALLOWED_LICENSE = /^(CC0|Public domain|CC BY(-SA)? \d\.\d)$/;
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const entries = Object.entries(companyPhotos);

test("company photo library has entries keyed by upper-case ticker", () => {
  assert.ok(entries.length >= 40, `expected at least 40 photos, got ${entries.length}`);
  for (const [ticker, photo] of entries) {
    assert.match(ticker, /^[A-Z]{1,5}$/);
    assert.equal(photo.url, `/company-photos/${ticker.toLowerCase()}.webp`);
  }
});

test("every company photo has an allowed free license and a Commons source", () => {
  for (const [ticker, photo] of entries) {
    assert.match(photo.license, ALLOWED_LICENSE, `${ticker}: license ${photo.license}`);
    if (photo.license !== "Public domain") {
      assert.match(photo.licenseUrl, /^https?:\/\/creativecommons\.org\//, `${ticker}: license URL`);
    }
    const source = new URL(photo.source);
    assert.equal(source.hostname, "commons.wikimedia.org", `${ticker}: source host`);
    assert.match(source.pathname, /^\/wiki\/File:/, `${ticker}: source path`);
    assert.ok(photo.credit.trim().length > 0, `${ticker}: credit`);
    assert.doesNotMatch(photo.credit, /<[^>]+>/, `${ticker}: credit must be plain text`);
    assert.ok(photo.caption.ja.trim().length > 0, `${ticker}: ja caption`);
    assert.ok(photo.caption.en.trim().length > 0, `${ticker}: en caption`);
  }
});

test("every company photo file exists under public/ and is smaller than 200 KB", () => {
  for (const [ticker, photo] of entries) {
    const file = `${publicDir}${photo.url}`;
    assert.ok(existsSync(file), `${ticker}: missing ${file}`);
    const { size } = statSync(file);
    assert.ok(size > 0 && size < 200 * 1024, `${ticker}: ${size} bytes`);
  }
});
