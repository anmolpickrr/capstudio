"""Hosted (Groq/OpenAI) engine tests against a simulated API."""
import subprocess

import httpx
import pytest

from server import transcribe


def fake_response(words, text, logprob=-0.2, status=200, headers=None, language="english"):
    body = {"language": language, "segments": [{"text": text, "avg_logprob": logprob}],
            "words": [{"word": w, "start": s, "end": e} for w, s, e in words]}
    return httpx.Response(status, json=body, headers=headers or {})


@pytest.fixture
def audio(tmp_path):
    path = tmp_path / "a.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=30",
                    "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", str(path)], check=True)
    return str(path)


@pytest.fixture
def groq(monkeypatch):
    monkeypatch.setattr(transcribe, "ENGINE", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(transcribe.time, "sleep", lambda s: None)
    calls = []
    return calls


def test_punctuation_restored_and_unsure_words_flagged(groq, monkeypatch, audio):
    def post(url, **kw):
        groq.append(kw["data"])
        return fake_response([("hello", 0.1, 0.4), ("world", 0.5, 0.9)], " Hello, world!", logprob=-1.2)
    monkeypatch.setattr(transcribe.httpx, "post", post)
    out = transcribe.transcribe(audio, 30, "en-US", "Pickrr", lambda p: None)
    assert [w["text"] for w in out["words"]] == ["Hello,", "world!"]
    assert all(w["conf"] == 0.4 for w in out["words"])
    assert out["engine"] == "groq" and not out["fallback"] and out["language"] == "en"
    sent = groq[0]
    assert sent["model"] == "whisper-large-v3" and sent["language"] == "en" and "Pickrr" in sent["prompt"]


def test_long_audio_is_chunked_with_correct_offsets(groq, monkeypatch, audio):
    monkeypatch.setattr(transcribe, "CHUNK_BYTES", 1000)
    monkeypatch.setattr(transcribe, "CHUNK_SECONDS", 10)

    def post(url, **kw):
        groq.append(kw["data"])
        n = len(groq)
        return fake_response([(f"w{n}", 1.0, 1.5)], f" w{n}.")
    monkeypatch.setattr(transcribe.httpx, "post", post)
    out = transcribe.transcribe(audio, 30, "auto", "", lambda p: None)
    assert len(groq) == 3
    starts = [w["start"] for w in out["words"]]
    assert starts[0] == 1.0
    assert all(9.5 < b - a < 11.5 for a, b in zip(starts, starts[1:]))  # shifted by each chunk's start
    assert "w1." in groq[1]["prompt"]  # previous chunk's tail is passed on


def test_rate_limit_falls_back_to_on_server_model(groq, monkeypatch, audio):
    monkeypatch.setattr(transcribe.httpx, "post",
                        lambda url, **kw: httpx.Response(429, headers={"retry-after": "3600"}))
    monkeypatch.setattr(transcribe, "_local", lambda *a: {
        "language": "hi", "probability": 0.9, "words": [{"text": "नमस्ते", "start": 0, "end": 1, "conf": 0.9}]})
    out = transcribe.transcribe(audio, 30, "auto", "", lambda p: None)
    assert out["engine"] == "local" and out["fallback"] and out["words"][0]["text"] == "नमस्ते"


def test_short_rate_limit_is_retried(groq, monkeypatch, audio):
    responses = [httpx.Response(429, headers={"retry-after": "2"}),
                 fake_response([("ok", 0, 1)], " ok")]
    monkeypatch.setattr(transcribe.httpx, "post", lambda url, **kw: responses.pop(0))
    out = transcribe.transcribe(audio, 30, "auto", "", lambda p: None)
    assert out["engine"] == "groq" and out["words"][0]["text"] == "ok"


def test_bad_key_falls_back(groq, monkeypatch, audio):
    monkeypatch.setattr(transcribe.httpx, "post", lambda url, **kw: httpx.Response(401, json={}))
    monkeypatch.setattr(transcribe, "_local", lambda *a: {"language": "en", "probability": 1, "words": [
        {"text": "x", "start": 0, "end": 1, "conf": 1}]})
    assert transcribe.transcribe(audio, 30, "auto", "", lambda p: None)["engine"] == "local"


def test_no_fallback_reports_error(groq, monkeypatch, audio):
    monkeypatch.setattr(transcribe, "LOCAL_FALLBACK", False)
    monkeypatch.setattr(transcribe.httpx, "post", lambda url, **kw: httpx.Response(503))
    with pytest.raises(transcribe.TranscriptionError):
        transcribe.transcribe(audio, 30, "auto", "", lambda p: None)


def test_real_http_round_trip(groq, monkeypatch, audio):
    """No faked HTTP client: a real request to a local stand-in for Groq."""
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    received = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received["body"] = self.rfile.read(int(self.headers["content-length"]))
            received["auth"] = self.headers["authorization"]
            body = json.dumps({"language": "hindi", "segments": [{"text": " नमस्ते दोस्तों।", "avg_logprob": -0.1}],
                               "words": [{"word": "नमस्ते", "start": 0.2, "end": 0.6},
                                         {"word": "दोस्तों", "start": 0.7, "end": 1.2}]}).encode()
            self.send_response(200)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setitem(transcribe.HOSTED, "groq",
                            (f"http://127.0.0.1:{server.server_port}/openai/v1", "whisper-large-v3", "GROQ_API_KEY"))
        out = transcribe.transcribe(audio, 30, "hi", "", lambda p: None)
    finally:
        server.shutdown()
    assert [w["text"] for w in out["words"]] == ["नमस्ते", "दोस्तों।"]
    assert out["language"] == "hi" and out["engine"] == "groq"
    assert received["auth"] == "Bearer test-key"
    body = received["body"]
    assert b'name="timestamp_granularities[]"\r\n\r\nword' in body
    assert b'name="timestamp_granularities[]"\r\n\r\nsegment' in body
    assert b'name="language"\r\n\r\nhi' in body and b'filename="audio.mp3"' in body
