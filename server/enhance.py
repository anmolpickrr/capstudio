"""Emojis and keywords for finished captions.

For each caption: the word to emphasise (the keyword), and sometimes an emoji that
illustrates one of its words. A text model on Groq picks them (the same key as the
speech engine), choosing emojis only from the set the app can draw
(static/emoji/emoji.json). Without the key, or if the model fails, a simple
built-in picker matches words against each emoji's keywords instead.
"""
from __future__ import annotations

import json
import logging
import pathlib
import re

from . import script

log = logging.getLogger("captions.enhance")

EMOJI_FILE = pathlib.Path(__file__).resolve().parent.parent / "static" / "emoji" / "emoji.json"
BATCH = 40
GAP = 2  # captions between emojis, at least, so they stay special

_STOP = set(("a an the and or but if of to in on at for with by from as is are was were be been it its this that "
             "these those i you he she we they me my your our their his her them us so do does did not no yes just very "
             "really can will would should could have has had what when where who how why all any some more most than "
             "then there here about into over also too only like get got go going gonna im i'm you're it's that's don't "
             "hai hain tha the ki ka ke ko mein se par aur bhi to ye yeh wo woh hum tum aap main na nahi kya ki ek "
             "है हैं था थे की का के को में से पर और भी तो ये यह वो वह हम तुम आप मैं ना नहीं क्या कि एक").split())


def _load() -> dict:
    try:
        return json.loads(EMOJI_FILE.read_text())
    except (OSError, ValueError):
        log.warning("emoji set missing: %s", EMOJI_FILE)
        return {}


EMOJI = _load()
_BY_WORD: dict[str, str] = {}
for _ch, _e in EMOJI.items():
    for _k in _e["keywords"]:
        _BY_WORD.setdefault(_k.lower(), _ch)


def _core(word: str) -> str:
    return re.sub(r"[^\w%₹$]", "", word.lower())


def enhance(items: list[dict], emoji: bool = True, keywords: bool = True) -> tuple[list[dict], str]:
    """items: [{"id", "words": [str]}]. Returns ([{"id", "keyword": int|None, "emoji": str|None,
    "emojiWord": int|None}], source) where source is "ai" or "basic"."""
    if script.available():
        try:
            out: list[dict] = []
            for i in range(0, len(items), BATCH):
                out += _llm(items[i:i + BATCH], items[max(0, i - 3):i])
            return _finish(out, emoji, keywords), "ai"
        except script.ScriptError as e:
            log.warning("emoji and keyword picker fell back to the basic one: %s", e)
    return _finish(_basic(items), emoji, keywords), "basic"


def _finish(out: list[dict], emoji: bool, keywords: bool) -> list[dict]:
    for r in out:
        if not keywords:
            r["keyword"] = None
        if not emoji:
            r["emoji"] = r["emojiWord"] = None
    return out


def _keyword(words: list[str]) -> int | None:
    best, score = None, -1
    for i, w in enumerate(words):
        c = _core(w)
        if not c or c in _STOP:
            continue
        s = (100 if re.search(r"[\d%₹$]", c) else 0) + len(c)
        if s > score:
            best, score = i, s
    return best


def _match(words: list[str], keyword: int | None) -> tuple[str, int] | None:
    """The emoji for the caption's keyword if it has one, else for its longest word that has one."""
    found = []
    for i, w in enumerate(words):
        c = _core(w)
        for k in (c, c[:-1] if c.endswith("s") else None, c[:-2] if c.endswith("es") else None):
            if k and k in _BY_WORD:
                found.append((i == keyword, len(c), -i, _BY_WORD[k], i))
                break
    if not found:
        return None
    best = max(found)
    return best[3], best[4]


def _basic(items: list[dict]) -> list[dict]:
    out, last_at, last = [], -GAP - 1, None
    for n, it in enumerate(items):
        r = {"id": it["id"], "keyword": _keyword(it["words"]), "emoji": None, "emojiWord": None}
        m = _match(it["words"], r["keyword"])
        if m and n - last_at > GAP and m[0] != last:
            r["emoji"], r["emojiWord"] = m
            last_at, last = n, m[0]
        out.append(r)
    return out


_PROMPT = (
    "You add emphasis and emojis to short video captions (English, Hindi or Hinglish) for an Indian e-commerce "
    "and logistics brand's social videos. For each caption item (a list of words, indexed from 0):\n"
    "- keyword: the index of the one word that carries the meaning (a number, a price, a strong noun or verb), "
    "or null if the caption is filler.\n"
    "- emoji: an emoji that clearly illustrates a word in the caption, only from this list, or null: {emojis}. "
    "Add one to about one caption in three: where it adds meaning, never on two captions in a row, and don't "
    "repeat the same emoji close together. emojiWord: the index of the word it illustrates.\n"
    "Reply with JSON only: {{\"items\": [{{\"id\": \"...\", \"keyword\": 0, \"emoji\": null, \"emojiWord\": null}}]}}")


def _llm(items: list[dict], before: list[dict]) -> list[dict]:
    listing = " ".join(f"{ch} ({e['name']})" for ch, e in EMOJI.items())
    payload = {"context_before": [" ".join(b["words"]) for b in before],
               "items": [{"id": it["id"], "words": it["words"]} for it in items]}
    reply = script._chat(_PROMPT.format(emojis=listing), json.dumps(payload, ensure_ascii=False))
    got = {str(x.get("id")): x for x in reply.get("items", []) if isinstance(x, dict)}
    out = []
    for it in items:
        r, n = got.get(str(it["id"])) or {}, len(it["words"])
        idx = lambda v: v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < n else None  # noqa: E731
        ch = r.get("emoji") if isinstance(r.get("emoji"), str) else None
        ch = ch if ch in EMOJI else (ch + "️" if ch and ch + "️" in EMOJI else None)
        word = idx(r.get("emojiWord"))
        out.append({"id": it["id"], "keyword": idx(r.get("keyword")), "emoji": ch if ch else None,
                    "emojiWord": (word if word is not None else 0) if ch else None})
    return out
