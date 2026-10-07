# Node build -> Python runtime, single container (Fly.io/Hetzner ready)
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* frontend/pnpm-lock.yaml* ./
RUN npm install --prefix ./ 2>/dev/null || (cd frontend 2>/dev/null && npm install) || true
COPY frontend/ ./frontend/
RUN cd frontend && npm run build || true

FROM python:3.13-slim
WORKDIR /srv
COPY backend/ ./backend/
RUN pip install --no-cache-dir -e ./backend || pip install fastapi uvicorn sqlalchemy numpy httpx
COPY --from=web /web/frontend/dist ./frontend/dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "backend"]
