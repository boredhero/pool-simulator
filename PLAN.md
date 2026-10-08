# pool-simulator — Plan & build log

Live: https://pool.martinospizza.dev · `main` deploys via GHCR + compose.
Flow: work on `develop`, PR to `main` (protected: PR + `ci` check), merge to ship.

## Stack (locked)
- Frontend: Vite + TS + Three.js (WebGL2 baseline, WebGPU path later), custom 2D+spin sim
- Backend: FastAPI + uvicorn + SQLite WAL (`/srv/data` volume), serves `frontend/dist`
- Net: turn-based shot-event sync over WS, server authoritative on rules
- CI: one workflow (lint/test/e2e/docker/deploy), Dependabot weekly grouped

## Physics contract (both sims, keep in sync)
- 2D circles + 3-axis spin, SI units, fixed dt=1/240, semi-implicit Euler + swept TOI
- μs=0.20, μr=0.010, e_ball=0.94, cushion e_n=0.76 along nose normal + μ_c=0.17
- Speed-dependent throw μ(v), spin decay 10 rad/s², tip SRF 2.5·(b/R), squirt 5.7°/unit
- pooltool pocket geometry (offset capture, big corner jaws, speed rejection) + lip gravity
- Power: floor 0.55 m/s, p^1.55 curve, normal max 3.5 / break max 8.5 m/s
- TS: `frontend/src/sim/` · Python mirror: `backend/app/sim/` · golden tests both sides

## Done
- P0 skeleton, P1 solo sim+rules+controls, P2 Python mirror+API, P3 WS rooms,
  P4 PWA+audio+e2e, P5 L1 AI, P6 UX (hold/pull shooting, scorecards, themes,
  lobby), P7 research constants, P8 pockets (segmented rails, holes, lip dip)
- Table graphics repair: continuous beveled wood surround, true pocket cutouts
  and recessed wells, leather facings, sloped cushions and instanced jaws tied
  to sim geometry, softer materials/shadows, desktop/portrait camera fitting.
  Geometry ray tests cover clear pockets and continuous outside rails.
- Shared bed/cushion felt, reduced wood/ball glare, warm overhead area light
  with two shadow-casting bulbs and inverse-square falloff.
- Ball collisions check every pair regardless of array order/sleep state;
  penetration correction and a larger contact budget are mirrored in Python.
  Regressions cover sleeping targets, coincident balls, and every frame of breaks.

## Open / known gaps
- Pocket forgiveness for casual play (strict-pro now); cloth-speed setting
- Rooms never tested live with two browsers; scores/replays API unwired in UI
- Synth-only audio (no rolling loop); AI is L1 only; no real-device testing
- Version: bump info.yml + backend/pyproject.toml TOGETHER (see CLAUDE.md)

## Key docs
- README.md (quickstart), CLAUDE.md (agent rules), contracts/ (shot schema)
- Research reports live in chat history (GPU SOTA, physics, backend, feel, pockets, materials)
