"""Builds the example projects for the Demo section (static/demo/).

Each example is a short synthetic video with a synthesised voice. Words are
spoken one at a time, so their timings are known exactly; the captions are
saved as prepared example captions and are always labelled as examples in the
app (they are not output of the transcription engine).

    .venv/bin/python scripts/build_demo.py      (needs ffmpeg with flite, and espeak-ng)
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server import media  # noqa: E402

OUT = ROOT / "static" / "demo"

DEMOS = [
    {
        "id": "launch-reel", "title": "Product launch reel", "subtitle": "English (US) · 9:16 reel",
        "language": "en", "voice": ("flite", "slt"), "size": (1080, 1920), "fps": 30,
        "palette": "c0=0x1b1446:c1=0x6a4cff:c2=0xff5fa8:c3=0x14102e", "kind": "radial",
        "text": "Meet the new one click checkout. No forms. No waiting. Your customers pay in seconds, "
                "and conversions jump by forty percent. Launching today for every store.",
        "template": "hormozi",
    },
    {
        "id": "hindi-explainer", "title": "Hindi explainer", "subtitle": "Hindi · 16:9",
        "language": "hi", "voice": ("espeak", "hi"), "size": (1920, 1080), "fps": 25,
        "palette": "c0=0x3a1c0f:c1=0xff9f1c:c2=0x9b2c2c:c3=0x1b0f08", "kind": "linear",
        "text": "नमस्ते दोस्तों! आज हम सीखेंगे कि वीडियो पर कैप्शन कैसे लगाएं। "
                "यह बहुत आसान है, और आपके दर्शक हर शब्द समझ पाएंगे।",
        "template": "desi",
    },
    {
        "id": "studio-talk", "title": "Talking-head tips", "subtitle": "English (UK) · 1:1 square",
        "language": "en", "voice": ("espeak", "en-gb"), "size": (1080, 1080), "fps": 30,
        "palette": "c0=0x0b2a2f:c1=0x1f7a7a:c2=0x9fe8d8:c3=0x07181b", "kind": "circular",
        "text": "Most people watch with the sound off. So the words on screen do the talking. "
                "Keep each line short, keep it in sync, and make the key idea stand out.",
        "template": "magazine",
    },
]


def run(*cmd: str) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def duration(path: pathlib.Path) -> float:
    return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)))


def speak(word: str, voice: tuple[str, str], dest: pathlib.Path) -> None:
    raw = dest.with_suffix(".raw.wav")
    spoken = word.strip(".,!?।")
    if voice[0] == "flite":
        run("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"flite=text='{spoken}':voice={voice[1]}", str(raw))
    else:
        run("espeak-ng", "-v", voice[1], "-s", "150", "-w", str(raw), spoken)
    # trim leading/trailing silence so the timing is the word itself
    run("ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse,aresample=22050,aformat=channel_layouts=mono",
        str(dest))


def build(demo: dict, tmp: pathlib.Path) -> None:
    words, parts, t = [], [], 0.7
    silence = lambda d, p: run("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",  # noqa: E731
                               "anullsrc=r=22050:cl=mono", "-t", f"{d:.3f}", str(p))
    lead = tmp / "lead.wav"
    silence(t, lead)
    parts.append(lead)
    for i, word in enumerate(demo["text"].split()):
        wav = tmp / f"w{i}.wav"
        speak(word, demo["voice"], wav)
        d = duration(wav)
        words.append({"text": word, "start": round(t, 3), "end": round(t + d, 3), "conf": 0.97})
        t += d
        gap = 0.42 if word[-1] in ".!?।" else 0.2 if word[-1] == "," else 0.05
        pause = tmp / f"p{i}.wav"
        silence(gap, pause)
        parts += [wav, pause]
        t += gap
    listing = tmp / "list.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in parts))
    voice = tmp / "voice.wav"
    run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "pcm_s16le", str(voice))

    total = duration(voice) + 0.8
    w, h = demo["size"]
    out = OUT / demo["id"]
    out.mkdir(parents=True, exist_ok=True)
    video = out / "video.mp4"
    run("ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", f"gradients=s={w}x{h}:{demo['palette']}:n=4:type={demo['kind']}:speed=0.008:r={demo['fps']}:d={total:.2f}",
        "-i", str(voice),
        "-filter_complex", "[0]noise=alls=5:allf=t,vignette=PI/5,format=yuv420p[v];[1]apad,aresample=48000[a]",
        "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}",
        "-c:v", "libx264", "-crf", "24", "-preset", "slow", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(video))
    run("ffmpeg", "-v", "error", "-y", "-ss", "1.5", "-i", str(video), "-frames:v", "1", "-vf", "scale=640:-2", str(out / "poster.jpg"))
    (out / "captions.json").write_text(json.dumps({
        "language": demo["language"], "spaced": True, "prepared": True, "words": words,
    }, ensure_ascii=False, indent=1))
    info = media.probe(str(video))
    meta = {k: demo[k] for k in ("id", "title", "subtitle", "language", "template")}
    meta.update({"info": info, "words": len(words)})
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"{demo['id']}: {len(words)} words, {info['duration']:.1f}s, {video.stat().st_size / 1e6:.1f} MB")


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for demo in DEMOS:
        with tempfile.TemporaryDirectory() as d:
            build(demo, pathlib.Path(d))
    (OUT / "index.json").write_text(json.dumps([d["id"] for d in DEMOS]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
