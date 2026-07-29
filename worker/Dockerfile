
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV EAST_MODEL_PATH=/app/assets/models/frozen_east_text_detection.pb \
    MOBILECLIP_WEIGHTS_PATH=/app/assets/models/mobileclip_s0.pt

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

ARG MOBILECLIP_MODEL_URL="https://docs-assets.developer.apple.com/ml-research/datasets/mobileclip/mobileclip_s0.pt"
ARG MOBILECLIP_MODEL_SHA256="809b408eff74f8058843e86a1f92967097d42ba782450e85b8f4867b7f0ca0b7"
RUN curl -fSL "$MOBILECLIP_MODEL_URL" -o "$MOBILECLIP_WEIGHTS_PATH" \
    && echo "${MOBILECLIP_MODEL_SHA256}  ${MOBILECLIP_WEIGHTS_PATH}" | sha256sum -c -

COPY pyproject.toml uv.lock ./
# Railway needs only runtime media-processing dependencies; test tools stay in CI.
RUN uv sync --no-dev --no-install-project --frozen

COPY . .
RUN uv sync --no-dev --frozen

CMD ["uv", "run", "python", "-m", "app.main"]
