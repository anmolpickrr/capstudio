"""Changing the script of finished captions: Hindi words in Roman letters
("aaj ka offer"), Hindi in Devanagari, or an English translation.

Roman uses the built-in transliteration, so it's instant and needs no service.
Devanagari and English use a text model on Groq (the same key as the speech
engine). Captions keep their timing: transliteration keeps every word, and a
translation is spread over the caption's own time span by the editor.
"""
from __future__ import annotations

import json
import logging
import os
import re

import httpx

from .transcribe import HOSTED, romanize_devanagari

log = logging.getLogger("captions.script")

# Tried in order; the next is used when Groq retires or rejects one.
TEXT_MODELS = [m.strip() for m in os.environ.get(
    "GROQ_TEXT_MODELS", "llama-3.3-70b-versatile,openai/gpt-oss-120b,llama-3.1-8b-instant").split(",") if m.strip()]
BATCH = 40  # captions per request


class ScriptError(RuntimeError):
    pass


def available() -> bool:
    return bool(os.environ.get("GROQ_API_KEY"))


def convert(mode: str, items: list[dict], glossary: list[str]) -> list[dict]:
    """items: [{"id", "words": [str]}]. Returns [{"id", "words": [str]}] for 'roman' and
    'devanagari' (same word count, or the item unchanged) and [{"id", "text"}] for 'english'."""
    if mode == "roman":
        return [{"id": it["id"], "words": [romanize_devanagari(w) for w in it["words"]]} for it in items]
    if not available():
        raise ScriptError("This needs the Groq key on the server, which isn't set.")
    out: list[dict] = []
    for i in range(0, len(items), BATCH):
        out += _llm_batch(mode, items[i:i + BATCH], glossary)
    return out


_PROMPTS = {
    "devanagari": (
        "You rewrite Hinglish video captions. Each item is a list of words. Return exactly the same number of "
        "words, in the same order, one output word per input word: Hindi words written in standard Devanagari, "
        "English words kept in Latin letters exactly as given, numbers and punctuation kept. Keep these names "
        "unchanged: {glossary}. Reply with JSON only: {{\"items\": [{{\"id\": \"...\", \"words\": [\"...\"]}}]}}"),
    "english": (
        "You translate Hindi and Hinglish video captions into short, natural English for on-screen captions. "
        "Translate each item on its own, keeping its meaning and tone; use the neighbouring items only as context. "
        "Keep these names unchanged: {glossary}. Reply with JSON only: "
        "{{\"items\": [{{\"id\": \"...\", \"text\": \"...\"}}]}}"),
}


def _llm_batch(mode: str, items: list[dict], glossary: list[str]) -> list[dict]:
    payload = [{"id": it["id"], "words": it["words"]} if mode == "devanagari"
               else {"id": it["id"], "text": " ".join(it["words"])} for it in items]
    system = _PROMPTS[mode].format(glossary=", ".join(glossary) or "none")
    reply = _chat(system, json.dumps({"items": payload}, ensure_ascii=False))
    got = {str(x.get("id")): x for x in reply.get("items", []) if isinstance(x, dict)}
    out = []
    for it in items:
        r = got.get(str(it["id"]))
        if mode == "devanagari":
            words = r.get("words") if r else None
            ok = isinstance(words, list) and len(words) == len(it["words"]) and all(isinstance(w, str) and w.strip() for w in words)
            out.append({"id": it["id"], "words": [w.strip() for w in words] if ok else it["words"]})
        else:
            text = r.get("text") if r else None
            ok = isinstance(text, str) and text.strip()
            out.append({"id": it["id"], "text": text.strip() if ok else " ".join(it["words"])})
    return out


def _chat(system: str, user: str) -> dict:
    base = HOSTED["groq"][0]
    key = os.environ["GROQ_API_KEY"]
    last = "no model answered"
    for model in TEXT_MODELS:
        body = {"model": model, "temperature": 0, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        try:
            r = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=120)
        except httpx.HTTPError as e:
            last = f"network error: {e}"
            continue
        if r.status_code == 200:
            try:
                return _parse(r.json()["choices"][0]["message"]["content"])
            except (KeyError, IndexError, ValueError) as e:
                last = f"unreadable reply from {model}: {e}"
                continue
        last = f"{model}: HTTP {r.status_code} {r.text[:200]}"
        if r.status_code in (401, 403):
            raise ScriptError("The Groq key was rejected.")
        if r.status_code == 429:
            raise ScriptError("The text service is busy (rate limit). Try again in a minute.")
        log.warning("text model %s unavailable: %s", model, last)
    raise ScriptError(f"The text service couldn't do this right now ({last}).")


def _parse(content: str) -> dict:
    m = re.search(r"\{.*\}", content or "", re.S)
    if not m:
        raise ValueError("no JSON object")
    return json.loads(m.group(0))
