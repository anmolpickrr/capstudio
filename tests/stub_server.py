"""Runs Caption Panel with a fake speech model, for UI tests on machines
without the Whisper model. Usage: python tests/stub_server.py [port]"""
import os
import pathlib
import sys
import tempfile

import uvicorn

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="caption-panel-e2e-"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from server import main, transcribe  # noqa: E402

TEXT = ("Hey everyone, welcome back to the channel. Today I'm going to show you how to organize "
        "your favorite videos with colour-perfect captions. यह बहुत आसान है, let's get started! "
        "First, upload your video. Then pick a template and customize it.")


def fake(audio, duration, code, prompt, vocab, progress):
    toks = TEXT.split()
    step = (duration - 1) / len(toks)
    return {"language": "en", "probability": 0.97, "words": [
        {"text": t, "start": round(0.5 + i * step, 3), "end": round(0.5 + i * step + step * 0.85, 3),
         "conf": 0.3 if i in (5, 17) else 0.95} for i, t in enumerate(toks)]}


transcribe._local = fake
transcribe.warm_up = lambda: None
uvicorn.run(main.app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8765,
            log_level="warning")
