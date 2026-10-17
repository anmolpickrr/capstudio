# Tests

**Unit tests** (Python, fast, no model needed):

```bash
pip install pytest
pytest tests
```

**End-to-end browser test** (real UI, real ffmpeg, fake speech model):

```bash
tests/make_media.sh                      # creates synthetic test videos in tests/media
python tests/stub_server.py 8765 &       # app with a stand-in transcriber
cd tests && npm install && npx playwright install chromium
npm test
```

The end-to-end test renders five source types:
- WebM
- vertical 10-bit HEVC
- ProRes
- a rotated phone clip
- multiple templates

For each output it checks that resolution, frame rate, codec, profile and bit depth match the source.

Transcription accuracy is **not** covered here. That needs the real Whisper model and real recordings.
