# Pocket geometry and scope

## Retained

The [WPA equipment specifications, sections 7–11](https://www.wpapool.com/wp-content/uploads/2024/01/RECOMMENDED-EQUIPMENT-SPECIFICATIONS.pdf)
define mouth endpoints and shelf measurement. We select 114.3 mm corner mouths,
127 mm side mouths, 32 mm corner shelves and 6.35 mm side shelves. Corner nose
intercepts are mouth / sqrt(2), because that opening is diagonal. These dimensions
lie within the published ranges; they do not reproduce a particular manufacturer.
The rendered slate holes and simulation use the same circle centers/radii.

Pocketing remains a **geometric termination approximation**, as described in
[Pooltool's published algorithm account, ball–pocket collisions](https://ekiefl.github.io/2020/12/20/pooltool-alg/).
A grounded ball whose center enters the slate cutout is recorded as potted. The
existing rounded jaw/rail collision model still rejects off-center entries before
that boundary. Airborne balls can cross above the hole. Near-pocket deterministic
substeps bound travel to 1 mm and time to 1/1920 s; these are numerical resolution
choices verified by convergence tests, not material parameters.

After the geometric event, the renderer shows a **presentation-only** vertical
fall using h = h0 − gt²/2, the constant-gravity equation given in
[OpenStax University Physics, Free Fall](https://openstax.org/books/university-physics-volume-1/pages/3-5-free-fall).
That animation does not collide, change scoring, or simulate a pocket interior.
There is no artificial attractive force or speed-dependent capture radius.
The unchanged geometric termination limitation is explicit: shelf contact is
approximated at the center crossing, rather than resolving a finite sphere
rolling around a lip.

## Deferred rather than invented

We do **not** ship the prototype frictionless sharp-lip projection, cylindrical
liner with an assumed restitution, or arbitrary terminal-depth rule. None was
verified as an implementation of a published pocket-contact model. Consequently,
this release does not claim live rim rolling, deep-pocket bounce-outs, pocket
liner materials, bevel compliance, or interactions with a basket of balls.

Published relevant sphere/hole work exists:

- [Penner, The physics of putting (2002)](https://raypenner.com/golf-putting.pdf),
  drawing on Holmes' ball/hole capture analysis.
- [Mechanics of the golf lip out](https://pmc.ncbi.nlm.nih.gov/articles/PMC12585879/),
  with uniform-sphere plane/rim/cylindrical-hole dynamics including spin.

Adapting those equations to pool equipment would require a separate reviewed
implementation and source-based assumptions. They are research leads, not
retroactive justification for the removed prototype. WPA equipment dimensions
alone likewise do not supply a liner restitution coefficient.

## Validation

Tests cover the actual selected mouth/shelf dimensions, no attraction of shelf
hangers, no hovering over a hole, geometric entry at multiple speeds, airborne
crossing, ordinary existing jaw rejection without energy gain, two sequential
pots, shared geometry rendering, and timestep convergence. Cross-language replay
checks validate consistency; no measured real-table calibration is claimed.
