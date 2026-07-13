
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1

COPY pyproject.toml uv.lock ./
RUN uv sync --no-install-project --frozen

COPY . .
RUN uv sync --frozen

CMD ["uv", "run", "python", "-m", "app.main"]