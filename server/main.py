"""Caption Panel API.

Everything a job produces lives in DATA_DIR/<job-id>/ and is removed by the
retention sweeper:
  * DOWNLOAD_GRACE_MIN after the first download of a finished video,
  * JOB_TTL_MIN after the job was last touched, whatever its state,
  * immediately when the editor clicks "Delete now" or closes the tab,
  * on server start (nothing survives a restart).
Uploaded media and transcripts are never written anywhere else and never logged.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import pathlib
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from . import auth, media, transcribe
from .fonts import FONTS_DIR, catalogue

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("captions")

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = pathlib.Path(os.environ.get("DATA_DIR") or pathlib.Path(tempfile.gettempdir()) / "caption-panel")
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "4096"))
JOB_TTL_MIN = float(os.environ.get("JOB_TTL_MIN", "120"))
DOWNLOAD_GRACE_MIN = float(os.environ.get("DOWNLOAD_GRACE_MIN", "15"))
SWEEP_SECONDS = 30

# Hosted engines handle several videos at once; the on-server model one at a time.
transcribe_pool = ThreadPoolExecutor(int(os.environ.get(
    "TRANSCRIBE_CONCURRENCY", "3" if transcribe.ENGINE in transcribe.HOSTED else "1")))
render_pool = ThreadPoolExecutor(int(os.environ.get("RENDER_CONCURRENCY", "2")))


@dataclass
class Task:
    status: str = "idle"  # idle | queued | running | done | error
    progress: float = 0.0
    error: str | None = None
    started: float | None = None
    finished: float | None = None
    queued_at: float = field(default_factory=time.time)

    def public(self, ahead: int = 0) -> dict:
        return {"status": self.status, "progress": round(self.progress, 3), "error": self.error,
                "elapsed": round((self.finished or time.time()) - self.started, 1)
                if self.started else None, "ahead": ahead}


@dataclass
class Job:
    id: str
    dir: pathlib.Path
    name: str
    source: pathlib.Path
    owner: str = ""
    info: dict = field(default_factory=dict)
    touched: float = field(default_factory=time.time)
    downloaded: float | None = None
    transcript: dict | None = None
    transcription: Task = field(default_factory=Task)
    render: Task = field(default_factory=Task)
    output: pathlib.Path | None = None
    output_name: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    proc: object = None          # running ffmpeg export, so it can be cancelled
    cancel_requested: bool = False

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "info": self.info,
            "transcription": self.transcription.public(queue_ahead(self, "transcription")),
            "transcript": self.transcript if self.transcription.status == "done" else None,
            "render": {**self.render.public(queue_ahead(self, "render")), "file": self.output_name,
                       "size": self.output.stat().st_size if self.render.status == "done" and self.output
                       and self.output.exists() else None},
            "expiresAt": self.expires_at(),
        }

    def expires_at(self) -> float:
        t = self.touched + JOB_TTL_MIN * 60
        if self.downloaded:
            t = min(t, self.downloaded + DOWNLOAD_GRACE_MIN * 60)
        return t


jobs: dict[str, Job] = {}
jobs_lock = threading.Lock()
# Job ids whose upload is still streaming in; their folders are not orphans.
uploading: set[str] = set()

JOB_DIR_NAME = re.compile(r"^[0-9a-f]{32}$")
MARKER = ".caption-panel"


def queue_ahead(job: Job, kind: str) -> int:
    """How many queued videos will start before this one."""
    mine = getattr(job, kind)
    if mine.status != "queued":
        return 0
    return sum(1 for other in list(jobs.values())
               if other is not job and getattr(other, kind).status == "queued"
               and getattr(other, kind).queued_at < mine.queued_at)


def get_job(job_id: str, request: Request) -> Job:
    job = jobs.get(job_id)
    user = auth.current_user(request)
    if job and user and job.owner and job.owner != user["email"]:
        job = None  # someone else's job looks exactly like a missing one
    if not job:
        raise HTTPException(404, "This job has expired or was deleted. Please upload the video again.")
    job.touched = time.time()
    return job


def delete_job(job_id: str, reason: str) -> None:
    with jobs_lock:
        job = jobs.pop(job_id, None)
    if job:
        shutil.rmtree(job.dir, ignore_errors=True)
        log.info("deleted job %s (%s)", job_id, reason)


def sweep_once(now: float) -> None:
    for job in list(jobs.values()):
        busy = job.render.status == "running" or job.transcription.status == "running"
        if now > job.expires_at() and not busy:
            delete_job(job.id, "retention")
    # A job folder with no job behind it (e.g. a failed request) is an orphan.
    # Only folders named like job ids are ever touched.
    for d in DATA_DIR.iterdir() if DATA_DIR.exists() else []:
        if (JOB_DIR_NAME.match(d.name) and d.name not in jobs and d.name not in uploading
                and now - d.stat().st_mtime > 60):
            shutil.rmtree(d, ignore_errors=True)


def sweeper() -> None:
    while True:
        time.sleep(SWEEP_SECONDS)
        try:
            sweep_once(time.time())
        except Exception:  # noqa: BLE001 - the sweeper must never die
            log.exception("retention sweep failed")


def prepare_data_dir() -> None:
    """Empty DATA_DIR of old jobs, refusing to touch a folder we don't own.

    A marker file identifies the folder as ours. An existing, non-empty folder
    without the marker (say DATA_DIR=/tmp by mistake) stops the server instead
    of being wiped.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    entries = [e for e in DATA_DIR.iterdir() if e.name != MARKER]
    if entries and not (DATA_DIR / MARKER).exists():
        raise RuntimeError(
            f"DATA_DIR {DATA_DIR} is not empty and was not created by Caption Panel. "
            "Point DATA_DIR at an empty, dedicated folder.")
    (DATA_DIR / MARKER).touch()
    for e in entries:
        if e.is_dir() and JOB_DIR_NAME.match(e.name):
            shutil.rmtree(e, ignore_errors=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    prepare_data_dir()
    threading.Thread(target=sweeper, daemon=True).start()
    threading.Thread(target=catalogue, daemon=True).start()  # first page load needs it
    transcribe.warm_up()
    yield


app = FastAPI(title="Caption Panel", docs_url=None, redoc_url=None, lifespan=lifespan)
app.middleware("http")(auth.guard)
# Added last so it runs first: the guard needs the session.
app.add_middleware(SessionMiddleware, secret_key=auth.SESSION_SECRET, session_cookie="caption_panel",
                   max_age=14 * 24 * 3600, same_site="lax",
                   https_only=bool(os.environ.get("SPACE_HOST") or os.environ.get("RENDER_EXTERNAL_URL")
                                   or os.environ.get("PUBLIC_URL", "").startswith("https")))
app.include_router(auth.router)


@app.get("/login")
def login_page():
    return FileResponse(ROOT / "static" / "login.html")


# ------------------------------------------------------------------ config


@app.get("/api/config")
def config():
    return {
        "engine": transcribe.ENGINE,
        "model": transcribe.HOSTED[transcribe.ENGINE][1] if transcribe.ENGINE in transcribe.HOSTED
        else transcribe.WHISPER_MODEL,
        "languages": [{"id": i, "label": label, "group": g} for i, _, label, g in transcribe.LANGUAGES]
        + [{"id": u, "label": label, "group": "Indian", "unsupported": True} for u, label in transcribe.UNSUPPORTED],
        "maxUploadMB": MAX_UPLOAD_MB,
        "lowPower": media.LOW_POWER,
        "maxBurnPixels": media.MAX_BURN_PIXELS,
        "retention": {"jobTtlMin": JOB_TTL_MIN, "downloadGraceMin": DOWNLOAD_GRACE_MIN},
    }


@app.get("/api/health")
def health():
    # RENDER_GIT_COMMIT is set by Render: shows which version of the code is live
    version = os.environ.get("RENDER_GIT_COMMIT", "")[:7] or None
    return {"status": "ok", "version": version, "jobs": len(jobs), **transcribe.model_status()}


@app.get("/api/fonts")
def fonts():
    return catalogue()


# -------------------------------------------------------------------- jobs

SAFE_NAME = re.compile(r"[^\w.\- ]+", re.UNICODE)
UNSAFE_IN_NAME = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')


def clean_name(filename: str) -> str:
    """The uploaded file's own name, minus anything that can't be in a file name."""
    base = re.split(r"[/\\]", filename)[-1]
    name = UNSAFE_IN_NAME.sub("", base).strip(" .")[:200]
    return name if pathlib.Path(name).stem else "video.mp4"


def export_name(original: str, ext: str) -> str:
    """Exports keep the original name; the extension changes only with the format."""
    path = pathlib.Path(original)
    return original if path.suffix.lower() == ext.lower() else f"{path.stem}{ext}"


@app.post("/api/jobs")
async def create_job(request: Request):
    # The name travels in a header, not the URL, so access logs never record it.
    filename = urllib.parse.unquote(request.headers.get("x-filename", "")) or "video.mp4"
    name = clean_name(filename)
    ext = SAFE_NAME.sub("_", pathlib.Path(name).suffix.lower())[:10] or ".mp4"
    job_id = uuid.uuid4().hex
    jdir = DATA_DIR / job_id
    uploading.add(job_id)
    jdir.mkdir(parents=True)
    src = jdir / f"source{ext}"
    limit = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with open(src, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
                f.write(chunk)
        info = media.probe(str(src))
    except media.MediaError as e:
        shutil.rmtree(jdir, ignore_errors=True)
        raise HTTPException(400, str(e))
    except BaseException:
        shutil.rmtree(jdir, ignore_errors=True)
        raise
    finally:
        uploading.discard(job_id)
    user = auth.current_user(request)
    job = Job(id=job_id, dir=jdir, name=name, source=src, info=info, owner=user["email"] if user else "")
    with jobs_lock:
        jobs[job_id] = job
    log.info("job %s created (%.1f MB, %sx%s)", job_id, size / 1e6, info["width"], info["height"])
    return job.public()


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str, request: Request):
    return get_job(job_id, request).public()


@app.delete("/api/jobs/{job_id}")
@app.post("/api/jobs/{job_id}/delete")  # sendBeacon from a closing tab can only POST
def remove_job(job_id: str, request: Request):
    get_job(job_id, request)
    delete_job(job_id, "requested by editor")
    return {"deleted": True}


@app.get("/api/jobs/{job_id}/source")
def job_source(job_id: str, request: Request):
    job = get_job(job_id, request)
    return FileResponse(job.source)


@app.get("/api/jobs/{job_id}/proxy")
def job_proxy(job_id: str, request: Request):
    job = get_job(job_id, request)
    proxy = job.dir / "preview.mp4"
    with job.lock:
        if not proxy.exists():
            media.make_proxy(str(job.source), str(proxy))
    return FileResponse(proxy, media_type="video/mp4")


# ----------------------------------------------------------- transcription


class TranscribeReq(BaseModel):
    language: str = "auto"
    vocabulary: str = Field("", max_length=4000)


@app.post("/api/jobs/{job_id}/transcribe")
def start_transcription(job_id: str, req: TranscribeReq, request: Request):
    job = get_job(job_id, request)
    if req.language not in transcribe.LANG_INDEX:
        raise HTTPException(400, "Unsupported language")
    if job.transcription.status in ("queued", "running"):
        raise HTTPException(409, "Captions are already being generated.")
    if not job.info.get("acodec"):
        raise HTTPException(400, "This video has no audio track to caption.")
    job.transcription = Task(status="queued")
    transcribe_pool.submit(_run_transcription, job, req)
    return job.public()


def _run_transcription(job: Job, req: TranscribeReq) -> None:
    task = job.transcription
    task.status, task.started = "running", time.time()
    mp3 = transcribe.ENGINE in transcribe.HOSTED
    audio = job.dir / ("audio.mp3" if mp3 else "audio.wav")
    try:
        media.extract_audio(str(job.source), str(audio), mp3=mp3)
        task.progress = 0.03

        def progress(p: float) -> None:
            task.progress = 0.03 + 0.97 * p
            job.touched = time.time()

        job.transcript = transcribe.transcribe(str(audio), job.info["duration"], req.language,
                                               req.vocabulary, progress)
        task.progress, task.status = 1.0, "done"
    except Exception as e:  # noqa: BLE001 - surfaced to the editor
        log.exception("transcription failed for job %s", job.id)
        task.status, task.error = "error", str(e)
    finally:
        task.finished = time.time()
        audio.unlink(missing_ok=True)


# ---------------------------------------------------------------- render


class RenderReq(BaseModel):
    mode: str = Field("burn", pattern="^(burn|soft)$")
    ass: str = Field("", max_length=20_000_000)
    ass_gz: str = Field("", max_length=60_000_000)  # base64 gzip of the ASS script
    srt: str = Field("", max_length=20_000_000)
    quality: str = Field("high", pattern="^(max|high|fast)$")
    language: str = "und"


ISO3 = {"en": "eng", "hi": "hin", "bn": "ben", "ta": "tam", "te": "tel", "mr": "mar", "gu": "guj",
        "kn": "kan", "ml": "mal", "pa": "pan", "ur": "urd", "as": "asm", "ne": "nep", "ar": "ara",
        "zh": "zho", "fr": "fra", "de": "deu", "es": "spa", "pt": "por", "ja": "jpn", "ko": "kor",
        "ru": "rus", "it": "ita", "nl": "nld", "tr": "tur", "id": "ind", "ms": "msa", "th": "tha",
        "vi": "vie", "sa": "san", "sd": "snd"}


@app.post("/api/jobs/{job_id}/render")
def start_render(job_id: str, req: RenderReq, request: Request):
    job = get_job(job_id, request)
    if job.render.status in ("queued", "running"):
        raise HTTPException(409, "A render is already in progress.")
    if req.ass_gz:
        req.ass = _gunzip(req.ass_gz)
    if req.mode == "burn" and not req.ass.startswith("[Script Info]"):
        raise HTTPException(400, "Invalid caption data.")
    if req.mode == "burn" and media.too_large_to_burn(job.info):
        raise HTTPException(400, "This server can draw captions into videos up to 1080p. "
                                 "For larger videos, export with a subtitle track or download caption files.")
    if req.mode == "soft" and not req.srt.strip():
        raise HTTPException(400, "There are no captions to embed.")
    job.render = Task(status="queued")
    job.downloaded = None
    job.cancel_requested = False
    render_pool.submit(_run_render, job, req)
    return job.public()


def _gunzip(data: str, limit: int = 400_000_000) -> str:
    try:
        d = zlib.decompressobj(wbits=31)
        raw = d.decompress(base64.b64decode(data), limit)
        if d.unconsumed_tail:
            raise HTTPException(413, "The caption data is too large.")
        return raw.decode("utf-8")
    except (ValueError, zlib.error, UnicodeDecodeError):
        raise HTTPException(400, "Invalid caption data.")


@app.post("/api/jobs/{job_id}/render/cancel")
def cancel_render(job_id: str, request: Request):
    job = get_job(job_id, request)
    job.cancel_requested = True
    proc = job.proc
    if proc is not None and proc.poll() is None:
        proc.terminate()
    if job.render.status == "queued":
        job.render.status = "cancelled"
    return job.public()


def _run_render(job: Job, req: RenderReq) -> None:
    task = job.render
    if job.cancel_requested or task.status == "cancelled":
        task.status = "cancelled"
        return
    task.status, task.started = "running", time.time()
    src_ext = job.source.suffix
    try:
        if job.output:
            job.output.unlink(missing_ok=True)
        if req.mode == "burn":
            (job.dir / "captions.ass").write_text(req.ass, encoding="utf-8")
            venc, ext = media.output_plan(job.info, src_ext, req.quality)
            out = job.dir / f"output{ext}"

            def progress(p: float) -> None:
                task.progress = p
                job.touched = time.time()

            media.burn(str(job.source), "captions.ass", str(out), job.info, venc, str(job.dir),
                       progress, on_start=lambda p: _export_started(job, p))
            job.output_name = export_name(job.name, ext)
        else:
            (job.dir / "captions.srt").write_text(req.srt, encoding="utf-8")
            ext = src_ext.lower() if src_ext.lower() in (".mov", ".mkv") else ".mp4"
            out = job.dir / f"output{ext}"
            media.mux_soft(str(job.source), str(job.dir / "captions.srt"), str(out), job.info,
                           ISO3.get(req.language.split("-")[0], "und"))
            job.output_name = export_name(job.name, ext)
        job.output = out
        task.progress, task.status = 1.0, "done"
    except media.Cancelled:
        task.status = "cancelled"
        _discard_output(job)
    except Exception as e:  # noqa: BLE001
        log.exception("render failed for job %s", job.id)
        task.status, task.error = "error", str(e)
        _discard_output(job)
    finally:
        job.proc = None
        task.finished = time.time()


def _export_started(job: Job, proc) -> None:
    job.proc = proc
    if job.cancel_requested:  # cancelled just before ffmpeg started
        proc.terminate()


def _discard_output(job: Job) -> None:
    """A failed or cancelled export leaves no partial file behind."""
    for f in job.dir.glob("output.*"):
        f.unlink(missing_ok=True)
    job.output = None


@app.get("/api/jobs/{job_id}/waveform")
def job_waveform(job_id: str, request: Request):
    job = get_job(job_id, request)
    cache = job.dir / "waveform.json"
    with job.lock:
        if not cache.exists():
            rate = 50
            cache.write_text(json.dumps({"rate": rate, "peaks": media.waveform(str(job.source), rate)}))
    return JSONResponse(json.loads(cache.read_text()))


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str, request: Request):
    job = get_job(job_id, request)
    if job.render.status != "done" or not job.output or not job.output.exists():
        raise HTTPException(404, "Nothing to download yet.")
    if not job.downloaded:
        job.downloaded = time.time()
        log.info("job %s downloaded; deleting in %s min", job.id, DOWNLOAD_GRACE_MIN)
    return FileResponse(job.output, filename=job.output_name)


@app.exception_handler(media.MediaError)
def media_error(_, exc: media.MediaError):
    return JSONResponse({"detail": str(exc)}, status_code=500)


# ------------------------------------------------------------------ static

@app.middleware("http")
async def revalidate_app_files(request: Request, call_next):
    """Pages, scripts and styles are checked for changes on every load, so an update
    shows up straight away instead of an old cached copy (fonts and clips stay cached)."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css", ".json", ".svg")) and not path.startswith("/fonts/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


app.mount("/fonts", StaticFiles(directory=FONTS_DIR), name="fonts")
app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
