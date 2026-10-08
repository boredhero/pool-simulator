# pool-simulator

GPU-accelerated browser pool (8-Ball extensible) + Python backend.
Decisions (Socratic dialog 2026-10-06): online private rooms (anonymous), hybrid physics (client predicts / Python validates), realistic 3D adaptive quality, different controls per device, practice + simple AI, dual sim (TS + Python) with shared golden tests.

## Layout
- `backend/` FastAPI + uvicorn, SQLite WAL, serves `frontend/dist` in prod
- `frontend/` Vite + TypeScript + Three.js r186 (WebGL2 baseline, WebGPU upgrade path)
- `contracts/` shared shot/snapshot schemas
- See `PLAN.md` for phased plan from research subagents.

## Dev quickstart
- Backend: `cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000`
- Frontend: `cd frontend && pnpm install && pnpm dev` (proxies `/api` + `/ws` → :8000)
- Prod single container: `docker build -t pool-sim . && docker run -p 8000:8000 pool-sim`

## Physics contract
- 2D circles + 3-axis spin (ωx,ωy,ωz), SI units, fixed dt=1/240, semi-implicit Euler + swept TOI, sleep thresholds. See `backend/app/sim/` and `frontend/src/sim/` — keep in sync via golden vectors in `contracts/golden/`.
