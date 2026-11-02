"""Voice memos sent from the owner's phone (iPhone shortcut) into a private inbox (owner, Nov 2).

The shortcut cannot sign in, so it presents a key the owner issued. Only the key's hash is stored. A file is accepted only when
the key matches, the sender is not over the limits, and the bytes really are audio (not just the name). It goes to the private
R2 bucket and into the inbox as NEW. Nothing here publishes anything."""

import hashlib
import hmac
import json
import mmap
import os
import re
import secrets
import sqlite3
import struct
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

SETTINGS_PATH = Path(__file__).with_name("voice_inbox_settings.json")
ITEM_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
MAX_TITLE = 80


@lru_cache(maxsize=1)
def settings():
    value = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    ok = (type(value.get("maxBytes")) is int and 1_000_000 <= value["maxBytes"] <= 1_000_000_000
          and all(type(value.get(k)) is int and 1 <= value[k] <= 100_000 for k in ("perMinute", "perHour", "badKeyLimit", "badKeyWindowSeconds")))
    if not ok:
        raise ValueError("invalid-inbox-settings")
    return value


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def connect(path):
    db = sqlite3.connect(path, timeout=20)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS inbox_key(
        id INTEGER PRIMARY KEY CHECK(id=1), key_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox_items(
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_key TEXT NOT NULL, content_type TEXT NOT NULL,
        bytes INTEGER NOT NULL, seconds REAL, created_at TEXT NOT NULL, read_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_inbox_items_created ON inbox_items(created_at DESC);
    """)
    return db


# ---- the key ----------------------------------------------------------------

def _hash(key):
    return hashlib.sha256(key.encode()).hexdigest()


def issue_key(db):
    """A new key. It is returned this once; only its hash is kept, and the old key stops working at once."""
    key = "tpinbox_" + secrets.token_urlsafe(32)
    now = stamp()
    with db:
        db.execute("INSERT INTO inbox_key(id,key_hash,created_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash,created_at=excluded.created_at", (_hash(key), now))
    return {"key": key, "createdAt": now}


def key_status(db):
    row = db.execute("SELECT created_at FROM inbox_key WHERE id=1").fetchone()
    return {"exists": bool(row), "createdAt": row["created_at"] if row else None}


def key_matches(db, authorization):
    match = re.fullmatch(r"Bearer (tpinbox_[A-Za-z0-9_-]{20,100})", authorization or "")
    row = db.execute("SELECT key_hash FROM inbox_key WHERE id=1").fetchone()
    # The hash is always computed, so a missing key and a wrong key take the same time.
    presented = _hash(match.group(1) if match else "")
    return bool(match and row and hmac.compare_digest(presented, row["key_hash"]))


# ---- limits -----------------------------------------------------------------

class Limiter:
    def __init__(self):
        self.lock = threading.Lock()
        self.sent = defaultdict(deque)
        self.bad = defaultdict(deque)

    def _trim(self, queue, window, now):
        while queue and now - queue[0] > window:
            queue.popleft()

    def blocked(self, sender, now=None):
        now = time.time() if now is None else now
        config = settings()
        with self.lock:
            self._trim(self.bad[sender], config["badKeyWindowSeconds"], now)
            return len(self.bad[sender]) >= config["badKeyLimit"]

    def bad_key(self, sender, now=None):
        with self.lock:
            self.bad[sender].append(time.time() if now is None else now)

    def allow(self, sender, now=None):
        """False when this sender has uploaded too much in the last minute or hour."""
        now = time.time() if now is None else now
        config = settings()
        with self.lock:
            queue = self.sent[sender]
            self._trim(queue, 3600, now)
            if len(queue) >= config["perHour"] or sum(1 for t in queue if now - t <= 60) >= config["perMinute"]:
                return False
            queue.append(now)
            return True


LIMITER = Limiter()


# ---- checking what the bytes really are -------------------------------------

class NotAudio(ValueError):
    pass


def _boxes(read, start, end):
    """The MP4 boxes between two offsets: (type, payload start, box end)."""
    at = start
    while at + 8 <= end:
        size, kind = struct.unpack(">I4s", read(at, 8))
        header = 8
        if size == 1:
            size = struct.unpack(">Q", read(at + 8, 8))[0]; header = 16
        elif size == 0:
            size = end - at
        if size < header or at + size > end:
            raise NotAudio("bad-box")
        yield kind, at + header, at + size
        at += size


def sniff_mp4(read, total):
    """An MP4/M4A container with sound and no picture track. Returns the length in seconds, when it says."""
    if total < 16 or read(4, 4) != b"ftyp":
        raise NotAudio("not-mp4")
    moov = None
    for kind, a, b in _boxes(read, 0, total):
        if kind == b"moov":
            moov = (a, b)
            break
    if not moov or moov[1] - moov[0] > 16 * 1024 * 1024:
        raise NotAudio("no-moov")
    seconds, handlers = None, []
    for kind, a, b in _boxes(read, *moov):
        if kind == b"mvhd":
            payload = read(a, min(b - a, 32))
            if payload[0] == 1 and len(payload) >= 32:
                scale, length = struct.unpack(">IQ", payload[20:32])
            elif len(payload) >= 20:
                scale, length = struct.unpack(">II", payload[12:20])
            else:
                scale = length = 0
            seconds = length / scale if scale else None
        elif kind == b"trak":
            for k2, a2, b2 in _boxes(read, a, b):
                if k2 != b"mdia":
                    continue
                for k3, a3, b3 in _boxes(read, a2, b2):
                    if k3 == b"hdlr" and b3 - a3 >= 12:
                        handlers.append(read(a3 + 8, 4))
    if b"vide" in handlers or b"soun" not in handlers:
        raise NotAudio("not-audio-only")
    return seconds


def _mp3_frame(header):
    if len(header) < 4 or header[0] != 0xFF or (header[1] & 0xE0) != 0xE0:
        return 0
    version, layer = (header[1] >> 3) & 3, (header[1] >> 1) & 3
    bitrate, rate, pad = header[2] >> 4, (header[2] >> 2) & 3, (header[2] >> 1) & 1
    if version == 1 or layer != 1 or bitrate in (0, 15) or rate == 3:
        return 0
    table = (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320) if version == 3 else (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
    sample = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}[version][rate]
    return (144 * table[bitrate - 1] * 1000 // sample + pad) if version == 3 else (72 * table[bitrate - 1] * 1000 // sample + pad)


def sniff_mp3(read, total):
    start = 0
    head = read(0, 10)
    if head[:3] == b"ID3" and len(head) == 10 and all(v < 128 for v in head[6:10]):
        start = 10 + head[6] * 2097152 + head[7] * 16384 + head[8] * 128 + head[9]
    window = read(start, 4096 + 4)
    for offset in range(0, max(0, len(window) - 4)):
        size = _mp3_frame(window[offset:offset + 4])
        if size and start + offset + size + 4 <= total and _mp3_frame(read(start + offset + size, 4)):
            return None
    raise NotAudio("not-mp3")


def sniff_wav(read, total):
    if total < 44 or read(0, 4) != b"RIFF" or read(8, 4) != b"WAVE":
        raise NotAudio("not-wav")
    at, byte_rate, data = 12, 0, None
    while at + 8 <= total:
        kind, size = struct.unpack("<4sI", read(at, 8))
        if kind == b"fmt " and size >= 16:
            tag, _channels, _rate, byte_rate = struct.unpack("<HHII", read(at + 8, 12))
            if tag not in (1, 3, 0xFFFE, 0x55):
                raise NotAudio("wav-format")
        elif kind == b"data":
            data = min(size, total - at - 8)
            break
        at += 8 + size + (size & 1)
    if not byte_rate or data is None or data <= 0:
        raise NotAudio("wav-empty")
    return data / byte_rate


def sniff(read, total):
    """(extension, content type, seconds or None). Raises NotAudio unless the content is audio, whatever the file is called."""
    first = read(0, 12)
    if first[4:8] == b"ftyp":
        return "m4a", "audio/mp4", sniff_mp4(read, total)
    if first[:4] == b"RIFF":
        return "wav", "audio/wav", sniff_wav(read, total)
    return "mp3", "audio/mpeg", sniff_mp3(read, total)


# ---- the private bucket (R2, signed requests by hand: no extra package) ------

class StorageError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _storage():
    account, bucket = os.environ.get("DESK_MEDIA_R2_ACCOUNT_ID", ""), os.environ.get("DESK_MEDIA_R2_BUCKET", "")
    access, secret = os.environ.get("DESK_MEDIA_R2_ACCESS_KEY_ID", ""), os.environ.get("DESK_MEDIA_R2_SECRET_ACCESS_KEY", "")
    missing = [name for name, value in (("DESK_MEDIA_R2_ACCOUNT_ID", account), ("DESK_MEDIA_R2_BUCKET", bucket), ("DESK_MEDIA_R2_ACCESS_KEY_ID", access), ("DESK_MEDIA_R2_SECRET_ACCESS_KEY", secret)) if not value]
    if missing:
        # Names only, never values.
        raise StorageError("r2-not-configured:" + ",".join(missing))
    if not re.fullmatch(r"[a-f0-9]{32}", account) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", bucket):
        raise StorageError("r2-config-invalid-format")
    return {"host": f"{account}.r2.cloudflarestorage.com", "bucket": bucket, "access": access, "secret": secret}


def _hmac(key, text):
    return hmac.new(key, text.encode(), hashlib.sha256).digest()


def _signing_key(secret, date, region, service):
    return _hmac(_hmac(_hmac(_hmac(("AWS4" + secret).encode(), date), region), service), "aws4_request")


def presign(method, host, path, access, secret, expires, amz_date, region="auto", service="s3"):
    """A query-signed URL (AWS Signature V4), for reading a file straight from the bucket for a short time."""
    date = amz_date[:8]
    scope = f"{date}/{region}/{service}/aws4_request"
    query = {"X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": f"{access}/{scope}", "X-Amz-Date": amz_date, "X-Amz-Expires": str(expires), "X-Amz-SignedHeaders": "host"}
    canonical_query = "&".join(f"{quote(k, safe='')}={quote(v, safe='')}" for k, v in sorted(query.items()))
    canonical = f"{method}\n{path}\n{canonical_query}\nhost:{host}\n\nhost\nUNSIGNED-PAYLOAD"
    to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    signature = hmac.new(_signing_key(secret, date, region, service), to_sign.encode(), hashlib.sha256).hexdigest()
    return f"https://{host}{path}?{canonical_query}&X-Amz-Signature={signature}"


def put_object(key, body, length, content_type, now=None, urlopen=urllib.request.urlopen):
    """Store the file in the private bucket. Failures are told apart by reason, never by silence."""
    config = _storage()
    moment = datetime.now(timezone.utc) if now is None else now
    amz_date, date = moment.strftime("%Y%m%dT%H%M%SZ"), moment.strftime("%Y%m%d")
    path = f"/{config['bucket']}/{quote(key, safe='/')}"
    headers = {"content-type": content_type, "host": config["host"], "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": amz_date}
    signed = ";".join(sorted(headers))
    canonical = f"PUT\n{path}\n\n" + "".join(f"{k}:{headers[k]}\n" for k in sorted(headers)) + f"\n{signed}\nUNSIGNED-PAYLOAD"
    scope = f"{date}/auto/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    signature = hmac.new(_signing_key(config["secret"], date, "auto", "s3"), to_sign.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(f"https://{config['host']}{path}", data=body, method="PUT", headers={
        "Content-Type": content_type, "Content-Length": str(length), "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": amz_date,
        "Authorization": f"AWS4-HMAC-SHA256 Credential={config['access']}/{scope}, SignedHeaders={signed}, Signature={signature}"})
    try:
        with urlopen(request, timeout=600) as response:
            if not 200 <= response.status < 300:
                raise StorageError(f"r2-put-failed-{response.status}")
    except urllib.error.HTTPError as error:
        raise StorageError("r2-auth-failed-403" if error.code in (401, 403) else f"r2-put-failed-{error.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise StorageError("r2-network-error") from None


def file_url(key, expires=900, now=None):
    config = _storage()
    moment = datetime.now(timezone.utc) if now is None else now
    return presign("GET", config["host"], f"/{config['bucket']}/{quote(key, safe='/')}", config["access"], config["secret"], expires, moment.strftime("%Y%m%dT%H%M%SZ"))


# ---- receiving ---------------------------------------------------------------

class Slice:
    """A read-only view of part of a memory-mapped file, usable as a request body."""
    def __init__(self, data, start, end):
        self.data, self.start, self.end, self.at = data, start, end, start

    def read(self, count=-1):
        stop = self.end if count is None or count < 0 else min(self.end, self.at + count)
        chunk = self.data[self.at:stop]
        self.at = stop
        return chunk


def _file_part(data, boundary):
    marker = b"--" + boundary
    at = data.find(marker)
    while at != -1:
        head_start = at + len(marker)
        if data[head_start:head_start + 2] == b"--":
            break
        head_start += 2
        head_end = data.find(b"\r\n\r\n", head_start, head_start + 8192)
        if head_end == -1:
            raise ValueError("bad-multipart")
        raw = data[head_start:head_end]
        try:
            headers = raw.decode("utf-8")
        except UnicodeDecodeError:
            headers = raw.decode("latin-1")
        start = head_end + 4
        end = data.find(b"\r\n" + marker, start)
        if end == -1:
            raise ValueError("bad-multipart")
        if re.search(r'name="file"', headers, re.I):
            named = re.search(r'filename="([^"]*)"', headers, re.I)
            return start, end, (named.group(1) if named else "")
        at = end + 2
    raise ValueError("no-file")


def _title(filename, now):
    base = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", filename.replace("\\", "/").split("/")[-1]).strip()
    base = "".join(ch for ch in base if ch.isprintable())[:MAX_TITLE]
    return base or datetime.fromtimestamp(now, timezone.utc).astimezone(timezone(timedelta(hours=9))).strftime("%-m月%-d日 %-H:%M の録音")


def receive(db, rfile, length, content_type, authorization, sender, now=None, upload=None):
    """(status, short Japanese message, item id or None). The message is shown by the shortcut as it is."""
    now = time.time() if now is None else now
    upload = upload or put_object
    config = settings()
    if LIMITER.blocked(sender, now):
        return 429, "鍵の間違いが続いたため、しばらく受け付けません。", None
    if not key_matches(db, authorization):
        LIMITER.bad_key(sender, now)
        return 401, "鍵が合いません。", None
    if not LIMITER.allow(sender, now):
        return 429, "送信が多すぎます。少し待ってからもう一度送ってください。", None
    if length <= 0:
        return 400, "音声ファイルが入っていません。", None
    if length > config["maxBytes"] + 65536:
        return 413, f"ファイルが大きすぎます(上限 {config['maxBytes'] // 1_000_000}MB)。", None
    match = re.search(r'boundary=(?:"([^"]+)"|([^;\s]+))', content_type or "", re.I)
    if not (content_type or "").lower().startswith("multipart/form-data") or not match:
        return 400, "音声ファイルが入っていません。", None
    boundary = (match.group(1) or match.group(2)).encode()
    with tempfile.TemporaryFile() as spool:
        remaining = length
        while remaining:
            chunk = rfile.read(min(1 << 20, remaining))
            if not chunk:
                return 400, "受け取りの途中で切れました。もう一度送ってください。", None
            spool.write(chunk)
            remaining -= len(chunk)
        spool.flush()
        with mmap.mmap(spool.fileno(), 0, access=mmap.ACCESS_READ) as data:
            try:
                start, end, filename = _file_part(data, boundary)
            except ValueError:
                return 400, "音声ファイルが入っていません。", None
            size = end - start
            if size > config["maxBytes"]:
                return 413, f"ファイルが大きすぎます(上限 {config['maxBytes'] // 1_000_000}MB)。", None
            if size < 512:
                return 400, "音声ファイルではありません。", None
            read = lambda offset, count: bytes(data[start + offset:start + min(size, offset + count)])
            try:
                extension, content_kind, seconds = sniff(read, size)
            except (NotAudio, struct.error, IndexError, KeyError):
                return 400, "音声ファイルではありません。", None
            item_id = str(uuid.uuid4())
            file_key = f"inbox/{item_id}.{extension}"
            try:
                upload(file_key, Slice(data, start, end), size, content_kind)
            except StorageError as error:
                print(f"voice-inbox-store-failed reason={error.reason}", flush=True)
                if error.reason.startswith("r2-not-configured") or error.reason == "r2-config-invalid-format":
                    return 503, "受信箱の保存先の設定が、まだ終わっていません。", None
                if error.reason == "r2-auth-failed-403":
                    return 503, "受信箱の保存先に入れませんでした(権限)。", None
                return 503, "受信箱に保存できませんでした。もう一度送ってください。", None
    with db:
        db.execute("INSERT INTO inbox_items(id,title,file_key,content_type,bytes,seconds,created_at) VALUES(?,?,?,?,?,?,?)",
                   (item_id, _title(filename, now), file_key, content_kind, size, seconds, stamp()))
    return 200, "受信箱に届きました。", item_id


# ---- the owner's list ----------------------------------------------------------

def _item(row):
    return {"id": row["id"], "title": row["title"], "at": row["created_at"], "seconds": row["seconds"], "isNew": row["read_at"] is None}


def items(db, limit=50):
    rows = db.execute("SELECT * FROM inbox_items ORDER BY created_at DESC,id DESC LIMIT ?", (max(1, min(int(limit), 100)),)).fetchall()
    return {"items": [_item(row) for row in rows]}


def _row(db, item_id):
    if not isinstance(item_id, str) or not ITEM_ID.fullmatch(item_id):
        raise ValueError("invalid-inbox-id")
    row = db.execute("SELECT * FROM inbox_items WHERE id=?", (item_id,)).fetchone()
    if not row:
        raise ValueError("inbox-not-found")
    return row


def rename(db, payload):
    row = _row(db, payload.get("id"))
    title = payload.get("title")
    if not isinstance(title, str) or "\x00" in title or not 1 <= len(title.strip()) <= MAX_TITLE:
        raise ValueError("invalid-inbox-title")
    with db:
        db.execute("UPDATE inbox_items SET title=? WHERE id=?", (title.strip(), row["id"]))
    return {"item": _item(db.execute("SELECT * FROM inbox_items WHERE id=?", (row["id"],)).fetchone())}


def mark_read(db, payload):
    row = _row(db, payload.get("id"))
    with db:
        db.execute("UPDATE inbox_items SET read_at=COALESCE(read_at,?) WHERE id=?", (stamp(), row["id"]))
    return {"item": _item(db.execute("SELECT * FROM inbox_items WHERE id=?", (row["id"],)).fetchone())}


def file_link(db, item_id):
    row = _row(db, item_id)
    return {"url": file_url(row["file_key"]), "contentType": row["content_type"]}
