
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS base

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV EAST_MODEL_PATH=/app/assets/models/frozen_east_text_detection.pb

# ffmpeg provides ffprobe (metadata) and ffmpeg (audio extraction / decoding);
# curl + ca-certificates fetch model weights at build time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG EAST_MODEL_URL="https://github.com/oyyd/frozen_east_text_detection.pb/raw/master/frozen_east_text_detection.pb"
ARG EAST_MODEL_SHA256="9b486f3c3eee77b4c8cc91a83892c37026cca7d29b79bf3b93772ccd2db58454"
RUN mkdir -p /app/assets/models \
    && curl -fSL "$EAST_MODEL_URL" -o "$EAST_MODEL_PATH" \
    && echo "${EAST_MODEL_SHA256}  ${EAST_MODEL_PATH}" | sha256sum -c -


COPY pyproject.toml uv.lock ./
# Railway needs only runtime media-processing dependencies; test tools stay in CI.
RUN uv sync --no-dev --no-install-project --frozen

COPY . .

FROM base AS dev
RUN uv sync --frozen
ENV MODE=dev
CMD ["uv", "run", "python", "-m", "app.main"]

FROM base AS runtime
RUN uv sync --no-dev --frozen
CMD ["uv", "run", "python", "-m", "app.main"]
