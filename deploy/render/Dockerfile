# Image for Render's free plan (512 MB memory, 0.1 CPU).
# Captions come from Groq, so the on-server speech model is left out, and
# LOW_POWER=1 keeps exports within the memory limit (see server/media.py).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /app

COPY requirements.txt ./
RUN grep -v '^faster-whisper' requirements.txt > /tmp/requirements.txt \
 && pip install --no-cache-dir -r /tmp/requirements.txt

# Fonts are committed (built by scripts/fetch_fonts.py), so the image uses
# exactly the files the preview was tested with.
COPY fonts fonts
COPY server server
COPY static static
COPY premiere premiere

ENV DATA_DIR=/tmp/caption-panel \
    ALLOWED_EMAIL_DOMAINS=pickrr.com,shiprocket.com \
    LOCAL_FALLBACK=0 \
    LOW_POWER=1 \
    RENDER_CONCURRENCY=1 \
    MAX_UPLOAD_MB=1024
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --proxy-headers --forwarded-allow-ips '*'"]
