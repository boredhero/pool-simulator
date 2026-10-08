# Frontend build and Python runtime in one release image.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY changelog.json /changelog.json
COPY contracts/ /contracts/
RUN npm run build

FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /srv
COPY info.yml ./info.yml
COPY backend/pyproject.toml backend/uv.lock backend/README.md* ./
COPY backend/ ./backend/
RUN uv sync --frozen --no-dev --directory backend
COPY --from=web /web/dist ./frontend/dist
EXPOSE 8000
CMD ["uv", "run", "--no-sync", "--directory", "backend", "python", "-m", "app.server"]
