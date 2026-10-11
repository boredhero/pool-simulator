# Bounded shot and continuation planning

Both the offline CPU and server planner propose geometric shots, simulate them
with the production stroke/physics/rules, and retain measured legal results. Jev
selects from server-verified options; it does not supply unverified trajectories.
The CPU never calls a model or provider.

## Research basis

[Smith, Running the Table (AAAI 2006)](https://fileadmin.cs.lth.se/ai/Proceedings/aaai06/09/AAAI06-156.pdf)
compares greedy choices with probabilistic and Monte Carlo lookahead. Its central
useful result here is that evaluating subsequent shots can improve play over
immediate-pot selection. Perturbed rollouts can measure execution uncertainty,
but increase branching substantially. Our implementation uses a bounded,
deterministic two-ply beam with a third shot in sparse endgames, not a claimed win probability or full-rack solution.

[Pooltool's physics documentation](https://pooltool.readthedocs.io/en/latest/autoapi/pooltool/physics/index.html)
distinguishes 3D cue contact (retaining the vertical velocity component) from a
2D clamp. Elevated action proposals need actual 3D physics and identical replay;
adding shot labels alone cannot implement jumps or curves.

The [WPA rules](https://www.wpapool.com/wp-content/uploads/2026/01/2026.01.02-WPA-Rules.pdf)
(section 2.11) distinguish a legal jump from scooping the ball. Our jump proposals
use elevated downward strokes, never artificial upward launch forces.

## Search and execution

- Existing direct, bank, kick, development, safety and break candidates remain.
- A blocked cue-to-ghost route with a clear object-to-pocket route can propose
  elevated jump and sidespin massé rescues. These are proposals, not promises.
- Elevation is stored on the action and resolved against shaft clearance. The
  same resolved elevation must be used by preview, cue animation and execution.
- Completed root states retain actual rule outcomes and chalk wear. Two leading
  continuing roots get up to two simulated follow-ups each; sparse endgames can
  spend a remaining preview on a third shot, within the original
  total preview count and wall-clock deadline.
- `followUpVerified` means a legal continuing second shot was simulated.
  `runout` means that a simulated continuation won the rack. Neither is a statistical
  probability, nor a prediction robust to arbitrary execution errors.
- Expired or unsettled previews do not count as verified. Partial searches retain
  completed options. Geometric fallback remains explicitly unverified.

The default budgets remain 16 previews / 2 seconds on the server and 12 previews /
120 milliseconds in the browser. These are work limits, not guaranteed search
coverage: large clusters can consume a budget before continuation search starts.
Accuracy of the evaluated plans depends on the underlying calibrated physics.
