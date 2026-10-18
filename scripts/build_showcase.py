"""Builds the looping clips for the style showcase on the first page (static/showcase/).

Each clip is a short, silent animated background. The words and their timings
are written here (a simple reading-speed model), and the app draws the captions
on top live with the same engine the editor uses, so every card shows a real
template in motion.

    python scripts/build_showcase.py      (needs ffmpeg)
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "showcase"
W, H, FPS = 432, 768, 30

CARDS = [
    {"id": "spotlight", "template": "hormozi", "language": "English",
     "palette": "c0=0x1b1446:c1=0x6a4cff:c2=0xff5fa8:c3=0x14102e", "kind": "radial",
     "text": "Meet the new one click checkout. No forms. No waiting. Your customers pay in seconds."},
    {"id": "karaoke", "template": "karaoke", "language": "English",
     "palette": "c0=0x0b2a2f:c1=0x1f7a7a:c2=0x9fe8d8:c3=0x07181b", "kind": "circular",
     "text": "Most people watch with the sound off, so the words on screen do the talking."},
    {"id": "hindi", "template": "desi", "language": "Hindi",
     "palette": "c0=0x3a1c0f:c1=0xff9f1c:c2=0x9b2c2c:c3=0x1b0f08", "kind": "linear",
     "text": "नमस्ते दोस्तों! आज हम सीखेंगे कि वीडियो पर कैप्शन कैसे लगाएं।"},
    {"id": "hinglish", "template": "popstar", "language": "Hinglish",
     "palette": "c0=0x101828:c1=0x2b59ff:c2=0x8a5cff:c3=0x0a0f1c", "kind": "radial",
     "text": "Yeh offer sirf aaj ke liye hai, toh jaldi order karo aur free delivery pao!"},
    {"id": "editorial", "template": "magazine", "language": "English",
     "palette": "c0=0x1d1d1b:c1=0x6b5b45:c2=0xd9c3a0:c3=0x121210", "kind": "linear",
     "text": "Keep each line short, keep it in sync, and make the key idea stand out."},
    {"id": "neon", "template": "neon", "language": "English",
     "palette": "c0=0x0d0221:c1=0x3a0ca3:c2=0xf72585:c3=0x050010", "kind": "circular",
     "text": "Launching tonight for every store. Free shipping on your first order."},
]


def timings(text: str) -> tuple[list[dict], float]:
    """Word start/end times at a natural speaking pace."""
    words, t = [], 0.5
    for word in text.split():
        d = 0.16 + 0.05 * len(word.strip(".,!?।"))
        words.append({"text": word, "start": round(t, 3), "end": round(t + d, 3)})
        t += d + (0.4 if word[-1] in ".!?।" else 0.18 if word[-1] == "," else 0.06)
    return words, t + 0.6


def build(card: dict) -> dict:
    words, total = timings(card["text"])
    video = OUT / f"{card['id']}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    f"gradients=s={W}x{H}:{card['palette']}:n=4:type={card['kind']}:speed=0.012:r={FPS}:d={total:.2f}",
                    "-vf", "vignette=PI/5,format=yuv420p", "-an", "-c:v", "libx264", "-crf", "30",
                    "-preset", "slow", "-movflags", "+faststart", str(video)], check=True)
    # WebM too, for browsers without H.264 (some Linux builds)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-c:v", "libvpx-vp9", "-crf", "42", "-b:v", "0",
                    "-row-mt", "1", "-an", str(video.with_suffix(".webm"))], check=True)
    poster = OUT / f"{card['id']}.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1", "-i", str(video), "-frames:v", "1",
                    "-q:v", "4", str(poster)], check=True)
    print(f"{card['id']}: {len(words)} words, {total:.1f}s, {video.stat().st_size / 1e3:.0f} kB")
    return {"id": card["id"], "template": card["template"], "language": card["language"],
            "video": f"showcase/{video.name}", "webm": f"showcase/{video.stem}.webm", "poster": f"showcase/{poster.name}",
            "width": W, "height": H, "duration": round(total, 2), "words": words}


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    cards = [build(c) for c in CARDS]
    (OUT / "showcase.json").write_text(json.dumps(cards, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
