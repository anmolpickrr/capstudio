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
```

- **`e2e.mjs`** exports five kinds of source video:
  - WebM
  - vertical 10-bit HEVC
  - ProRes
  - a rotated phone clip
  - with different styles

  For each, it checks that resolution, frame rate, codec, profile and bit depth match the source. It also checks that the download keeps the original file name, that the style showcase on the first page plays with captions and that a picked style is used for the upload, and undo.
- **`parity.mjs`** draws a caption frame with the live preview and burns the same frame with ffmpeg/libass, then compares the two around the caption (PSNR). The cases are every library template plus feature cases in `parity_cases.mjs`. Images land in `$PARITY_OUT` (default: a temp folder).
- **`mock_groq.py`** is a stand-in for Groq's API, for testing a full deployment without a real key.

Transcription *accuracy* is not covered here. It needs the real speech service and real recordings.
