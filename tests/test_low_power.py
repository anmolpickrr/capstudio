"""LOW_POWER=1 (Render's free plan): low-memory encoder settings, HEVC exported as
H.264, burn-in limited to 1080p. Run in a subprocess because the mode is read at import."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
import json
from server import media
hevc = {"vcodec": "hevc", "pixFmt": "yuv420p10le"}
h264 = {"vcodec": "h264", "pixFmt": "yuv420p"}
print(json.dumps({
    "low": media.LOW_POWER,
    "hevc": media.output_plan(hevc, ".mov", "high"),
    "h264": media.output_plan(h264, ".mp4", "high"),
    "reel": media.too_large_to_burn({"width": 1080, "height": 1920}),
    "uhd": media.too_large_to_burn({"width": 3840, "height": 2160}),
}))
"""


def run(low: bool) -> dict:
    env = {**os.environ, "LOW_POWER": "1" if low else "0"}
    out = subprocess.run([sys.executable, "-c", SCRIPT], cwd=ROOT, env=env,
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_low_power_plan():
    r = run(True)
    assert r["low"] is True
    args, ext = r["hevc"]
    assert args[:2] == ["-c:v", "libx264"] and ext == ".mov"
    assert args[args.index("-pix_fmt") + 1] == "yuv420p"
    assert "rc-lookahead=5:bframes=2:ref=2" in r["h264"][0]
    assert r["reel"] is False and r["uhd"] is True


def test_full_power_plan_unchanged():
    r = run(False)
    assert r["low"] is False
    args, _ = r["hevc"]
    assert args[:2] == ["-c:v", "libx265"]
    assert args[args.index("-pix_fmt") + 1] == "yuv420p10le"
    assert "-x264-params" not in r["h264"][0]
    assert r["uhd"] is False


def test_keep_awake_pings_its_own_address(monkeypatch):
    from server import main
    calls = []

    class Stop(Exception):
        pass

    def fake_sleep(_):
        if calls:
            raise Stop
    monkeypatch.setattr(main.time, "sleep", fake_sleep)
    monkeypatch.setattr(main.urllib.request, "urlopen",
                        lambda url, timeout: calls.append(url) or type("R", (), {"read": lambda self: b""})())
    try:
        main.keep_awake("https://example.onrender.com/")
    except Stop:
        pass
    assert calls == ["https://example.onrender.com/api/health"]
