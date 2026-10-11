# Finite cue contact

The live shot path uses `strike_balls` / `strikeBalls`; the original impulse
helper remains available for isolated legacy calibration tests. The finite
contact routine returns shot events that must be preserved into subsequent
simulation. It advances all balls, including collisions, while the tip can
still act on the cue ball. No transient contact objects are stored on balls or
serialized into account/game storage.

The cue has 0.54 kg axial mass and 0.012 kg transverse effective end mass.
A 6 mm radius tip contacts a 0.17 kg rigid ball through a unilateral damped
spring. Normal force is clamped nonnegative; tangential impulse cancels slip
only up to the chalk-dependent Coulomb limit. Applied impulses update both
cue velocity and ball translation/rotation. This replaces the old empirical
linear squirt angle in live play. Lower end mass reduces squirt naturally.
Power maps to cue speed using the existing center-hit speed calibration and
a nominal restitution of 0.75.

The nominal axial contact time is 1.2 ms. Contact integration uses 12.5 microsecond
steps. These are reduced-model calibration choices, not measured specifications
of a particular tip or cue. Off-center motion, contact loss and rebounds change
the actual contact duration. A short compliant ball/slate phase (nominal 0.8 ms,
restitution 0.5) allows the elevated cue force to build and release vertical
compression; repeatedly applying the ordinary low-speed rigid landing cutoff
would incorrectly remove every microstep's downward impulse. The internal
slate compression does not alter the rendered ball radius or pocket geometry.
There is no slate support inside a pocket cutout.

For clear shots the routine ends on tip separation after slate release. For
shots near other balls or rails it follows the passive cue for up to 20 ms,
using 0.1 ms steps outside active contact. This bounded follow-through catches
close-ball recontacts without spending that time on every open-table stroke.
It does not model a player's arm applying a second deliberate forward thrust.
The current input system exposes no independent prolonged-push control.

A second distinct tip contact is recorded as a double hit. Object-ball contact
while the tip is engaged is also recorded, except for initially frozen balls
and conservative grazing contacts (directional cosine <= 0.15). The grazing
threshold is an explicit numerical interpretation of a qualitative referee
rule, not a WPA measurement. Frozen status does not exempt actual later tip
recontact. Passive contact duration alone never produces a push foul: a soft
tip is not a deliberate push. The push-event field is reserved for future
controlled-stroke mechanics. Model results should not be advertised as metrology.

## Research

- [Dr. Dave's high-speed contact measurements](https://drdavepoolinfo.com/faq/cue-tip/contact-time/)
  motivate millisecond contact resolution and distinguish tip contact from visual follow-through.
- [TP A.31, squirt](https://drdavepoolinfo.com/technical_proofs/new/TP_A-31.pdf)
  motivates effective end mass and coupled translational/angular response.
- [TP B.19, end mass versus stiffness](https://drdavepoolinfo.com/technical_proofs/new/TP_B-19.pdf)
  supports a reduced end-mass model rather than adding a second arbitrary shaft spring-back kick.
- [TP B.20, tip force and contact distance](https://drdavepoolinfo.com/technical_proofs/new/TP_B-20.pdf)
  provides a millimetric contact-distance and force-time sanity reference.
- [WPA rules 3.7–3.8](https://www.wpapool.com/wp-content/uploads/2026/01/2026.01.02-WPA-Rules.pdf)
  distinguish repeated contact, frozen balls, grazing close contacts, and prolonged pushes.

Tests cover center calibration, energy bounds, mirrored spin, end-mass response,
step-size convergence, actual close-ball recontact, frozen-ball exceptions,
elevated launch, and preservation of contact events through complete shots.
Python/TypeScript parity and full-game tests additionally exercise the live path.
