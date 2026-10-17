"""Speech-to-text with word-level timestamps.

Two engines are supported:
  * local  – faster-whisper (Whisper large-v3 by default). Runs on GPU when
             available, otherwise CPU int8. Audio never leaves the server.
  * openai – OpenAI's hosted whisper-1 API. Faster on machines without a GPU,
             but audio is sent to a third party.
"""
from __future__ import annotations

import logging
import os
import re
import threading
from typing import Callable

import httpx

from .spelling import convert_word

log = logging.getLogger("captions.transcribe")

ENGINE = os.environ.get("TRANSCRIBE_ENGINE", "local")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3")

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

    if ENGINE == "openai":
        result = _openai(audio_path, code, prompt, progress)
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
    """Reported by /api/health so a deployment can confirm it is really on the GPU."""
    if ENGINE != "local":
        return {"engine": ENGINE, "model": "whisper-1"}
    return {"engine": ENGINE, "model": WHISPER_MODEL, "device": _device, "modelLoaded": _model is not None}


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
    if ENGINE == "local":
        threading.Thread(target=_get_model, daemon=True).start()


def _local(audio_path, duration, code, prompt, vocab, progress) -> dict:
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


# -------------------------------------------------------------------- openai

def _openai(audio_path, code, prompt, progress) -> dict:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise TranscriptionError("TRANSCRIBE_ENGINE=openai but OPENAI_API_KEY is not set")
    progress(0.1)
    data = [("model", "whisper-1"), ("response_format", "verbose_json"),
            ("timestamp_granularities[]", "word"), ("timestamp_granularities[]", "segment")]
    if code:
        data.append(("language", code))
    if prompt:
        data.append(("prompt", prompt))
    with open(audio_path, "rb") as f:
        r = httpx.post("https://api.openai.com/v1/audio/transcriptions",
                       headers={"Authorization": f"Bearer {key}"},
                       data=data, files={"file": ("audio.mp3", f, "audio/mpeg")}, timeout=900)
    if r.status_code != 200:
        raise TranscriptionError(f"OpenAI transcription failed: {r.text[:300]}")
    body = r.json()
    raw = body.get("words", [])
    # whisper-1 word entries carry no punctuation; restore it from segment text
    # when the token counts line up.
    words = []
    for seg in body.get("segments", []):
        inside = [w for w in raw if seg["start"] - 0.01 <= w["start"] < seg["end"] + 0.01
                  and w not in words]
        tokens = seg["text"].split()
        if len(tokens) == len(inside):
            for w, t in zip(inside, tokens):
                w["word"] = t
        words.extend(inside)
    if not words:
        words = raw
    lang = (body.get("language") or code or "en").lower()
    lang = _LANG_NAMES.get(lang, lang)
    return {"language": lang, "probability": None,
            "words": [{"text": w["word"].strip(), "start": round(w["start"], 3),
                       "end": round(w["end"], 3), "conf": None} for w in words]}


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
