# Bounded continuation planning

Both the offline CPU and server planner propose geometric shots, simulate them
with the production physics/rules, and retain measured legal results. Jev selects
from server-verified options; it does not supply unverified trajectories. The CPU
never calls a model or provider.

## Kept: published simulation lookahead

[Smith, Running the Table (AAAI 2006)](https://fileadmin.cs.lth.se/ai/Proceedings/aaai06/09/AAAI06-156.pdf),
Figures 3–4 and the experimental comparison, studies probabilistic and Monte Carlo
lookahead against greedy immediate-shot selection. It supports evaluating
subsequent shots and describes the computational tradeoff between depth and
sampling. Our implementation uses a deterministic two-ply beam with a third
shot in sparse endgames. It does not claim to reproduce the paper's stochastic
algorithm, measured playing strength, or success probabilities.

Beam widths, search depth, preview counts, and ranking weights are computational
choices. They do not change ball motion and are not presented as physical
constants or experimental measurements.

- Existing direct, bank, kick, development, safety and break candidates remain.
- Resolved shaft-clearance elevation is carried by the action so preview and
  authoritative execution use the same stroke.
- Completed root states retain actual rule outcomes and chalk wear. Two leading
  continuing roots get up to two simulated follow-ups each; sparse endgames can
  spend a remaining preview on a third shot, within the original total budget.
- `followUpVerified` means a legal continuing second shot was simulated.
  `runout` means a simulated continuation won the rack. These are deterministic
  model outcomes, not statistical probabilities or validated real-table outcomes.
- Expired/unsettled previews never count as verified. Partial searches retain
  completed options; geometric fallback remains explicitly unverified.

The default work limits remain 16 previews / 2 seconds on the server and 12
previews / 120 milliseconds in the browser. Large clusters can exhaust the budget
before continuation search begins. This is bounded planning, not exhaustive
full-rack search.

## Deferred: deliberate jump and massé candidates

Jump and massé are real, published phenomena. [Alciatore TP A.19](https://drdavepoolinfo.com/technical_proofs/new/TP_A-19.pdf)
derives massé aiming and curved cue-ball trajectories, while explicitly noting
omitted tip/ball/slate multi-body collision effects. [TP B.9](https://drdavepoolinfo.com/technical_proofs/new/TP_B-9.pdf)
derives cue-ball/slate rebound, and [TP B.10](https://drdavepoolinfo.com/technical_proofs/new/TP_B-10.pdf)
applies the sequential tip-impulse/slate-rebound approximation with experimental
support qualified to modest cue elevations.

Those publications do not validate the custom simultaneous slate-compression
model initially prototyped here, nor establish a universal numeric boundary
between modest and steep elevation. The prototype's deliberate high-angle
jump/massé candidates have therefore been removed. Internal replay tests can
prove that code agrees with itself; they cannot establish physical accuracy.
We retain the existing clearance behavior without claiming new calibrated
high-angle trick-shot physics. Reintroducing these candidates requires a cited,
implemented model valid in their operating range and independent validation.
