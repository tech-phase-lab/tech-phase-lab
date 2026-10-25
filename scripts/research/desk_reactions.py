"""Member reactions to published Notes; no member identities in the response."""
import re
import editorial_posts

EMOJI = ("like", "smile", "sad", "angry", "fire")


def connect(path):
    db = editorial_posts.connect(path)
    db.execute("CREATE TABLE IF NOT EXISTS desk_reactions(post_id TEXT NOT NULL, owner_key TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(post_id,owner_key,emoji))")
    db.commit()
    # Collapse historical multi-choice votes once, retaining the last choice.
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name='desk_reactions_one_choice'").fetchone():
        with db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM desk_reactions WHERE rowid NOT IN (SELECT max(rowid) FROM desk_reactions GROUP BY post_id,owner_key)")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS desk_reactions_one_choice ON desk_reactions(post_id,owner_key)")
    return db


def validate(db, owner, post_id):
    if not isinstance(owner, str) or not re.fullmatch(r"[a-f0-9]{64}", owner):
        raise ValueError("invalid-member")
    if not isinstance(post_id, str) or not re.fullmatch(r"[a-z0-9-]{16,64}", post_id):
        raise ValueError("invalid-post")
    if not db.execute("SELECT 1 FROM editorial_posts WHERE id=? AND kind='notes' AND status='published'", (post_id,)).fetchone():
        raise ValueError("post-unavailable")


def read(db, owner, post_id):
    validate(db, owner, post_id)
    rows = db.execute("SELECT emoji,count(*) AS total,max(CASE WHEN owner_key=? THEN 1 ELSE 0 END) AS mine FROM desk_reactions WHERE post_id=? GROUP BY emoji", (owner, post_id)).fetchall()
    values = {row["emoji"]: {"count": row["total"], "selected": bool(row["mine"])} for row in rows}
    return {"reactions": {emoji: values.get(emoji, {"count": 0, "selected": False}) for emoji in EMOJI}}


def save(db, owner, payload):
    post_id, emoji, selected = payload.get("postId"), payload.get("emoji"), payload.get("selected")
    if emoji not in EMOJI or type(selected) is not bool:
        raise ValueError("invalid-reaction")
    with db:
        db.execute("BEGIN IMMEDIATE")
        validate(db, owner, post_id)
        if selected:
            db.execute("DELETE FROM desk_reactions WHERE post_id=? AND owner_key=? AND emoji<>?", (post_id, owner, emoji))
            db.execute("INSERT OR IGNORE INTO desk_reactions VALUES(?,?,?)", (post_id, owner, emoji))
        else:
            db.execute("DELETE FROM desk_reactions WHERE post_id=? AND owner_key=? AND emoji=?", (post_id, owner, emoji))
        return read(db, owner, post_id)
