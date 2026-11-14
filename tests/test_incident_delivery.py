from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "incident_delivery_unit", ROOT / "scripts/research/incident_delivery.py"
)
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class FakeResponse:
    status = 204

    def close(self):
        pass


class IncidentDeliveryTests(unittest.TestCase):
    def test_configuration_requires_explicit_complete_settings(self):
        self.assertFalse(delivery.configuration({})["enabled"])
        with self.assertRaisesRegex(delivery.DeliveryUnavailable, "notification-token-invalid"):
            delivery.configuration({"RESEARCH_INCIDENT_DELIVERY_ENABLED": "true"})
        for url in ("http://alerts.example.com/hook", "https://127.0.0.1/hook", "https://user:pass@alerts.example.com/hook"):
            with self.assertRaisesRegex(delivery.DeliveryUnavailable, "notification-url-invalid"):
                delivery.configuration({
                    "RESEARCH_INCIDENT_DELIVERY_ENABLED": "true",
                    "RESEARCH_INCIDENT_DELIVERY_START_AT": "2026-09-20T00:00:00Z",
                    "RESEARCH_INCIDENT_WEBHOOK_URL": url,
                    "RESEARCH_INCIDENT_WEBHOOK_TOKEN": "x" * 40,
                })

    def test_webhook_payload_and_headers_exclude_transport_secrets(self):
        config = delivery.configuration({
            "RESEARCH_INCIDENT_DELIVERY_ENABLED": "true",
            "RESEARCH_INCIDENT_DELIVERY_START_AT": "2026-09-20T00:00:00Z",
            "RESEARCH_INCIDENT_WEBHOOK_URL": "https://alerts.example.com/hook",
            "RESEARCH_INCIDENT_WEBHOOK_TOKEN": "s" * 40,
        })
        claim = {
            "id": 1, "key": "source:NBIS", "revision": 1, "transition": "opened",
            "occurredAt": "2026-09-20T00:00:01+00:00", "category": "official-source",
            "subject": "NBIS", "severity": "warning", "errorCode": "timeout", "attempts": 1,
        }
        captured = {}

        def opener(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse()

        self.assertTrue(delivery.send_webhook(config, claim, opener=opener))
        request = captured["request"]
        self.assertEqual(request.full_url, "https://alerts.example.com/hook")
        self.assertEqual(request.get_header("Authorization"), "Bearer " + "s" * 40)
        self.assertEqual(
            request.get_header("Idempotency-key"), "tech-phase:source:NBIS:1:opened"
        )
        body = request.data.decode()
        self.assertIn('"key":"source:NBIS"', body)
        self.assertNotIn("ssssssss", body)
        self.assertNotIn('"id"', body)


if __name__ == "__main__":
    unittest.main()


class OwnerPushTests(unittest.TestCase):
    NOW = datetime(2026, 11, 14, 6, 0, tzinfo=timezone.utc)

    def claim(self, severity="critical", transition="opened", minutes_ago=1):
        at = (self.NOW - timedelta(minutes=minutes_ago)).isoformat()
        return {"key": "discovery:all-sources", "transition": transition, "severity": severity,
                "errorCode": "discovery-all-sources-failing", "occurredAt": at}

    def test_web_push_mode_needs_web_push_and_an_explicit_cutover(self):
        base = {"RESEARCH_INCIDENT_DELIVERY_ENABLED": "true", "RESEARCH_INCIDENT_DELIVERY_MODE": "web-push"}
        with self.assertRaisesRegex(delivery.DeliveryUnavailable, "notification-web-push-disabled"):
            delivery.configuration(base)
        with self.assertRaisesRegex(delivery.DeliveryUnavailable, "notification-cutover-invalid"):
            delivery.configuration({**base, "WEB_PUSH_ENABLED": "true"})
        config = delivery.configuration({**base, "WEB_PUSH_ENABLED": "true", "RESEARCH_INCIDENT_DELIVERY_START_AT": "2026-11-14T05:00:00Z"})
        self.assertEqual((config["mode"], config["enabled"]), ("web-push", True))
        self.assertNotIn("token", config)

    def test_a_recent_critical_incident_reaches_every_owner_device(self):
        sent = []
        reached = delivery.send_owner_push(self.claim(), ['{"endpoint":"a"}', '{"endpoint":"b"}'], lambda sub, msg: sent.append((sub, msg)) or 201, now=self.NOW)
        self.assertEqual(reached, 2)
        self.assertEqual(sent[0][1]["title"], "🚨 公式発表の巡回が全社失敗しています")
        self.assertEqual(sent[0][1]["tag"], "incident-discovery:all-sources")

    def test_warnings_and_stale_rows_are_consumed_without_a_push(self):
        sent = []
        sender = lambda sub, msg: sent.append(msg) or 201
        self.assertEqual(delivery.send_owner_push(self.claim(severity="warning"), ['{}'], sender, now=self.NOW), 0)
        self.assertEqual(delivery.send_owner_push(self.claim(minutes_ago=31), ['{}'], sender, now=self.NOW), 0)
        self.assertEqual(sent, [])

    def test_a_critical_incident_that_reaches_no_device_is_a_failure_to_retry(self):
        with self.assertRaises(delivery.DeliveryFailed):
            delivery.send_owner_push(self.claim(), [], lambda sub, msg: 201, now=self.NOW)
        with self.assertRaises(delivery.DeliveryFailed):
            delivery.send_owner_push(self.claim(), ['{}'], lambda sub, msg: 410, now=self.NOW)
        with self.assertRaises(delivery.DeliveryFailed):
            delivery.send_owner_push(self.claim(), ['{}'], lambda sub, msg: 1 / 0, now=self.NOW)

    def test_resolution_says_recovered(self):
        sent = []
        delivery.send_owner_push(self.claim(transition="resolved"), ['{}'], lambda sub, msg: sent.append(msg) or 200, now=self.NOW)
        self.assertEqual(sent[0]["title"], "✅ 復旧しました")
