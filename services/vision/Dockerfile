# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS base
ARG BUILD_TS="unknown"
ARG GIT_SHA="dev"
WORKDIR /app
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*

COPY services/vision/pyproject.toml services/vision/poetry.lock ./
RUN pip install --no-cache-dir poetry==1.7.1 && \
    poetry export --without-hashes -f requirements.txt -o requirements.txt && \
    pip install --no-cache-dir -r requirements.txt

COPY services/vision/src ./src
ENV PYTHONPATH=/app/src
ENV VISION_MODEL_DIR=/models
ENV VISION_MODEL_PATH=/models
ENV VISION_PORT=50052
EXPOSE 50052
VOLUME ["/models"]
CMD ["python","-m","vision.server"]
LABEL org.opencontainers.image.source="https://github.com/jonahgrigoryan/gittest" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_TS"
