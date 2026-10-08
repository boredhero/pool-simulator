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

Account stats count server-simulated private online matches, not client-posted
legacy scores or local/AI games. The ledger stores stable account IDs, guest/name
snapshots, opponents, rules/version, timestamps, outcomes, disconnects, and shot
facts. This is the foundation for future lobbies/matchmaking; private games are
currently unrated and there is no public matchmaking queue yet.

### Persistence and deployment

Both Compose files retain the existing named `pool_data` volume at `/srv/data`,
with `DATABASE_URL=sqlite:////srv/data/pool.db`. Rebuilding/replacing the container
preserves accounts, session verifiers, match history, and stats. Initial startup
adds the new tables idempotently without dropping existing scores/replays. This
release adds tables only; future changes to existing columns need an explicit
migration rather than relying on `create_all`.

Production publishes port 8000 on host loopback for the existing HTTPS reverse
proxy, and trusts that proxy’s forwarded client IP so rate limits apply per client.
Do not expose the API port publicly while trusting forwarded headers.
Production Compose sets `COOKIE_SECURE=true` and allows origin
`https://pool.martinospizza.dev`. Set `ALLOWED_ORIGINS` (comma-separated) when using
additional trusted frontend origins. Local HTTP development keeps Secure cookies
off by default. No Fernet key or application encryption key is required. Protect
the database and its backups as account data.

Run **one Uvicorn worker / one API instance** while live rooms are held in memory.
SQLite uses WAL, foreign keys, and a busy timeout. Restarting the server closes
live rooms and marks their persisted active matches interrupted, without inventing
wins/losses. PostgreSQL can replace the SQLAlchemy database URL later, but horizontal
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
