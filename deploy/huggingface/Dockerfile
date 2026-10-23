# Image for the free Hugging Face Space (2 vCPU, 16 GB, no GPU).
# Captions come from Groq; the smaller on-server model is the backup.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/models \
    XDG_CACHE_HOME=/tmp/.cache \
    HOME=/tmp
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Fonts are committed (built by scripts/fetch_fonts.py), so the image uses
# exactly the files the preview was tested with.
COPY fonts fonts

ARG PRELOAD_MODEL=1
ENV WHISPER_MODEL=large-v3-turbo
RUN mkdir -p /opt/models \
 && if [ "$PRELOAD_MODEL" = "1" ]; then \
      python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', device='cpu', compute_type='int8')"; \
    fi \
 && chmod -R a+rwX /opt/models

COPY server server
COPY static static
COPY panel panel

# Spaces run the container as user 1000; everything it writes goes to /tmp.
ENV DATA_DIR=/tmp/caption-panel \
    ALLOWED_EMAIL_DOMAINS=pickrr.com,shiprocket.com \
    LOCAL_FALLBACK=1 \
    RENDER_CONCURRENCY=1 \
    MAX_UPLOAD_MB=2048
USER 1000
EXPOSE 7860
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
