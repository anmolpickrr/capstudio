"""Team glossary and changing the caption script."""
import pytest
from fastapi.testclient import TestClient

from server import main, script, transcribe


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_DISABLED", "1")
    with TestClient(main.app) as c:
        yield c


def test_glossary_is_loaded_and_shared(client):
    cfg = client.get("/api/config").json()
    assert "Fastrr" in cfg["glossary"] and "Shiprocket" in cfg["glossary"]
    assert all(not g.startswith("#") for g in cfg["glossary"])


def test_glossary_fixes_case_only():
    words = [{"text": t} for t in ["shiprocket,", "upi", "faster", "Fastrr!", "rto."]]
    transcribe.fix_glossary_case(words, ["Shiprocket", "UPI", "Fastrr", "RTO"])
    assert [w["text"] for w in words] == ["Shiprocket,", "UPI", "faster", "Fastrr!", "RTO."]


def test_glossary_goes_into_the_prompt(monkeypatch):
    seen = {}

    def fake_local(audio, duration, code, prompt, vocab, progress):
        seen["prompt"], seen["vocab"] = prompt, vocab
        return {"language": "hi", "words": [{"text": "shiprocket", "start": 0, "end": 0.5}]}
    monkeypatch.setattr(transcribe, "ENGINE", "local")
    monkeypatch.setattr(transcribe, "_local", fake_local)
    out = transcribe.transcribe("x.wav", 1, "hinglish", "Anmol", lambda p: None, glossary=["Fastrr", "Shiprocket", "anmol"])
    assert seen["vocab"] == ["Anmol", "Fastrr", "Shiprocket"]  # editor's names first, no duplicates
    assert "Anmol, Fastrr, Shiprocket." in seen["prompt"]
    assert out["words"][0]["text"] == "Shiprocket"


def test_roman_needs_no_service(client, monkeypatch):
    monkeypatch.setattr(script, "available", lambda: False)
    r = client.post("/api/convert", json={"mode": "roman", "items": [{"id": "a", "words": ["क्या", "offer", "है"]}]})
    assert r.status_code == 200
    assert r.json()["items"][0]["words"] == ["kya", "offer", "hai"]


def test_devanagari_keeps_word_count(client, monkeypatch):
    monkeypatch.setattr(script, "available", lambda: True)
    # the model drops a word in item b: that item stays as it was
    monkeypatch.setattr(script, "_chat", lambda s, u: {"items": [
        {"id": "a", "words": ["आज", "offer"]}, {"id": "b", "words": ["बहुत"]}]})
    r = client.post("/api/convert", json={"mode": "devanagari", "items": [
        {"id": "a", "words": ["aaj", "offer"]}, {"id": "b", "words": ["bahut", "achha"]}]})
    items = {i["id"]: i["words"] for i in r.json()["items"]}
    assert items == {"a": ["आज", "offer"], "b": ["bahut", "achha"]}


def test_english_translation(client, monkeypatch):
    monkeypatch.setattr(script, "available", lambda: True)
    monkeypatch.setattr(script, "_chat", lambda s, u: {"items": [{"id": "a", "text": "Today's offer is great"}]})
    r = client.post("/api/convert", json={"mode": "english", "items": [{"id": "a", "words": ["आज", "का", "offer"]}]})
    assert r.json()["items"] == [{"id": "a", "text": "Today's offer is great"}]


def test_without_key_the_editor_is_told(client, monkeypatch):
    monkeypatch.setattr(script, "available", lambda: False)
    r = client.post("/api/convert", json={"mode": "english", "items": [{"id": "a", "words": ["x"]}]})
    assert r.status_code == 503 and "Groq" in r.json()["detail"]


def test_model_fallback(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    calls = []

    class R:
        def __init__(self, code, content=None):
            self.status_code, self._c, self.text = code, content, "model_not_found"

        def json(self):
            return {"choices": [{"message": {"content": self._c}}]}

    def fake_post(url, headers, json, timeout):
        calls.append(json["model"])
        return R(404) if len(calls) == 1 else R(200, 'Sure: {"items": []}')
    monkeypatch.setattr(script.httpx, "post", fake_post)
    assert script._chat("s", "u") == {"items": []}
    assert calls == script.TEXT_MODELS[:2]


# ---------------------------------------------------------------- emojis and keywords

def test_enhance_basic_without_the_key(client, monkeypatch):
    from server import enhance
    monkeypatch.setattr(script, "available", lambda: False)
    items = [{"id": "a", "words": ["Fast", "delivery", "in", "2", "days"]},
             {"id": "b", "words": ["your", "orders", "arrive"]},       # within the gap: no emoji
             {"id": "c", "words": ["and", "so", "on"]},
             {"id": "d", "words": ["Paisa", "bachao", "har", "mahine"]}]
    r = client.post("/api/enhance", json={"items": items}).json()
    assert r["source"] == "basic"
    got = {i["id"]: i for i in r["items"]}
    assert got["a"]["keyword"] == 3                                   # the number
    assert got["a"]["emoji"] == "🚚" and got["a"]["emojiWord"] == 1
    assert got["b"]["emoji"] is None
    assert got["c"]["keyword"] is None and got["c"]["emoji"] is None    # all filler
    assert got["d"]["emoji"] == "💰" and got["d"]["emojiWord"] == 0
    assert all(ch in enhance.EMOJI for ch in ["🚚", "💰"])
    # either part can be left out
    r = client.post("/api/enhance", json={"items": items, "emoji": False}).json()
    assert all(i["emoji"] is None for i in r["items"]) and r["items"][0]["keyword"] == 3


def test_enhance_ai_answers_are_checked(client, monkeypatch):
    monkeypatch.setattr(script, "available", lambda: True)
    seen = {}

    def fake_chat(system, user):
        seen["system"], seen["user"] = system, user
        return {"items": [{"id": "a", "keyword": 1, "emoji": "🚀", "emojiWord": 1},
                          {"id": "b", "keyword": 9, "emoji": "🦄", "emojiWord": 0},   # out of range, not in the set
                          {"id": "c", "keyword": True, "emoji": "❤", "emojiWord": None}]}  # heart without its variation selector
    monkeypatch.setattr(script, "_chat", fake_chat)
    items = [{"id": "a", "words": ["Grow", "faster"]}, {"id": "b", "words": ["hello"]}, {"id": "c", "words": ["we", "care"]}]
    r = client.post("/api/enhance", json={"items": items}).json()
    got = {i["id"]: i for i in r["items"]}
    assert r["source"] == "ai"
    assert got["a"] == {"id": "a", "keyword": 1, "emoji": "🚀", "emojiWord": 1}
    assert got["b"]["keyword"] is None and got["b"]["emoji"] is None
    assert got["c"]["keyword"] is None and got["c"]["emoji"] == "❤️" and got["c"]["emojiWord"] == 0
    assert "🚀 (rocket)" in seen["system"] and '"Grow"' in seen["user"]


def test_enhance_falls_back_when_the_model_fails(client, monkeypatch):
    monkeypatch.setattr(script, "available", lambda: True)

    def down(system, user):
        raise script.ScriptError("busy")
    monkeypatch.setattr(script, "_chat", down)
    r = client.post("/api/enhance", json={"items": [{"id": "a", "words": ["Big", "sale", "today"]}]}).json()
    assert r["source"] == "basic" and r["items"][0]["emoji"] == "🔥"
