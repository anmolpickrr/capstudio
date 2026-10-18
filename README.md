# Caption Studio

An internal tool for the creative team. Upload a finished video and captions are generated automatically, synced word by word. Pick one of 42 caption styles, fine-tune typography, effects, motion and placement with a live preview, and export at the original quality. Videos are only processed temporarily and deleted automatically.

```
Upload → captions generated automatically → choose a style → customise → preview → export & download
```

## What's inside

**Studio (your video)**
- **Upload-first start.** Drop a video; captions start generating as soon as the upload finishes. You can pick the spoken language and add brand or people names beforehand.
- **Editor** with five tool panels:
  - **Styles:** the library of 42 styles, previewed live on a frame of your video.
  - **Text:** font, weight, size, case, alignment, colour or gradient, spacing, and keyword emphasis.
  - **Effects:** outline, shadow, glow, background shapes (per line, block or word), and spoken-word highlights (colour, pill, karaoke sweep, read-along).
  - **Motion:** entrance, exit, word-by-word reveal and cascade, and speed.
  - **Layout:** position presets, offsets, width, words and lines per caption, staggered lines, and tilt.
- **Captions panel:** edit text and timestamps; split, merge or delete captions; star keywords; find & replace; move all captions earlier or later. Words the speech engine was unsure about are underlined.
- **Timeline:** shows the audio waveform. Drag caption blocks to move them and their edges to trim; a shared edge moves both captions. Drag word markers to fix word timing. Zoom in and out.
- **Preview:** play, frame-step, replay the current caption, speed control, drag the caption to position it, and safe-area guides (including the reels/shorts app-button zones).
- **Undo / redo** for every edit (Ctrl+Z / Ctrl+Shift+Z).
- **Export** has three options:
  - **Burned-in video:** same resolution, frame rate, rotation, bit depth and audio. The encoder matches the source: H.264 → H.264, HEVC → HEVC (including 10-bit), ProRes → ProRes.
  - **Subtitle track only:** the original picture is kept untouched.
  - **Caption files:** SRT, WebVTT, styled ASS, or a plain transcript.

  Exports show progress, can be cancelled, and leave no partial files behind.

**Demo**
- Three example videos: an English reel, a Hindi explainer and a UK-English square video.
- Their captions were prepared for the demo and are labelled as such.
- Switch styles instantly or compare four side by side.
- "Customise this example" opens it in the Studio as a separate, clearly labelled example project.

**Languages**
- Auto-detect.
- English (India / US / UK, with matching spelling).
- Hinglish, either in Devanagari with English in Latin, or all in Roman script.
- Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Assamese, Nepali, Sanskrit, Sindhi, plus major international languages.
- **Odia** appears in the list as *not supported yet*, because the Whisper model can't transcribe it.
- Every word is drawn in a font that can render it: fonts fall back per word. The font picker only lists fonts that support the captions' language.

## How the preview matches the export

Captions are laid out once in the browser by `static/js/engine/`:
- **Measurement:** words are measured with the same font files the exporter uses.
- **Layout:** line breaks, word positions and boxes are computed once.
- **Animation:** keyframe curves are evaluated from the same definitions.

That one scene is drawn two ways: as SVG for the live preview, and as an ASS script that libass (inside ffmpeg) burns into the video.

`tests/parity.mjs` checks this automatically. For every template and a dozen feature cases, it renders a frame each way and compares the pixels.

## Fonts

- About 70 open-source font families (SIL OFL / Apache 2.0), in `fonts/`.
- Covers modern sans, display, condensed, editorial serif, handwritten and mono styles, plus Noto/Baloo/Hind/Mukta and others for every Indian script.
- Variable fonts are converted into one static file per weight, because libass only draws a variable font's default weight.
- Rebuild with `python scripts/fetch_fonts.py --clean`.

## Running it

**Locally:**

```bash
./run.sh            # http://localhost:8000
```

Set `AUTH_DISABLED=1` to skip Google sign-in while developing.

**Live site:** https://caption-studio-ujgd.onrender.com on Render's free plan, set up from `render.yaml`. One-click setup: [Deploy to Render](https://render.com/deploy?repo=https://github.com/anmolpickrr/capstudio). Render redeploys on every push to `main`.
- Captions come from Groq's hosted Whisper large-v3 (free tier). There's no on-server backup model: it doesn't fit in the free plan's memory. Render asks for `GROQ_API_KEY` during setup.
- Sign-in is off (`AUTH_DISABLED=1` in `render.yaml`), so anyone with the address can use the site. To require Google sign-in (limited to @pickrr.com and @shiprocket.com), remove `AUTH_DISABLED` and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Render. Google's redirect URI is `https://<service>.onrender.com/auth/callback`.
- GitHub Pages only serves the files, so a copy opened there links to the live site (`LIVE_SITE` in `static/js/app/main.js`); the root `index.html` shows the live site in a full-window frame, so https://anmolpickrr.github.io/capstudio is a working address too (this needs sign-in off: with Google sign-in, use the onrender.com address).
- The free machine has 512 MB of memory and 0.1 CPU, so the image sets `LOW_POWER=1`:
  - ffmpeg runs single-threaded with a short look-ahead (a 1080p export peaks around 300 MB);
  - HEVC sources are exported as 8-bit H.264 at the same resolution and frame rate;
  - burned-in exports are limited to 1080p (subtitle tracks and caption files work at any size).
- A 30-second reel takes a few minutes to export. The site sleeps after 15 idle minutes, and the next visit takes about a minute to wake it.
- `/api/health` shows the engine status.

A Hugging Face Space (`deploy/huggingface/`) is also supported, but Docker Spaces now need a paid Hugging Face plan; run the "Deploy to Hugging Face" workflow by hand to use one.

**Docker on your own server:**

```bash
docker build -t caption-studio .
docker run --gpus all -p 8000:8000 caption-studio
```

The build uses the GPU by default; add `--build-arg GPU=0` to build for CPU only.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `TRANSCRIBE_ENGINE` | `groq` if `GROQ_API_KEY` is set, else `local` | `groq`, `openai`, or `local` (faster-whisper on this server; audio never leaves it). |
| `LOCAL_FALLBACK` | `1` | With a hosted engine, use the on-server model when the service is busy or unreachable. |
| `WHISPER_MODEL` | `large-v3` | On-server model (`large-v3-turbo` on the Space). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS` | — | Google sign-in. |
| `JOB_TTL_MIN` / `DOWNLOAD_GRACE_MIN` | `120` / `15` | Delete a job after this many minutes of inactivity, or this many minutes after its download. |
| `MAX_UPLOAD_MB` | `4096` | Upload limit. |
| `LOW_POWER` | `0` | `1` for small machines: low-memory ffmpeg settings, HEVC exported as H.264, burn-in limited to 1080p. |
| `DATA_DIR` | `$TMPDIR/caption-panel` | Scratch space. It must be a dedicated, empty folder; the server refuses to start in a folder holding files it didn't create. |
| `TRANSCRIBE_CONCURRENCY` / `RENDER_CONCURRENCY` | `3`/`1` with Groq, `1`/`2` otherwise | Jobs run in parallel; queue position is shown to editors. |

Run a single server process: jobs are tracked in memory.

## Privacy and retention

Each job lives in one random-ID folder. It is deleted at the first of these:
- 15 minutes after download;
- 2 hours of inactivity;
- the editor starting a new video or closing the tab;
- a server restart.

Other rules:
- Extracted audio is deleted right after transcription.
- Failed or cancelled exports are removed immediately.
- File names never appear in server logs.
- There is no database and no permanent storage.
- Keys stay on the server; the browser never sees them.
- With Groq, audio is sent to Groq for transcription.

## Tests

See `tests/README.md`:
- **Python tests:** API, sign-in, engines, retention, deploy script.
- **Browser end-to-end test:** five source formats, undo, Demo.
- **Preview-vs-export pixel comparison:** every template.

## Layout

```
server/            FastAPI app: jobs, retention, transcription engines, sign-in, ffmpeg
static/js/engine/  caption engine: fonts, measurement, layout, motion, scene, SVG preview, ASS export
static/js/templates/  default settings and the 42-style library
static/js/app/     the interface: studio, stage, timeline, panels, export, demo
static/demo/       example videos with prepared captions (scripts/build_demo.py)
fonts/             caption fonts (scripts/fetch_fonts.py)
deploy/render/     Render image (render.yaml at the root)
deploy/huggingface/  Space image and deploy script
tests/             unit, end-to-end and parity tests
```
