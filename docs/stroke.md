# Cue impact: scope and research

The shared `strike_balls` / `strikeBalls` entry points use the established
instantaneous cue impulse. `simulate_stroke` runs that same launch followed by
the normal ball simulation. This release does **not** add finite tip contact,
shaft flex simulation, push shots or double-hit detection.

An experimental spring/contact implementation was removed because its tip
stiffness, simultaneous slate response and referee thresholds were not grounded
in a directly implemented published billiards model. A publication establishing
that a phenomenon exists does not validate arbitrary coefficients or a different
solver. Adding detail without that support would not establish better accuracy.

The existing impulse mechanics use solid-sphere inertia, linear/angular impulse,
frictional slate rebound, and the existing empirical launch calibration. For a
ball of radius R and mass m, I=2/5 mR²; an impulse at normalized offset b gives
the familiar spin ratio R*omega/v=5b/2. The existing speed and linear squirt
calibrations remain approximations, not measurements of a specific cue.

[Dr. Dave TP B.10](https://drdavepoolinfo.com/technical_proofs/new/TP_B-10.pdf)
uses sequential cue impulse followed by table rebound, with high-speed-video
support specifically for modest cue elevations. It lists example restitution
and friction parameters. Our existing engine follows that general sequential
approach; it does not reproduce all of that paper's parameter values or claim
accuracy for extreme elevations. Existing geometric clearance can still raise
the cue; that is separate from validating deliberately selected jump/massé shots.

## Published paths for future work

- [Measured tip contact times](https://drdavepoolinfo.com/faq/cue-tip/contact-time/)
  establish millisecond contacts but do not specify a complete tip force law.
- [Kim, Motions of a billiard ball after a cue stroke](https://arxiv.org/pdf/2104.11232)
  provides a flexible-end impact model, including an approximate 12 g end mass.
  We have not implemented that full model here.
- [Jia, Mason and Erdmann, Multiple impacts: A state transition diagram approach](https://publications.ri.cmu.edu/storage/publications/pub_files/2013/1/The_International_Journal_of_Robotics_Research-2013-Jia-84-114.pdf)
  models coupled cue/ball/table impacts and compares a massé experiment. Its
  contact-state and energy-based restitution formulation is a candidate for a
  properly sourced future implementation.
- [WPA rules 3.7–3.8](https://www.wpapool.com/wp-content/uploads/2026/01/2026.01.02-WPA-Rules.pdf)
  distinguish repeated contact, frozen balls, grazing close contacts and pushes.
  Reliable foul detection requires an implemented contact model; proximity alone
  is insufficient. We do not produce or expose these unmodeled foul facts.

Tests verify the shared entry point retains the established engine's exact
launch state, satisfies the angular-impulse relation, and reports actual ball
contacts without inventing unmodeled stroke fouls. Cross-language replay tests
remain necessary for full-rack consistency.
