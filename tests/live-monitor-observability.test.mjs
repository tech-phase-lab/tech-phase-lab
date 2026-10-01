import assert from "node:assert/strict";
import test from "node:test";

import {
  createMonitorFallbackLogger,
  monitorDiagnosticHeaders,
  monitorExceptionReason,
  monitorStatusReason,
} from "../lib/research/live-monitor-observability.ts";

test("live monitor failures use bounded categories without upstream details", () => {
  assert.equal(monitorStatusReason(401), "upstream-4xx");
  assert.equal(monitorStatusReason(503), "upstream-5xx");
  assert.equal(monitorStatusReason(302), "upstream-other-status");
  assert.equal(monitorExceptionReason(new SyntaxError("private response body")), "invalid-json");
  assert.equal(monitorExceptionReason(new DOMException("private timeout detail", "TimeoutError")), "timeout");
  assert.equal(monitorExceptionReason(new Error("https://user:secret@private.example/path")), "network");
});

test("live monitor fallback headers expose only the fixed safe category", () => {
  assert.deepEqual(monitorDiagnosticHeaders("timeout"), {
    "X-Tech-Phase-Monitor-Mode": "snapshot",
    "X-Tech-Phase-Monitor-Reason": "timeout",
  });
});

test("live monitor logging coalesces failures and records one recovery without private evidence", () => {
  const entries = [];
  const logger = {
    warn: (...args) => entries.push(["warn", ...args]),
    info: (...args) => entries.push(["info", ...args]),
  };
  const monitor = createMonitorFallbackLogger(logger, 300_000);

  monitor.failure("timeout", 1_000);
  monitor.failure("timeout", 2_000);
  monitor.failure("upstream-5xx", 3_000);
  monitor.failure("upstream-5xx", 304_000);
  monitor.recovered(306_000);
  monitor.recovered(307_000);

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((entry) => entry[0]), ["warn", "warn", "warn", "info"]);
  assert.deepEqual(entries.at(-1), ["info", "[research-live] monitor recovered", {
    previousReason: "upstream-5xx",
    elapsedMs: 305_000,
  }]);
  const rendered = JSON.stringify(entries);
  for (const value of ["secret", "private.example", "private response body", "private timeout detail"]) {
    assert.equal(rendered.includes(value), false);
  }
});
