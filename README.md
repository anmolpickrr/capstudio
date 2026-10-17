# Caption Panel

A fast, self-hosted panel for editors. You upload a finished video, generate word-synced captions, pick and tweak a template, preview it live, and download the captioned video in the original quality. Files are never stored permanently.

```
Upload → Generate → Style & edit (live preview) → Export → auto-delete
```

## Online demo

https://anmolpickrr.github.io/capstudio/ opens the editor in demo mode, using a sample video with pre-made captions. Your team can try templates, styling, animations, the live preview, caption editing and SRT/VTT/ASS downloads there.

GitHub Pages can only host fixed files, so the demo can't generate captions for your own videos or export a captioned video. Those need the server below.

`scripts/build_demo.py` rebuilds the demo files (`static/demo/`). Adding `?demo` to any server URL opens the same demo locally.

## Run it

Requirements: Python 3.10+, ffmpeg 6+ (built with libass, libx264 and libx265, which standard distro builds include).

```bash
./run.sh                 # installs deps, downloads fonts, serves http://localhost:8000
```

With Docker:

```bash
# GPU server (needs the NVIDIA driver + NVIDIA Container Toolkit on the host)
docker build -t caption-panel .
docker run -d --restart unless-stopped --gpus all -p 127.0.0.1:8000:8000 caption-panel

# CPU-only server (much slower transcription)
docker build --build-arg GPU=0 -t caption-panel .
docker run -d --restart unless-stopped -p 127.0.0.1:8000:8000 caption-panel
```

The image bakes the Whisper model in at build time (large-v3 is about 3 GB). Pass `--build-arg PRELOAD_MODEL=0` to skip that, and the model then downloads on first start.

Check the server after starting it:

```bash
curl localhost:8000/api/health
# {"status":"ok","jobs":0,"engine":"local","model":"large-v3","device":"cuda","modelLoaded":true}
```

On a GPU server, `device` must say `cuda`. If it says `cpu`, the container isn't seeing the GPU.

Run a single server process (the default). Jobs are tracked in memory, so several workers or replicas would not see each other's jobs.

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `TRANSCRIBE_ENGINE` | `local` | `local` = faster-whisper on this server (audio never leaves it). `openai` = OpenAI whisper-1 API (needs `OPENAI_API_KEY`; audio is sent to OpenAI). |
| `WHISPER_MODEL` | `large-v3` | `large-v3` gives the best accuracy, including Indian languages. `large-v3-turbo` is about 3× faster with slightly lower accuracy and is a good choice for CPU-only servers. |
| `JOB_TTL_MIN` | `120` | Delete a job this many minutes after its last activity, whatever its state. |
| `DOWNLOAD_GRACE_MIN` | `15` | Delete a job this many minutes after its first download. This window allows a re-download. |
| `MAX_UPLOAD_MB` | `4096` | Upload size limit. |
| `DATA_DIR` | `$TMPDIR/caption-panel` | Scratch space for jobs. Old jobs in it are removed on every start. Use an empty, dedicated folder: the server refuses to start if the folder already holds files it didn't create. |
| `TRANSCRIBE_CONCURRENCY` / `RENDER_CONCURRENCY` | `1` / `2` | Parallel jobs. |

## How each requirement is met

**Accurate, synced captions.** Whisper large-v3 provides word-level timestamps. Voice-activity detection and `condition_on_previous_text=False` prevent hallucinated or looping text, and overlapping timings are repaired. Editors can add names and terms (brands, people), which are passed to the model as hotwords and prompt context. Words the model was unsure of are underlined in the caption editor for a quick check. Global sync nudges (±20 ms / ±100 ms) correct any constant offset.

**Templates and customisation.** There are 12 templates: Clean Subtitle, Cinema, Boxed, Bold Pop, Karaoke Fill, One Word, Typewriter, Neon Glow, News Strap, Minimal, Comic and Desi Bold. Editors can change:
- font and weight (51 bundled OFL fonts, including Noto for every Indian script)
- size, text and highlight colour, case, letter spacing, punctuation hiding
- outline, shadow, glow and background box
- placement (top/middle/bottom, plus dragging the caption in the preview)
- entrance animation (fade, pop, zoom, slide)
- word effect (highlight the spoken word, karaoke fill, word-by-word reveal)
- caption length (words per caption, characters per line, lines)

Any style can be saved as a personal preset. Presets are stored in the browser only.

**Multilingual.** Supported languages:
- English: India, US and UK. US and UK spelling is enforced, e.g. *color/colour*, *organize/organise*.
- Hindi, plus Hinglish in two forms: Devanagari with English words in Latin, or all Roman script.
- Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Assamese, Nepali, Sanskrit and Sindhi.
- Major international languages.
- Auto-detect, which reports the detected language and its confidence.

If the chosen font can't draw a script (e.g. Anton with Tamil), the closest font that can is used automatically. The panel shows a notice when this happens.

**Live preview = final output.** The preview and the export share one caption engine (`static/js/captions.js`) that handles chunking, line breaks, word timing and animation curves. The preview draws in SVG on the video's own pixel grid. The export is an ASS file that libass burns in on the same grid, with the same font files and libass's font metrics. Side-by-side frame comparisons during development matched in size, position, outline, boxes and highlights.

**Original quality.** Resolution, aspect ratio, frame rate (including variable frame rate), rotation, colour metadata and bit depth are kept. Audio is stream-copied. The video is re-encoded only because burning in captions requires it, and the encoder matches the source:
- H.264 → x264 at CRF 17 (CRF 14 in "Maximum")
- HEVC → x265, keeping 10-bit if the source is 10-bit
- ProRes → ProRes in the same profile

**Subtitle track (no re-encode).** "Create subtitled video" adds a selectable subtitle track. The picture is bit-for-bit the original.

SRT, WebVTT, styled ASS and plain transcript downloads are generated in the browser.

**Fast.** The upload starts the moment a file is dropped, and the language can be chosen in parallel. Preview playback uses the local file, so nothing is downloaded back. Styling is instant and client-side. Transcription runs on GPU when available.

**No permanent storage.** Each job lives in one random-ID folder and is deleted at the first of these:
1. `DOWNLOAD_GRACE_MIN` after the download,
2. `JOB_TTL_MIN` of inactivity,
3. the editor clicking "Delete my files now" or closing the tab,
4. a server restart.

The extracted audio is deleted as soon as transcription finishes. Media and transcripts are never logged and have no database. A countdown in the top bar shows when the files will be removed.

## Known limits / next steps
- **Odia** is not supported by Whisper. Noto Sans Oriya fonts are bundled, but transcription needs an Indic ASR model such as AI4Bharat IndicConformer or Sarvam. `server/transcribe.py` has an engine switch for this.
- **Hinglish (all Roman)** asks Whisper for Roman output and transliterates any remaining Devanagari into casual spelling (e.g. *yah bahut aasaan hai*). Uncommon words may need a manual touch-up.
- Ideas from comparable tools, not yet built:
  - a pill-shaped background behind the active word
  - auto emoji and keyword emphasis
  - translating captions to a second language
  - speaker labels
  - a profanity filter

## Tests

See `tests/README.md`:
- Python unit tests (`pytest tests`)
- An end-to-end browser test that renders five kinds of source video and checks the output keeps the original's specs

## Layout
```
server/main.py        API, jobs, retention sweeper, /api/health
server/transcribe.py  faster-whisper / OpenAI engines, Hinglish romanisation
server/media.py       ffprobe, quality-preserving encode plans, burn-in, soft subs
server/spelling.py    US ↔ UK spelling
server/fonts.py       font catalogue + metrics shared with the browser
static/js/captions.js caption engine (chunking, timing, animation, ASS/SRT/VTT)
static/js/preview.js  SVG live preview
static/js/templates.js templates
static/js/app.js      UI
tests/                unit + end-to-end tests
```
