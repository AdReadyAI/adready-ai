
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1

# ffmpeg provides ffprobe (metadata) and ffmpeg (audio extraction / decoding).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
# Railway needs only runtime media-processing dependencies; test tools stay in CI.
RUN uv sync --no-dev --no-install-project --frozen

COPY . .
RUN uv sync --no-dev --frozen

CMD ["uv", "run", "python", "-m", "app.main"]
