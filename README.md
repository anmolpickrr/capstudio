# Capstudio

An internal tool for the creative team. Upload a finished video and captions are generated automatically, synced word by word. Pick one of 54 caption styles, fine-tune typography, effects, motion and placement with a live preview, and export at the original quality. Videos are only processed temporarily and deleted automatically.

```
Upload → captions generated automatically → choose a style → customise → preview → export & download
```

## What's inside

**Studio (your video)**
- **Upload-first start.** Drop a video; captions start generating as soon as the upload finishes. You can pick the spoken language and add brand or people names beforehand.
- **Editor** with five tool panels:
  - **Styles:** the library of 54 styles, previewed live on a frame of your video. The **Fastrr** brand kit comes first for every editor: Fastrr Bold, Fastrr Marker, Fastrr Pill and Fastrr Clean, in the brand's purple `#6037D7`, lavender `#B9A6FF` and the logo's bold italic Poppins. The **Trending** group (tagged in the library) holds the current creator looks: a small lead-in over one big keyword on its own line (Two-tier, Serif stack, Hype, Hook, Desi marker), with lead-ins aligned to the keyword's edges, one heavy word per line, left-aligned like a poster (Poster stack), one big word at a time (Big word), and soft glow with words blurring in (Soft glow).
  - Supporting settings: keyword on its own line, one word per line, emphasis on the last word (the punchline), a Blur-in word entrance, and keyword sizes up to 300%. A word too wide for the caption area is scaled down to fit.
  - **Text:** font, weight, size, case, alignment, colour or gradient, spacing, and keyword emphasis.
  - **Effects:** outline, shadow, glow, background shapes (per line, block or word), and spoken-word highlights (colour, pill, karaoke sweep, read-along).
  - **Motion:** entrance, exit, word-by-word reveal and cascade, and speed.
  - **Layout:** position presets, offsets, width, words and lines per caption, staggered lines, and tilt.
- **Captions panel:** edit text and timestamps; split, merge or delete captions; star keywords; find & replace; move all captions earlier or later. Words the speech engine was unsure about are underlined.
- **Timeline:** shows the audio waveform. Drag caption blocks to move them and their edges to trim; a shared edge moves both captions. Drag word markers to fix word timing. Zoom in and out.
- **Preview:** play, frame-step, replay the current caption, speed control, and drag the caption to position it.
- **One caption at a time:** select a caption on the timeline or the video to get Edit, a size control (50–250%, also the + and − keys) and Delete (also the Delete key). Double-click a caption to type in it. All of it can be undone.
- **Live preview:** changing a motion or highlight setting replays the current caption; any style change made while no caption is on screen jumps to one, so the result is always visible.
- **Safe zones:** one click above the preview shows a see-through overlay for Instagram Reels, Instagram Stories, Facebook Reels, Facebook Stories, YouTube Shorts, WhatsApp Status or TikTok (9:16 videos), or a 10% title-safe area for any video.
  Margins on 1080×1920 (top / bottom / sides): Instagram Reels 220 / 420 / 35 plus the button column; Instagram and Facebook Stories 270 / 380 / 65 (Meta: 14% / 20% / 6%); Facebook Reels 270 / 672 / 65 (Meta: 14% / 35% / 6%); YouTube Shorts 288 / 672 / 48 left, 192 right (Google's vertical video spec); TikTok 220 / 650 / 125 plus the button column; WhatsApp Status 250 / 400 / 48 (an estimate: WhatsApp publishes none). The source of each is shown under the format buttons. Covered areas are hatched and labelled with their margins in px; the safe area is outlined with a light grid. A status line says whether any caption crosses into a covered area, and "Move inside" adjusts position and width to fix it (undoable). The overlay is preview-only and never exported. Margins live in `static/js/app/safezones.js`.
- **Watermark:** the fastrr watermark (full-frame transparent overlays in `static/watermarks/`: light for dark videos, dark for light videos, each in a 1:1 and a 9:16 layout). "Auto" picks 9:16 for tall videos and 1:1 otherwise; the overlay is fitted inside the frame and centred, with size (20–100%) and visibility (10–100%) controls. It's shown in the preview and drawn into the export under the captions, in the browser (canvas) and on the server (ffmpeg overlay), placed by the same rules (`static/js/engine/watermark.js`, `watermark_overlay` in `server/main.py`). The choice is remembered in the browser for the next video.
- **Team glossary** (`server/glossary.txt`, one name per line): Fastrr, Shiprocket, Pickrr and the team's terms. The glossary is given to the speech engine for every video, after the editor's own "Names & terms". Words heard right but written in the wrong case are fixed automatically (shiprocket → Shiprocket, upi → UPI). Near misses of names five letters or longer are suggested, not changed: "faster" → Fastrr?, and "ship rocket" → Shiprocket?, which joins two words.
- **Words to check:** a bar at the top of the Captions panel steps through the words the speech engine was unsure about and the glossary near misses. Each one plays its caption and offers "Looks right" or "Edit", or "Use Fastrr" or "Keep". "All good" clears the list.
- **Script** (Hindi and Hinglish videos): rewrite every caption as Roman Hinglish ("aaj ka offer"), Hindi in Devanagari with English words left in Latin, or an English translation. Roman uses the built-in transliteration, so it's instant and needs no service. Devanagari and English use a Groq text model with the same key (`GROQ_TEXT_MODELS`, tried in order: `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `llama-3.1-8b-instant`). Transliterations keep every word's timing, and a word list the model gets wrong leaves that caption as it was. A translation is spread over each caption's own time span. It's all one undo step.
- **Autosave:** every project, including the video, is saved in the browser (IndexedDB, `static/js/app/saved.js`, the last 5). The first page lists them under "Continue where you left off". Closing the tab, reloading or a server restart loses nothing, and "New video" no longer asks. A resumed project's copy on the server has usually been deleted, so it's sent again, once, only when the server is needed (writing captions again, server exports, a preview for formats the browser can't play). If a video was too large to keep in the browser, the editor is asked to pick the same file again.
- **Undo / redo** for every edit (Ctrl+Z / Ctrl+Shift+Z).
- **Export** has three options:
  - **Burned-in video:** same resolution, frame rate, rotation and audio. In Chrome and Edge (and other browsers with WebCodecs) the video is made on the user's own computer: `static/js/app/browserexport.js` decodes the original file, draws the captions on each frame with the canvas renderer and encodes H.264 on the computer's video hardware ([Mediabunny](https://mediabunny.dev), vendored in `static/vendor/`). A 30-second reel takes seconds rather than minutes, and nothing is sent to the server. Audio is copied as is (AAC, MP3, AC-3, ALAC) or converted to AAC. When the browser can't do it (no encoder, a codec it can't decode such as ProRes, or audio it can't carry over), the server does it with ffmpeg/libass, and the encoder matches the source: H.264 → H.264, HEVC → HEVC (including 10-bit), ProRes → ProRes.
  - **Every format at once:** vertical 9:16, portrait 4:5, square 1:1 and landscape 16:9 versions from the same edit (choose which), named "<original name> 9x16.mp4" and so on.
    - **Size:** each format keeps the original's quality class, with its short side matching the original's (720 to 2160).
    - **Framing:** each format either crops to fill, with a slider for which part of the picture stays, or fits the whole picture over a blurred, darkened copy of itself. The default is whichever keeps more of the picture.
    - **Captions:** they're laid out again for each frame, and a caption that no longer fits a narrower frame is split, keeping its timing.
    - **Safe zones:** each format is checked against its safe zone (9:16: the platform of your choice; the others: 10% title-safe). Captions that cross it are moved inside, for that format only, with "Keep my layout" to undo that. The dialog shows a live preview of each format with its safe area.
    - **How it's made:** in the browser like the main export, or on the server with an ffmpeg version of the same framing (`reframe_filter` in `server/media.py`). The rules are in `static/js/engine/reframe.js`, and the dialog and settings in `static/js/app/formats.js`; the settings are remembered in the browser.
  - **Captions only, transparent:** for Premiere Pro and After Effects. A QuickTime Animation (RLE, 32-bit with alpha) `.mov` of just the captions, plus the watermark if it's on, on a see-through background. It has the same size, frame rate and length as the video, so editors put it on the track above their footage. It's made in the browser by `static/js/app/overlayexport.js`, which has its own small RLE encoder and QuickTime writer and needs neither a video encoder nor the server, so it works in every browser. Between key frames (one a second), only the area the captions cover is read back from the canvas. The file is named "<original name> captions.mov".
  - **After Effects, editable layers:** a zip containing a script (`static/ae/capstudio-ae.jsx`, with the captions filled in), the fonts the captions use, the watermark if it's on, and a README. Install the fonts, then run the script from File › Scripts › Run Script File. It builds a composition the size, frame rate and length of the video in which every word is a live text layer (plus its shadow and glow layers) and backgrounds and pills are shape layers. Position, scale, rotation, opacity, blur, colour changes and karaoke sweeps (an animated mask) are keyframes. The layer data comes from the same element states the preview draws (`static/js/engine/ae.js`), sampled on the composition's frames and thinned to the keyframes that change the motion. If a font isn't installed, the script names it. Differences from the preview: a gradient fill becomes its first colour, and After Effects' Gaussian Blur is close to the preview's blur but not identical (Blurriness ≈ 2.4 × the blur's standard deviation).
  - **Subtitle track only:** the original picture is kept untouched.
  - **Caption files:** SRT, WebVTT, styled ASS, or a plain transcript.

  Exports keep the original file name (only the extension changes if the format does, e.g. WebM to MP4). They show progress, can be cancelled, and leave no partial files behind.

**First page**
- A headline set in caption typefaces, and a Reels-style phone mockup (the app's own header, buttons, username and audio line) whose live caption changes style on every loop. Small floating cards show real features: language detection, word timing, the style library, safe zones and original-quality export.
- A strip of language names, each in its own script; a compact upload bar; a video can be dropped anywhere on the page.
- A bento of style specimens on flat, editorial surfaces, each caption drawn live by the export engine with the style's name, category and key traits; clicking one makes it the starting style for the upload.

**Languages**
- Auto-detect.
- English (India / US / UK, with matching spelling).
- Hinglish, either in Devanagari with English in Latin, or all in Roman script.
- Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Assamese, Nepali, Sanskrit, Sindhi, plus major international languages.
- **Odia** appears in the list as *not supported yet*, because the Whisper model can't transcribe it.
- Every word is drawn in a font that can render it: fonts fall back per word. The font picker only lists fonts that support the captions' language.

## Premiere Pro panel

`premiere/` is a panel for Premiere Pro 2022 and newer (CEP 11+, Windows and Mac). It shows the Capstudio app from the live site inside Premiere, so every feature works there, and adds the link to the timeline.

- **Install:** the first page has an "Edit in Premiere Pro?" link with one line to run. On Windows that's `irm <site>/premiere/install.ps1 | iex` in PowerShell; on a Mac, `curl -fsSL <site>/premiere/install.sh | bash`. Each copies the panel into the user's CEP extensions folder and switches on Premiere's setting for panels from outside Adobe's store (`PlayerDebugMode`), with no admin rights. Then restart Premiere and open Window › Extensions › Capstudio. The server builds the download (`/premiere/capstudio-premiere.zip`) and the installers with its own address filled in.
- **Use:**
  1. Select a clip in the timeline and click "Caption the selected clip". The panel reads the clip's media file, and captions are written only for the part of it used in the timeline (from its in-point, at its speed). They're laid out at the sequence's frame size.
  2. Style and check the captions as usual.
  3. Export › "Add to timeline" draws them (and the watermark, if it's on) as a transparent QuickTime Animation `.mov` at the sequence's frame size and rate, for the clip's span. It's saved in a `Capstudio` folder next to the project (or in Documents if the project isn't saved yet) and imported into a `Capstudio` bin. It's placed on the first video track above the clip that's empty for that span. Optionally an SRT is also added as an editable Premiere caption track.
- **How it works:**
  - `premiere/index.html` and `bridge.js` show the app in a frame.
  - The app (`static/js/app/premiere.js`, in "Premiere mode" via `?host=premiere`) asks the bridge for the selected clip and sends back the finished files, by `postMessage`.
  - The bridge reads and writes files with Node, and calls `premiere/host/host.jsx` (ExtendScript) for the selection, import and placement.
- **Limits:**
  - One clip at a time, using its own media file's audio. Clips whose sound comes from a separate audio clip, nested sequences and multicam clips aren't supported yet.
  - Media files over 1.5 GB are refused.
  - Reversed clips are refused.
- **Tests:**
  - `node tests/premiere_host.mjs` checks that `host.jsx` is plain ES3 (ExtendScript) and runs it against a stand-in for Premiere's DOM (`tests/premiere/fake-premiere.js`).
  - The browser test runs the whole loop through the real panel bridge, with Premiere and the file system replaced (`/__premiere/` on the test server).

The After Effects script is tested the same way. `node tests/ae_script.mjs [script.jsx]` checks that the script is ES3 and runs it against a stand-in for After Effects' DOM (`tests/ae/fake-ae.js`). The browser test exports a zip from the app, runs its script that way, and draws the layer data the way After Effects composites it, comparing it with the preview for several templates.

## How the preview matches the export

Captions are laid out once in the browser by `static/js/engine/`:
- **Measurement:** words are measured with the same font files the exporter uses.
- **Layout:** line breaks, word positions and boxes are computed once.
- **Animation:** keyframe curves are evaluated from the same definitions.

That one scene is drawn three ways: as SVG for the live preview, on a canvas for exports made in the browser (`static/js/engine/canvas.js`), and as an ASS script that libass (inside ffmpeg) burns into the video on the server.

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

**Live site:** https://caption-studio-ujgd.onrender.com on Render's free plan, set up from `render.yaml`. One-click setup: [Deploy to Render](https://render.com/deploy?repo=https://github.com/anmolpickrr/capstudio). After the tests pass on `main`, the Tests workflow triggers Render's deploy hook (GitHub secret `RENDER_DEPLOY_HOOK`). `/api/health` shows the live commit as `version`.
- Captions come from Groq's hosted Whisper large-v3 (free tier). There's no on-server backup model: it doesn't fit in the free plan's memory. Render asks for `GROQ_API_KEY` during setup.
- Sign-in is off (`AUTH_DISABLED=1` in `render.yaml`), so anyone with the address can use the site. To require Google sign-in (limited to @pickrr.com and @shiprocket.com), remove `AUTH_DISABLED` and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Render. Google's redirect URI is `https://<service>.onrender.com/auth/callback`.
- GitHub Pages only serves the files, so a copy opened there links to the live site (`LIVE_SITE` in `static/js/app/main.js`); the root `index.html` shows the live site in a full-window frame, so https://anmolpickrr.github.io/capstudio is a working address too (this needs sign-in off: with Google sign-in, use the onrender.com address).
- The free machine has 512 MB of memory and 0.1 CPU, so the image sets `LOW_POWER=1`:
  - ffmpeg runs single-threaded with a short look-ahead (a 1080p export peaks around 300 MB);
  - HEVC sources are exported as 8-bit H.264 at the same resolution and frame rate;
  - burned-in exports are limited to 1080p (subtitle tracks and caption files work at any size).
- Exports made in the browser don't use the server at all. When the server has to export (other browsers, ProRes), a 30-second reel takes a few minutes. Render's free plan puts a site to sleep after 15 idle minutes, so the server requests its own address every 9 minutes and stays awake (`KEEP_AWAKE=0` turns this off; one service running all month uses about 744 of the 750 free hours). The github.io address shows a loading screen with the logo while the app loads behind it.
- `/api/health` shows the engine status.
- The page loads its scripts and styles from `/v/<fingerprint>/` (a hash of the app's files, worked out when the server starts), cached for good at that address. Each release changes the fingerprint, so browsers always get the new files together and can't mix an old cached script with a new page.

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
| `JOB_TTL_MIN` / `DOWNLOAD_GRACE_MIN` | `120` / `20` | Delete a job after this many minutes of inactivity, or this many minutes after its download. |
| `MAX_UPLOAD_MB` | `4096` | Upload limit. |
| `LOW_POWER` | `0` | `1` for small machines: low-memory ffmpeg settings, HEVC exported as H.264, burn-in limited to 1080p. |
| `DATA_DIR` | `$TMPDIR/caption-panel` | Scratch space. It must be a dedicated, empty folder; the server refuses to start in a folder holding files it didn't create. |
| `TRANSCRIBE_CONCURRENCY` / `RENDER_CONCURRENCY` | `3`/`1` with Groq, `1`/`2` otherwise | Jobs run in parallel; queue position is shown to editors. |

Run a single server process: jobs are tracked in memory.

## Privacy and retention

Each job lives in one random-ID folder. It is deleted at the first of these:
- 20 minutes after download (for videos made in the browser: 20 minutes after they are saved);
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
- **Browser end-to-end test:** five source formats on the server (including file names), exports made in the browser (size, frame count, audio, rotation), the first-page style showcase, undo.
- **Preview-vs-export pixel comparison:** every template, against both the server (libass) and the browser (canvas) export.

## Layout

```
server/            FastAPI app: jobs, retention, transcription engines, sign-in, ffmpeg
static/js/engine/  caption engine: fonts, measurement, layout, motion, scene, SVG preview, canvas and ASS export
static/vendor/     Mediabunny (MPL-2.0), reads and writes video files for exports made in the browser
static/js/templates/  default settings and the 54-style library (brand kit first)
static/js/app/     the interface: first page and showcase, studio, stage, timeline, panels, export
fonts/             caption fonts (scripts/fetch_fonts.py)
deploy/render/     Render image (render.yaml at the root)
deploy/huggingface/  Space image and deploy script
tests/             unit, end-to-end and parity tests
```
