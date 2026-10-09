# Application data inventory

Checked against the database models, authentication/account endpoints, provider payload,
and cleanup/deletion code for release 1.5.0. This describes application behavior. It does
not assert a retention period for separately configured reverse-proxy logs or backups.

| Records | Stored information and purpose | Retention and deletion |
| --- | --- | --- |
| `accounts` | Stable ID, username/normalized key, most recent rename time, creation/last-active times, password/recovery hashes, Premium/Sim/disabled and optional-feature flags, saved appearance/camera/playback preferences, optional monthly allowance override | Account lifetime; removed on account deletion. Google-only accounts use a disabled-password marker until recovery sets a password. No username history table; matches retain name snapshots. |
| `terms_acceptances` | Account ID, accepted content hash, acceptance time; adult affirmation is part of acceptance | Replaced by later acceptance; removed with account. No date of birth or identity document. |
| `login_sessions`, `auth_fresh` | Hashed session token, account, session expiry and recent-authentication expiry | Sessions last up to 30 days; recent authentication five minutes. Logout/recovery/credential removal/disable revoke relevant sessions; expired rows are removed during later sign-ins. Account deletion removes both tables' account rows. |
| `passkeys` | Credential ID/public key, name, account, signature counter, transport list, backup state, creation/last-use times | Until removal, recovery, or account deletion. Never private keys or biometric data. |
| `passkey_challenges` | Challenge, purpose, account where applicable, hashed browser/session binding, site origin, relying-party ID, expiry | Five-minute validity, single-use consumption; expired rows purged on later ceremonies. Recovery/deletion remove account-bound rows. |
| `google_identities` | Stable Google subject, pool account ID, link creation time | Until unlink, recovery, or deletion. Never used to match accounts by email. |
| `google_flows` | Nonce, purpose, hashed binding, account for linking, Google subject for pending signup, expiry | Five-minute validity per flow; consumed on use and expired rows purged at later Google starts. Account-bound rows removed on unlink/recovery/deletion. Anonymous abandoned signup tickets can remain until subsequent cleanup. |
| `auth_throttles` | Hash of scope/identity (which can be source IP or username), attempt count, window expiry | Enforces abuse limits; expired rows deleted during subsequent rate-limit operations. Hashing an identifier is not anonymization. |
| `game_matches`, `match_players`, `match_shots` | Mode/rules/version, start/end, outcomes, player account links and display-name snapshots, per-player counters, shot inputs and facts | No automatic expiry. Account deletion clears its match-player links and replaces its names with `Deleted player`; shared match/shot history remains. |
| `jev_games` | Account, stored game state, simulation/rules, times/status/revision, token/cost totals; obsolete daily fields and historical network hashes may remain | Startup/hourly maintenance deletes games last updated more than 90 days ago; deletion removes account rows. New games do not record network hashes. Shared results survive detailed-game cleanup. |
| `jev_requests` | Internal request/account/game IDs, revision/seat/month/model, start/finish, status, token counts, recorded price, calculated charge and unknown-cost reservation | Deleted 90 days after request start by maintenance, or with account. Charges are calculated ledger amounts, not provider debit receipts. |
| `jev_usage` | Account lifetime provider attempts and successful selections | Until account deletion; separate from detailed-game/request retention. |
| `jev_budget_settings`, `jev_budget_adjustments` | Operator default allowance; adjustment actor/target where applicable, month/kind/amount/time | Current settings persist. Adjustments expire 90 days after their timestamp; account-specific adjustments are removed with account. |
| `admin_audit` | Actor/target IDs, old/new Premium status, time | No automatic expiry; relevant rows removed on account deletion. |
| `admin_account_actions` | Opaque actor/target IDs, lifecycle/Sim action, time | No automatic expiry; survives account deletion and includes the deletion event. No username or credentials stored in these rows. |
| `visitor_sessions`, `feature_events` | Hashed random session token, consent version, broad touch/pointer device class, session/event times, allowlisted feature names | Separate adult analytics opt-in; no account link, IP, user agent, typed content, URL, or referrer in analytics rows. Current session/events deleted on withdrawal; sessions inactive more than 30 days and their events removed by maintenance. |

## Browser and provider data

- Essential cookies: `pool_session` (30 days), `pool_passkey` (six minutes),
  `pool_google` (ten minutes). HttpOnly, Secure in production; session SameSite=Lax,
  ceremony cookies SameSite=Strict. Cookie lifetime and database cleanup are separate.
- Optional analytics cookie: `pool_analytics`, one day, HttpOnly, only after consent;
  withdrawal clears it. Privacy choice persists locally; GPC/DNT disable analytics.
- Local storage: table/cue styling, input/camera/playback settings, dismissed help/tutorial,
  welcome/Terms acknowledgement and privacy preference. Service worker caches game assets.
  Application credentials are not stored in local storage.
- Google Identity Services loads only after choosing Google sign-in. Google receives the
  browser connection and its own authentication interaction. The backend verifies an ID
  token; our database does not persist that token, email, Google name/photo, access token,
  refresh token, or a Google password. The browser SDK can receive provider profile data
  as part of that interaction; “not stored” does not mean Google never transmits it.
- TypeSafe receives structured server-owned game context/rules and offered shot-plan
  consequences, authenticated with the server API key. Model input excludes account IDs,
  usernames, browser IPs, credentials, and player-written text. Provider connection/billing
  metadata is distinct from model input. The admin panel links to provider billing; the documented API does not expose a prepaid
  balance, so the app marks that balance unavailable. Neither is per-player billing evidence.
- Host/reverse-proxy/access logs and backups are outside application cleanup. Verify their
  actual deployment configuration separately before promising a fixed deletion deadline.

## Implementation references

- [Database models](../backend/app/models/db.py)
- [Scheduled cleanup and analytics consent](../backend/app/api/privacy.py)
- [Account deletion and audit](../backend/app/api/admin.py)
- [Authentication sessions](../backend/app/services/auth.py)
- [Passkeys](../backend/app/api/passkeys.py), [Google sign-in](../backend/app/api/google.py)
- [Jev provider context and requests](../backend/app/api/jev.py), [usage ledger](../backend/app/services/jev_budget.py)

The public [Privacy Notice](../frontend/public/privacy.html) summarizes these practices.
The [Terms](../frontend/public/terms.html) describe the monthly allowance. Terms text changes
require regenerating `contracts/terms.json`; the previous legacy hash must remain pinned.
Clarifying essential account-data disclosures does not grant analytics consent or change its
collection scope; the existing analytics-consent version remains unchanged in this release.
