"""Private question intake, ownership and answer-link tests."""
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import editorial_posts
import questions


OWNER_A = "a" * 64
OWNER_B = "b" * 64
QUESTION_ID = "q-" + "1" * 32


def qa_draft():
    return {
        "id": "synthetic-answer-0001", "version": 0, "kind": "qa",
        "titleJa": "検証用の回答", "titleEn": "Synthetic answer",
        "introJa": "確認済みの導入文です。", "introEn": "A verified introduction.",
        "bodyJa": "確認済みの回答本文です。必要な長さを満たします。",
        "bodyEn": "This is the verified answer body with enough detail.",
        "sourceNotes": "Synthetic source notes for isolated testing.",
        "sources": [{"title": "Example", "url": "https://example.com/source"}],
    }


class QuestionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "questions.sqlite"
        with editorial_posts.connect(self.path):
            pass
        self.db = questions.connect(self.path)

    def tearDown(self):
        self.db.close(); self.temp.cleanup()

    def test_board_shares_only_new_posts_and_hides_deleted(self):
        private = questions.submit(self.db, {"ownerKey": OWNER_A, "body": "以前の非公開質問は共有しないでください。"})["item"]
        payload = {"ownerKey": OWNER_A, "requestId": QUESTION_ID, "body": "新しい質問はPRO会員で共有します。", "audience": "pro-board"}
        posted = questions.submit(self.db, payload)["item"]
        board = questions.board_queue(self.db, OWNER_B)
        self.assertEqual([i["id"] for i in board["items"]], [posted["id"]])
        self.assertFalse(board["items"][0]["isMine"])
        self.assertNotIn(OWNER_A, json.dumps(board))
        self.assertEqual(board["privateItems"], [])
        self.assertEqual(questions.board_queue(self.db, OWNER_A)["privateItems"][0]["id"], private["id"])
        with self.assertRaisesRegex(ValueError, "question-conflict"):
            questions.submit(self.db, {**payload, "audience": "private"})
        questions.review(self.db, {"id": posted["id"], "decision": "closed"})
        self.assertEqual(questions.board_queue(self.db, OWNER_B)["items"], [])
        questions.review(self.db, {"id": posted["id"], "decision": "pending"})
        self.assertEqual(len(questions.board_queue(self.db, OWNER_B)["items"]), 1)

    def test_board_daily_limit_allows_idempotent_retry(self):
        payload = {"ownerKey": OWNER_A, "body": "投稿回数制限を検証するための質問です。", "audience": "pro-board"}
        for i in range(10):
            questions.submit(self.db, {**payload, "requestId": "q-" + format(i, "032x")})
        questions.submit(self.db, {**payload, "requestId": "q-" + format(0, "032x")})
        with self.assertRaisesRegex(ValueError, "question-daily-limit"):
            questions.submit(self.db, payload)

    def test_submit_is_private_owned_and_idempotent(self):
        payload = {"ownerKey": OWNER_A, "requestId": QUESTION_ID, "body": "  決算で最初に見る数字は何ですか？  "}
        first = questions.submit(self.db, payload)["item"]
        second = questions.submit(self.db, payload)["item"]
        self.assertEqual(first, second)
        self.assertEqual(first["body"], "決算で最初に見る数字は何ですか？")
        self.assertEqual(questions.member_queue(self.db, OWNER_B)["items"], [])
        self.assertEqual(len(questions.member_queue(self.db, OWNER_A)["items"]), 1)
        with self.assertRaisesRegex(ValueError, "question-conflict"):
            questions.submit(self.db, {**payload, "ownerKey": OWNER_B})

    def test_answer_requires_a_published_qa_post(self):
        item = questions.submit(self.db, {"ownerKey": OWNER_A, "requestId": QUESTION_ID, "body": "この質問は回答候補になりますか？"})["item"]
        with self.assertRaisesRegex(ValueError, "question-answer-not-published"):
            questions.review(self.db, {"id": item["id"], "decision": "answered", "answerPostId": "synthetic-answer-0001"})
        with editorial_posts.connect(self.path) as posts:
            answer = editorial_posts.save(posts, qa_draft())["item"]
            answer = editorial_posts.review(posts, {"id": answer["id"], "version": answer["version"], "decision": "published", "reviewer": "human-reviewer", "reason": "Verified synthetic answer", "verified": True})["item"]
        linked = questions.review(self.db, {"id": item["id"], "decision": "answered", "answerPostId": answer["id"]})["item"]
        self.assertEqual(linked["status"], "answered")
        self.assertEqual(linked["answerPostId"], answer["id"])
        queue = questions.moderation_queue(self.db, "answered")
        self.assertEqual(queue["items"][0]["body"], "この質問は回答候補になりますか？")
        self.assertEqual(queue["answers"][0]["id"], answer["id"])

    def test_closed_question_can_return_to_pending(self):
        item = questions.submit(self.db, {"ownerKey": OWNER_A, "requestId": QUESTION_ID, "body": "掲載しない場合の状態を確認します。"})["item"]
        closed = questions.review(self.db, {"id": item["id"], "decision": "closed"})["item"]
        self.assertEqual(closed["status"], "closed")
        pending = questions.review(self.db, {"id": item["id"], "decision": "pending"})["item"]
        self.assertEqual(pending["status"], "pending")

    def test_input_bounds_and_owner_keys_are_enforced(self):
        for payload in [
            {"ownerKey": "raw-user-id", "requestId": QUESTION_ID, "body": "十分な長さの質問本文です。"},
            {"ownerKey": OWNER_A, "requestId": "bad", "body": "十分な長さの質問本文です。"},
            {"ownerKey": OWNER_A, "requestId": QUESTION_ID, "body": "short"},
            {"ownerKey": OWNER_A, "requestId": QUESTION_ID, "body": "x" * 1201},
        ]:
            with self.assertRaises(ValueError):
                questions.submit(self.db, payload)

    def test_http_routes_separate_member_and_editor_credentials(self):
        import service
        app = object.__new__(service.AutomaticMonitor); app.db_path = self.path
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler); server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        def request(path, token, payload=None, owner=None):
            headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
            if owner:
                headers["X-Question-Owner"] = owner
            req = Request(base + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
            with urlopen(req, timeout=2) as response:
                self.assertIn("no-store", response.headers["Cache-Control"])
                return json.load(response)
        try:
            env = {"RESEARCH_API_TOKEN": "member-api-token", "RESEARCH_EDITOR_TOKEN": "editor-api-token"}
            with patch.dict(os.environ, env, clear=False):
                payload = {"ownerKey": OWNER_A, "requestId": QUESTION_ID, "body": "HTTP経由で非公開質問を保存します。"}
                with self.assertRaises(HTTPError) as denied:
                    request("/questions", "editor-api-token", payload)
                self.assertEqual(denied.exception.code, 401)
                request("/questions", "member-api-token", payload)
                self.assertEqual(len(request("/questions", "member-api-token", owner=OWNER_A)["items"]), 1)
                with self.assertRaises(HTTPError) as denied:
                    request("/admin/questions", "member-api-token")
                self.assertEqual(denied.exception.code, 401)
                self.assertEqual(len(request("/admin/questions?view=pending", "editor-api-token")["items"]), 1)
                closed = request("/admin/questions/review", "editor-api-token", {"id": QUESTION_ID, "decision": "closed"})["item"]
                self.assertEqual(closed["status"], "closed")
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
