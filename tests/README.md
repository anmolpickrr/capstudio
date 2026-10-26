# Tests

**Python tests** (fast, no model needed; run on every push by GitHub Actions):

```bash
pip install -r requirements.txt pytest
pytest tests
```

They cover the API, Google sign-in, the Groq/OpenAI engines (against a stand-in service), retention and clean-up, cancelled exports, export file names, and the deploy script.

**Browser tests.** These need Node with Playwright, plus the app running with a stand-in transcriber:

```bash
tests/make_media.sh                      # synthetic test videos in tests/media
python tests/stub_server.py 8765 &       # app with sign-in off and a fake speech model
cd tests && npm install && npx playwright install chromium
node e2e.mjs                             # upload → captions → style → export → download
node parity.mjs                          # preview vs export, pixel comparison
node panel_host.mjs                      # the panel's ExtendScript, against stand-in Premiere and After Effects
node ae_script.mjs                       # the After Effects script, against a stand-in After Effects
node editor_model.mjs                    # the video editor's edits (no browser needed)
```

- **`e2e.mjs`** exports five kinds of source video:
  - WebM
  - vertical 10-bit HEVC
  - ProRes
  - a rotated phone clip
  - with different styles

  For each, it checks that resolution, frame rate, codec, profile and bit depth match the source. It also exports two VP9 + AAC MP4s in the browser (one rotated), checking size, frame count, AAC audio, the file name and that captions are in the picture. Playwright's Chromium has no H.264 encoder (or decoder), so this test asks for VP9 through `window.__exportCodecs`; H.264 sources fall back to the server in the test browser, as they would in any browser without one. It also checks that the download keeps the original file name, that the style showcase on the first page plays with captions and that a picked style is used for the upload, undo, and the safe-zone overlays (each platform, plus "Move inside").
- **`parity.mjs`** draws a caption frame with the live preview, burns the same frame with ffmpeg/libass, and draws it with the canvas renderer used by exports made in the browser, then compares each with the preview around the caption (PSNR: 20 dB for libass, 22 dB for canvas; the canvas differs only by sub-pixel antialiasing at letter edges). The cases are every library template plus feature cases in `parity_cases.mjs`. Images land in `$PARITY_OUT` (default: a temp folder).
- **`mock_groq.py`** is a stand-in for Groq's API, for testing a full deployment without a real key.

Transcription *accuracy* is not covered here. It needs the real speech service and real recordings.
