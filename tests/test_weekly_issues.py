"""週刊 Tech Phase PRO: structured issues, drafts, publication numbers, member reading, draft notice."""
import json
import os
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import weekly_issues as weekly


def issue(headline="MU決算と、ADPからPCEで変わった相場", **over):
    return {"date": "2026-10-01", "headline": headline, "lead": "MUは次四半期も増収増益を見込む決算です。", "sources": [{"title": "Micron", "url": "https://example.com/mu"}], "notes": ["ここは取れませんでした: 粗利率の前年比"],
            "parts": [
                {"type": "numbers", "heading": "MUの決算", "cards": [{"label": "売上", "value": 542.29, "outlook": 615, "unit": "億ドル", "range": "会社見通し 615億ドル ±15億ドル"}, {"label": "前週比だけ", "previous": 10, "value": 12, "unit": "%"}], "note": "利益率の小幅な低下を分けて確認します。"},
                {"type": "timeline", "heading": "ADPからPCEまでの15分", "points": [{"when": "ADP", "event": "強い結果", "comment": "雇用の強さで、金利が意識されました。", "tone": "down"}, {"when": "その後", "event": "受け止めが変わった", "tone": "flat"}]},
                {"type": "chart", "heading": "売上の伸び", "title": "売上(億ドル)", "unit": "億ドル", "bars": [{"label": "今回", "value": 542.29}, {"label": "見通し", "value": 615}], "note": "見通しの幅は 600〜630億ドル"},
                {"type": "schedule", "heading": "次の予定", "items": [{"date": "2026-10-02", "name": "米雇用統計", "comment": "今週の締めになる指標です。"}]},
                {"type": "text", "heading": "ひとこと", "body": "結論から言うと、慌てる週ではありません。"},
                {"type": "highlight", "text": "ルールを開いて、一度だけ深呼吸。"}], **over}


class WeeklyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "weekly.sqlite"
        self.db = weekly.connect(self.path)

    def tearDown(self):
        self.db.close(); self.temp.cleanup()

    def test_a_draft_is_kept_strictly_and_a_member_never_sees_it_or_its_notes(self):
        saved = weekly.save_draft(self.db, {**issue(), "evil": "<script>", "parts": [*issue()["parts"][:1], {"type": "text", "heading": "本文", "body": "短い。", "html": "<b>x</b>"}]})["item"]
        self.assertEqual(saved["status"], "draft"); self.assertIsNone(saved["number"])
        self.assertNotIn("evil", saved); self.assertNotIn("html", json.dumps(saved))
        self.assertEqual(saved["notes"], ["ここは取れませんでした: 粗利率の前年比"])
        self.assertEqual(weekly.member_issues(self.db)["issues"], [])
        self.assertIsNone(weekly.member_issues(self.db)["issue"])
        self.assertEqual(len(weekly.owner_view(self.db)["drafts"]), 1)

    def test_a_part_keeps_its_reading_order_section_and_a_wrong_section_is_refused(self):
        parts = [{"type": "text", "heading": "決算", "body": "本文。", "section": "earnings"}, {"type": "text", "heading": "古い号", "body": "本文。"}]
        saved = weekly.save_draft(self.db, {**issue(), "parts": parts})["item"]
        self.assertEqual([p.get("section") for p in saved["parts"]], ["earnings", None])
        with self.assertRaises(ValueError):
            weekly.save_draft(self.db, {**issue(), "parts": [{**parts[0], "section": "gossip"}]})

    def test_bad_data_is_refused_but_a_number_less_or_one_sided_card_is_fine(self):
        for bad in ({"headline": ""}, {"lead": "x" * 401}, {"date": "2026-13-40"}, {"sources": [{"title": "t", "url": "http://insecure.example"}]},
                    {"parts": [{"type": "magic", "heading": "x"}]}, {"parts": [{"type": "numbers", "heading": "x", "cards": [{"label": "a"}]}]},
                    {"parts": [{"type": "numbers", "heading": "x", "cards": [{"label": "a", "value": float("nan")}]}]},
                    {"parts": [{"type": "chart", "heading": "x", "bars": [{"label": "a", "value": -1}]}]},
                    {"parts": [{"type": "timeline", "heading": "x", "points": [{"when": "a", "event": "b", "tone": "purple"}]}]},
                    {"parts": [{"type": "text", "heading": "x", "body": "y"}] * 13}):
            with self.assertRaises(ValueError, msg=str(bad)[:60]):
                weekly.save_draft(self.db, {**issue(), **bad})
        weekly.save_draft(self.db, {**issue(), "parts": [{"type": "numbers", "heading": "数字が少ない週", "cards": [{"label": "前週比だけ", "previous": 3, "value": 4}, {"label": "見通しだけ", "outlook": 5}]}]})
        weekly.save_draft(self.db, {**issue(), "parts": [], "sources": []})
        weekly.save_draft(self.db, {**issue(), "parts": [{"type": "text", "heading": "本文だけ", "body": "数字が1つもない号です。"}]})

    def test_publishing_numbers_the_issue_one_higher_each_time_and_a_published_issue_is_closed_for_editing(self):
        first = weekly.save_draft(self.db, issue("一つ目"))["item"]
        second = weekly.save_draft(self.db, issue("二つ目"))["item"]
        self.assertEqual(weekly.publish(self.db, {"id": first["id"]})["item"]["number"], 1)
        self.assertEqual(weekly.publish(self.db, {"id": second["id"]})["item"]["number"], 2)
        with self.assertRaisesRegex(ValueError, "weekly-already-published"):
            weekly.publish(self.db, {"id": first["id"]})
        with self.assertRaisesRegex(ValueError, "weekly-already-published"):
            weekly.save_draft(self.db, {**issue("直す"), "id": first["id"]})
        weekly.save_settings(self.db, {"nextNumber": 41})
        third = weekly.save_draft(self.db, issue("三つ目"))["item"]
        self.assertEqual(weekly.publish(self.db, {"id": third["id"]})["item"]["number"], 41)
        with self.assertRaisesRegex(ValueError, "invalid-weekly-settings"):
            weekly.save_settings(self.db, {"nextNumber": 3})
        weekly.delete(self.db, {"id": third["id"]})
        fourth = weekly.save_draft(self.db, issue("四つ目"))["item"]
        self.assertEqual(weekly.publish(self.db, {"id": fourth["id"]})["item"]["number"], 42, "a deleted number is not used again")

    def test_the_owner_fixes_a_draft_and_publishes_it_and_members_read_newest_first_in_pages(self):
        draft = weekly.save_draft(self.db, issue())["item"]
        fixed = weekly.save_draft(self.db, {**issue("直した見出し"), "id": draft["id"]})["item"]
        self.assertEqual((fixed["id"], fixed["headline"]), (draft["id"], "直した見出し"))
        for index in range(7):
            item = weekly.save_draft(self.db, issue(f"号{index}"))["item"]
            weekly.publish(self.db, {"id": item["id"]})
        page = weekly.member_issues(self.db, limit=5)
        self.assertEqual([row["number"] for row in page["issues"]], [7, 6, 5, 4, 3])
        self.assertTrue(page["hasMore"]); self.assertEqual((page["latest"], page["issue"]["number"]), (7, 7))
        older = weekly.member_issues(self.db, limit=5, before=3)
        self.assertEqual([row["number"] for row in older["issues"]], [2, 1]); self.assertFalse(older["hasMore"])
        self.assertEqual(weekly.member_issues(self.db, number=4)["issue"]["headline"], "号3")
        self.assertNotIn("notes", weekly.member_issues(self.db)["issue"])
        self.assertEqual(len(weekly.owner_view(self.db)["drafts"]), 1, "the draft that was not published is still a draft")

    def test_the_auto_publish_switch_is_off_until_turned_on_and_only_the_generators_drafts_follow_it(self):
        self.assertFalse(weekly.settings(self.db)["autoPublish"])
        self.assertEqual(weekly.save_draft(self.db, {**issue(), "auto": True})["item"]["status"], "draft", "off: always goes through the owner")
        weekly.save_settings(self.db, {"autoPublish": True})
        self.assertEqual(weekly.save_draft(self.db, {**issue(), "auto": True})["item"]["status"], "published")
        self.assertEqual(weekly.save_draft(self.db, issue())["item"]["status"], "draft", "a hand-made draft is never published by the switch")
        with self.assertRaisesRegex(ValueError, "invalid-weekly-settings"):
            weekly.save_settings(self.db, {"autoPublish": "yes"})

    def test_http_member_reads_with_the_member_token_and_the_owner_works_with_the_editor_token(self):
        import service
        app = object.__new__(service.AutomaticMonitor); app.db_path = self.path
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler); server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        def call(path, token, payload=None):
            with urlopen(Request(base + path, data=None if payload is None else json.dumps(payload).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}), timeout=5) as response:
                return json.load(response)
        try:
            with patch.dict(os.environ, {"RESEARCH_API_TOKEN": "member-api-token", "RESEARCH_EDITOR_TOKEN": "editor-api-token"}):
                made = call("/admin/weekly/draft", "editor-api-token", issue())["item"]
                with self.assertRaises(HTTPError) as denied:
                    call("/admin/weekly", "member-api-token")
                self.assertEqual(denied.exception.code, 401)
                with self.assertRaises(HTTPError) as denied:
                    call("/weekly/issues", "editor-api-token")
                self.assertEqual(denied.exception.code, 401)
                self.assertIsNone(call("/weekly/issues", "member-api-token")["issue"])
                call("/admin/weekly/publish", "editor-api-token", {"id": made["id"]})
                self.assertEqual(call("/weekly/issues?limit=2", "member-api-token")["issue"]["number"], 1)
                with self.assertRaises(HTTPError) as bad:
                    call("/admin/weekly/draft", "editor-api-token", {"headline": ""})
                self.assertEqual(bad.exception.code, 400)
                self.assertEqual(call("/admin/weekly/settings", "editor-api-token", {"autoPublish": True})["settings"]["autoPublish"], True)
                call("/admin/weekly/delete", "editor-api-token", {"id": made["id"]})
                self.assertIsNone(call("/weekly/issues", "member-api-token")["issue"])
                # "make one now": the editor only; refused while the model is not set up; otherwise it starts in the background.
                with self.assertRaises(HTTPError) as denied:
                    call("/admin/weekly/generate", "member-api-token", {})
                self.assertEqual(denied.exception.code, 401)
                with patch.object(service.weekly_generator, "configuration", return_value=None), self.assertRaises(HTTPError) as unset:
                    call("/admin/weekly/generate", "editor-api-token", {})
                self.assertEqual(unset.exception.code, 503)
                started = threading.Event()
                with patch.object(service.weekly_generator, "configuration", return_value=("k", "m")), \
                     patch.object(service.weekly_generator, "generate_now", side_effect=lambda *args, **kwargs: started.set()):
                    self.assertTrue(call("/admin/weekly/generate", "editor-api-token", {})["ok"])
                    self.assertTrue(started.wait(5))
                self.assertIn("running", call("/admin/weekly", "editor-api-token")["generation"])
                self.assertTrue(call("/admin/weekly/settings", "editor-api-token", {"generateEnabled": True, "generateHour": 9})["settings"]["generateEnabled"])
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


class DraftNoticeTests(unittest.TestCase):
    def test_the_draft_notice_is_off_by_default_carries_no_text_and_comes_once(self):
        import hashlib
        import web_push as push
        from test_web_push import subscription
        with tempfile.TemporaryDirectory() as folder:
            db = push.connect(Path(folder) / "p.sqlite")
            now = datetime(2026, 10, 3, 23, 0, tzinfo=timezone.utc).timestamp()
            payload = {"memberId": "user_ownerfixture", "subscription": subscription(), "accessExpiresAt": now + 600, "allTargets": True}
            env = patch.dict(os.environ, {"WEB_PUSH_ENABLED": "true", "WEB_PUSH_PRIVATE_KEY": "fixture", "WEB_PUSH_PUBLIC_KEY": "fixture", "WEB_PUSH_SUBJECT": "mailto:fixture@example.test"})
            with env:
                push.register_member(db, payload, {"MU"}, now - 10)
                made = datetime.fromtimestamp(now - 60, timezone.utc).isoformat().replace("+00:00", "Z")
                draft = [{"id": "12345678-1234-4234-8234-123456789abc", "createdAt": made}]
                sent = []
                send = lambda _sub, msg: sent.append(msg) or 201
                push.deliver_weekly_drafts(db, draft, send, now, wall_now=lambda: now, entitlement=lambda _: now + 600)
                self.assertEqual(sent, [], "off by default")
                self.assertFalse(push.member_preferences(db, payload, now=now)["preferences"]["weeklyDraft"])
                push.member_preferences(db, {**payload, "preferences": {"weeklyDraft": True}}, save=True, now=now)
                push.deliver_weekly_drafts(db, draft, send, now, wall_now=lambda: now, entitlement=lambda _: now + 600)
                push.deliver_weekly_drafts(db, draft, send, now, wall_now=lambda: now, entitlement=lambda _: now + 600)
                self.assertEqual(len(sent), 1)
                self.assertEqual(sent[0]["url"], "/research/weekly")
                old = [{"id": "12345678-1234-4234-8234-123456789abd", "createdAt": datetime.fromtimestamp(now - 86400, timezone.utc).isoformat()}]
                push.deliver_weekly_drafts(db, old, send, now, wall_now=lambda: now, entitlement=lambda _: now + 600)
                self.assertEqual(len(sent), 1, "an old draft is not announced")
            db.close()


if __name__ == "__main__":
    unittest.main()
