# pool-simulator — Phased Plan (from 3 research reports)

## Choices locked
- v1 modes: practice + simple AI + local 2P, architected for online private rooms (anonymous, share-code). Online turn-based shot-event sync (not 60Hz streaming).
- Rules: 8-ball WPA full, extensible to 9-ball. Table 100x50in (2.54x1.27m), balls 57.15mm/170g, pockets corner 4.5in / side 5in with jaw-bumper capture.
- Graphics: Three.js r186, WebGL2 baseline (`WebGLRenderer`), upgrade to `three/webgpu` WebGPURenderer with auto-fallback + `?renderer=webgl2` override. One baked PMREM env, 1 shadow light (1024 desk / 512 mobile or blob), DPR≤2 desk / ≤1.5 mobile adaptive, MSAA 2-4x mobile, KTX2/ASTC 1024², <80 draws.
- Physics: custom (not matter/cannon/Rapier for v1 sim): state x,y,vx,vy,ωx,ωy,ωz, μs~0.2 μr~0.01 e_bb~0.95 e_cush~0.6-0.8, Coulomb throw, squirt as aim map, 240Hz accumulator + swept ball-ball/ball-cushion + jaw pockets + sleep. Dual impl TS+Python, golden-vector tested, bit-identical NOT assumed — reconcile at rest.
- Net: shot event {pose,aim,power,tip,shotId} ~60B, snapshot 16x(pos+vel) ~0.5KB at rest. FastAPI WS Room manager (in-proc dict → Redis later). REST for scores/replays v1.
- Backend: FastAPI+uvicorn, SQLite WAL (SQLAlchemy2+Alembic), anonymous device_id cookie, no auth v1. Single Docker container (node build → python slim), Fly.io/Hetzner.
- UI: canvas full-bleed + DOM HUD, pointer events + touch-action:none, desktop aim+slider vs mobile drag-to-shoot, portrait top-down / landscape angled, viewport-fit=cover + dvh + safe-area, ≥48px targets, tap-to-start audio unlock.

## Phases
- P0 skeleton (this scaffold): monorepo builds, health, placeholder sim/render, CI, golden harness.
- P1 solo sim: TS sim + rules + Three table/balls/cue + drag/aim controls + vitest golden (head-on, cut 30°, cushion 45°, WPA 4-length, slide-roll, draw/follow, break no-tunnel, sleep).
- P2 Python mirror: numpy sim + 8-ball rules + pytest same goldens + /api/scores/replays + serve dist.
- P3 rooms WS: Room join/code, turn/foul authority, shot broadcast + rest snapshot validate, live ghost aim preview, reconnect/snapshot resync.
- P4 adaptive + mobile: DPR adaptive, blob fallback, KTX2, PWA persist, Playwright matrix + real iPhone/Android.
- P5 AI L1 geometry + noise σ, L2 Monte-Carlo rollouts (100-1000 sims <1ms each).

## Non-goals v1
Auth/accounts, matchmaking rating, Postgres/Redis, jump/massé z-axis, Unity/Godot, WebGL1 fallback, per-frame state streaming.
