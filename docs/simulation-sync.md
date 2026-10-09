# Simulation synchronization

Online rooms and Jev matches use Python to decide turns, fouls, pocketed balls,
and results. The browser predicts human shots immediately and animates opponent
shots using the returned shot parameters. Local CPU matches use browser physics
and do not call Jev.

## Preserve the starting state

Network snapshots must preserve the simulator's binary64 values through JSON.
Do not round coordinates for display or bandwidth before sending them. Five
decimal places changed rack spacing and moved rail-frozen balls inside the
cushion contact plane. A reproduced break pocketed a ball from the rounded
snapshot but did not pocket it from the original state, even when both were
run through the same Python engine. Applying the final server result then made
the browser's pocketed ball reappear.

The wire representation includes position, height, linear and angular velocity,
sleep state, and pocket state. Clients retain those fields instead of assuming
every received ball has zero velocity. Legacy snapshots without the additional
fields still load as settled balls. Full-precision inputs are necessary, but
alone do not prove identical execution in different runtimes.

## Repeatable execution

Both engines advance at 240 physics steps per simulated second. Rendering frame
rate and fast-forward affect how many steps are played, not the step size. Ball
ordering, collision tie-breaking, constants, shot parameters, and the sequence
of arithmetic operations must also agree. A test that repeats one engine twice
does not establish agreement between Python and JavaScript.

Vector lengths and square roots use matching explicit arithmetic in both
engines. Different norm implementations amplified tiny differences during dense
rack collisions: a differential sample previously disagreed on pocket results
for two of 60 breaks. Matching these operations removed those outcome differences
and reduced the largest final position difference in that sample to about four
micrometres. The regression compares the live implementations, requires equal
pocket outcomes, and permits at most ten micrometres of final position error.
This tolerance is a test bound, not a reason to round network coordinates.

[Box2D's determinism notes](https://box2d.org/posts/2024/08/determinism/) explain
why math-library implementations, operation order, fused arithmetic, and platform
differences matter. Strict cross-platform guarantees require controlled math
throughout a shared solver or equivalent deterministic implementations and tests
on each supported runtime. The current mirrored solvers are not a proof of
bit-identical behavior on every browser and CPU.

Snapshots remain authoritative: preserving a locally predicted pot despite a
different server result would create a contradictory game state. Regression
tests must compare pocket events and final positions, rather than hiding such
disagreements with rendering or scoring changes.

## Validation

`contracts/snapshot-replay.json` covers the precision-sensitive rack and two
successive object-ball pots. Both unit suites exercise those cases; browser
coverage checks that applying the Jev result keeps both balls down and preserves
all received physics fields.

Run the live differential suite from `frontend/`:

```sh
POOL_REPLAY_PARITY=1 npm test -- --run tests/replayParity.test.ts
```

It launches `scripts/physics-replay.py` with Python 3 (standard library only),
replays the same full-precision inputs in TypeScript, and checks ordered pocket
results, pocket identities, first contact, scratches, rail/kitchen events, sleep
state, and final ball state. The required `replay-parity` CI job also gates
main-branch deployment. Ordinary frontend unit runs skip this one cross-runtime
test so a browser-only development environment does not require Python.

The 45-second simulation cap and mirrored math-library calls remain limitations;
this release does not replace the physics engines with a shared deterministic
binary. A future strict bitwise requirement should use a common controlled
solver and a browser/CPU test matrix, rather than increasingly loose tolerances.
