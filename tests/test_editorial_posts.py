"""Manual columns exercised against isolated SQLite and HTTP, no provider calls."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import editorial_posts as posts


def draft(kind="weekly"):
    return {"id": "synthetic-column-0001", "version": 0, "kind": kind,
            "titleJa": "検証用の見出し", "titleEn": "Synthetic headline",
            "introJa": "無料の導入文", "introEn": "Public introduction",
            "bodyJa": "これは試験用の本文です。実際の投資情報や本人の見解ではありません。",
            "bodyEn": "This is synthetic test content, not actual investment research.",
            "sourceNotes": "PRIVATE original evidence or actual owner memo",
            "sources": [{"title": "Synthetic evidence", "url": "https://example.com/evidence"}]}


def review(item, decision="published"):
    return {"id": item["id"], "version": item["version"], "decision": decision,
            "reviewer": "Test editor", "reason": "Both languages checked", "verified": True}


class EditorialPostsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "posts.sqlite"
        self.db = posts.connect(self.path)

    def tearDown(self):
        self.db.close(); self.tmp.cleanup()

    def test_save_reopen_publish_and_withdraw_no_private_metadata(self):
        item = posts.save(self.db, draft())["item"]
        self.assertEqual(posts.queue(self.db, published=True)["items"], [])
        with posts.connect(self.path) as second:
            self.assertEqual(posts.queue(second)["items"][0]["sourceNotes"], draft()["sourceNotes"])
            item = posts.review(second, review(item))["item"]
        feed = posts.queue(self.db, published=True)
        self.assertEqual(feed["items"][0]["bodyEn"], draft()["bodyEn"])
        self.assertNotIn("PRIVATE", json.dumps(feed))
        posts.review(self.db, review(item, "withdrawn"))
        self.assertEqual(posts.queue(self.db, published=True)["items"], [])
        self.assertEqual(self.db.execute("SELECT count(*) FROM editorial_post_history").fetchone()[0], 3)

    def test_stale_saves_reviews_and_creation_retries_do_not_overwrite(self):
        item = posts.save(self.db, draft())["item"]
        for operation, payload in [(posts.save, draft()), (posts.review, review({**item, "version": 0}))]:
            with self.assertRaisesRegex(ValueError, "post-conflict"):
                operation(self.db, payload)
        newer = posts.save(self.db, {**item, "bodyEn": "The second editor changed the analysis."})["item"]
        with self.assertRaisesRegex(ValueError, "post-conflict"):
            posts.review(self.db, review(item))
        self.assertEqual(posts.queue(self.db)["items"][0]["version"], newer["version"])

    def test_editing_published_always_requires_new_review_even_if_reverted(self):
        item = posts.review(self.db, review(posts.save(self.db, draft())["item"]))["item"]
        item = posts.save(self.db, item)["item"]
        self.assertEqual(item["status"], "draft")
        self.assertEqual(posts.queue(self.db, published=True)["items"], [])
        item = posts.review(self.db, review(item))["item"]
        self.assertEqual(item["version"], 4)

    def test_incomplete_bilingual_draft_saves_but_cannot_publish(self):
        for field in ["titleJa", "titleEn", "introJa", "introEn", "bodyJa", "bodyEn"]:
            value = {**draft(), "id": "synthetic-" + field.lower() + "-000001", field: ""}
            item = posts.save(self.db, value)["item"]
            with self.assertRaisesRegex(ValueError, "post-bilingual-required"):
                posts.review(self.db, review(item))
        self.assertEqual(posts.queue(self.db, published=True)["items"], [])

    def test_notes_require_owner_memo_and_explicit_verification(self):
        item = posts.save(self.db, {**draft("notes"), "sources": [], "sourceNotes": ""})["item"]
        with self.assertRaisesRegex(ValueError, "post-sources-required"):
            posts.review(self.db, review(item))
        item = posts.save(self.db, {**item, "sourceNotes": "Actual owner statement for this test"})["item"]
        with self.assertRaisesRegex(ValueError, "post-review-required"):
            posts.review(self.db, {**review(item), "verified": "true"})
        self.assertEqual(posts.review(self.db, review(item))["item"]["status"], "published")

    def test_q_and_a_requires_sources_and_safe_links(self):
        item = posts.save(self.db, {**draft("qa"), "sources": []})["item"]
        with self.assertRaisesRegex(ValueError, "post-sources-required"):
            posts.review(self.db, review(item))
        for url in ["javascript:alert(1)", "https://user:password@example.com", "https://example.com/ bad"]:
            with self.assertRaisesRegex(ValueError, "invalid-post-sources"):
                posts.save(self.db, {**item, "sources": [{"title": "bad", "url": url}]})

    def test_editor_archive_keeps_older_drafts_reachable(self):
        for i in range(23):
            posts.save(self.db, {**draft(), "id": f"synthetic-column-{i:04d}"})
        first = posts.queue(self.db)
        self.assertEqual(len(first["items"]), 20)
        self.assertEqual(first["nextOffset"], 20)
        second = posts.queue(self.db, offset=first["nextOffset"])
        self.assertEqual(len(second["items"]), 3)
        self.assertIsNone(second["nextOffset"])
        self.assertEqual(len({v["id"] for v in first["items"] + second["items"]}), 23)

    def test_http_auth_persistence_publication_and_withdrawal(self):
        import service  # Only after discovery has installed isolated service dependencies.
        app = object.__new__(service.AutomaticMonitor); app.db_path = self.path
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler); server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(path, token, payload=None):
            req = Request(f"http://127.0.0.1:{server.server_port}" + path,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            with urlopen(req, timeout=2) as response:
                self.assertIn("no-store", response.headers["Cache-Control"])
                return json.load(response)
        try:
            with patch.dict("os.environ", {"RESEARCH_EDITOR_TOKEN": "synthetic-editor", "RESEARCH_API_TOKEN": "synthetic-reader"}):
                for path, token, payload in [("/posts", "", None), ("/admin/posts", "synthetic-reader", None), ("/admin/posts/draft", "synthetic-reader", draft()), ("/admin/posts/review", "synthetic-reader", {})]:
                    with self.assertRaises(HTTPError) as e: request(path, token, payload)
                    self.assertEqual(e.exception.code, 401)
                item = request("/admin/posts/draft", "synthetic-editor", draft())["item"]
                self.assertEqual(len(request("/admin/posts", "synthetic-editor")["items"]), 1)
                self.assertEqual(request("/posts", "synthetic-reader")["items"], [])
                item = request("/admin/posts/review", "synthetic-editor", review(item))["item"]
                self.assertNotIn("sourceNotes", request("/posts", "synthetic-reader")["items"][0])
                request("/admin/posts/review", "synthetic-editor", review(item, "withdrawn"))
                self.assertEqual(request("/posts", "synthetic-reader")["items"], [])
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)
