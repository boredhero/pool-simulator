# 1.0.0 reliability review

This release reviewed account consent and statistics, multiplayer shot processing,
opponent presentation, mobile controls, and the release pipeline. The changes below
address reproduced failures or concrete code paths; this is not a claim that every
possible gameplay or deployment failure has been eliminated.

| Finding | Change | Regression coverage |
| --- | --- | --- |
| Jev games were absent from account wins and losses. | Write authoritative Jev results to the durable match ledger in the same transaction as game state. Backfill retained completed games without inventing shot counts. | Actual AI-winning shot, rollback, repeated migration, ownership, reset and retention tests. |
| Agreement acceptance depended on a date rather than content. | Hash canonical visible Terms text; persist acceptance per account; preserve legacy acceptance only for the exact original text. | Changed content, unchanged markup, legacy migration and account-switch tests. |
| A delayed account response could restore stale identity after logout. | Invalidate stale requests and bound account request duration. | Delayed response and timeout browser tests. |
| Concurrent shots could exceed the room simulation cap. | Reserve capacity before the first await and release it after all worker work finishes. | A broadcast barrier admits four simultaneous simulations and rejects the fifth. |
| Rejected predicted shots could leave the client waiting indefinitely. | Return a stable authoritative snapshot with rejection and reconcile it through normal playback handling. | Real paired clients reject a stale shot, restore matching state, then retry successfully. |
| Cancellation could interrupt disconnect bookkeeping. | Shield the final ledger update and drain cancelled simulation workers before releasing capacity. | Disconnect/forfeit tests and the full backend suite. |
| Opponent strokes overwrote the player's spin selection. | Pass the opponent's spin directly to the strike without updating player controls. | CPU and Jev browser regressions. |
| All deployment health probes could fail while CI still reported success. | Explicitly fail after bounded probes; build the release container on PRs. | Shell regression exercises healthy and unhealthy responses; CI builds the image. |
| Dependency installation silently retried without frozen locks. | Require committed npm/uv locks and avoid dependency resolution at container startup. | Container build and required CI. |

## Remaining boundaries

- Live online rooms still require one API process. Persistent match results survive
  restart; active WebSocket rooms do not.
- Historical Jev games already removed by retention cannot be reconstructed. Their
  unavailable shot facts are never estimated or silently treated as known zeros.
- Shared simulator fixtures check specific trajectories and rules, not complete
  physical equivalence. Planner evaluations do not establish competitive strength.
- Browser checks cover simulated touch and trackpad input. Physical-device testing
  remains useful for operating-system gestures and perceived animation performance.
- Database initialization still inspects schema on request paths. The release avoids
  repeated no-op Terms writes; a broader initialization cache needs explicit engine
  invalidation and concurrency tests before changing that lifecycle.

See the README for reproducible checks, deployment, storage and backup instructions.
