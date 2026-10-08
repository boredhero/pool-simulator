# Off-table behavior (0.9.4)

Flight remains deterministic. The simulation already models cue elevation, the downward strike and slate rebound, gravity, 3D ball collisions, and finite-height rails. No random jumps or power multiplier were added.

## Physical behavior

The shared `contracts/off-table-flight.json` cases use the same automatic cue clearance and strike functions as actual play. A cue ball close to the rail (.06 m from the end, .4 m across), aimed diagonally inward at .7 radians, leaves the table at full break power; the same geometry at .3 power stays. Both cases run mirrored across each axis, settle within 5,000 fixed steps, and distinguish off-table from pocket events. This is a controlled high-elevation example, not a measurement of real-world departure frequency.

A concrete collision defect was fixed: a descending ball above a jaw could collide with its planar disk when already overlapping that disk. The overlap correction now requires the same maximum bottom height as jaw contact. Both simulators test that a ball above the jaw continues forward instead of bouncing against an invisible wall.

The rail gate remains an approximation at .05 m ball-bottom height, not a cushion-nose measurement. Rails do not impart vertical velocity; there is no modeled rail-top resting surface or complete rubber profile. Balls disappear after crossing the existing outer boundary; the bed-plane landing model outside the playable rectangle is unchanged. These limitations require geometry and rendering work before claiming detailed off-table flight realism.

Elevated cue strikes and airborne rack impacts are documented causes of hop; glancing airborne hits can send the cue ball off the table. See [Dr Dave's explanation with high-speed demonstrations](https://drdavepoolinfo.com/faq/break/ball-hop/). The new fixtures exercise this existing energy-based behavior instead of inventing chance-based mistakes.

## Presets

| Event | Bar house preset | Tournament preset |
| --- | --- | --- |
| Cue leaves table | Scratch; kitchen placement | Scratch; anywhere in regular play, kitchen on break |
| Ordinary object leaves table | Foul; object respotted | Foul; object remains out |
| Eight leaves table during regular play | Loss | Loss |
| Eight leaves table on break | Loss | Eight respotted; opponent gets kitchen placement |
| Other object leaves table on break | Respot and foul | Remains out; opponent gets kitchen placement |

A simultaneous legal pot does not cancel the foul. Tournament removed object balls join the return order without being recorded as pocket events. An off-table break takes priority over the automatic weak-break rerack. Custom rules retain the existing Bar off-table policy; selecting Tournament activates the Tournament policy.

Tournament follows the off-table disposition in [WPA rules, sections 2.6, 3.1, 3.5, and 4.3–4.9](https://www.wpapool.com/wp-content/uploads/2026/01/2026.01.02-WPA-Rules.pdf). The published PDF is effective September 15, 2025. This game automatically chooses kitchen placement after a break foul rather than offering all WPA incoming-player choices, so it is not a complete implementation of that ruleset. Bar remains this project's documented house preset. [APA's official floor-ball rules](https://rules.poolplayers.com/game-rules/balls-on-the-floor/) use different spotting and continuation behavior; there is no implied APA certification.

## Verification

`contracts/off-table-rules.json` supplies the same 22 cases to Python and TypeScript: cue, own object, opponent object, eight, break versus regular play, simultaneous pot and off-table ball, and eight-pot/cue-off loss. The tests check actual object disposition, placement, turn, and winner. The flight contract supplies eight mirrored production-strike cases, with an additional regression for airborne jaw overlap.

Run backend `pytest tests/test_off_table.py tests/test_flight.py tests/test_rules.py tests/test_planner.py -q`, frontend `npm test -- tests/off-table.test.ts tests/flight.test.ts tests/rules.test.ts tests/cpu-turns.test.ts`, and `PYTHONPATH=.:tests python tests/benchmark_planner.py` from backend. The eight existing planner fixtures retain 8 legal outcomes, 5 called pots and no scratches (geometry baseline: 6 legal, 3 called pots, 1 scratch). Existing planner fixtures remain useful regression evidence, not a win-rate estimate.

New matches identify these rules as `eight-ball:2`. Room and Jev state metadata use the same version, and new match-ledger rows record it. Historical ledger rows retain their original metadata; this change does not migrate them or add a protocol compatibility gate.
