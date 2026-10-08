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
