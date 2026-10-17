"""Builds the static demo served by GitHub Pages (static/demo/).

The demo runs the real editor in the browser without the server: a sample
video with pre-made, exactly-timed captions, plus the language list and font
catalogue the server would normally provide. Re-run after changing fonts,
languages or the sample script:

    .venv/bin/python scripts/build_demo.py
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import main, media  # noqa: E402
from server.fonts import catalogue  # noqa: E402

OUT = ROOT / "static" / "demo"
W, H = 1080, 1920
SCRIPT = (
    "Welcome to Caption Panel. Upload your final video, and get accurate captions in seconds. "
    "Pick a template, then change the font, colours and animation. Every change shows up live. "
    "When you are happy, download your video in its original quality. "
    "Your files are deleted automatically."
)
# Words shown as "unsure" in the demo, to show the low-confidence underline.
UNSURE = {"Caption", "colours"}


def run(*cmd: str) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def duration(path: pathlib.Path) -> float:
    return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(path)))


def synthesize(tmp: pathlib.Path) -> tuple[pathlib.Path, list[dict]]:
    """Speaks the script one word at a time, so every word's timing is exact."""
    words, parts, t = [], [], 0.6
    lead = tmp / "lead.wav"
    run("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-t", str(t), str(lead))
    parts.append(lead)
    for i, word in enumerate(SCRIPT.split()):
        spoken = word.strip(".,")
        wav = tmp / f"w{i}.wav"
        run("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
            f"flite=text='{spoken}':voice=slt", "-af",
            "silenceremove=start_periods=1:start_threshold=-45dB,"
            "areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
            "aresample=16000", str(wav))
        d = duration(wav)
        words.append({"text": word, "start": round(t, 3), "end": round(t + d, 3),
                      "conf": 0.35 if spoken in UNSURE else 0.97})
        t += d
        gap = 0.45 if word.endswith(".") else 0.2 if word.endswith(",") else 0.06
        pause = tmp / f"p{i}.wav"
        run("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
            "-t", str(gap), str(pause))
        parts += [wav, pause]
        t += gap
    listing = tmp / "list.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in parts))
    voice = tmp / "voice.wav"
    run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
        "-c", "pcm_s16le", str(voice))
    return voice, words


def main_() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d)
        voice, words = synthesize(tmp)
        total = duration(voice) + 0.8
        video = OUT / "sample.mp4"
        run("ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", f"gradients=s={W}x{H}:c0=0x1d2b64:c1=0x6c5cff:c2=0xf8cdda:"
                                 f"x0=0:y0=0:x1={W}:y1={H}:speed=0.012:r=30:d={total}",
            "-i", str(voice),
            "-filter_complex", "[0]noise=alls=6:allf=t,format=yuv420p[v];[1]apad[a]",
            "-map", "[v]", "-map", "[a]", "-t", str(total),
            "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart", str(video))

    info = media.probe(str(video))
    (OUT / "transcript.json").write_text(json.dumps({
        "language": "en", "languageProbability": 1.0, "requested": "en-GB",
        "spaced": True, "words": words,
    }, ensure_ascii=False, indent=1))
    (OUT / "job.json").write_text(json.dumps({"id": "demo", "name": "caption-panel-sample.mp4",
                                              "info": info}, indent=1))
    (OUT / "config.json").write_text(json.dumps(main.config(), ensure_ascii=False))
    (OUT / "fonts.json").write_text(json.dumps(catalogue(), ensure_ascii=False))
    print(f"demo built: {len(words)} words, {info['duration']:.1f}s, "
          f"{video.stat().st_size / 1e6:.1f} MB video")


if __name__ == "__main__":
    main_()
