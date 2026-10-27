"""API behaviour: upload, waveform, export cancel/cleanup, and export file names."""
import os
import pathlib
import subprocess
import time
import urllib.parse

import pytest
from fastapi.testclient import TestClient

from server import main

MEDIA = pathlib.Path(__file__).parent / "media"


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    path = tmp_path_factory.mktemp("v") / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=20",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", str(path)], check=True)
    return path


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_DISABLED", "1")
    with TestClient(main.app) as c:
        yield c


def upload(client, path):
    r = client.post("/api/jobs", content=path.read_bytes(), headers={"X-Filename": "clip.mp4"})
    assert r.status_code == 200, r.text
    return r.json()


def test_upload_and_waveform(client, video):
    job = upload(client, video)
    assert job["info"]["width"] == 640 and job["info"]["acodec"] == "aac"
    w = client.get(f"/api/jobs/{job['id']}/waveform").json()
    assert w["rate"] == 50 and 900 < len(w["peaks"]) < 1100
    assert max(w["peaks"]) > 0.05  # the test tone is audible


def test_export_cancel_leaves_no_partial_file(client, video):
    job = upload(client, video)
    ass = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\n"
           "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
           "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
           "MarginR, MarginV, Encoding\nStyle: W,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,"
           "1,0,0,2,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
           "Dialogue: 0,0:00:00.00,0:00:20.00,W,,0,0,0,,{\\an2\\pos(320,340)}hello\n")
    client.post(f"/api/jobs/{job['id']}/render", json={"mode": "burn", "ass": ass, "quality": "max"})
    for _ in range(100):
        st = client.get(f"/api/jobs/{job['id']}").json()["render"]["status"]
        if st == "running":
            break
        time.sleep(0.05)
    client.post(f"/api/jobs/{job['id']}/render/cancel")
    for _ in range(100):
        st = client.get(f"/api/jobs/{job['id']}").json()["render"]
        if st["status"] in ("cancelled", "done"):
            break
        time.sleep(0.1)
    assert st["status"] == "cancelled"
    assert not list((main.DATA_DIR / job["id"]).glob("output.*"))
    assert client.get(f"/api/jobs/{job['id']}/download").status_code == 404


def test_rejects_non_video(client, tmp_path):
    bad = tmp_path / "notes.mp4"
    bad.write_text("not a video")
    r = client.post("/api/jobs", content=bad.read_bytes(), headers={"X-Filename": "notes.mp4"})
    assert r.status_code == 400
    assert not [d for d in main.DATA_DIR.iterdir() if d.is_dir() and d.name not in main.jobs]


def test_config_flags_unsupported_languages(client):
    langs = client.get("/api/config").json()["languages"]
    odia = next(lang for lang in langs if lang["id"] == "or")
    assert odia.get("unsupported") is True
    assert any(lang["id"] == "hinglish-roman" for lang in langs)


@pytest.mark.parametrize("original, ext, expected", [
    ("Diwali sale reel (final).mp4", ".mp4", "Diwali sale reel (final).mp4"),
    ("Interview.MOV", ".mov", "Interview.MOV"),
    ("clip.webm", ".mp4", "clip.mp4"),
    ("बिक्री वीडियो.mp4", ".mp4", "बिक्री वीडियो.mp4"),
])
def test_exports_keep_the_original_name(original, ext, expected):
    assert main.export_name(main.clean_name(original), ext) == expected


def test_upload_name_is_cleaned_not_replaced():
    assert main.clean_name("C:\\Users\\me\\My: reel?.mp4") == "My reel.mp4"
    assert main.clean_name("../../etc/passwd") == "passwd"
    assert main.clean_name("") == "video.mp4"


def test_downloaded_export_has_the_original_name(client, video):
    r = client.post("/api/jobs", content=video.read_bytes(),
                    headers={"X-Filename": urllib.parse.quote("Summer launch (v2).mp4")})
    job = r.json()
    assert job["name"] == "Summer launch (v2).mp4"
    srt = "1\n00:00:00,000 --> 00:00:02,000\nHello\n"
    client.post(f"/api/jobs/{job['id']}/render", json={"mode": "soft", "srt": srt})
    for _ in range(100):
        state = client.get(f"/api/jobs/{job['id']}").json()["render"]
        if state["status"] in ("done", "error"):
            break
        time.sleep(0.1)
    assert state["status"] == "done" and state["file"] == "Summer launch (v2).mp4"
    d = client.get(f"/api/jobs/{job['id']}/download")
    assert "Summer%20launch%20%28v2%29.mp4" in d.headers["content-disposition"] or \
        'filename="Summer launch (v2).mp4"' in d.headers["content-disposition"]
    client.delete(f"/api/jobs/{job['id']}")


def test_session_cookie_secure_on_spaces():
    # On Hugging Face the SPACE_HOST variable is set and cookies must be Secure.
    assert ("SPACE_HOST" in os.environ) == bool(os.environ.get("SPACE_HOST"))


def test_app_files_have_versioned_addresses(client):
    """Each release loads its scripts from new addresses, so no browser can run an old
    cached script against a new page."""
    r = client.get("/")
    assert r.headers["cache-control"] == "no-cache"
    v = main.APP_VERSION
    assert f'src="/v/{v}/js/app/main.js"' in r.text and f'href="/v/{v}/css/studio.css"' in r.text
    js = client.get(f"/v/{v}/js/app/main.js")
    assert js.status_code == 200 and "immutable" in js.headers["cache-control"]
    assert "javascript" in js.headers["content-type"]
    assert client.get("/v/old/js/app/main.js").headers["cache-control"] == "no-cache"
    assert client.get(f"/v/{v}/../server/main.py").status_code == 404
    assert client.get(f"/v/{v}/%2e%2e/server/main.py").status_code == 404


def test_browser_export_starts_the_download_grace(client, video):
    job = upload(client, video)
    r = client.post(f"/api/jobs/{job['id']}/downloaded")
    assert r.status_code == 200
    j = main.jobs[job["id"]]
    assert j.expires_at() == pytest.approx(j.downloaded + main.DOWNLOAD_GRACE_MIN * 60)
    assert main.DOWNLOAD_GRACE_MIN == 20


@pytest.mark.parametrize("w,h,fmt,size,expect", [
    (1080, 1920, "auto", 100, ("9x16", 0, 0, 1080, 1920)),
    (1080, 1080, "auto", 100, ("1x1", 0, 0, 1080, 1080)),
    (1920, 1080, "auto", 50, ("1x1", 690, 270, 540, 540)),
    (1080, 1920, "1x1", 100, ("1x1", 0, 420, 1080, 1080)),
])
def test_watermark_placement(w, h, fmt, size, expect):
    o = main.watermark_overlay(main.Watermark(format=fmt, size=size), w, h)
    assert o["path"].endswith(f"fastrr-light-{expect[0]}.png") and pathlib.Path(o["path"]).exists()
    assert (o["x"], o["y"], o["w"], o["h"]) == expect[1:]


def test_server_export_with_watermark(client, video):
    job = upload(client, video)
    ass = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\n"
           "Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment\nStyle: D,Inter,40,&H00FFFFFF,1,2\n\n"
           "[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:05.00,D,Hello\n")
    r = client.post(f"/api/jobs/{job['id']}/render", json={"mode": "burn", "quality": "fast", "ass": ass,
                                                         "watermark": {"tone": "dark", "size": 60, "opacity": 50}})
    assert r.status_code == 200, r.text
    for _ in range(600):
        st = client.get(f"/api/jobs/{job['id']}").json()["render"]
        if st["status"] in ("done", "error"):
            break
        time.sleep(0.1)
    assert st["status"] == "done", st


def test_panel_download(client):
    import io
    import zipfile
    r = client.get("/panel/capstudio-panel.zip")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert {"CSXS/manifest.xml", "index.html", "bridge.js", "host/host.jsx"} <= names
    assert not any(n.startswith("install/") for n in names)
    # the panel points at the server it was downloaded from
    assert b'data-site="http://testserver"' in z.read("index.html")
    assert b'Host Name="AEFT"' in z.read("CSXS/manifest.xml") and b'Host Name="PPRO"' in z.read("CSXS/manifest.xml")
    for kind in ("ps1", "sh"):
        text = client.get(f"/panel/install.{kind}").text
        assert "'http://testserver'" in text and "/panel/capstudio-panel.zip" in text and "__SITE__" not in text
        assert "PlayerDebugMode" in text
    assert client.get("/panel/install.exe").status_code == 404
    # the first links handed out still work
    assert client.get("/premiere/capstudio-premiere.zip").content == r.content
    assert client.get("/premiere/install.sh").text == client.get("/panel/install.sh").text


@pytest.mark.parametrize("mode", ["fill", "fit"])
def test_server_export_in_another_format(client, video, mode):
    """The server reframes the 16:9 test clip into 9:16, named after the format."""
    job = upload(client, video)
    ass = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\n"
           "Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment\nStyle: D,Inter,30,&H00FFFFFF,1,2\n\n"
           "[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:05.00,D,Hello\n")
    r = client.post(f"/api/jobs/{job['id']}/render", json={"mode": "burn", "quality": "fast", "ass": ass,
                                                         "reframe": {"width": 360, "height": 640, "mode": mode, "fx": 0.2, "suffix": "9x16"}})
    assert r.status_code == 200, r.text
    for _ in range(600):
        st = client.get(f"/api/jobs/{job['id']}").json()["render"]
        if st["status"] in ("done", "error"):
            break
        time.sleep(0.1)
    assert st["status"] == "done", st
    assert st["file"] == "clip 9x16.mp4"
    out = main.jobs[job["id"]].output
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout.strip()
    assert probe == "360,640"


def test_editor_page(client):
    r = client.get("/edit")
    assert r.status_code == 200 and "Capstudio Editor" in r.text
    # its scripts and styles come from this release's versioned address
    assert '/v/' in r.text and 'src="js/' not in r.text and 'href="css/' not in r.text
    assert client.get("/edit.html").status_code == 200


def test_timeline_rebuilt_from_its_clips(client, video):
    """A Premiere/After Effects timeline: clips from one file, a muted gap, sound from two
    places at once, sent once and rebuilt as one video over the timeline's full length."""
    import time as _t
    data = video.read_bytes()
    spec = {"name": "Reel", "width": 1080, "height": 1920, "fps": 25, "duration": 9,
            "files": [{"name": "clip.mp4", "size": len(data)}],
            "segments": [{"file": 0, "kind": "video", "start": 0, "end": 4, "inPoint": 2, "track": 0},
                         {"file": 0, "kind": "video", "start": 5, "end": 9, "inPoint": 10, "speed": 2, "track": 0},
                         {"file": 0, "kind": "audio", "start": 0, "end": 4, "inPoint": 2},
                         {"file": 0, "kind": "audio", "start": 5, "end": 9, "inPoint": 10, "speed": 2}]}
    assert client.post("/api/timelines", json={**spec, "segments": spec["segments"][:2]}).status_code == 400  # no sound
    tl = client.post("/api/timelines", json=spec).json()
    assert client.post(f"/api/timelines/{tl['id']}/build").status_code == 400  # files not sent yet
    assert client.post(f"/api/timelines/{tl['id']}/files/0", content=data).json()["received"] == [0]
    client.post(f"/api/timelines/{tl['id']}/build")
    for _ in range(300):
        s = client.get(f"/api/timelines/{tl['id']}").json()
        if s["build"]["status"] in ("done", "error"):
            break
        _t.sleep(0.2)
    assert s["build"]["status"] == "done", s["build"]["error"]
    assert s["used"]["video"] == 2 and s["used"]["audio"] == 2
    info = s["job"]["info"]
    assert abs(info["duration"] - 9) < 0.1 and info["acodec"] and info["width"] * 1920 == info["height"] * 1080
    # the rebuilt video is a job like any upload
    assert client.get(f"/api/jobs/{s['job']['id']}").status_code == 200
