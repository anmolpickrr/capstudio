"""Speech-to-text with word-level timestamps.

Engines:
  * groq   – Groq's hosted Whisper large-v3 (free tier available). Very fast;
             audio is sent to Groq. Used automatically when GROQ_API_KEY is set.
  * openai – OpenAI's hosted whisper-1. Audio is sent to OpenAI.
  * local  – faster-whisper on this server. Runs on GPU when available,
             otherwise CPU int8. Audio never leaves the server.

With a hosted engine, the local model is kept as a backup (LOCAL_FALLBACK=1)
and takes over when the hosted service is unreachable or rate-limited.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable

import httpx

from .spelling import convert_word

log = logging.getLogger("captions.transcribe")

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3")
HOSTED = {
    # engine: (API base URL, model, API key variable)
    "groq": (os.environ.get("GROQ_API_BASE", "https://api.groq.com/openai/v1"), "whisper-large-v3",
             "GROQ_API_KEY"),
    "openai": ("https://api.openai.com/v1", "whisper-1", "OPENAI_API_KEY"),
}
ENGINE = os.environ.get("TRANSCRIBE_ENGINE") or ("groq" if os.environ.get("GROQ_API_KEY") else "local")
LOCAL_FALLBACK = os.environ.get("LOCAL_FALLBACK", "1") == "1"
# Hosted APIs accept files up to 25 MB; audio is split into chunks below that.
CHUNK_BYTES = int(os.environ.get("HOSTED_CHUNK_BYTES", str(24 * 1024 * 1024)))
CHUNK_SECONDS = 600

# UI language id -> (whisper language code or None for auto, label, group)
LANGUAGES: list[tuple[str, str | None, str, str]] = [
    ("auto", None, "Auto-detect", "Common"),
    ("en-IN", "en", "English (India)", "English"),
    ("en-US", "en", "English (US spelling)", "English"),
    ("en-GB", "en", "English (UK spelling)", "English"),
    ("hinglish", "hi", "Hinglish – Hindi in Devanagari, English in Latin", "Hindi"),
    ("hinglish-roman", "hi", "Hinglish – all Roman script", "Hindi"),
    ("hi", "hi", "Hindi (हिन्दी)", "Indian"),
    ("bn", "bn", "Bengali (বাংলা)", "Indian"),
    ("ta", "ta", "Tamil (தமிழ்)", "Indian"),
    ("te", "te", "Telugu (తెలుగు)", "Indian"),
    ("mr", "mr", "Marathi (मराठी)", "Indian"),
    ("gu", "gu", "Gujarati (ગુજરાતી)", "Indian"),
    ("kn", "kn", "Kannada (ಕನ್ನಡ)", "Indian"),
    ("ml", "ml", "Malayalam (മലയാളം)", "Indian"),
    ("pa", "pa", "Punjabi (ਪੰਜਾਬੀ)", "Indian"),
    ("ur", "ur", "Urdu (اردو)", "Indian"),
    ("as", "as", "Assamese (অসমীয়া)", "Indian"),
    ("ne", "ne", "Nepali (नेपाली)", "Indian"),
    ("sa", "sa", "Sanskrit (संस्कृतम्)", "Indian"),
    ("sd", "sd", "Sindhi", "Indian"),
    ("ar", "ar", "Arabic", "International"),
    ("zh", "zh", "Chinese", "International"),
    ("nl", "nl", "Dutch", "International"),
    ("fr", "fr", "French", "International"),
    ("de", "de", "German", "International"),
    ("id", "id", "Indonesian", "International"),
    ("it", "it", "Italian", "International"),
    ("ja", "ja", "Japanese", "International"),
    ("ko", "ko", "Korean", "International"),
    ("ms", "ms", "Malay", "International"),
    ("pt", "pt", "Portuguese", "International"),
    ("ru", "ru", "Russian", "International"),
    ("es", "es", "Spanish", "International"),
    ("th", "th", "Thai", "International"),
    ("tr", "tr", "Turkish", "International"),
    ("vi", "vi", "Vietnamese", "International"),
]
LANG_INDEX = {lid: (code, label) for lid, code, label, _ in LANGUAGES}

# Scripts written without spaces between words.
UNSPACED = {"zh", "ja", "th", "lo", "my", "km", "yue"}

# Steering prompts. Whisper imitates the style of the prompt, which is the most
# reliable way to get code-mixed Hindi/English in the expected script.
PROMPTS = {
    "hinglish": "तो दोस्तों, आज हम बात करेंगे कि कैसे अपना business grow करें। "
                "ये video बहुत important है, तो end तक ज़रूर देखना।",
    "hinglish-roman": "Toh doston, aaj hum baat karenge ki kaise apna business grow karein. "
                      "Yeh video bahut important hai, toh end tak zaroor dekhna.",
}

ProgressCb = Callable[[float], None]


class TranscriptionError(RuntimeError):
    pass


def transcribe(audio_path: str, duration: float, lang_id: str, vocabulary: str,
               progress: ProgressCb) -> dict:
    if lang_id not in LANG_INDEX:
        raise TranscriptionError(f"Unsupported language: {lang_id}")
    code, _ = LANG_INDEX[lang_id]
    vocab = [v.strip() for v in re.split(r"[,\n]", vocabulary or "") if v.strip()][:100]
    prompt = PROMPTS.get(lang_id, "")
    if vocab:
        prompt = (prompt + " " + ", ".join(vocab) + ".").strip()

    engine = ENGINE
    if engine in HOSTED:
        try:
            result = _hosted(engine, audio_path, duration, code, prompt, progress)
        except HostedUnavailable as e:
            if not LOCAL_FALLBACK:
                raise TranscriptionError(str(e)) from e
            log.warning("%s unavailable (%s); using the on-server model", engine, e)
            engine = "local"
            result = _local(audio_path, duration, code, prompt, vocab, progress)
    else:
        result = _local(audio_path, duration, code, prompt, vocab, progress)

    words = result["words"]
    if lang_id in ("en-US", "en-GB", "en-IN"):
        # Indian English follows British spelling.
        variant = "en-US" if lang_id == "en-US" else "en-GB"
        for w in words:
            w["text"] = convert_word(w["text"], variant)
    if lang_id == "hinglish-roman":
        for w in words:
            w["text"] = romanize_devanagari(w["text"])
    words = [w for w in words if w["text"]]
    _fix_overlaps(words)
    return {
        "language": result["language"],
        "languageProbability": result.get("probability"),
        "requested": lang_id,
        "spaced": result["language"] not in UNSPACED,
        "engine": engine,
        "fallback": engine != ENGINE,
        "words": words,
    }


def _fix_overlaps(words: list[dict]) -> None:
    """Whisper occasionally emits zero-length or overlapping word timings."""
    for i, w in enumerate(words):
        if i and w["start"] < words[i - 1]["end"]:
            w["start"] = words[i - 1]["end"]
        if w["end"] - w["start"] < 0.04:
            w["end"] = w["start"] + 0.04
        nxt = words[i + 1]["start"] if i + 1 < len(words) else None
        if nxt is not None and w["end"] > nxt and nxt > w["start"]:
            w["end"] = nxt


# --------------------------------------------------------------------- local

_model = None
_model_lock = threading.Lock()
_device: str | None = None


def model_status() -> dict:
    """Reported by /api/health so a deployment can confirm what is running."""
    status = {"engine": ENGINE}
    if ENGINE in HOSTED:
        status["hostedModel"] = HOSTED[ENGINE][1]
        status["hostedKeySet"] = bool(os.environ.get(HOSTED[ENGINE][2]))
    if ENGINE == "local" or LOCAL_FALLBACK:
        status.update({"localModel": WHISPER_MODEL, "device": _device, "modelLoaded": _model is not None})
    return status


def _get_model():
    global _model, _device
    with _model_lock:
        if _model is None:
            import ctranslate2
            from faster_whisper import WhisperModel

            if ctranslate2.get_cuda_device_count() > 0:
                device, compute = "cuda", "float16"
            else:
                device, compute = "cpu", "int8"
            log.info("loading whisper model %s on %s (%s)", WHISPER_MODEL, device, compute)
            _device = device
            _model = WhisperModel(WHISPER_MODEL, device=device, compute_type=compute,
                                  cpu_threads=os.cpu_count() or 4)
        return _model


def warm_up() -> None:
    if ENGINE == "local" or LOCAL_FALLBACK:
        threading.Thread(target=_safe_load, daemon=True).start()


def _safe_load() -> None:
    try:
        _get_model()
    except Exception:  # noqa: BLE001 - a missing backup model must not stop the app
        log.exception("could not load the on-server model")


# The on-server model uses every CPU core, so jobs take turns.
_local_turn = threading.Semaphore(1)


def _local(audio_path, duration, code, prompt, vocab, progress) -> dict:
    with _local_turn:
        return _local_run(audio_path, duration, code, prompt, vocab, progress)


def _local_run(audio_path, duration, code, prompt, vocab, progress) -> dict:
    model = _get_model()
    segments, info = model.transcribe(
        audio_path,
        language=code,
        task="transcribe",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 200},
        condition_on_previous_text=False,  # avoids repetition loops on long videos
        initial_prompt=prompt or None,
        hotwords=", ".join(vocab) if vocab else None,
        language_detection_segments=3,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"text": text, "start": round(w.start, 3), "end": round(w.end, 3),
                              "conf": round(w.probability, 3)})
        if duration:
            progress(min(seg.end / duration, 0.99))
    return {"language": info.language, "probability": round(info.language_probability, 3),
            "words": words}


# ------------------------------------------------------------------ hosted


class HostedUnavailable(RuntimeError):
    """The hosted service can't be used right now (limits, outage, bad key)."""


def _hosted(engine, audio_path, duration, code, prompt, progress) -> dict:
    base, model, key_var = HOSTED[engine]
    key = os.environ.get(key_var)
    if not key:
        raise HostedUnavailable(f"{key_var} is not set")
    progress(0.05)
    with tempfile.TemporaryDirectory() as tmp:
        chunks = _split_audio(audio_path, Path(tmp))
        words, language = [], None
        for i, (path, offset) in enumerate(chunks):
            # The tail of the previous chunk keeps wording consistent across cuts.
            tail = " ".join(w["text"] for w in words[-30:])
            body = _post_transcription(base, model, key, path, code, (prompt + " " + tail).strip())
            language = language or body.get("language")
            for w in _words_from_response(body):
                w["start"] = round(w["start"] + offset, 3)
                w["end"] = round(w["end"] + offset, 3)
                words.append(w)
            progress(0.05 + 0.95 * (i + 1) / len(chunks))
    lang = (language or code or "en").lower()
    return {"language": _LANG_NAMES.get(lang, lang), "probability": None, "words": words}


def _split_audio(audio_path: str, tmp: Path) -> list[tuple[str, float]]:
    if os.path.getsize(audio_path) <= CHUNK_BYTES:
        return [(audio_path, 0.0)]
    total = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                  "-of", "csv=p=0", audio_path],
                                 check=True, capture_output=True, text=True).stdout)
    # Equal-length pieces, so no tiny leftover chunk at the end.
    pieces = max(1, -(-int(total) // CHUNK_SECONDS))
    listing = tmp / "chunks.csv"
    subprocess.run(["ffmpeg", "-v", "error", "-i", audio_path, "-f", "segment",
                    "-segment_time", f"{total / pieces + 0.5:.2f}", "-segment_list", str(listing),
                    "-segment_list_type", "csv", "-c", "copy", str(tmp / "chunk%03d.mp3")],
                   check=True, capture_output=True)
    chunks = []
    for line in listing.read_text().splitlines():
        name, start, _end = line.split(",")[:3]
        chunks.append((str(tmp / name), float(start)))
    return chunks


def _post_transcription(base, model, key, path, code, prompt) -> dict:
    data = {"model": model, "response_format": "verbose_json",
            "timestamp_granularities[]": ["word", "segment"], "temperature": "0"}
    if code:
        data["language"] = code
    if prompt:
        data["prompt"] = prompt[-800:]  # APIs cap the prompt at ~224 tokens
    for attempt in range(4):
        try:
            with open(path, "rb") as f:
                r = httpx.post(f"{base}/audio/transcriptions", headers={"Authorization": f"Bearer {key}"},
                               data=data, files={"file": ("audio.mp3", f, "audio/mpeg")}, timeout=600)
        except httpx.HTTPError as e:
            if attempt == 3:
                raise HostedUnavailable(f"network error: {e}") from e
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429 or r.status_code >= 500:
            wait = _retry_after(r)
            if attempt < 3 and wait <= 30:
                time.sleep(wait)
                continue
            raise HostedUnavailable(f"HTTP {r.status_code} (rate limit or outage)")
        if r.status_code in (401, 403):
            raise HostedUnavailable("the API key was rejected")
        raise TranscriptionError(f"Transcription failed: {r.text[:300]}")
    raise HostedUnavailable("no response")


def _retry_after(r: httpx.Response) -> float:
    try:
        return float(r.headers.get("retry-after", "5"))
    except ValueError:
        return 60.0


_NORM = re.compile(r"[\W_]+", re.UNICODE)


def _words_from_response(body: dict) -> list[dict]:
    """Word timings from the API, with punctuation and casing taken from the
    segment text (word entries often come back bare), and words in segments
    the model was unsure about flagged for review."""
    raw = [w for w in body.get("words") or [] if str(w.get("word", "")).strip()]
    segments = body.get("segments") or []
    tokens: list[tuple[str, bool]] = []
    for seg in segments:
        unsure = seg.get("avg_logprob", 0) < -0.8
        tokens += [(t, unsure) for t in seg.get("text", "").split()]
    out, j = [], 0
    for w in raw:
        text, conf = w["word"].strip(), None
        key = _NORM.sub("", text).lower()
        # look a few tokens ahead so a single mismatch doesn't derail alignment
        for k in range(j, min(j + 4, len(tokens))):
            if _NORM.sub("", tokens[k][0]).lower() == key and key:
                text, conf, j = tokens[k][0], (0.4 if tokens[k][1] else 0.95), k + 1
                break
        out.append({"text": text, "start": float(w["start"]), "end": float(w["end"]), "conf": conf})
    return out


_LANG_NAMES = {"english": "en", "hindi": "hi", "bengali": "bn", "tamil": "ta", "telugu": "te",
               "marathi": "mr", "gujarati": "gu", "kannada": "kn", "malayalam": "ml",
               "punjabi": "pa", "urdu": "ur", "assamese": "as", "nepali": "ne"}


# ------------------------------------------------------ Devanagari → Roman

_CONS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j",
    "झ": "jh", "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t",
    "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh",
    "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v", "श": "sh", "ष": "sh",
    "स": "s", "ह": "h", "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d", "ढ़": "rh",
    "फ़": "f", "य़": "y",
}
_NUKTA = {"क": "क़", "ख": "ख़", "ग": "ग़", "ज": "ज़", "ड": "ड़", "ढ": "ढ़", "फ": "फ़", "य": "य़"}
_VOWELS = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e",
           "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ॲ": "e"}
_MATRAS = {"ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai",
           "ो": "o", "ौ": "au", "ॅ": "e", "ॉ": "o"}
_MISC = {"ं": "n", "ँ": "n", "ः": "h", "।": ".", "॥": ".", "ॐ": "om"}
_DIGITS = {chr(0x966 + i): str(i) for i in range(10)}
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def romanize_devanagari(word: str) -> str:
    """Casual, chat-style romanisation (e.g. 'क्या बात है' -> 'kya baat hai')."""
    if not _DEVANAGARI.search(word):
        return word
    out: list[str] = []
    chars = list(word)
    i = 0
    while i < len(chars):
        c = chars[i]
        if i + 1 < len(chars) and chars[i + 1] == "़" and c in _NUKTA:
            c = _NUKTA[c]
            i += 1
        if c in _CONS:
            out.append(_CONS[c])
            nxt = chars[i + 1] if i + 1 < len(chars) else ""
            if nxt in _MATRAS:
                out.append(_MATRAS[nxt])
                i += 1
            elif nxt == "्":
                i += 1
            else:
                out.append("a")
        elif c in _VOWELS:
            out.append(_VOWELS[c])
        elif c in _MISC:
            out.append(_MISC[c])
        elif c in _DIGITS:
            out.append(_DIGITS[c])
        else:
            out.append(c)
        i += 1
    s = "".join(out)
    # Final schwa deletion and casual long-vowel endings: "kyaa" -> "kya".
    s = re.sub(r"(?<=[^aeiou\W])a(?=\W*$)", "", s) if len(s) > 2 else s
    s = re.sub(r"aa(?=\W*$)", "a", s)
    s = re.sub(r"ee(?=\W*$)", "i", s)
    return s
