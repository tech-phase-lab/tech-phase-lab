import test from "node:test";
import assert from "node:assert/strict";
import { parseCompanyWire } from "../lib/research/company-wire.ts";

const row = { id: "a1", titleEn: "Credo expands", titleJa: "Credoが拡大", publisher: "Credo Technology Group", origin: "wire", url: "https://news.google.com/rss/articles/x", publishedAt: "2026-10-14T03:00:00+00:00" };

test("valid rows pass and a bad row is dropped alone", () => {
  const feed = parseCompanyWire({ ok: true, items: { CRDO: [row, { ...row, id: "b", url: "http://insecure.example/a" }, { ...row, id: "c", origin: "official" }, { ...row, id: "d", titleJa: null }] } });
  assert.deepEqual(feed.items.CRDO.map(item => item.id), ["a1", "d"]);
});

test("bad tickers and malformed payloads are refused", () => {
  assert.deepEqual(parseCompanyWire({ ok: true, items: { "bad ticker": [row], CRDO: "x" } }).items, {});
  assert.throws(() => parseCompanyWire({ ok: false, items: {} }));
  assert.throws(() => parseCompanyWire(null));
});
