# pool-simulator

GPU-accelerated browser pool (8-Ball extensible) + Python backend.
Decisions (Socratic dialog 2026-10-06): online private rooms (anonymous), hybrid physics (client predicts / Python validates), realistic 3D adaptive quality, different controls per device, practice + simple CPU, dual sim (TS + Python) with shared golden tests.

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

## Changelog maintenance

Always update the root `changelog.json` as you make user-visible changes. The
version button displays this committed file in the in-game changelog modal. Keep
releases newest first, with `version`, ISO `date`, `title`, and a `changes` list
of plain-language entries. Add changes to the current release while iterating;
create a new entry when bumping the version. Keep its version aligned with
`info.yml`, `backend/pyproject.toml`, and `backend/uv.lock`. Build the frontend
after editing the changelog to validate its import.

## Online play and optional accounts (0.5.0)

Open **Online → Create room**, then copy the invite link. The link carries an
8-character room code in its fragment (`/#join=CODE`), so the code is not part of
normal HTTP request/referrer logs. Opening it pre-fills the join form; guests need
no account. Both players must join before shooting. Rooms close when a player
leaves, refreshes, loses the connection, or is idle for 15 minutes. A completed
match stays recorded; an unfinished disconnect does not award a win.

Accounts are optional and usernames are 3–20 ASCII letters, digits, or underscores,
unique without regard to case. Passwords are 15–128 characters. Passwords and
recovery codes are salted Argon2id hashes (19 MiB, two passes, one lane), never
reversibly encrypted. The 160-bit recovery code is shown once; successful recovery
rotates it and invalidates all sessions. Without either the password or recovery
code, there is no administrative bypass or email recovery. Opaque session cookies
are HttpOnly, SameSite=Lax, expire after 30 days, and are Secure in production.
Only token hashes are stored in the database; credentials are not kept in browser
storage. Auth mutations require a same-origin request and a custom request header.
Account/IP attempt limits persist across server restarts.

Account stats count server-simulated private online matches, not client-submitted results or local/CPU games. The ledger stores stable account IDs, guest/name
snapshots, opponents, rules/version, timestamps, outcomes, disconnects, and shot
facts. This is the foundation for future lobbies/matchmaking; private games are
currently unrated and there is no public matchmaking queue yet.

### Persistence and deployment

Both Compose files retain the existing named `pool_data` volume at `/srv/data`,
with `DATABASE_URL=sqlite:////srv/data/pool.db`. Rebuilding/replacing the container
preserves accounts, session verifiers, match history, and stats. Initial startup
creates the current tables idempotently. The premium upgrade explicitly adds
`accounts.premium` (default false) and makes `jev_games.day` nullable using an
Alembic batch migration, preserving game data, indexes and free-game uniqueness.
NULL allowance days identify premium games; `started_at` retains creation time.
Changes to existing columns need explicit migrations. Obsolete test tables in
an existing database are no longer mapped or exposed by the application.

Production publishes port 8000 on host loopback for the existing HTTPS reverse
proxy, and trusts that proxy’s forwarded client IP so rate limits apply per client.
Do not expose the API port publicly while trusting forwarded headers.
Production Compose sets `COOKIE_SECURE=true` and allows origin
`https://pool.martinospizza.dev`. Set `ALLOWED_ORIGINS` (comma-separated) when using
additional trusted frontend origins. Local HTTP development keeps Secure cookies
off by default. No Fernet key or application encryption key is required. Protect
the database and its backups as account data.

Run **one Uvicorn worker / one API instance** while live rooms are held in memory.
SQLite uses WAL, foreign keys, and a busy timeout. The production entrypoint (`python -m app.server`) marks shutdown before closing
live sockets; restarting marks persisted active matches interrupted without inventing
wins/losses. Leaving or losing connection after the first accepted shot is a casual
forfeit; leaving before play starts is an abandonment without a winner. PostgreSQL can replace the SQLAlchemy database URL later, but horizontal
scaling also needs shared room coordination and distributed rate limiting.

For a consistent live backup (including the WAL), use the backup API rather than
copying `pool.db` while it is open:

```sh
docker compose exec -T api uv run --directory backend python scripts/backup_db.py /srv/data/backups/pool-2026-10-08.db
docker cp pool-simulator-api:/srv/data/backups/pool-2026-10-08.db ./pool-2026-10-08.db
```

Use a fresh output filename for each backup and keep a copy outside the Docker
volume. For a restore, stop the API, restore the database into the same volume,
remove stale WAL/SHM files from the stopped database, then restart. Do not run
`docker compose down -v` unless intentionally deleting all persistent data.

### Integration checks

```sh
uv sync --project backend --frozen
npm --prefix frontend run build
cd frontend
npm run test:online
```

The online suite starts a real backend on port 8011 with a temporary SQLite database
and exercises account creation, recovery, persistent sessions, a registered host,
a guest invite, authoritative shot results, and stats. It never uses the development
or production account database. Ordinary UI tests stay backend-independent.

Security references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), and
[account recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

### Mobile and trackpad controls (0.6.0)

On a touchscreen, drag one finger on the felt to aim continuously. Lift without
shooting, set the power slider, then tap **Shoot**. Two fingers moving together
orbit the table; spreading/pinching the same fingers zooms without needing to
restart the gesture. Lift both fingers before aiming again. **View → Move camera**
retains one-finger orbit and two-finger pan/zoom. Three-finger gestures are not
required because they can conflict with operating-system accessibility controls.

Mobile player names, groups, and remaining counts stay visible. **Show balls**
expands the numbered ball details; **More** reveals CPU and new-rack controls. Spin and Reset remain visible for every shot.
Mouse play still uses hover-to-aim and pull/release. On trackpads, Shift-scroll
orbits, normal scroll/pinch zooms, and camera mode offers left-button dragging.

The gesture implementation uses [Pointer Events](https://www.w3.org/TR/pointerevents3/)
and [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html).
Browser tests exercise real multi-touch pinch-to-orbit and partial finger release;
physical Android/iOS hardware remains useful for evaluating feel and OS gestures.

Dependabot checks weekly for npm, uv, Docker, and GitHub Actions updates. Runtime
and development dependencies are grouped separately for npm and uv; container
images and Actions each have their own group. Version-update PRs target `develop`
so they go through tests before the release PR to `main`. Configuration follows
[GitHub's grouping reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).


### Online security (0.6.1)

The server simulates shots, checks turns and placements, and records results.
Browser state and playback acknowledgements are not trusted. The legacy `/api/scores` and `/api/replays` routes, database models, and unused
REST replay transport have been removed entirely.
Account totals are unranked casual statistics, including private/custom games and
forfeits. They are not a matchmaking rating: cooperating players and aiming bots
can still produce valid shots. Future ranked games need a separate eligibility and
abuse policy; never reuse these casual totals as ranked results.

Connections are capped at eight per IP and 400 total, with 200 rooms and four
concurrent simulations. Each socket has a 30-message burst, replenishing at one
message per second. Before joining a room, sockets time out after 30 seconds;
room sockets time out after 15 minutes without a message. HTTP bodies and production
WebSocket messages are limited to 16 KiB. The single-worker production entrypoint
also limits WebSocket queues and marks planned shutdowns before disconnecting
players. Use `python -m app.server` for production, as the Dockerfile does.

HTTPS pages use same-origin HTTPS and WSS with normal browser certificate validation.
Browsers no longer support site-controlled HPKP certificate pinning; we do not
attempt JavaScript pinning. HTTPS responses send HSTS (one year, this host only),
plus CSP, anti-framing, no-referrer, and MIME-sniffing protection. TLS terminates at
the host proxy, with the backend port published only on loopback. Keep the proxy's
HTTP-to-HTTPS redirect and certificate renewal working. Do not expose the backend
port publicly or widen forwarded-header trust.

References: [OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html),
[Chrome HPKP removal](https://developer.chrome.com/blog/chrome-72-deps-rems/),
and [HSTS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security).

## Jev AI, privacy, and daily games (0.7.0)

CPU stays offline and account-free. Jev AI requires a signed-in adult account and
explicit acceptance of the current Terms. It offers **one server-owned game per
free account and per source network per UTC day**. IPv6 /64 addresses share an allowance.
An unfinished game resumes after reload, even across server restarts. A new local
rack does not reset the free game. Server simulation owns turn progression, legal
shots and the winner; clients cannot supply Jev prompts, candidate sets or costs.

Premium accounts show a badge in Settings and Account and have unlimited Jev
games without a daily account/network allowance or midnight expiry. Select Jev
to resume, or use **New rack** during Jev to abandon that rack and start another.
Premium games do not consume the shared free network allowance. Terms acceptance,
authentication, short request throttles, concurrent-turn limits and the global
paid-call safeguard still apply; reaching that safeguard uses visible CPU fallback.

After deploying, toggle an existing account on this host (case-insensitive):

```sh
cd ~/pool-simulator
docker compose exec -T api uv run --directory backend python -m app.premium USERNAME on
docker compose exec -T api uv run --directory backend python -m app.premium USERNAME off
```

To enable all accounts that currently exist, use the same command with `--all-existing on` in place of `USERNAME on`. New registrations still default to free.

The boolean defaults off. There is no public API for setting it. Existing sessions
see changes on their next account refresh or Jev request. Revocation prevents
premium-only games from continuing and does not reset a consumed free allowance.
Back up the existing database before upgrading; preserve the `pool_data` volume.

Jev 1.13 chooses among up to 12 server-planned shots with semantic descriptions
of settled physics previews. A bounded planner proposes direct pots, banks,
kicks, combinations and safeties, including cue placement when needed. One model
request selects a tactical family and its corresponding offered plan. The server
owns placement, aim, power, spin and all outcomes. Single-plan turns need no model
call; provider failures or the emergency paid-call budget use a visible local
fallback. Reported usage is metered even when an answer is invalid.

The offline CPU also previews a bounded set of legal-target shots and plans
placement together with the shot. Kitchen escapes can leave the head string
before returning to a target inside it. Deterministic regression fixtures improve
legality and pots over the old geometry policy; this does not establish Jev's
competitive win rate. See [planner research and benchmark](docs/planner-research.md)
and [Jev decision design](docs/jev.md) for sources and limits.
Jev games do not count toward online account win/loss statistics.

Set `JEV_API_KEY` only in the backend process environment or deployment folder's
ignored `.env` (mode `0600`). Both Compose configurations pass it to the API. Never
use a `VITE_` key or commit a credential. Missing configuration leaves other modes
working. The production pool nginx proxy must **replace** `X-Forwarded-For` with
`$remote_addr`, not append arbitrary client headers; only the loopback-published
backend should be reachable. This is required for trustworthy network allowances.

`jev_games` stores private game state, revisions, request counts, provider input
and output tokens, estimated cost in nano-USD, and unmetered failures. The pinned
model price is recorded per game (42 nano-USD per input token as researched); this
is an estimate, not an invoice. Failed or incomplete provider responses can leave
actual charges unknown, explicitly counted as unmetered. These records have no
public reporting endpoint. Account/game ownership checks protect resume endpoints.
`jev_usage` retains lifetime attempt/completion counters. Free-game admission is capped
at 100 daily games, paid calls at 1,000 per 24-hour budget window, concurrent Jev
game turns at four, and turn requests at 30/minute/account. The call cap falls back
to CPU instead of ending the rack. Network and account identity are not proof of a
unique human; the global caps bound abuse even across accounts and VPNs.

Terms and Privacy are served at `/terms.html` and `/privacy.html`, with operator
Noah Martino, Pennsylvania, and personal.boredhero@gmail.com. Registration requires
an 18+ affirmation and records Terms version/time; existing users accept updated
Terms in Account before Jev use. These documents need qualified legal review for
the operator's actual audience and practices; they do not certify legal compliance.

Optional first-party feature analytics is off until separate adult opt-in. Privacy
choices offers withdrawal and honors GPC/DNT. `visitor_sessions` and `feature_events`
store random session identifiers, broad input type, times and fixed feature names;
no account link, IP, URL, raw user agent, text input, or session replay. There are no
analytics read endpoints. Consent uses an HttpOnly one-day cookie; withdrawal
removes that session and its events. Older unlinked sessions expire through retention.
Essential sign-in, security limits and Jev billing/allowance records are independent
of analytics consent. Terms acceptance never implies analytics consent.

Hourly maintenance removes analytics inactive for 30 days and detailed Jev games
inactive for 90 days. Preserve the existing `pool_data` volume. New tables are
additive. Account access/export/deletion requests go to the public contact address;
verify ownership without asking for a password or recovery code. Production host
logs and backup rotation must be managed separately from application retention.
See [Jev integration notes](docs/jev.md) for research and evaluation limitations.

The Help panel includes an optional interactive tutorial. It observes real aiming,
spin, camera and shot actions, supports skipping/back/close, and does not reset the
current rack. Its shot step uses the current game rather than a separate practice
simulation. The panel stays centered in the space between scores and controls.
On compact screens, tap either scorecard (or use Enter/Space when focused) to show
or hide ball details; there is no floating Show balls button.

## Owner dashboard (0.8.0)

Set `ADMIN_ACCOUNT_ID` in the deployment environment to the existing owner's
immutable account ID. An unset value disables administration. Usernames do not
grant privileges, and registration cannot assign admin status. The owner sees
**Admin settings** in Settings. Every `/api/admin/*` endpoint checks the active
server session and configured ID; other callers receive 404. Premium mutations
require the same origin/request header protection as account mutations and
record an audit entry.

The dashboard provides account search, Premium filtering, sorting, pagination,
Premium toggles, per-account game usage and recent Premium changes. Token and
cost totals cover retained game records (removed after 90 days of inactivity),
not a lifetime invoice. Unmetered requests are shown separately because missing
provider usage does not establish zero cost. Lifetime attempt/completion counts
are labeled separately. Credentials, recovery hashes and network identifiers
are never returned by the admin endpoints.

Settings, View and Online panels have draggable headers, click/keyboard Move
controls and Reset position. WASD moves the camera relative to its view; the
HUD Fly control opens a four-arrow touch pad. Camera movement pauses while
editing fields or using dialogs.
