"""Voice memos sent from the phone to the owner's inbox: key, limits, content checks, private storage, owner list."""
import io
import json
import os
import struct
import sys
import tempfile
import threading
import unittest
import wave
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import voice_inbox as inbox


def box(kind, payload=b""):
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def mp4(handler=b"soun", seconds=3, pad=2048):
    hdlr = box(b"hdlr", b"\0\0\0\0" + b"\0\0\0\0" + handler + b"\0" * 12)
    mvhd = box(b"mvhd", b"\0\0\0\0" + b"\0" * 8 + struct.pack(">II", 1000, seconds * 1000) + b"\0" * 80)
    trak = box(b"trak", box(b"mdia", hdlr))
    return box(b"ftyp", b"M4A \0\0\0\0M4A mp42isom") + box(b"moov", mvhd + trak) + box(b"mdat", b"\x01" * pad)


def mp3(frames=3):
    frame = b"\xff\xfb\x90\x00" + b"\0" * 413  # MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417 bytes
    return b"ID3\x03\x00\x00\x00\x00\x00\x00" + frame * frames + b"\0" * 600


def wav(seconds=1):
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); w.writeframes(b"\0\0" * 8000 * seconds)
    return out.getvalue()


def multipart(filename, content, field="file", boundary="----tpboundary123"):
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "inbox.sqlite"
        self.db = inbox.connect(self.path)
        inbox.LIMITER.__init__()
        self.key = inbox.issue_key(self.db)["key"]
        self.stored = []
        self.upload = lambda key, body, length, kind: self.stored.append((key, body.read(), length, kind))

    def tearDown(self):
        self.db.close(); self.temp.cleanup()

    def send(self, filename, content, key=None, sender="1.1.1.1", field="file"):
        body, ctype = multipart(filename, content, field)
        return inbox.receive(self.db, io.BytesIO(body), len(body), ctype, f"Bearer {self.key if key is None else key}", sender, upload=self.upload)

    def test_the_key_is_shown_once_stored_only_as_a_hash_and_replaced_at_once(self):
        stored = self.db.execute("SELECT key_hash FROM inbox_key").fetchone()[0]
        self.assertNotIn(self.key, stored)
        self.assertEqual(len(stored), 64)
        self.assertTrue(inbox.key_matches(self.db, f"Bearer {self.key}"))
        self.assertFalse(inbox.key_matches(self.db, "Bearer tpinbox_" + "x" * 43))
        self.assertFalse(inbox.key_matches(self.db, None))
        self.assertFalse(inbox.key_matches(self.db, self.key))
        newer = inbox.issue_key(self.db)["key"]
        self.assertNotEqual(newer, self.key)
        self.assertFalse(inbox.key_matches(self.db, f"Bearer {self.key}"), "the old key stops working at once")
        self.assertTrue(inbox.key_matches(self.db, f"Bearer {newer}"))
        self.assertNotIn(newer, json.dumps(inbox.key_status(self.db)))

    def test_a_wrong_key_stores_nothing_and_repeated_wrong_keys_are_blocked(self):
        for _ in range(5):
            self.assertEqual(self.send("a.m4a", mp4(), key="tpinbox_" + "y" * 43)[0], 401)
        self.assertEqual(self.stored, [])
        self.assertEqual(self.send("a.m4a", mp4())[0], 429, "even the right key is refused while blocked")
        self.assertEqual(self.send("a.m4a", mp4(), sender="2.2.2.2")[0], 200, "another sender is not blocked")

    def test_only_real_audio_is_accepted_whatever_the_file_is_called(self):
        for index, (name, content) in enumerate((("memo.m4a", mp4()), ("memo.mp4", mp4()), ("a.mp3", mp3()), ("a.wav", wav()), ("noext", mp4()), ("liar.txt", wav()))):
            self.assertEqual(self.send(name, content, sender=f"10.0.0.{index}")[0], 200, name)
        for index, (name, content) in enumerate((("a.m4a", b"hello world" * 100), ("movie.mp4", mp4(handler=b"vide")), ("fake.mp3", b"\xff" * 2000), ("x.wav", b"RIFF" + b"\0" * 2000), ("tiny.m4a", b"abc"))):
            status, message, _ = self.send(name, content, sender=f"10.0.1.{index}")
            self.assertEqual((status, message), (400, "音声ファイルではありません。"), name)
        self.assertEqual([item[3] for item in self.stored], ["audio/mp4", "audio/mp4", "audio/mpeg", "audio/wav", "audio/mp4", "audio/wav"])
        self.assertEqual(len(self.stored), 6, "nothing else was stored")

    def test_the_length_of_the_memo_is_read_and_a_title_comes_from_the_file_name_or_the_time(self):
        self.send("朝のメモ.m4a", mp4(seconds=42))
        self.send("", mp4(seconds=5))
        rows = inbox.items(self.db)["items"]
        self.assertEqual(rows[1]["title"], "朝のメモ")
        self.assertEqual(rows[1]["seconds"], 42)
        self.assertRegex(rows[0]["title"], r"^\d+月\d+日 \d+:\d\d の録音$")
        self.assertTrue(all(item["isNew"] for item in rows))

    def test_size_limit_missing_file_and_rate_limit_have_short_japanese_reasons(self):
        base = inbox.settings()
        with patch.object(inbox, "settings", lambda: {**base, "maxBytes": 1_000_000}):
            status, message, _ = self.send("big.m4a", mp4(pad=1_200_000))
            self.assertEqual((status, message), (413, "ファイルが大きすぎます(上限 1MB)。"))
        self.assertEqual(self.send("a.m4a", mp4(), field="other")[:2], (400, "音声ファイルが入っていません。"))
        self.assertEqual(inbox.receive(self.db, io.BytesIO(b""), 0, "multipart/form-data; boundary=x", f"Bearer {self.key}", "3.3.3.3", upload=self.upload)[0], 400)
        self.assertEqual(inbox.receive(self.db, io.BytesIO(b"{}"), 2, "application/json", f"Bearer {self.key}", "3.3.3.3", upload=self.upload)[0], 400)
        for _ in range(6):
            self.assertEqual(self.send("a.m4a", mp4(), sender="9.9.9.9")[0], 200)
        status, message, _ = self.send("a.m4a", mp4(), sender="9.9.9.9")
        self.assertEqual((status, message), (429, "送信が多すぎます。少し待ってからもう一度送ってください。"))

    def test_storage_failures_say_why_in_the_log_and_never_leave_an_item_behind(self):
        def failing(reason):
            def upload(*_):
                raise inbox.StorageError(reason)
            return upload
        for reason, expected in (("r2-not-configured:DESK_MEDIA_R2_BUCKET", "設定が、まだ終わっていません"), ("r2-auth-failed-403", "権限"), ("r2-network-error", "保存できませんでした")):
            body, ctype = multipart("a.m4a", mp4())
            with patch("builtins.print") as log:
                status, message, _ = inbox.receive(self.db, io.BytesIO(body), len(body), ctype, f"Bearer {self.key}", "4.4.4.4", upload=failing(reason))
            self.assertEqual(status, 503)
            self.assertIn(expected, message)
            self.assertIn(reason, str(log.call_args_list))
        self.assertEqual(inbox.items(self.db)["items"], [])

    def test_signed_requests_match_the_published_aws_example_and_never_print_the_secret(self):
        url = inbox.presign("GET", "examplebucket.s3.amazonaws.com", "/test.txt", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", 86400, "20130524T000000Z", region="us-east-1")
        self.assertIn("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404", url)
        env = {"DESK_MEDIA_R2_ACCOUNT_ID": "a" * 32, "DESK_MEDIA_R2_BUCKET": "tech-phase-desk-audio", "DESK_MEDIA_R2_ACCESS_KEY_ID": "AKID", "DESK_MEDIA_R2_SECRET_ACCESS_KEY": "SECRETVALUE"}
        seen = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
        def fake(request, timeout):
            seen.append(request); return Response()
        with patch.dict(os.environ, env):
            inbox.put_object("inbox/x.m4a", io.BytesIO(b"abc"), 3, "audio/mp4", urlopen=fake)
            link = inbox.file_url("inbox/x.m4a")
        self.assertEqual(seen[0].get_method(), "PUT")
        self.assertTrue(seen[0].full_url.startswith(f"https://{'a' * 32}.r2.cloudflarestorage.com/tech-phase-desk-audio/inbox/x.m4a"))
        self.assertIn("AWS4-HMAC-SHA256 Credential=AKID/", seen[0].get_header("Authorization"))
        self.assertNotIn("SECRETVALUE", seen[0].get_header("Authorization") + link)
        with patch.dict(os.environ, {**env, "DESK_MEDIA_R2_SECRET_ACCESS_KEY": ""}):
            with self.assertRaises(inbox.StorageError) as error:
                inbox.put_object("inbox/x.m4a", io.BytesIO(b"abc"), 3, "audio/mp4", urlopen=fake)
        self.assertEqual(error.exception.reason, "r2-not-configured:DESK_MEDIA_R2_SECRET_ACCESS_KEY")

    def test_the_owner_can_rename_and_mark_read_and_nothing_is_shown_to_members(self):
        item_id = self.send("memo.m4a", mp4())[2]
        self.assertEqual(inbox.rename(self.db, {"id": item_id, "title": "  新しい名前  "})["item"]["title"], "新しい名前")
        for bad in ("", "x" * 81, None, "a\0b"):
            with self.assertRaisesRegex(ValueError, "invalid-inbox-title"):
                inbox.rename(self.db, {"id": item_id, "title": bad})
        self.assertFalse(inbox.mark_read(self.db, {"id": item_id})["item"]["isNew"])
        with self.assertRaisesRegex(ValueError, "inbox-not-found"):
            inbox.mark_read(self.db, {"id": "12345678-1234-4234-8234-123456789abc"})
        with self.assertRaisesRegex(ValueError, "invalid-inbox-id"):
            inbox.mark_read(self.db, {"id": "../x"})
        self.assertEqual(self.db.execute("SELECT count(*) FROM sqlite_master WHERE name LIKE 'editorial%' OR name LIKE 'member_q%'").fetchone()[0], 0)

    def test_http_upload_uses_the_key_and_the_owner_routes_use_the_editor_token(self):
        import service
        app = object.__new__(service.AutomaticMonitor); app.db_path = self.path
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler); server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        def post(path, headers, data):
            with urlopen(Request(base + path, data=data, headers=headers), timeout=5) as response:
                return response.status, response.read().decode(), response.headers
        body, ctype = multipart("memo.m4a", mp4())
        try:
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": "editor-api-token", "RESEARCH_API_TOKEN": "member-api-token"}), patch.object(inbox, "put_object", self.upload):
                with self.assertRaises(HTTPError) as denied:
                    post("/inbox/upload", {"Authorization": "Bearer member-api-token", "Content-Type": ctype}, body)
                self.assertEqual(denied.exception.code, 401, "the members' token is not the inbox key")
                self.assertEqual(denied.exception.read().decode(), "鍵が合いません。")
                status, text, headers = post("/inbox/upload", {"Authorization": f"Bearer {self.key}", "Content-Type": ctype}, body)
                self.assertEqual((status, text), (200, "受信箱に届きました。"))
                self.assertIn("text/plain", headers["Content-Type"])
                self.assertEqual(len(self.stored), 1)
                def owner(path, data=None):
                    with urlopen(Request(base + path, data=data, headers={"Authorization": "Bearer editor-api-token", "Content-Type": "application/json"}), timeout=5) as response:
                        return json.load(response)
                self.assertEqual(len(owner("/admin/inbox/items")["items"]), 1)
                with self.assertRaises(HTTPError) as no_editor:
                    urlopen(Request(base + "/admin/inbox/items", headers={"Authorization": f"Bearer {self.key}"}), timeout=5)
                self.assertEqual(no_editor.exception.code, 401)
                fresh = owner("/admin/inbox/key", b"{}")
                self.assertTrue(fresh["key"].startswith("tpinbox_"))
                self.assertFalse(inbox.key_matches(self.db, f"Bearer {self.key}"))
                self.assertNotIn("key", owner("/admin/inbox/key"), "reading the status never shows a key")
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
