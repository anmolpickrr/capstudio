import os
import pathlib
import time

import pytest

from server import main, media
from server.spelling import convert_word
from server.transcribe import romanize_devanagari


def test_spelling_variants():
    assert convert_word("Organized,", "en-GB") == "Organised,"
    assert convert_word("COLOUR", "en-US") == "COLOR"
    assert convert_word("favorite", "en-GB") == "favourite"
    assert convert_word("program", "en-GB") == "program"


def test_hinglish_romanisation():
    assert " ".join(romanize_devanagari(w) for w in "यह बहुत आसान है".split()) == "yah bahut aasaan hai"
    assert romanize_devanagari("hello") == "hello"


@pytest.mark.parametrize("info,ext,expect", [
    ({"vcodec": "h264", "pixFmt": "yuv420p"}, ".mp4", ("libx264", ".mp4")),
    ({"vcodec": "hevc", "pixFmt": "yuv420p10le"}, ".mp4", ("libx265", ".mp4")),
    ({"vcodec": "prores", "pixFmt": "yuv422p10le", "profile": "HQ"}, ".mov", ("prores_ks", ".mov")),
    ({"vcodec": "vp9", "pixFmt": "yuv420p"}, ".webm", ("libx264", ".mp4")),
])
def test_encoder_matches_source(info, ext, expect):
    args, out_ext = media.output_plan(info, ext, "high")
    assert (args[args.index("-c:v") + 1], out_ext) == expect
    if info["pixFmt"].endswith("10le"):
        assert args[args.index("-pix_fmt") + 1] == info["pixFmt"]


def test_sweeper_keeps_uploads_in_progress():
    """Regression: folders of uploads still streaming in were deleted after ~60s."""
    main.prepare_data_dir()
    job_id = "a" * 32
    d = main.DATA_DIR / job_id
    d.mkdir()
    old = time.time() - 600
    os.utime(d, (old, old))
    main.uploading.add(job_id)
    main.sweep_once(time.time())
    assert d.exists()
    main.uploading.discard(job_id)
    main.sweep_once(time.time())
    assert not d.exists()


def test_sweeper_ignores_foreign_files():
    main.prepare_data_dir()
    other = main.DATA_DIR / "not-a-job"
    other.mkdir()
    os.utime(other, (0, 0))
    main.sweep_once(time.time())
    assert other.exists()
    other.rmdir()


def test_refuses_foreign_data_dir(tmp_path, monkeypatch):
    (tmp_path / "important.txt").write_text("keep me")
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    with pytest.raises(RuntimeError):
        main.prepare_data_dir()
    assert (tmp_path / "important.txt").exists()


def test_cleans_own_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    (tmp_path / main.MARKER).touch()
    stale = tmp_path / ("b" * 32)
    stale.mkdir()
    main.prepare_data_dir()
    assert not stale.exists()


def test_job_expiry_after_download(monkeypatch):
    job = main.Job(id="c" * 32, dir=pathlib.Path("/nonexistent"), name="x.mp4",
                   source=pathlib.Path("/nonexistent/x.mp4"))
    job.downloaded = time.time()
    assert job.expires_at() == pytest.approx(job.downloaded + main.DOWNLOAD_GRACE_MIN * 60)
