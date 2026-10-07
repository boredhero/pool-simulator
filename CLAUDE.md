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
  by branch protection (PR + `test` check required).
- Backend uses `uv` (`backend/pyproject.toml` + `uv.lock`). Never pipenv here.
- Lint gate is ruff `select = ["E","F","I","W","UP"]` — run
  `uvx ruff check --fix .` in `backend/` before pushing.
- Deploy secrets (`DEPLOY_HOST/USER/KEY`) exist; `Build and Deploy` runs only
  on `main` and skips SSH steps gracefully if secrets are absent.
- Prod: https://pool.martinospizza.dev (nginx on boredhero.dyndns.org →
  127.0.0.1:8000, certbot auto-renew). Container: `~/pool-simulator`.
