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
