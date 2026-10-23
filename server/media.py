"""ffprobe / ffmpeg helpers: probing, audio extraction, burn-in and soft-sub muxing."""
from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Callable

from .fonts import FONTS_DIR


class MediaError(RuntimeError):
    pass


# Small servers (Render's free plan: 512 MB, 0.1 CPU) set LOW_POWER=1. ffmpeg then runs
# single-threaded with a short look-ahead so a 1080p export fits in memory (~300 MB
# instead of ~700 MB), HEVC is re-encoded as H.264 (x265 needs ~600 MB even when
# reduced), and burned-in exports are limited to 1080p.
LOW_POWER = os.environ.get("LOW_POWER") == "1"
MAX_BURN_PIXELS = 1920 * 1080 if LOW_POWER else 0
IN_THREADS = ["-threads", "1"] if LOW_POWER else []
OUT_THREADS = ["-filter_threads", "1", "-threads", "1"] if LOW_POWER else []
X264_LOW = ["-x264-params", "rc-lookahead=5:bframes=2:ref=2"] if LOW_POWER else []


def too_large_to_burn(info: dict) -> bool:
    return bool(MAX_BURN_PIXELS) and info["width"] * info["height"] > MAX_BURN_PIXELS


def probe(path: str) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format",
                        "-show_streams", path], capture_output=True, text=True)
    if r.returncode != 0:
        raise MediaError("This file could not be read as a video.")
    data = json.loads(r.stdout)
    video = next((s for s in data["streams"] if s["codec_type"] == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    if not video:
        raise MediaError("No video stream found in this file.")
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)

    rotation = 0
    for sd in video.get("side_data_list", []):
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    if not rotation and "rotate" in video.get("tags", {}):
        rotation = -int(video["tags"]["rotate"])
    w, h = int(video["width"]), int(video["height"])
    if abs(rotation) % 180 == 90:
        w, h = h, w  # ffmpeg auto-rotates before filtering; captions use display dims

    def rate(s):
        try:
            n, d = s.split("/")
            return round(int(n) / int(d), 3) if int(d) else None
        except (ValueError, AttributeError):
            return None

    duration = float(data["format"].get("duration") or video.get("duration") or 0)
    return {
        "width": w,
        "height": h,
        "rotation": rotation,
        "fps": rate(video.get("avg_frame_rate")) or rate(video.get("r_frame_rate")),
        "duration": duration,
        "vcodec": video.get("codec_name"),
        "profile": video.get("profile"),
        "pixFmt": video.get("pix_fmt"),
        "colorSpace": video.get("color_space"),
        "colorPrimaries": video.get("color_primaries"),
        "colorTransfer": video.get("color_transfer"),
        "colorRange": video.get("color_range"),
        "bitRate": int(video.get("bit_rate") or data["format"].get("bit_rate") or 0),
        "acodec": audio.get("codec_name") if audio else None,
        "format": data["format"].get("format_name"),
        "size": int(data["format"].get("size") or 0),
    }


def extract_audio(src: str, dest: str, mp3: bool = False) -> None:
    args = ["-vn", "-ac", "1", "-ar", "16000"]
    args += ["-c:a", "libmp3lame", "-b:a", "48k"] if mp3 else ["-c:a", "pcm_s16le"]
    _run(["ffmpeg", "-y", "-v", "error", "-i", src, *args, dest])


def make_proxy(src: str, dest: str) -> None:
    """Low-res H.264 copy for browsers that can't play the original (ProRes, HEVC on some
    browsers). Only used for the preview; the export always uses the original."""
    _run(["ffmpeg", "-y", "-v", "error", *IN_THREADS, "-i", src, "-vf", "scale=-2:'min(720,ih)'",
          *OUT_THREADS, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", "-b:a", "96k",
          "-movflags", "+faststart", dest])


QUALITY = {
    #           x264 crf, x264 preset, x265 crf, x265 preset
    "max":      (14, "slow", 16, "medium"),
    "high":     (17, "medium", 19, "fast"),
    "fast":     (20, "veryfast", 22, "veryfast"),
}
if LOW_POWER:  # same quality targets, presets a tenth of a CPU can finish in minutes
    QUALITY = {"max": (14, "medium", 16, "fast"), "high": (17, "veryfast", 19, "veryfast"),
               "fast": (20, "superfast", 22, "superfast")}
X264_PIX = {"yuv420p", "yuvj420p", "yuv422p", "yuv444p", "yuv420p10le", "yuv422p10le",
            "yuv444p10le"}
X265_PIX = X264_PIX | {"yuv420p12le", "yuv422p12le", "yuv444p12le"}
# Audio formats every editor and player accepts inside MP4 (Opus/FLAC in MP4 break
# QuickTime and Premiere), so others are converted to AAC at a transparent bitrate.
MP4_AUDIO = {"aac", "mp3", "ac3", "eac3", "alac"}
PRORES_PROFILES = {"Proxy": "0", "LT": "1", "Standard": "2", "HQ": "3", "4444": "4",
                   "4444 XQ": "5", "XQ": "5"}


def output_plan(info: dict, src_ext: str, quality: str) -> tuple[list[str], str]:
    """Encoder args + output extension that best preserve the original's quality."""
    crf264, preset264, crf265, preset265 = QUALITY.get(quality, QUALITY["high"])
    vcodec, pix = info["vcodec"], info["pixFmt"]
    if vcodec == "prores":
        profile = PRORES_PROFILES.get(info.get("profile") or "", "3")
        pix_out = pix if pix in ("yuv422p10le", "yuv444p10le", "yuva444p10le") else "yuv422p10le"
        return (["-c:v", "prores_ks", "-profile:v", profile, "-vendor", "apl0",
                 "-pix_fmt", pix_out], ".mov")
    ext = ".mov" if src_ext.lower() == ".mov" else ".mp4"
    if vcodec == "hevc" and not LOW_POWER:
        args = ["-c:v", "libx265", "-crf", str(crf265), "-preset", preset265,
                "-tag:v", "hvc1", "-x265-params", "log-level=error"]
        args += ["-pix_fmt", pix if pix in X265_PIX else "yuv420p"]
    else:
        args = ["-c:v", "libx264", "-crf", str(crf264), "-preset", preset264, *X264_LOW]
        if LOW_POWER and vcodec == "hevc":  # 8-bit H.264 plays everywhere; 10-bit H.264 doesn't
            args += ["-pix_fmt", "yuv420p"]
        else:
            args += ["-pix_fmt", pix if pix in X264_PIX else "yuv420p"]
    for flag, key in (("-colorspace", "colorSpace"), ("-color_primaries", "colorPrimaries"),
                      ("-color_trc", "colorTransfer"), ("-color_range", "colorRange")):
        if info.get(key) and info[key] != "unknown":
            args += [flag, info[key]]
    return args, ext


def _audio_args(info: dict, ext: str) -> list[str]:
    if not info["acodec"]:
        return []
    if ext == ".mov" or info["acodec"] in MP4_AUDIO:
        return ["-c:a", "copy"]
    return ["-c:a", "aac", "-b:a", "320k"]


def _escape_filter_path(p: str) -> str:
    return p.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def reframe_filter(r: dict) -> str:
    """The picture reframed into another format, as in static/js/engine/reframe.js:
    cropped to fill (focus fx, fy) or fitted over a blurred, darkened copy."""
    w, h = r["width"], r["height"]
    if r.get("mode") == "fit":
        bw, bh = max(8, round(w / 24)), max(8, round(h / 24))
        return (f"[0:v:0]split[s1][s2];[s1]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},"
                f"scale={w}:{h}:flags=bicubic,boxblur=2:1,colorchannelmixer=rr=0.72:gg=0.72:bb=0.72[bg];"
                f"[s2]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base];")
    fx, fy = r.get("fx", 0.5), r.get("fy", 0.5)
    return (f"[0:v:0]scale={w}:{h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h}:(iw-{w})*{fx:.4f}:(ih-{h})*{fy:.4f},setsar=1[base];")


def burn(src: str, ass_name: str, dest: str, info: dict, venc: list[str], cwd: str,
         progress: Callable[[float], None], on_start: Callable | None = None,
         overlay: dict | None = None, reframe: dict | None = None) -> None:
    """Draw the captions (and the watermark overlay, if any, under them) into the
    video, reframed into another format if asked."""
    ext = "." + dest.rsplit(".", 1)[1]
    ass = f"ass={ass_name}:fontsdir='{_escape_filter_path(str(FONTS_DIR))}'"
    if overlay or reframe:
        graph, video_in = "", "[0:v:0]"
        if reframe:
            graph += reframe_filter(reframe)
            video_in = "[base]"
        extra = []
        if overlay:
            o = overlay
            graph += (f"[1:v]scale={o['w']}:{o['h']},format=rgba,colorchannelmixer=aa={o['alpha']:.3f}[wm];"
                      f"{video_in}[wm]overlay={o['x']}:{o['y']}:format=auto[ov];")
            video_in = "[ov]"
            extra = ["-i", o["path"]]
        graph += f"{video_in}{ass}[v]"
        video = [*extra, "-map", "[v]", "-map", "0:a?", "-filter_complex", graph]
    else:
        video = ["-map", "0:v:0", "-map", "0:a?", "-vf", ass]
    cmd = ["ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
           *IN_THREADS, "-i", src, *video, *OUT_THREADS, *venc,
           "-fps_mode", "passthrough", *_audio_args(info, ext),
           "-map_metadata", "0", "-movflags", "+faststart", dest]
    _run_with_progress(cmd, info["duration"], progress, cwd, on_start)


def mux_soft(src: str, srt: str, dest: str, info: dict, lang3: str) -> None:
    ext = "." + dest.rsplit(".", 1)[1]
    scodec = "srt" if ext == ".mkv" else "mov_text"
    _run(["ffmpeg", "-y", "-v", "error", "-i", src, "-i", srt, "-map", "0:v:0", "-map", "0:a?",
          "-map", "1:0", "-c:v", "copy", *_audio_args(info, ext), "-c:s", scodec,
          "-metadata:s:s:0", f"language={lang3}", "-disposition:s:0", "default",
          "-map_metadata", "0", *(["-movflags", "+faststart"] if ext != ".mkv" else []), dest])


def _run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise MediaError(_last_error(r.stderr))


class Cancelled(MediaError):
    pass


def _run_with_progress(cmd, duration, progress, cwd, on_start=None) -> None:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            cwd=cwd)
    if on_start:
        on_start(proc)
    for line in proc.stdout:
        m = re.match(r"out_time_us=(\d+)", line)
        if m and duration:
            progress(min(int(m.group(1)) / 1e6 / duration, 0.995))
    err = proc.stderr.read()
    code = proc.wait()
    if code < 0:
        raise Cancelled("Export cancelled.")
    if code != 0:
        raise MediaError(_last_error(err))


def _last_error(stderr: str) -> str:
    lines = [ln for ln in stderr.strip().splitlines() if ln.strip()]
    return "ffmpeg failed: " + (lines[-1][:300] if lines else "unknown error")


def waveform(src: str, rate: int = 50) -> list[float]:
    """Peak level of the audio, `rate` values per second (0..1), for the timeline."""
    window = 8000 // rate
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-af",
                        f"aformat=channel_layouts=mono,aresample=8000,asetnsamples=n={window}:p=0,"
                        "astats=metadata=1:reset=1,"
                        "ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-", "-f", "null", "-"],
                       capture_output=True, text=True)
    peaks = []
    for line in r.stdout.splitlines():
        if line.startswith("lavfi.astats.Overall.Peak_level="):
            v = line.split("=", 1)[1]
            try:
                db = float(v)
            except ValueError:
                db = -120.0
            peaks.append(round(max(0.0, min(1.0, 10 ** (db / 20))), 3))
    return peaks
