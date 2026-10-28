# Capstudio

An internal tool for the creative team. Upload a finished video and captions are generated automatically, synced word by word. Pick one of 54 caption styles, fine-tune typography, effects, motion and placement with a live preview, and export at the original quality. Videos are only processed temporarily and deleted automatically.

```
Upload → captions generated automatically → choose a style → customise → preview → export & download
```

## What's inside

**Studio (your video)**
- **Upload-first start.** Drop a video; captions start generating as soon as the upload finishes. You can pick the spoken language and add brand or people names beforehand. Under it, cards open the video editor and the Adobe panel's install steps. The phone on the first page has a tester: step through styles (the one shown becomes the starting style) and type your own line to see it captioned.
- **Captions | Editor switch** in the header of both (`static/js/app/appswitch.js`): from a captioned video, Editor opens it in the editor with its captions and style (and reopens the same edit next time, with the captions brought up to date); from the editor, Captions goes straight back to that video. Pages cross-fade where the browser supports it.
- **Editor** with five tool panels:
  - **Styles:** the library of 54 styles, previewed live on a frame of your video. The **Fastrr** brand kit comes first for every editor: Fastrr Bold, Fastrr Marker, Fastrr Pill and Fastrr Clean, in the brand's purple `#6037D7`, lavender `#B9A6FF` and the logo's bold italic Poppins. The **Trending** group (tagged in the library) holds the current creator looks: a small lead-in over one big keyword on its own line (Two-tier, Serif stack, Hype, Hook, Desi marker), with lead-ins aligned to the keyword's edges, one heavy word per line, left-aligned like a poster (Poster stack), one big word at a time (Big word), and soft glow with words blurring in (Soft glow).
  - Supporting settings: keyword on its own line, one word per line, emphasis on the last word (the punchline), a Blur-in word entrance, and keyword sizes up to 300%. A word too wide for the caption area is scaled down to fit.
  - **Text:** font, weight, size, case, alignment, colour or gradient, spacing, and keyword emphasis.
  - **Effects:** outline, shadow, glow, background shapes (per line, block or word), and spoken-word highlights (colour, pill, karaoke sweep, read-along).
  - **Motion:** entrance, exit, word-by-word reveal and cascade, and speed.
  - **Layout:** position presets, offsets, width, words and lines per caption, staggered lines, and tilt.
- **Captions panel:** edit text and timestamps; split, merge or delete captions; star keywords; find & replace; move all captions earlier or later. Words the speech engine was unsure about are underlined.
- **Timeline:** shows the audio waveform. Drag caption blocks to move them and their edges to trim; a shared edge moves both captions. Drag word markers to fix word timing. Zoom in and out.
- **Preview:** play, frame-step, replay the current caption, speed control, and drag the caption to position it. **Frame / Phone** above the video switches to a phone view (`static/js/app/phone.js`): an iPhone at its real proportions (393 × 852 points) with the status bar, Dynamic Island and the app's own interface laid out in points as on the phone: Instagram or Facebook Reels (the default), TikTok, YouTube Shorts or a story, following the platform picked in Safe zone. The video fills the space the app gives it (cropped a little at the sides, as in the apps; landscape videos are fitted across), with the live captions on it, so you see exactly what the app's buttons cover. It works in the Adobe panel too (icon buttons next to the safe zones; the preview grows to fit the phone unless it was resized by hand).
- **Type bar** over the preview (`static/js/app/typebar.js`): font, size (− / +), letter case, alignment, position (top, middle, low), spacing (letter spacing, line height, width, up/down) and the text and highlight colours, applied live. The full set stays in the Text and Layout tools.
- **One caption at a time:** select a caption on the timeline or the video to get Edit, a size control (50–250%, also the + and − keys) and Delete (also the Delete key). Double-click a caption to type in it. All of it can be undone.
- **Live preview:** changing a motion or highlight setting replays the current caption; any style change made while no caption is on screen jumps to one, so the result is always visible.
- **Safe zones:** one click above the preview shows a see-through overlay for Instagram Reels, Instagram Stories, Facebook Reels, Facebook Stories, YouTube Shorts, WhatsApp Status or TikTok (9:16 videos), or a 10% title-safe area for any video.
  Margins on 1080×1920 (top / bottom / sides): Instagram Reels 220 / 420 / 35 plus the button column; Instagram and Facebook Stories 270 / 380 / 65 (Meta: 14% / 20% / 6%); Facebook Reels 270 / 672 / 65 (Meta: 14% / 35% / 6%); YouTube Shorts 288 / 672 / 48 left, 192 right (Google's vertical video spec); TikTok 220 / 650 / 125 plus the button column; WhatsApp Status 250 / 400 / 48 (an estimate: WhatsApp publishes none). The source of each is shown under the format buttons. Covered areas are hatched and labelled with their margins in px; the safe area is outlined with a light grid. A status line says whether any caption crosses into a covered area, and "Move inside" adjusts position and width to fix it (undoable). The overlay is preview-only and never exported. Margins live in `static/js/app/safezones.js`.
- **Watermark:** the fastrr watermark (full-frame transparent overlays in `static/watermarks/`: light for dark videos, dark for light videos, each in a 1:1 and a 9:16 layout). "Auto" picks 9:16 for tall videos and 1:1 otherwise; the overlay is fitted inside the frame and centred, with size (20–100%) and visibility (10–100%) controls. It's shown in the preview and drawn into the export under the captions, in the browser (canvas) and on the server (ffmpeg overlay), placed by the same rules (`static/js/engine/watermark.js`, `watermark_overlay` in `server/main.py`). The choice is remembered in the browser for the next video.
- **Team glossary** (`server/glossary.txt`, one name per line): Fastrr, Shiprocket, Pickrr and the team's terms. The glossary is given to the speech engine for every video, after the editor's own "Names & terms". Words heard right but written in the wrong case are fixed automatically (shiprocket → Shiprocket, upi → UPI). Near misses of names five letters or longer are suggested, not changed: "faster" → Fastrr?, and "ship rocket" → Shiprocket?, which joins two words.
- **Words to check:** a bar at the top of the Captions panel steps through the words the speech engine was unsure about and the glossary near misses. Each one plays its caption and offers "Looks right" or "Edit", or "Use Fastrr" or "Keep". "All good" clears the list.
- **Script** (Hindi and Hinglish videos): rewrite every caption as Roman Hinglish ("aaj ka offer"), Hindi in Devanagari with English words left in Latin, or an English translation. Roman uses the built-in transliteration, so it's instant and needs no service. Devanagari and English use a Groq text model with the same key (`GROQ_TEXT_MODELS`, tried in order: `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `llama-3.1-8b-instant`). Transliterations keep every word's timing, and a word list the model gets wrong leaves that caption as it was. A translation is spread over each caption's own time span. It's all one undo step.
- **Emojis & keywords:** one click in the Captions panel ("Add emojis & keywords") stars the word that carries each caption's meaning and adds an emoji to about one caption in three, where it illustrates a word. A Groq text model picks them (same key and models as the script switch), choosing only from the emojis the app can draw. Without the key, or if the model fails, a built-in picker matches words against each emoji's English, Hinglish and Hindi keywords instead (`server/enhance.py`). It's one undo step. Each caption's emoji button changes or removes its emoji from a searchable picker; Text › Emojis puts them above or below the words, sets their size, or turns them off. An emoji belongs to a word (like a starred keyword), pops in when that word is spoken, and stays with it when captions are edited, split, regrouped or reframed for other formats.
  - The emojis are about 110 Twemoji pictures (graphics © Twitter and contributors, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)) stored as flat-colour vector shapes in `static/emoji/emoji.json`. They're drawn as shapes, not from an emoji font, so the preview, the browser export, the server export (libass draws them as `\p1` drawings, one per colour) and After Effects (shape layers) all show the same picture. To change the set, edit the list in `scripts/build_emoji.mjs` and run it on the Twemoji SVGs (instructions at its top).
- **Batch queue:** choose or drop several videos at once and they join a queue (`static/js/app/queue.js`). Each is stored in the browser, uploaded and captioned one after another in the background, with the language and starting style chosen when it was queued, while the editor works on the ones that are ready.
  - **The queue on the first page** shows each video's state: waiting, uploading (with progress), writing captions, ready to review, in progress, exported, or failed with Retry.
  - **"Next video ›" in the editor** opens the next one that's ready.
  - **Opening a ready video** uses its copy on the server while that's still there, so nothing is uploaded twice.
  - **After a reload**, the queue carries on, and a video that was half done starts again.
  - **Storage:** queued videos are kept until they've been exported or removed. Videos are captioned one at a time, which is gentle on the server and on Groq's limits.
- **Renaming:** the video's name in the top bar is editable, and every export dialog (here, in the editor and in the Adobe panel) has a File name field. Exports, caption files, the panel's captions file and the saved project use it (`renameProject` and `chosenName` in `session.js`; files made by the server download under it too). The original file name is kept separately, for picking the same video again.
- **Autosave:** every project, including the video, is saved in the browser (IndexedDB, `static/js/app/saved.js`, the last 5). The first page lists them under "Continue where you left off". Closing the tab, reloading or a server restart loses nothing, and "New video" no longer asks. A resumed project's copy on the server has usually been deleted, so it's sent again, once, only when the server is needed (writing captions again, server exports, a preview for formats the browser can't play). If a video was too large to keep in the browser, the editor is asked to pick the same file again.
- **Undo / redo** for every edit (Ctrl+Z / Ctrl+Shift+Z).
- **Export** is one fixed-size dialog: the kinds of export in a list on the left (video with captions, every format, transparent captions, After Effects layers, subtitle track, caption files), the chosen one's settings on the right (quality as three choices, the four formats as a 2×2 grid of compact cards), and a footer with the video's specs and the main button, which says what it will do ("Export 3 formats"). The kinds:
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

## Video editor

`/edit` is a multi-track video editor in the browser (`static/js/editor/`), linked from Capstudio's first page ("Open the video editor") and from a captioned video ("Open in Editor", which brings the video, its captions and style along).

- **Start screen** (`starters.js`): a "New project" page in three parts. **Canvas:** one row of formats (Vertical 9:16, Portrait 4:5, Square 1:1, Tall 2:3, Landscape 16:9, 4K UHD, Cinematic 21:9, Custom) and a settings strip with the size (typing a size makes it custom; swap width and height), frame rate (24–60) and background (or each layout's own). **Start from:** blank or a starting layout (scroll-stopper, product launch, quote card, sale promo, top-3 list, talking head), each drawn live by the editor's compositor at the chosen canvas and played on hover; one click creates the project. Layouts are built for any size (scaled by the short side, above the main track so videos go under them). **Recent:** projects saved in this browser. "Import video" (or dropping a video on the page) makes a project matching the video's size and frame rate with the video on the timeline. The choices are remembered.
- **Projects:** size and frame rate can be changed any time in the project settings. Projects and their media files are saved in the browser (IndexedDB) as you work. Undo and redo cover every edit. Press ? for the keyboard shortcuts.
- **Media:** import or drop videos, music, voice-overs and images. Pictures go on the main track (V1) at the playhead, or after its last clip; sound at the playhead. The timeline shows frames from each video and the waveform of each sound.
- **Timeline:** as many video and audio tracks as needed (upper video tracks cover lower ones), each can be hidden or muted and locked. Move clips (across tracks of the same kind; they stop at their neighbours instead of covering them), trim either edge, cut with the razor (C) or at the playhead (S), delete (Del), delete and close the gap (Shift+Del, or the ripple switch), close a gap by double-clicking it, duplicate, copy and paste. Snapping to the playhead and clip edges, zoom (Ctrl+wheel) and frame stepping.
- **Layers:** position, scale, rotation and opacity, set with the inspector or by dragging the picture, its corners and its rotation handle in the viewer (snapping to the centre lines). Fit, fill or original size, and blend modes (multiply, screen, overlay…).
- **Keyframes:** every one of those, and volume, can be animated: the ◇ next to a setting adds a keyframe at the playhead; changing the value elsewhere adds another. Easing per keyframe (linear, ease in, out, in and out, hold); keyframes show on the selected clip in the timeline.
- **Transitions:** cross dissolve, dip to black or white, slide, push, wipe (four directions each), zoom in and out, blur, and the trending zoom blur, whip pans, flash, spin, glitch, iris and split. Between two clips on a track the transition is centred on the cut (the source's extra frames are used, or the edge frame is held); on a clip with nothing before or after it, it's an entrance or exit. Right-click a clip for the quick ones.
- **Animations:** any picture, title or shape can come in (fade, pop, zoom, slide, rise, drop & bounce, spin, blur, flip), go out, and move while on screen (Ken Burns zoom in or out, slow drift, pulse, float, wiggle, shake, heartbeat, spin), on top of keyframes. The Animate tab previews each one on hover.
- **Trending effects:** glow, RGB split, film grain, light leak, VHS, glitch, and presets of them (retro film, neon pop…), on a clip or, with nothing selected, on the whole video through an **adjustment layer**: a layer whose colour settings and effects change everything on the tracks below it while it lasts (also cinema bars). Grain, leaks and glitches are worked out from the frame's time, so the preview and the export show the same frames.
- **Automation (Auto tab):** a transition style on every cut in one click (smooth, cinematic, snappy, energetic, glitchy, dreamy, mixed), optionally fading in and out at the ends; **cut to the music**: the beat of a music clip is found (`beats.js`: onsets from its loudness, tempo by autocorrelation, a beat grid to a hundredth of a sample), marked on the ruler and snapped to, and the main track can be cut so each clip lasts 1, 2 or 4 beats; Ken Burns on every photo; animate every title.
- **Colour:** looks (vivid, warm, cool, film, moody, black & white, noir, vintage, teal & orange…) plus exposure, contrast, saturation, temperature, tint, hue, fade, vignette and blur.
- **Text and shapes:** title, subtitle, lower third, tag, quote, typewriter, outlined and caption-box presets with every font in the library (116 families, including trending display, retro, script and Indian-script faces), colour, outline, shadow, background box and entrance/exit animations; rectangles, circles, bars and colour fills.
- **Sound:** per-clip volume (keyframable, in dB), fade in and out, mute, speed (0.1–8×; pitch follows, as in the export), separating a video's sound onto its own clip, track mute.
- **Captions:** select a captions clip to set its font, size, case, alignment, letter and line spacing, colours (text, spoken word or keyword), outline, position, width, and words and lines per caption (the captions are split again), or pick a ready-made style. "Caption this edit" mixes the edit's sound, sends it to the same speech engine as Capstudio (inside a tiny blank video, since the service takes video files) and adds a captions clip, styled with any Capstudio template; or add a Capstudio project's video and captions.
- **Export:** an MP4 (H.264 + AAC) made in the browser with WebCodecs, nothing uploaded: each video clip's frames are decoded exactly, each frame is drawn by the same compositor as the preview (`render.js`), and the sound is mixed in an OfflineAudioContext with every volume, fade, keyframe and speed. Full or half size; high, best or small file. Needs Chrome or Edge on a computer.
- **Speed:** the timeline updates clips in place (a moved clip is only repositioned; its frames and waveform aren't redrawn), handles the pointer once per frame, and auto-scrolls while dragging; the library and inspector only rebuild what changed. The preview draws at the size it's shown (the "Full" switch draws every pixel), pieces of one video cut apart share a video element so playback runs through cuts without loading or seeking, and transition windows are cached until the next edit. The export draws decoded frames directly and decodes clips seen together side by side. Drag a box on empty track space to select clips; right-click a clip for split, duplicate, speed, transitions and delete.
- **How it's built:** `model.js` (the project and every edit, no DOM), `store.js` (state, history, autosave), `media.js` (import, thumbnails, waveforms), `render.js` (the compositor, effects and adjustment layers), `player.js` (real-time preview: media elements near the playhead, kept in step and routed through gains), `beats.js`, `auto.js`, `timeline.js`, `viewer.js`, `inspector.js`, `library.js`, `menu.js`, `actions.js`, `captions.js`, `export.js`, `main.js`.
- **Tests:** `node tests/editor_model.mjs` checks the edits (placement, trims, splits, ripple, speed, keyframes, transitions, audio gain), the trending transitions and animations, beat finding at several tempos, transition styles and cutting to the beat; the browser test edits with the mouse and keyboard, plays back, exports and compares exported frames with the preview, checks the sound's fades, and takes a captioned video from Capstudio into the editor and captions an edit. Another browser test goes Captions → Editor → Captions → Editor with the switch (style changed in the type bar carried over, the same edit reopened), checks the phone view, and creates projects from the start screen (format and starter layout, custom size, import matching a video).
- **Limits:** a computer screen is needed (the side panels hide below 900 px); speed changes shift pitch; very long or many 4K clips are limited by the browser's memory.

## Premiere Pro and After Effects panel

`panel/` is one panel for Premiere Pro and After Effects 2022 and newer (CEP 11+, Windows and Mac). It shows the Capstudio app from the live site inside the app, so every feature works there, and adds the link to the timeline or composition. It sees which app it's open in and works the right way for each.

- **Install:** the first page has an "Adobe panel" card with one line to run. On Windows that's `irm <site>/panel/install.ps1 | iex` in PowerShell; on a Mac, `curl -fsSL <site>/panel/install.sh | bash`. Each copies the panel into the user's CEP extensions folder and switches on the setting for panels from outside Adobe's store (`PlayerDebugMode`), with no admin rights. One install covers both apps. Then restart the app and open Window › Extensions › Capstudio. The server builds the download (`/panel/capstudio-panel.zip`) and the installers with its own address filled in. The older `/premiere/...` links still work. The installers switch the setting on for panel engines 9 to 16 (Premiere and After Effects 2019 to future versions) and, on a Mac, refresh the settings cache. The panel opens at panel size (440 × 860) and docks down to 320 px wide.
- **Reliability:** if the app hasn't loaded the panel's host script (for example when the panel was installed or updated while the app was open), the panel loads it itself (`$.evalFile`) and retries. When no video track is free above the edit, Premiere gets a new one on top (QE scripting) instead of an error. The panel reports its version; an older install shows how to update it on the first screen. Adobe's panels run Chromium 88, so the site avoids newer CSS like `:has()`. The host scripts are checked as plain ES3 and run in tests with everything ExtendScript lacks removed (`tests/panel_host.mjs`, `tests/ae_script.mjs`).
- **The whole sequence or composition** (the main button: "Caption the whole sequence" / "Caption the whole composition"): every clip that plays is captioned together, across cuts, voice-overs and music. The panel lists every clip on every track (`Capstudio.timeline()` / `CapstudioAE.timeline()` in `panel/host/host.jsx`): sound from each unmuted audio track (Premiere) or each layer with its audio switched on (After Effects), pictures from each visible video track or layer, with the part of the file used, where it sits, its speed and track. Disabled clips, muted tracks and switched-off layers are left out; titles, graphics, nested sequences, precomps and time-remapped layers have no file to send and are counted (the panel says how many). Each media file is sent once (`/api/timelines`), and the server rebuilds the edit as one video (`server/timeline.py`): the sounds mixed at their places and speeds, the pictures drawn over a black frame in track order, letterboxed to the sequence's shape, at most 1280 px for the preview. That video is captioned over its full length like any upload. Export puts the captions over the whole edit: in Premiere on the first video track that's empty from start to end above every clip, in After Effects at the top of the composition over its full length.
- **Use in Premiere Pro (one clip):**
  1. Select a clip in the timeline and click "Caption the selected clip" (under the main button). The panel reads the clip's media file, and captions are written only for the part of it used in the timeline (from its in-point, at its speed). They're laid out at the sequence's frame size.
  2. Style and check the captions as usual.
  3. Export › "Add to timeline" draws them (and the watermark, if it's on) as a transparent QuickTime Animation `.mov` at the sequence's frame size and rate, for the clip's span. It's saved in a `Capstudio` folder next to the project (or in Documents if the project isn't saved yet) and imported into a `Capstudio` bin. It's placed on the first video track above the clip that's empty for that span. Optionally an SRT is also added as an editable Premiere caption track.
- **Use in After Effects (one layer):**
  1. Select a footage layer in the open composition and click "Caption the selected layer". Captions are written for the part of the file the layer plays (from its in and out points and time stretch), laid out at the composition's size.
  2. Style and check them as usual.
  3. Export › "Add to composition" offers two ways:
     - **Editable layers** (the default): the same text and shape layers as the After Effects script (below), keyframed on the composition's frames, built in a precomp placed directly above the layer. The precomp runs in the footage's own time and takes the layer's start time and stretch, so it stays in sync, and its in and out points match the layer's. The watermark, if on, is saved next to the project and added to the precomp. Fonts that aren't installed are named, with a button to download them. It's one undo step.
     - **Transparent video:** the same `.mov` as in Premiere, imported and placed directly above the layer over its span.
- **Layout in the panel** (`static/css/panel.css`, only inside the panel): panels are narrow and tall, so the app becomes a fixed-height tool instead of a long page. A compact bar holds the clip and the main action (Add to timeline / Add to comp); the preview can be resized from the handle under it (double-click: small or normal); the tool tabs are one row that's always on screen (1–7 switch tools); only the open tool's settings scroll, each tool keeps its scroll position and open groups, sections fold from their titles (remembered), sliders sit on one line with their label, and the style search and categories stay at the top while styles scroll. The caption timeline is behind the Timing tab. In a wide panel (720 px and up) the preview and the tools sit side by side. Advanced editing stays in the web editor; the panel is for captions.
- **How it works:**
  - `panel/index.html` and `bridge.js` show the app in a frame (`?host=premiere` or `?host=aftereffects`).
  - The app (`static/js/app/premiere.js`) asks the bridge for the selected clip or layer and sends back the finished files, or the layer data, by `postMessage`.
  - The bridge reads and writes files with Node, and calls `panel/host/host.jsx` (ExtendScript): `Capstudio` for Premiere, `CapstudioAE` for After Effects. For editable layers it first loads `static/ae/capstudio-ae.jsx` (the same builder as the downloadable script) into After Effects.
- **Limits:**
  - One clip or layer at a time, using its own media file's audio. Clips whose sound comes from a separate audio clip, nested sequences, multicam clips and precomp layers aren't supported yet.
  - Media files over 1.5 GB are refused.
  - Reversed clips and layers, and layers with time remapping, are refused.
  - It has been tested against stand-ins for Premiere and After Effects, not yet in the real apps.
- **Tests:**
  - `node tests/panel_host.mjs` checks that `host.jsx` is plain ES3 (ExtendScript) and runs it against stand-ins for Premiere's DOM (`tests/panel/fake-premiere.js`) and After Effects' DOM (`tests/ae/fake-ae.js`).
  - The browser test runs the whole loop through the real panel bridge, with the app and the file system replaced: `/__panel/` (Premiere) and `/__panel/ae.html` (After Effects, both ways of adding) on the test server.

The After Effects script is tested the same way. `node tests/ae_script.mjs [script.jsx]` checks that the script is ES3 and runs it against a stand-in for After Effects' DOM (`tests/ae/fake-ae.js`). The browser test exports a zip from the app, runs its script that way, and draws the layer data the way After Effects composites it, comparing it with the preview for several templates.

## How the preview matches the export

Captions are laid out once in the browser by `static/js/engine/`:
- **Measurement:** words are measured with the same font files the exporter uses.
- **Layout:** line breaks, word positions and boxes are computed once.
- **Animation:** keyframe curves are evaluated from the same definitions.
- **In sync with speech:** an entrance has to make its text readable (85% opaque) by the time the word is spoken, so a caption's or a revealed word's entrance starts early by that much and its motion settles just after; with no room before it, it starts part-way in (`readyTime`, `entranceSkip` in `motion.js`). Captions also come on 0.12 s before their first word when the previous caption's words are over (`LEAD_IN` in `chunk.js`). Every style shows each word within 0.03 s of it being spoken (checked by `tests/editor_model.mjs`). Highlights and karaoke sweeps follow the word times exactly. The sound sent for captioning is padded from the video's start (`aresample=async=1:first_pts=0`), so videos whose sound starts after the picture (phones, edit lists) aren't captioned early.

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
