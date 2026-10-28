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
