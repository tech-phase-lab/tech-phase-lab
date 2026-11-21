import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { priceAlertDelivery } from "../lib/research/price-alert-settings.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("the price-alert sheet says 準備中 until the monitor delivers price alerts to this member", () => {
  assert.equal(priceAlertDelivery({ enabled: true, pro: true, priceAlerts: true }), "live");
  assert.equal(priceAlertDelivery({ enabled: true, pro: true, priceAlerts: false }), "not-ready", "the monitor's switch is off (the default)");
  assert.equal(priceAlertDelivery({ enabled: true, pro: true }), "not-ready", "an older monitor that does not say");
  assert.equal(priceAlertDelivery({ enabled: false, priceAlerts: true }), "not-ready", "push itself is off");
  assert.equal(priceAlertDelivery({ enabled: false, reason: "pro-required" }), "pro-required");
  assert.equal(priceAlertDelivery({ enabled: true, pro: false, resolute: true, priceAlerts: true }), "pro-required", "a RESOLUTE-only buyer");
  assert.equal(priceAlertDelivery(null), "not-ready");
  const detail = read("../app/research/price/quote-detail.tsx");
  assert.match(detail, /delivery === "not-ready" \? <p>\{t\("設定のみ保存できます。通知配信は準備中です。"/);
});

test("the site gives the monitor the member's watchlist key and passes on the monitor's switch", () => {
  const route = read("../app/api/research/notifications/route.ts");
  assert.match(route, /favoritesOwner: createHmac\("sha256", process\.env\.RESEARCH_MONITOR_TOKEN \?\? ""\)\.update\(`favorites:\$\{member\.userId\}`\)/);
  // The same key the watchlists are stored under.
  assert.match(read("../app/api/research/favorites/route.ts"), /createHmac\("sha256", token\)\.update\(`favorites:\$\{member\.userId\}`\)/);
  assert.match(route, /priceAlerts: config\.enabled === true && config\.priceAlerts === true/);
  const service = read("../scripts/research/service.py");
  assert.match(service, /"priceAlerts": price_alerts\.enabled\(\)/);
  assert.match(service, /self\.price_alert_thread\.start\(\)/);
  const monitor = read("../scripts/research/price_alerts.py");
  assert.match(monitor, /get\('PRICE_ALERT_PUSH_ENABLED', ''\)\.strip\(\)\.lower\(\) == 'true'/, "off unless the owner turns it on");
});

test("the 価格通知 row appears on the notification page only while delivery is on; the owner is let through like PRO", () => {
  const view = read("../app/research/notification-page-view.tsx");
  assert.match(view, /\{p\.access\?\.priceAlerts && row\(icons\.price, t\("価格通知", "Price alerts"\)/);
  assert.match(read("../app/research/notification-settings.tsx"), /priceAlerts: config\.priceAlerts === true/);
  // The monitor re-checks PRO right before each send through the membership check, which answers PRO for the owner accounts first.
  const entitlement = read("../app/api/research/notifications/entitlement/route.ts");
  assert.match(entitlement, /if \(isOwnerAccount\(id\)\) return Response\.json\(\{ ok: true, pro: true/);
  assert.match(read("../scripts/research/price_alerts.py"), /web_push\.announce\(db, _key\(owner, alert, crossings\)/);
});
