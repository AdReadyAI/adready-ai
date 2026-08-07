
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS base

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV EAST_MODEL_PATH=/app/assets/models/frozen_east_text_detection.pb

# ffmpeg provides media decoding; curl and certificates fetch pinned build assets.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Bake the immutable EAST graph into the OCR runtime. The checksum is the
# approved artifact identity and prevents a changed download from entering the
# image; the running worker never downloads model files.
ARG EAST_MODEL_URL="https://raw.githubusercontent.com/oyyd/frozen_east_text_detection.pb/71415464412c55bb1d135fcdeda498e29a67effa/frozen_east_text_detection.pb"
ARG EAST_MODEL_SHA256="9b486f3c3eee77b4c8cc91a83892c37026cca7d29b79bf3b93772ccd2db58454"
RUN mkdir -p /app/assets/models \
    && curl --fail --location --silent --show-error \
        "${EAST_MODEL_URL}" \
        --output "${EAST_MODEL_PATH}" \
    && echo "${EAST_MODEL_SHA256}  ${EAST_MODEL_PATH}" \
        | sha256sum --check -


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
# Run the immutable environment built above so production startup never
# resolves or installs development dependencies.
CMD ["/app/.venv/bin/python", "-m", "app.main"]
