# pool-simulator — Plan & build log

Live: https://pool.martinospizza.dev · `main` deploys via GHCR + compose.
Flow: work on `develop`, PR to `main` (protected: PR + `ci` check), merge to ship.

## Stack (locked)
- Frontend: Vite + TS + Three.js (WebGL2 baseline, WebGPU path later), custom 2D+spin sim
- Backend: FastAPI + uvicorn + SQLite WAL (`/srv/data` volume), serves `frontend/dist`
- Net: turn-based shot-event sync over WS, server authoritative on rules
- CI: one workflow (lint/test/e2e/docker/deploy), Dependabot weekly grouped

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
