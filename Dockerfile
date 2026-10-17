# Caption Panel image.
#
#   GPU (default):  docker build -t caption-panel .
#                   docker run --gpus all -p 8000:8000 caption-panel
#   CPU only:       docker build --build-arg GPU=0 -t caption-panel .
#
# The GPU build adds NVIDIA's CUDA 12 cuBLAS and cuDNN 9 libraries, which
# faster-whisper needs to run on the GPU. Only the host's NVIDIA driver and the
# NVIDIA Container Toolkit are needed on the server. Check /api/health after
# start: "device" must say "cuda".
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /app

COPY requirements.txt requirements-gpu.txt ./
ARG GPU=1
RUN pip install --no-cache-dir -r requirements.txt \
 && if [ "$GPU" = "1" ]; then pip install --no-cache-dir -r requirements-gpu.txt; fi
ENV LD_LIBRARY_PATH=/opt/venv/lib/python3.12/site-packages/nvidia/cublas/lib:/opt/venv/lib/python3.12/site-packages/nvidia/cudnn/lib

COPY scripts scripts
RUN python scripts/fetch_fonts.py

# Bake the speech model into the image so the first job doesn't wait for a
# ~3 GB download. PRELOAD_MODEL=0 skips this (the model then downloads on start).
ARG WHISPER_MODEL=large-v3
ARG PRELOAD_MODEL=1
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN if [ "$PRELOAD_MODEL" = "1" ]; then \
      python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"; \
    fi

COPY server server
COPY static static

ENV DATA_DIR=/tmp/caption-panel
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
