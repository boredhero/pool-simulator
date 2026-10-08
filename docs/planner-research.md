# Jev shot planning

The server generates executable options and resolves isolated previews with the
same cue clearance, strike, 240 Hz physics and rules as real shots. Jev selects
between tactical alternatives; it does not have to derive angles from coordinates.

## Research basis

- [PickPocket, AAAI 2006](https://cdn.aaai.org/AAAI/2006/AAAI06-156.pdf)
  describes direct, bank, kick and combination move generation, speed/spin
  variants, positional evaluation and opponent-aware safety search.
- [CueCard, IJCAI 2009](https://www.ijcai.org/Proceedings/09/Papers/231.pdf)
  uses physics-tested candidates, outcome sampling, lookahead and an offline
  optimized break. Its substantial compute budget is inappropriate to copy
  directly onto the application server.
- [Dr. Dave's bank/kick analysis](https://drdavepoolinfo.com/faq/bank-kick/effects/)
  explains why mirror geometry needs correction for speed, spin and angle.
- [Pooltool](https://github.com/ekiefl/pooltool) provides useful simulation research
  and examples. It is not substituted for this game's authoritative engine.

## Implemented scope

`plan_shots(state)` generates direct, one-rail bank/kick, two-object combination
and contact-safety seeds. It tries limited power, draw/follow and aim variants,
scores actual pot/turn/win/foul outcomes, and estimates subsequent opportunities
for both players. Banks use the ball-center cushion plane and reject pocket gaps.
Combination calls identify the potted ball separately from the first contact.

Ball-in-hand considers legal placements behind promising pot lines before grid
escape positions. Kitchen targets can be contacted after a kick leaves the
kitchen; they are not globally excluded. Trials include automatic cue elevation.

The default budget is 16 trials and two seconds. Individual previews check the
deadline every 24 physics ticks and never report unfinished simulations as
verified. Inputs are copied. Completed legal choices exclude known foul/loss
choices, and immediate verified wins exclude alternatives. If no preview is
available, an executable geometry fallback explicitly reports unknown legality.
The caller must bound concurrent requests; the planner itself performs no I/O.

Evidence describes a single deterministic simulation, not a calibrated success
probability. Positional evaluation is a cheap next-shot geometry estimate, not a
two-ply full simulation. The release does not promise reliable trick-shot pots,
optimized breaks, arbitrary kick escapes, massé/jump planning or a guaranteed
foul-free fallback when the bounded search finds none.

## Reproducible evaluation

From `backend`:

```sh
.venv/bin/pytest tests/test_planner.py tests/test_rules.py tests/test_physics.py tests/test_flight.py -q
PYTHONPATH=.:tests .venv/bin/python tests/benchmark_planner.py
```

The benchmark compares the old first-ranked geometry policy (including its grid
placement) against the bounded planner on the committed exact-state fixtures. It
uses 16 trials without the wall deadline for reproducibility and replays each
selected shot using `simulate_shot`, independently of the planner's preview loop.
It invokes no paid model or account/database services.

Initial eight-fixture results: geometry 6 legal shots, 3 called pots, 1 scratch;
planner 8 legal shots, 5 called pots, 0 scratches. Both won the eight-ball fixture.
These are targeted regression fixtures, not an estimate of competitive win rate.
Follow-up evaluation should use paired rack seeds/starting seats and compare
geometry, planner-only and Jev selecting from the same planner options. Track
fouls, runs, retained turns, latency, fallback rate and provider cost separately.

## 0.9.2: controlled energy and cluster development

The previous candidate queue only reduced power or changed spin; it never tried
a firmer version of a normal seed. Contact safeties used power 0.42 regardless of
congestion, and legal shots passing the turn received no credit for improving
own-ball congestion. A tight group could also be incorrectly rejected because
clearance was tested to the object's center, beyond the cue's first-contact point.

The queue now reserves early trials for an original shot, a variant adding
0.65 m/s of launch speed through the engine's nonlinear power mapping, and two
controlled development seeds when an accessible legal cluster face exists.
Development speeds begin at 2.05/2.85 m/s, with a bounded travel-energy estimate;
configured speed limits and authoritative previews still decide the outcome.
Cluster clearance ends at the cue's first-contact ghost position.

Completed previews report separated neighboring pairs, newly clear object-ball
routes, new direct-shot targets, and corresponding opponent development. The
evaluation limits the reward for raw separation and values a usable cue leave;
foul/loss exclusion and immediate-win priority remain in force. Jev receives
these measured outcomes and a plain-language pace/development description.
Both Python Jev planning and offline TypeScript CPU planning use this approach.
The 16-trial/two-second backend and 12-trial/120-ms browser budgets are unchanged.

This follows CueCard's explicit cluster-dispersal candidates and search over
different feasible speeds, rather than assuming one speed per geometric route.
[CueCard paper](https://www.ijcai.org/Proceedings/09/Papers/231.pdf).
Dr. Dave's worked breakout examples likewise combine controlled speed and spin
to enter a cluster and obtain a subsequent shot; they do not prescribe maximum
power. [February 2010 breakout examples](https://drdavepoolinfo.com/bd_articles/2010/feb10.pdf).

The benchmark additionally compares identical contact aims at powers 0.42,
0.65, 0.85 and 1.0 against the selected plan on three committed cluster fixtures.
For `dense-solids` and its reversed layout:

| Power | Separated nearby pairs | Own direct options afterward | Scratch/foul |
| --- | --- | --- | --- |
| 0.42 | 5 | 0 | none |
| 0.65 | 6 | 1 | none |
| 0.85 | 7 | 1 | none |
| 1.00 | 9 | 0 | none |
| Selected 0.8517, within four trials | 7 | 1 | none |

On `tightly-packed-solids`, selected power 0.8517 opens 11 neighboring pairs and
leaves one own direct option with none for the opponent. Power 0.42 leaves no own
direct option; maximum power exposes an opponent option. Tests independently
replay the chosen shots, cover a development shot that loses on an early eight,
and retain a controlled-power easy pot. All eight earlier fixtures retain their
previous result totals: eight legal shots, five called pots, zero scratches.

These are deterministic targeted regression results, not win-rate estimates.
Object routes and next-shot counts remain geometry estimates, not calibrated
probabilities. A dense arrangement can still require a multi-turn development
plan beyond this bounded one-shot preview, and model selection can choose among
the offered legal alternatives. No paid inference is used by the benchmark.
