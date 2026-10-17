#!/usr/bin/env bash
# Generates small synthetic test videos in tests/media (not committed).
set -euo pipefail
cd "$(dirname "$0")" && mkdir -p media && cd media
gen() { [ -f "$1" ] || ffmpeg -v error -y "${@:2}" "$1"; }
gen land.mp4  -f lavfi -i testsrc2=size=1920x1080:rate=29.97:duration=12 -f lavfi -i sine=frequency=300:duration=12 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest
# WebM plays in Playwright's Chromium, which has no H.264 decoder.
gen land.webm -i land.mp4 -c:v libvpx-vp9 -b:v 4M -deadline realtime -cpu-used 8 -c:a libopus
gen vert_hevc10.mp4 -f lavfi -i testsrc2=size=1080x1920:rate=25:duration=8 -f lavfi -i sine=frequency=500:duration=8 -c:v libx265 -tag:v hvc1 -x265-params log-level=error -pix_fmt yuv420p10le -c:a aac -shortest
gen prores.mov -f lavfi -i testsrc2=size=1280x720:rate=24:duration=6 -f lavfi -i sine=frequency=400:duration=6 -c:v prores_ks -profile:v 3 -c:a pcm_s16le
gen rotated.mp4 -display_rotation 90 -i land.mp4 -c copy
