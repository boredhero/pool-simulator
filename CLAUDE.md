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
- Ruff is enforced by CI, not by hand: `test.yml` has a dedicated `lint` job
  (`ruff check` + `ruff format --check` on `backend/`) that runs on every push
  to any branch and every PR. A lint failure fails fast alongside tests — do
  not merge red. Config: `select = ["E","F","I","W","UP"]` in
  `backend/pyproject.toml`. You can still run `uvx ruff check --fix .` in
  `backend/` locally before pushing to catch it early.
- Deploy secrets (`DEPLOY_HOST/USER/KEY`) exist; `Build and Deploy` runs only
  on `main` and skips SSH steps gracefully if secrets are absent.
- Prod: https://pool.martinospizza.dev (nginx on boredhero.dyndns.org →
  127.0.0.1:8000, certbot auto-renew). Container: `~/pool-simulator`.
