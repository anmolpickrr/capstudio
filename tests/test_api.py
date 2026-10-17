"""API behaviour: upload, waveform, export cancel/cleanup, and demo projects."""
import os
import pathlib
import subprocess
import time

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


@pytest.mark.skipif(not (main.DEMO_DIR / "index.json").exists(), reason="demo assets not built")
def test_demo_projects(client):
    demos = client.get("/api/demo").json()
    assert len(demos) >= 3 and all(d["info"]["duration"] > 5 for d in demos)
    r = client.post(f"/api/demo/{demos[0]['id']}/project").json()
    assert r["transcript"]["prepared"] is True and r["transcript"]["words"]
    assert (main.DATA_DIR / r["id"] / "source.mp4").exists()
    assert client.post("/api/demo/nope/project").status_code == 404


def test_session_cookie_secure_on_spaces():
    # On Hugging Face the SPACE_HOST variable is set and cookies must be Secure.
    assert ("SPACE_HOST" in os.environ) == bool(os.environ.get("SPACE_HOST"))
