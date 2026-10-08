# pool-simulator — agent notes

## Version bumps: TWO locations, always both
The displayed site version comes from `info.yml` (`version:`), served via
`GET /api/version` and shown as a HUD badge. The backend package version lives
in `backend/pyproject.toml` (`version = "..."`).
**When bumping the version, update BOTH files to the same value or they drift.**
(`backend/uv.lock` records the package version too — run `uv lock` in `backend/`
after editing `pyproject.toml`.)

## Workflow
- Work on `develop`, open a PR to `main`. Direct pushes to `main` are blocked
  by branch protection (PR + `ci` check required).
- Backend uses `uv` (`backend/pyproject.toml` + `uv.lock`). Never pipenv here.
- `.github/workflows/ci.yml` runs Ruff, backend tests, frontend tests/build and
  container builds for PRs. The aggregate `ci` check must pass. Browser tests run
  separately in `e2e.yml`; run the relevant browser checks for interface changes.
- Dependencies use frozen uv and npm lockfiles. Frontend type checking is part of
  the build and is also available through `npm run typecheck`.
- Only main pushes publish and deploy. Deploy secrets enable SSH deployment;
  failed health probes must fail CI. Never manually deploy while preparing a PR.
- Prod: https://pool.martinospizza.dev (nginx on boredhero.dyndns.org →
  127.0.0.1:8000, certbot auto-renew). Container: `~/pool-simulator`.

## Changelog maintenance

Always update the root `changelog.json` as you make user-visible changes. The
version button displays this committed file in the in-game changelog modal. Keep
releases newest first, with `version`, ISO `date`, `title`, and a `changes` list
of plain-language entries. Add changes to the current release while iterating;
create a new entry when bumping the version. Keep its version aligned with
`info.yml`, `backend/pyproject.toml`, and `backend/uv.lock`. Build the frontend
after editing the changelog to validate its import.

## Accounts and online state
- Never encrypt passwords reversibly or log passwords/recovery codes/session cookies.
  Keep Argon2id hashes, one-use recovery rotation, and HttpOnly cookie sessions.
- Account stats come only from authoritative server matches. Never accept client-submitted scores or replay facts as evidence for stats or future rankings.
- Preserve the `pool_data:/srv/data` volume and DATABASE_URL across releases.
  See README for consistent backups; never delete a production volume as cleanup.
- New schema tables are additive in 0.5.0. Existing-column changes require migrations.
- Rooms are single-process and ephemeral. Run the real online integration tests
  (`npm run test:online` in frontend after a build) for account or room changes.
