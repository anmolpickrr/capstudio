"""A Premiere Pro sequence or After Effects composition rebuilt as one video, so the
whole edit can be captioned: every audible clip (voice-over, music, the sound of
video clips, on any track) mixed at its place in the timeline, and every visible
clip drawn over a black frame in track order for the preview.

The panel sends the clips it found (which file, which part of it, where it sits,
its speed and track) and the media files themselves; the result is an ordinary
upload as far as the rest of the server is concerned.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
from typing import Callable

from . import media

# Files that are pictures, not video: held on screen for the clip's length.
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".psd"}
PREVIEW_LONG_SIDE = 1280   # the rebuilt picture is only for the preview
MAX_FPS = 60


def streams(path: str) -> dict:
    """Which streams a file has (and if it reads at all): {'video': bool, 'audio': bool, 'image': bool}."""
    r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return {"video": False, "audio": False, "image": False}
    data = json.loads(r.stdout)
    kinds = {s.get("codec_type") for s in data.get("streams", [])
             if not s.get("disposition", {}).get("attached_pic")}
    fmt = data.get("format", {}).get("format_name", "")
    image = pathlib.Path(path).suffix.lower() in IMAGE_EXT or fmt.endswith("_pipe") or fmt == "image2"
    return {"video": "video" in kinds, "audio": "audio" in kinds, "image": image and "video" in kinds}


def _atempo(speed: float) -> list[str]:
    """atempo takes 0.5–2 per stage."""
    out = []
    while speed > 2:
        out.append("atempo=2")
        speed /= 2
    while speed < 0.5:
        out.append("atempo=0.5")
        speed /= 0.5
    if abs(speed - 1) > 1e-4:
        out.append(f"atempo={speed:.6f}")
    return out


def plan(spec: dict, files: dict[int, str], kinds: dict[int, dict]) -> tuple[list[str], str, dict]:
    """The ffmpeg inputs and filter graph for the rebuilt timeline, and what was used.

    spec: {width, height, fps, duration, segments: [{file, kind, start, end, inPoint, speed, track}]}
    (times in seconds, in the timeline; inPoint in the file; track: higher is on top).
    """
    w, h = spec["width"], spec["height"]
    k = min(1.0, PREVIEW_LONG_SIDE / max(w, h))
    W, H = max(2, round(w * k / 2) * 2), max(2, round(h * k / 2) * 2)
    fps = min(MAX_FPS, max(1.0, float(spec["fps"])))
    D = float(spec["duration"])
    inputs = ["-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={fps:.6f}:d={D:.6f}",
              "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo:d={D:.6f}"]
    graph, n, used = [], 2, {"video": 0, "audio": 0, "skipped": 0}
    last_v, mix = "[0:v]", ["[1:a]"]
    segs = [s for s in spec["segments"] if s["end"] - s["start"] > 0.01 and s["start"] < D]
    # pictures bottom track first, so upper tracks cover lower ones
    for s in sorted(segs, key=lambda x: (x["kind"] == "audio", x["track"], x["start"])):
        f = files.get(s["file"])
        info = kinds.get(s["file"], {})
        start, end = max(0.0, s["start"]), min(D, s["end"])
        speed = s.get("speed") or 1.0
        src_len = (end - start) * speed
        if s["kind"] == "audio":
            if not f or not info.get("audio"):
                used["skipped"] += 1
                continue
            inputs += ["-ss", f"{s.get('inPoint', 0):.6f}", "-t", f"{src_len:.6f}", "-i", f]
            ms = round(start * 1000)
            chain = [*_atempo(speed), "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo",
                     f"adelay={ms}|{ms}"]
            graph.append(f"[{n}:a]{','.join(chain)}[a{n}]")
            mix.append(f"[a{n}]")
            used["audio"] += 1
        else:
            if not f or not info.get("video"):
                used["skipped"] += 1
                continue
            if info.get("image"):
                inputs += ["-loop", "1", "-framerate", f"{fps:.6f}", "-t", f"{end - start:.6f}", "-i", f]
                pts = f"PTS-STARTPTS+{start:.6f}/TB"
            else:
                inputs += ["-ss", f"{s.get('inPoint', 0):.6f}", "-t", f"{src_len:.6f}", "-i", f]
                pts = f"(PTS-STARTPTS)/{speed:.6f}+{start:.6f}/TB"
            graph.append(f"[{n}:v]setpts={pts},scale={W}:{H}:force_original_aspect_ratio=decrease,setsar=1,format=yuva420p[v{n}]")
            graph.append(f"{last_v}[v{n}]overlay=(W-w)/2:(H-h)/2:eof_action=pass:repeatlast=0"
                         f":enable='between(t,{start:.6f},{end:.6f})'[o{n}]")
            last_v = f"[o{n}]"
            used["video"] += 1
        n += 1
    if not used["audio"]:
        raise media.MediaError("There's no sound on the timeline to caption. Unmute the voice-over or video tracks and try again.")
    graph.append(f"{last_v}format=yuv420p,fps={fps:.6f}[vout]")
    graph.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:dropout_transition=0:normalize=0,"
                 f"alimiter=limit=0.95[aout]")
    return inputs, ";\n".join(graph), {**used, "width": W, "height": H}


def compose(spec: dict, files: dict[int, str], dest: str, progress: Callable[[float], None], cwd: str) -> dict:
    """Build the timeline as one MP4 at dest. Returns what was used."""
    kinds = {i: streams(p) for i, p in files.items()}
    inputs, graph, used = plan(spec, files, kinds)
    script = os.path.join(cwd, "timeline.filter")
    with open(script, "w") as fh:
        fh.write(graph)
    cmd = ["ffmpeg", "-y", "-hide_banner", "-nostats", "-progress", "pipe:1", *media.IN_THREADS, *inputs,
           "-filter_complex_script", script, "-map", "[vout]", "-map", "[aout]", "-t", f"{float(spec['duration']):.6f}",
           *media.OUT_THREADS, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", *media.X264_LOW,
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", dest]
    media._run_with_progress(cmd, float(spec["duration"]), progress, cwd)
    return used
