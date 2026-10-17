#!/usr/bin/env bash
# Starts Caption Panel on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
[ -n "$(ls fonts/*.ttf 2>/dev/null)" ] || .venv/bin/python scripts/fetch_fonts.py
exec .venv/bin/uvicorn server.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
