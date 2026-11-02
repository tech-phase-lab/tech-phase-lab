"""Private question intake, ownership and answer-link tests."""
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
import secrets
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

    def test_board_paginates_beyond_fifty_and_embeds_only_published_answers(self):
        for index in range(61):
            self.db.execute("INSERT INTO member_questions(id,owner_key,body,status,created_at,updated_at,audience) VALUES(?,?,?,?,?,?,?)", (f"q-{index:032x}", OWNER_A, "質問の本文です。", "pending", f"2026-01-{index % 28 + 1:02d}T00:00:00Z", "2026-01-01T00:00:00Z", "pro-board"))
        self.db.commit()
        pages = [questions.board_queue(self.db, OWNER_B, page=page) for page in range(1, 8)]
        ids = [item["id"] for page in pages for item in page["items"]]
        self.assertEqual(len(ids), 61)
        self.assertEqual(len(set(ids)), 61)
        self.assertTrue(all(page["hasNext"] for page in pages[:6]))
        self.assertFalse(pages[-1]["hasNext"])
        question_id = pages[0]["items"][0]["id"]
        questions.answer(self.db, {"id": question_id, "body": "回答をここに表示します。", "reviewer": "owner"})
        answer = questions.board_queue(self.db, OWNER_B)["items"][0]["answer"]
        self.assertEqual(answer["bodyJa"], "回答をここに表示します。")
        self.assertNotIn("sourceNotes", answer)
        self.assertNotIn(OWNER_A, json.dumps(answer))
        self.db.execute("UPDATE editorial_posts SET status='withdrawn' WHERE id=?", (answer["id"],))
        self.db.commit()
        self.assertNotIn("answer", questions.board_queue(self.db, OWNER_B)["items"][0])
        for page in (0, -1, 100001, True):
            with self.assertRaisesRegex(ValueError, "invalid-question-page"):
                questions.board_queue(self.db, OWNER_B, page=page)

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

    def test_board_daily_limit_is_two_by_default_allows_idempotent_retry_and_resets_at_midnight_in_japan(self):
        self.assertEqual(questions.settings()["dailyLimit"], 2)
        payload = {"ownerKey": OWNER_A, "body": "投稿回数制限を検証するための質問です。", "audience": "pro-board"}
        for i in range(2):
            questions.submit(self.db, {**payload, "requestId": "q-" + format(i, "032x"), "body": f"{i}番目の、投稿回数を確かめる質問です。"})
        questions.submit(self.db, {**payload, "requestId": "q-" + format(0, "032x"), "body": "0番目の、投稿回数を確かめる質問です。"})
        with self.assertRaisesRegex(ValueError, "question-daily-limit"):
            questions.submit(self.db, {**payload, "body": "3件目は書けないはずの質問です。"})
        self.assertEqual(questions.board_queue(self.db, OWNER_A)["left"], 0)
        self.assertEqual(questions.board_queue(self.db, OWNER_B)["left"], 2, "the limit is per member")
        # The day changes at 0:00 Japan time (15:00 UTC), not at 0:00 UTC.
        from datetime import datetime, timezone
        evening = datetime(2026, 11, 2, 14, 59, tzinfo=timezone.utc)
        self.assertEqual(questions.day_start(evening), "2026-11-01T15:00:00.000+00:00")
        after = datetime(2026, 11, 2, 15, 1, tzinfo=timezone.utc)
        self.assertEqual(questions.day_start(after), "2026-11-02T15:00:00.000+00:00")
        with patch.object(questions, "day_start", lambda now=None: "9999-01-01T00:00:00.000+00:00"):
            self.assertEqual(questions.board_queue(self.db, OWNER_A)["left"], 2, "a new day gives the posts back")
            questions.submit(self.db, {**payload, "body": "次の日になれば、また書ける質問です。"})

    def test_urls_ng_words_and_repeated_posts_are_held_for_the_owner_only(self):
        post = lambda owner, body: questions.submit(self.db, {"ownerKey": owner, "body": body, "audience": "pro-board", "requestId": "q-" + secrets.token_hex(16)})["item"]
        cases = [("今すぐ儲かる方法はこちら http://xxxx.example", "URLを含む"), ("詳しくは www.example.com を見て", "URLを含む"),
                 ("ドル箱の銘柄を教えてください。", "NGワード「ドル箱」を含む"), ("ゼウスという人の話を聞きたいです。", "NGワード「ゼウス」を含む"),
                 ("これは詐欺ではないのでしょうか。", "NGワード「詐欺」を含む"), ("情報商材を買うべきか迷っています。", "NGワード「情報商材」を含む")]
        for index, (body, reason) in enumerate(cases):
            owner = format(index + 10, "064x")
            item = post(owner, body)
            self.assertNotIn("held", item, "the author is not told")
            self.assertEqual([row["id"] for row in questions.board_queue(self.db, owner)["items"]], [item["id"]], "the author still sees it as an ordinary post")
            self.assertNotIn(item["id"], [row["id"] for row in questions.board_queue(self.db, OWNER_B)["items"]], "other members never see it")
            seen = {row["id"]: row for row in questions.board_queue(self.db, OWNER_B, owner_view=True)["items"]}
            self.assertEqual((seen[item["id"]]["held"], seen[item["id"]]["heldReason"]), (True, reason))
        # An ordinary post is not held.
        fine = post(OWNER_A, "半導体は、いまから入っても遅いですか？")
        self.assertIn(fine["id"], [row["id"] for row in questions.board_queue(self.db, OWNER_B)["items"]])
        # The same text again by the same member is held; another member's identical text is not.
        again = post(OWNER_A, "半導体は、いまから入っても遅いですか？")
        self.assertNotIn(again["id"], [row["id"] for row in questions.board_queue(self.db, OWNER_B)["items"]])
        held = [row for row in questions.board_queue(self.db, OWNER_B, owner_view=True)["items"] if row["id"] == again["id"]][0]
        self.assertEqual(held["heldReason"], "同じ内容の連投")
        other = post(format(99, "064x"), "半導体は、いまから入っても遅いですか？")
        self.assertIn(other["id"], [row["id"] for row in questions.board_queue(self.db, OWNER_B)["items"]])
        # "表示する": the owner releases a held post and everyone sees it.
        questions.review(self.db, {"id": again["id"], "decision": "release"})
        self.assertIn(again["id"], [row["id"] for row in questions.board_queue(self.db, OWNER_B)["items"]])

    def test_only_the_author_can_delete_their_post_and_the_count_is_not_given_back(self):
        payload = {"ownerKey": OWNER_A, "audience": "pro-board"}
        first = questions.submit(self.db, {**payload, "body": "消してもその日の件数は戻らない質問です。"})["item"]
        with self.assertRaisesRegex(ValueError, "question-not-found"):
            questions.submit(self.db, {"ownerKey": OWNER_B, "action": "delete", "id": first["id"]})
        self.assertIn(first["id"], [row["id"] for row in questions.board_queue(self.db, OWNER_B)["items"]])
        result = questions.submit(self.db, {"ownerKey": OWNER_A, "action": "delete", "id": first["id"]})
        self.assertEqual(result["left"], 1)
        self.assertEqual(questions.board_queue(self.db, OWNER_B)["items"], [])
        second = questions.submit(self.db, {**payload, "body": "二つ目の質問です。これも消します。"})["item"]
        questions.submit(self.db, {"ownerKey": OWNER_A, "action": "delete", "id": second["id"]})
        self.assertEqual(questions.board_queue(self.db, OWNER_A)["left"], 0, "deleting and rewriting cannot be used to post more")
        with self.assertRaisesRegex(ValueError, "question-daily-limit"):
            questions.submit(self.db, {**payload, "body": "三つ目は消した分も数えるので書けません。"})
        # The owner can delete any post, and the answer goes with it.
        third = questions.submit(self.db, {"ownerKey": OWNER_B, "audience": "pro-board", "body": "運営者が消す質問と、その回答です。"})["item"]
        questions.answer(self.db, {"id": third["id"], "body": "回答です。"})
        questions.review(self.db, {"id": third["id"], "decision": "delete"})
        self.assertEqual(questions.board_queue(self.db, OWNER_A, owner_view=True)["items"], [])
        self.assertEqual(self.db.execute("SELECT status FROM editorial_posts WHERE id=?", ("qa-" + third["id"][2:],)).fetchone()[0], "withdrawn")

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

class DirectAnswerTests(unittest.TestCase):
    def test_atomic_publication_and_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"q.db"
            with editorial_posts.connect(path): pass
            with questions.connect(path) as db:
                questions.submit(db,{"ownerKey":OWNER_A,"requestId":QUESTION_ID,"body":"決算で最初に見る数字は何ですか？","audience":"pro-board"})
                answer=questions.answer(db,{"id":QUESTION_ID,"body":"売上の伸びと見通しを確認します。"})
                self.assertEqual(answer["item"]["status"],"answered")
                self.assertEqual(questions.answer(db,{"id":QUESTION_ID,"body":"売上の伸びと見通しを確認します。"})["item"]["answerPostId"],answer["item"]["answerPostId"])
                self.assertEqual(db.execute("SELECT count(*) FROM editorial_posts").fetchone()[0],1)
                with self.assertRaises(ValueError): questions.answer(db,{"id":QUESTION_ID,"body":"別の回答です。"})
                post=editorial_posts.queue(db,published=True)["items"][0]
                self.assertEqual(post["bodyEn"],"")
                self.assertEqual(post["bodyJa"],"売上の伸びと見通しを確認します。")
                private=questions.submit(db,{"ownerKey":OWNER_B,"body":"これは以前の非公開の質問です。"})["item"]
                with self.assertRaises(ValueError): questions.answer(db,{"id":private["id"],"body":"公開しない"})

    def test_correction_preserves_link_and_date_rejects_stale_version(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"q.db"
            with editorial_posts.connect(path): pass
            with questions.connect(path) as db:
                questions.submit(db,{"ownerKey":OWNER_A,"requestId":QUESTION_ID,"body":"決算で最初に見る数字は何ですか？","audience":"pro-board"})
                questions.answer(db,{"id":QUESTION_ID,"body":"最初の回答です。"})
                old = editorial_posts.queue(db,published=True)["items"][0]
                row = db.execute("SELECT content FROM editorial_posts WHERE id=?", (old['id'],)).fetchone()
                content = json.loads(row[0]); content.update(titleEn='Old question',bodyEn='Old answer')
                db.execute("UPDATE editorial_posts SET content=? WHERE id=?", (json.dumps(content),old['id'])); db.commit()
                updated = questions.answer(db,{"id":QUESTION_ID,"body":"**訂正した回答です。**","expectedVersion":old['version']})
                self.assertEqual(updated['post']['version'],old['version']+1)
                self.assertEqual(updated['post']['publishedAt'],old['publishedAt'])
                self.assertEqual(updated['post']['bodyEn'],'')
                self.assertEqual(updated['item']['answerPostId'],old['id'])
                self.assertEqual(db.execute("SELECT count(*) FROM editorial_posts").fetchone()[0],1)
                self.assertEqual(db.execute("SELECT count(*) FROM editorial_post_history").fetchone()[0],2)
                for version in [old['version'],True,0,-1,'2']:
                    with self.assertRaisesRegex(ValueError,'answer-conflict'):
                        questions.answer(db,{"id":QUESTION_ID,"body":"上書き禁止","expectedVersion":version})
                self.assertEqual(editorial_posts.queue(db,published=True)['items'][0]['bodyJa'],'**訂正した回答です。**')
                # Repeating unchanged content at the current version creates no history.
                questions.answer(db,{"id":QUESTION_ID,"body":"**訂正した回答です。**","expectedVersion":updated['post']['version']})
                self.assertEqual(db.execute("SELECT count(*) FROM editorial_post_history").fetchone()[0],2)
                questions.review(db,{"id":QUESTION_ID,"decision":"closed"})
                with self.assertRaisesRegex(ValueError,'question-not-found'):
                    questions.answer(db,{"id":QUESTION_ID,"body":"復活させない","expectedVersion":updated['post']['version']})

    def test_delete_answer_keeps_question_and_allows_answering_again(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"q.db"
            with editorial_posts.connect(path): pass
            with questions.connect(path) as db:
                questions.submit(db,{"ownerKey":OWNER_A,"requestId":QUESTION_ID,"body":"決算で最初に見る数字は何ですか？","audience":"pro-board"})
                questions.answer(db,{"id":QUESTION_ID,"body":"最初の回答です。"})
                old = editorial_posts.queue(db,published=True)["items"][0]
                editorial_posts.review(db,{"id":old['id'],"version":old['version'],"kind":"qa","decision":"withdrawn","reviewer":"verified-owner","reason":"Owner deleted reply"})
                self.assertEqual(editorial_posts.queue(db,published=True)['items'],[])
                row = db.execute("SELECT * FROM member_questions WHERE id=?", (QUESTION_ID,)).fetchone()
                self.assertEqual(row['status'],'pending'); self.assertIsNone(row['answer_post_id'])
                questions.answer(db,{"id":QUESTION_ID,"body":"改めて回答します。"})
                latest = editorial_posts.queue(db,published=True)['items'][0]
                self.assertEqual(latest['id'],old['id']); self.assertEqual(latest['bodyJa'],'改めて回答します。')
                self.assertEqual(db.execute("SELECT count(*) FROM editorial_posts").fetchone()[0],1)
