import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import desk_reactions
import editorial_posts


class DeskReactionTests(unittest.TestCase):
    def test_member_uniqueness_undo_and_published_notes_only(self):
        with tempfile.TemporaryDirectory() as directory:
            with desk_reactions.connect(Path(directory) / "test.sqlite") as db:
                post = editorial_posts.save(db, {"id": "note-reaction-test", "version": 0, "kind": "notes", "bodyJa": "テスト用の本文です。"})["item"]
                with self.assertRaises(ValueError):
                    desk_reactions.read(db, "a" * 64, post["id"])
                db.execute("UPDATE editorial_posts SET status='published' WHERE id=?", (post["id"],)); db.commit()
                payload = {"postId": post["id"], "emoji": "like", "selected": True}
                for _ in range(2):
                    self.assertEqual(desk_reactions.save(db, "a" * 64, payload)["reactions"]["like"], {"count": 1, "selected": True})
                self.assertEqual(desk_reactions.read(db, "b" * 64, post["id"])["reactions"]["like"], {"count": 1, "selected": False})
                desk_reactions.save(db, "b" * 64, payload)
                self.assertEqual(desk_reactions.save(db, "a" * 64, {**payload, "selected": False})["reactions"]["like"], {"count": 1, "selected": False})
                for emoji in ("sad", "angry"):
                    added = desk_reactions.save(db, "a" * 64, {**payload, "emoji": emoji})
                    self.assertEqual(added["reactions"][emoji], {"count": 1, "selected": True})
                    removed = desk_reactions.save(db, "a" * 64, {**payload, "emoji": emoji, "selected": False})
                    self.assertEqual(removed["reactions"][emoji], {"count": 0, "selected": False})
                for bad in ({**payload, "emoji": "invalid"}, {**payload, "selected": 1}):
                    with self.assertRaises(ValueError): desk_reactions.save(db, "a" * 64, bad)
                with self.assertRaises(ValueError): desk_reactions.read(db, "bad-owner", post["id"])
                for kind, status in (("qa", "published"), ("notes", "withdrawn")):
                    db.execute("UPDATE editorial_posts SET kind=?,status=? WHERE id=?", (kind, status, post["id"])); db.commit()
                    with self.assertRaises(ValueError): desk_reactions.save(db, "a" * 64, payload)

    def test_switch_replaces_old_choice_and_legacy_votes_are_collapsed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite"
            with desk_reactions.connect(path) as db:
                post_id = "note-reaction-test"
                editorial_posts.save(db, {"id": post_id, "version": 0, "kind": "notes", "bodyJa": "テスト用の本文です。"})
                db.execute("UPDATE editorial_posts SET status='published'")
                db.commit()
                payload = {"postId": post_id, "emoji": "like", "selected": True}
                desk_reactions.save(db, "a" * 64, payload)
                desk_reactions.save(db, "b" * 64, payload)
                result = desk_reactions.save(db, "a" * 64, {**payload, "emoji": "sad"})["reactions"]
                self.assertEqual(result["like"], {"count": 1, "selected": False})
                self.assertEqual(result["sad"], {"count": 1, "selected": True})
                self.assertEqual(sum(v["selected"] for v in result.values()), 1)
                db.execute("DROP INDEX desk_reactions_one_choice")
                db.execute("INSERT INTO desk_reactions VALUES(?,?,?)", (post_id, "a" * 64, "fire"))
                db.commit()
            with desk_reactions.connect(path) as db:
                result = desk_reactions.read(db, "a" * 64, post_id)["reactions"]
                self.assertEqual(result["fire"], {"count": 1, "selected": True})
                self.assertEqual(result["sad"]["count"], 0)
                self.assertEqual(result["like"]["count"], 1)
                self.assertEqual(sum(v["selected"] for v in result.values()), 1)
