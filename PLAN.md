# pool-simulator — Plan & build log

Live: https://pool.martinospizza.dev · `main` deploys via GHCR + compose.
Flow: work on `develop`, PR to `main` (protected: PR + `ci` check), merge to ship.

## Stack (locked)
- Frontend: Vite + TS + Three.js (WebGL2 baseline, WebGPU path later), custom 2D+spin sim
- Backend: FastAPI + uvicorn + SQLite WAL (`/srv/data` volume), serves `frontend/dist`
- Net: turn-based shot-event sync over WS, server authoritative on rules
- CI: required fast checks/release workflow plus advisory browser checks on development pushes, Dependabot weekly grouped

## Physics contract (both sims, keep in sync)
- Planar rolling + 3D flight/spin, SI units, fixed dt=1/240, swept TOI + gravity
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

- Assisted cue clearance feeds the same elevated impulse in TS and Python.
  Downward cue impulse rebounds from the slate; gravity, airborne collision
  normals, landing friction, and low-height pocket capture affect play.
- Eight-ball strategies consume pre-shot snapshots and physical facts. Shared
  JSON fixtures exercise both implementations. Bar, Tourny, and Custom expose
  explicit calls, kitchen placement, break rules, and speed limits. Server
  derives elevation and owns outcomes; rooms carry rules/version/revision.
- Large self-hosted Atkinson Hyperlegible UI, automatic pointer-aware help,
  wide desktop rules settings, separate desktop version card, immediate pot
  indicators. Pure sidespin at rest no longer delays turn completion.

## Model and preset decisions
- Bar is a named house preset, not a universal bar standard: scratch in the
  kitchen, other fouls anywhere, call the 8, single-group break pots assign that group, mixed break pots leave
  the table open, 8 on a legal break wins, scratch
  while on the 8 loses. Kitchen shots must leave the kitchen before contacting
  an object inside it. If all legal targets are inside, spot the nearest one.
- Tourny is a tournament-inspired preset: call every scoring shot, normal
  scratch anywhere, break scratch in kitchen, 8 on break respots. This is not
  a claim of complete WPA officiating: illegal breaks automatically rerack for
  the opponent and off-table objects respot; no referee choice flow is modeled.
- Pre-shot group membership decides whether the shooter was legally on the 8;
  pocketing the final group ball and 8 in the same stroke is an early-8 loss.
- Flight uses a rigid impulse/restitution approximation (slate restitution .5,
  sliding friction .2), not calibrated cue-tip compliance. Cushion collisions
  use a finite-height gate, not a rounded 3D rail collider. Ball-ball tangential
  throw remains the existing planar approximation during airborne impacts.
- Rest threshold is 5 mm/s (<0.13 mm additional rolling distance); isolated
  residual sidespin is discarded at rest instead of blocking the next turn.

## Research references
- [Pooltool cue impulse](https://github.com/ekiefl/pooltool/blob/main/pooltool/physics/resolve/stick_ball/instantaneous_point/__init__.py)
  and [table impact](https://github.com/ekiefl/pooltool/blob/main/pooltool/physics/resolve/ball_table/frictional_inelastic/__init__.py)
  informed elevation, spin projection and Coulomb-limited landing impulse.
- [Kim cue-impact paper](https://arxiv.org/html/2104.11232v2) distinguishes
  rigid impulse models from cue/tip compliance and off-center stroke effects.
- [WPA 2026 rules](https://www.wpapool.com/wp-content/uploads/2026/01/2026.01.02-WPA-Rules.pdf),
  [APA US Amateur rules](https://poolplayers.com/us-amateur-championship/rules/),
  and [CSI rules](https://www.playcsipool.com/uploads/7/3/5/9/7359673/official_rules_of_csi__08122025.pdf)
  informed explicitly named presets rather than a supposed universal bar rule.
- [Hexagonal architecture](https://alistair.cockburn.us/hexagonal-architecture),
  [state pattern](https://gameprogrammingpatterns.com/state.html), and
  [deterministic lockstep](https://gafferongames.com/post/deterministic_lockstep/)
  informed the rules boundary, pre-shot context and authoritative room state.
- [W3C interaction media features](https://www.w3.org/TR/mediaqueries-5/#mf-interaction)
  and [pointerType](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pointerType)
  inform automatic help on hybrid devices. Font assets and OFL license are
  self-hosted from [Atkinson Hyperlegible](https://github.com/googlefonts/atkinson-hyperlegible).

## Open / known gaps
- Pocket forgiveness for casual play (strict-pro now); cloth-speed setting
- Rooms never tested live with two browsers; scores/replays API unwired in UI
- Synth-only audio (no rolling loop); AI is L1 only; no real-device testing
- Version: bump info.yml + backend/pyproject.toml TOGETHER (see CLAUDE.md)

## Key docs
- README.md (quickstart), CLAUDE.md (agent rules), contracts/ (shot schema)
- Research reports live in chat history (GPU SOTA, physics, backend, feel, pockets, materials)

## Latest visual and group-assignment refinements
- Original procedural maple/walnut cue with ferrule, chalked leather tip,
  brushed joint, pearl points/rings, linen grip and rubber bumper. Clearance
  dimensions match its 1.45 m length and larger butt in both simulators.
- Kitchen placement has a shaded region, dashed head string and in-scene label;
  the guide remains while aiming the required shot out of the kitchen.
- Appearance offers dots, elongated diamonds (default), double diamonds, squares or none,
  saved locally. Real references: [A.E. Schmidt sights](https://shop.aeschmidtbilliards.com/products/mother-of-pearl-diamond-rail-sight),
  [Alexander double diamonds](https://aeschmidtbilliards.com/product/alexander-pool-table/),
  [Imperial Aris square sights](https://imperialusa.com/products/aris-8-pool-table).
- User selected immediate single-group break assignment for Bar. Tourny still
  stays open after the break; Custom exposes the switch. Both player cards
  refresh as soon as that scoring shot resolves, before the next shot starts.
- Material review fixed cloth bump height being derived from the albedo red
  channel: independent neutral height maps now give every theme the same fine,
  isotropic weave. Bed/cushion sheen is reduced and theme-tinted. Wood uses
  coherent periodic grain with subtle height/roughness maps; theme changes keep
  its pattern deterministic. Anisotropy is capped and shared by all maps.
  References: [Three texture data/color spaces](https://threejs.org/docs/pages/Texture.html),
  [material maps](https://threejs.org/docs/pages/MeshStandardMaterial.html),
  [physical sheen](https://threejs.org/docs/pages/MeshPhysicalMaterial.html), and
  [Simonis nap-free worsted cloth](https://www.simoniscloth.com/product/simonis-860/).
  A remaining refinement is individual longitudinal UV mapping on the short
  end rails; the current continuous surround retains its original UV layout.

## Cabinet and ordered ball return
- The rail and bed outlines now use 140 mm rounded outside corners, with a
  softer 8 mm rail bevel. Pocket and cushion physics coordinates are unchanged.
- Added apron panels, rounded skirt trim, underframe, four tapered legs,
  adjustable feet, shadow-receiving floor, and a glazed side return channel.
- Captured object balls are displayed oldest-first across the channel during
  shots. Capture order persists in client/server match state and room snapshots;
  spotting removes a ball from the channel, and a new rack resets it. Scratched
  cue balls return to ball-in-hand instead of occupying the object-ball window.
- Return travel is a presentation animation, not a simulated internal chute.
  Desktop framing includes the cabinet; mobile retains a larger playing surface
  and can orbit down to inspect the cabinet.
- References: [Brunswick Gold Crown VI aprons, legs and rail castings](https://www.brunswickbilliards.com/products/gold-crown-vi-9-foot-pool-table)
  and [Valley ball-view doors](https://www.valley-dynamoparts.com/product_categories.php?catid=16&line=2).

## Settling, optional fast playback, and live feedback
- Fixed both simulators' sliding-to-rolling transition. For a solid sphere,
  contact slip decreases at `(7/2) * mu_s * g`; the previous `3/2` threshold
  allowed the sliding impulse to overshoot and alternate indefinitely at low
  speeds (reproduced with 0.014 m/s and zero spin). Clamp sliding duration to
  the exact transition, then apply rolling drag during the remaining step.
  Regression tests check settling, non-increasing energy, analytical rolling
  deceleration, and shared Python/TypeScript flight fixtures.
- Research did **not** establish a credible population mean/median for full
  pool-break settling. [Dr. Dave's break model](https://drdavepoolinfo.com/technical_proofs/new/TP_B-6.pdf)
  uses the same representative sliding/rolling coefficients, 0.2/0.01.
  [Mathavan et al. (2009)](https://drdavepoolinfo.com/physics_articles/ajp_09_hsv_article.pdf)
  measures 0.124–0.126 m/s² rolling deceleration on a snooker table; our
  0.0981 m/s² is not calibrated to that table. Neither source provides an
  average full-break rest time. Real calibration needs uncut, timed shots.
- Reproducible 16-shot local benchmark: seeds 1–16, small aim offsets,
  80–100% break power, automatic cue elevation. Run from `backend` with
  `PYTHONPATH=. .venv/bin/python scripts/benchmark_settling.py`.
  Before fix: mean 13.166 s, median 7.660 s, range 6.142–30.767 s.
  After fix: mean 6.149 s, median 6.000 s, range 5.379–6.971 s.
  All shots settled below the 45 s cap. These are simulated seconds from a
  small synthetic sample, not real-world statistics or a universal target.
- **Fast-forward fine movements** defaults off and persists locally, separately
  from match rules. When all live balls are grounded and both translation and
  rolling surface speed are below 0.25 m/s, spend wall time at 4× playback.
  Every contact still uses the unchanged 1/240 s step; tests verify identical
  final ball states and contact events. Recheck eligibility every step.
  Queue online snapshots/following shots until local playback finishes so
  players can use different viewing speeds without snapping the slower view.
- Cards update immediately after simulated captures, including on an open
  break. Provisional groups are clearly marked pending and retract on a later
  foul; authoritative rules resolve only when the shot ends. The shooting
  player's card also lists captures/scratches while other balls move.
- Dismissing instructions persists across reloads and viewport changes. The
  information button always allows reopening the guide manually.

## Faster local iteration and reliable CI
- Run `npm run test:watch` in `frontend` for immediate physics/rules feedback.
  Run `npm run test:e2e` (or `test:e2e:ui`) for browser checks. Locally these
  use a separate Vite server on 4173 and read current source without rebuilding;
  the watched game on 5173 remains available. CI checks the production build.
- Browser tests intercept the version endpoint with a deterministic fixture;
  backend tests separately cover its real implementation. No missing-backend
  proxy requests are needed for these standalone frontend tests.
- The browser smoke uses actual mouse input and real WebGL frames, but advances
  the real game frame/physics logic synchronously to resolve the shot. Other UI
  assertions skip redundant WebGL draws after initialization; they still run
  game updates, input handling, DOM layout, and scene synchronization.
  This is not a replacement for visual inspection or multiplayer integration.
- Two browser workers run locally; CI uses one to avoid software WebGL CPU
  contention. Redundant draws pause in-page immediately after initialization,
  before browser-protocol round trips can queue additional expensive frames.
  The smoke renders a real post-shot frame as well. Bounded action/test timeouts,
  proper waitForFunction options, and failure trace/screenshot uploads replace
  two-minute silent waits. Frontend unit tests now run in CI as well.
- Develop updates run checks through the open PR's synchronize event. The `ci`
  job aggregates only lint, unit tests, builds and release jobs. Browser checks
  run in a separate advisory workflow on pushes to all branches except main
  and master, with stale runs cancelled. Neither `ci` nor deployment waits on
  E2E. Main branch protection already requires only `ci`, so no protection
  bypass or server-side settings change is needed. Release
  images build only on main, without the redundant host-side frontend build.
  The Docker build now respects TypeScript failures; deployment waits for tests.
- References: [Playwright API mocking](https://playwright.dev/docs/mock),
  [waitForFunction signature](https://playwright.dev/docs/api/class-page#page-wait-for-function),
  [parallelism](https://playwright.dev/docs/test-parallel), and
  [GitHub PR event branch filters](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

## Camera/table clearance
- Orbit elevation is constrained by zoom distance and the camera near-plane
  extent. Close zoom raises the lowest permitted viewing angle, keeping the
  eye and near-plane corners above the rail tops without changing zoom or yaw.
  The guard runs after orbit damping before drawing, for mouse and touch alike.

## Pocket and return-window seam cleanup
- Return-channel side walls and ceiling overlap its back and apron edges,
  closing oblique sight lines through the cabinet around the glass frame.
- Recessed felt cutouts, dark cut-edge materials and straight pocket liners
  remove the green ring formerly exposed behind tapered wells.
- Each cushion is one closed cloth mesh with rounded ends following the shared
  jaw outlines. Separate intersecting jaw cylinders have been removed. These
  are visual geometry changes; collision and capture definitions remain shared.
- Checked close pocket and window views, plus raycast regressions for cushion
  face orientation, closed return ends and the recessed felt edge.

## Ball artwork and optional cue markings
- Replaced 256×128 UV-painted ball artwork with 1024×512 spherical number
  medallions and antialiased stripe boundaries. Tangent-projected numerals stay
  legible on both sides; 6/9 have distinguishing underlines. Smooth warm-white
  resin uses restrained specular/clearcoat highlights, not surface grain or
  baked lighting. Mesh silhouettes use 48×32 sphere segments.
- Appearance offers plain, six red spots, red ring, blue dot, and black triangles.
  The cue preference persists locally; switching disposes the previous texture
  and changes no simulation state. These are generic markings, not brand logos.
- Manufacturer references: [Aramith cue-ball variants](https://aramith.com/cue-ball/),
  [Brunswick blue dot](https://www.brunswickbilliards.com/products/blue-dot-cue-ball),
  [Predator black triangles](https://predatorcues.com/products/predator-arcos-ii-reserve-cue-ball-with-black-triangles),
  [resin finish](https://aramith.com/general-specifications/), and
  [embedded number cores](https://aramith.com/aramith-makes-difference/).
- The head-string callout has a permanent local dismissal. Its dashed boundary
  and shaded kitchen remain; the information panel retains the explanation
  whenever the active rules use kitchen placement (including Custom).

## Spin input and execution research
- Added Reset beside the spin pad. It clears both offsets and the marker without
  altering balls already in motion. Arrow keys adjust a focused pad, Shift uses
  smaller increments, and Home/0 resets. Pointer capture cleans up on release
  or cancellation; markers fit the desktop/mobile control.
- Keep deterministic impact physics by default. The existing sim already has
  squirt, elevation effects and a 0.55-radius offset cap. Real inconsistency is
  delivery error (contact point, direction, speed), not a random result from
  identical clean impacts. No reliable population distribution of amateur tip
  error was found, so no arbitrary random miss penalty was added.
- A two-axis cue-ball selector is an established approach, not proven uniquely
  optimal: [Miniclip's spin UI](https://support.miniclip.com/hc/en-us/articles/35451960569361-Advanced-Plays-Spins-8-Ball-Pool)
  and [Virtual Pool's tip/stroke controls](https://vponline.celeris.com/support/quickstart).
  [Dr. Dave on grip/miscues](https://drdavepoolinfo.com/faq/squirt/miscue-limit/)
  and [contact accuracy](https://drdavepoolinfo.com/faq/sidespin/maximum/)
  distinguish execution precision from repeatable contact physics. Roughly half
  the ball radius is a practical contact guideline, not a universal threshold.
- A possible future opt-in execution mode would map stroke gesture to bounded,
  visible delivery deviation, showing the actual impact point. It needs play
  testing. Resolve actual shot parameters once for server/replay consistency;
  never add independent random errors inside the client and server simulators.


### 0.3.0 camera and release history
- Explicit mobile camera mode separates one-finger orbit and two-finger pinch/pan from shooting; placement commits on tap release to avoid pinch gestures placing the cue ball.
- Optional post-shot group framing swings behind the cue toward the narrowest angular arc containing a strict majority of current-player targets. It fits the cue plus all eligible targets, respects placement space and HUD, yields to manual input, and honors reduced motion. Defaults on for mobile and off for desktop; preference persists.
- Version badge opens a native dialog backed by root changelog.json; contributor docs require keeping it current.
- Camera interaction research: https://www.w3.org/WAI/WCAG21/Understanding/pointer-gestures and https://threejs.org/docs/pages/OrbitControls.html.

Camera direction uses sorted cue-relative bearings and a wrapped sliding window of floor(n/2)+1 targets. Near-ties prefer the smallest rotation; azimuth interpolates over the shortest arc. Group eligibility comes from legalTargets rather than shot-selection AI. Whole-table and placement views retain the existing azimuth. Reference: https://threejs.org/docs/pages/Spherical.html and https://threejs.org/docs/pages/MathUtils.html.

Auto-framing refinement: use a 26-degree elevation above the cloth, fit padded bounds around individual balls, and align the idle human cue with the final view. Do not align during a pull, placement, AI turn, or opponent turn.

### 0.5.0 optional identity and online foundation
- Guest room links carry 8-character random invitation codes; no account wall.
- Optional case-insensitive usernames, Argon2id password/recovery hashes, rotating
  one-use recovery codes, and opaque server-revocable cookie sessions.
- Durable SQLite account/match/participant/shot ledger in the existing Compose
  volume, with server-only stats and stable opponent identifiers for future queues.
- Server finalizes shots independently of client playback acknowledgement. Waiting
  rooms cannot shoot; disconnects close rooms and record unfinished matches.
- Auth origin/header checks, persistent rate limits, no-store account responses,
  session revocation and recovery/login race protection. Static serving is confined
  to frontend/dist. WebSocket transport is an explicit runtime dependency.
- Real online browser suite uses an isolated temporary database. Accounts and
  sessions persist through reconnecting the SQLAlchemy engine; live rooms do not.
- Deliberately deferred: ranked matchmaking, public lobbies, reconnection/resume of
  live rooms, email recovery, and tracking local practice/AI as verified matches.

### 0.6.1 legacy cleanup

Removed the unused client-submitted score/replay API, ORM models, and REST transport.
Online shot submission uses the authoritative WebSocket protocol; account statistics
come from its server-owned match ledger. Earlier score/replay notes above are historical.
