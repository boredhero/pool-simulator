# Finite pocket geometry

The simulator uses circular **slate cutouts**, a finite horizontal shelf, rounded
jaw collisions, a rigid sharp slate lip and a cylindrical pocket liner. It no
longer removes a ball when its planar path enters a speed-dependent capture
circle, and there is no attractive pocket force. The visible slate holes use the
same radii and centers as physical support.

The [WPA equipment specifications](https://www.wpapool.com/wp-content/uploads/2024/01/RECOMMENDED-EQUIPMENT-SPECIFICATIONS.pdf)
define mouth endpoints and shelf measurement. We select 114.3 mm corner mouths,
127 mm side mouths, 32 mm corner shelves and 6.35 mm side shelves. Corner nose
intercepts are mouth / sqrt(2), because that opening is diagonal. These selected
dimensions lie within the published ranges; they do not claim to reproduce a
particular manufacturer's table.

At a sharp lip, let d be horizontal distance into the cutout and h the sphere
center height above cloth. Support follows d²+h²=R². Gravity acts when the center
crosses the cutout; an inelastic unilateral contact removes inward normal
velocity if the sphere penetrates that support. Rim tangential friction and bevel
compliance are currently omitted. Below the lip, the ball remains a live 3D
sphere and can contact other balls. An e=0.25 cylindrical liner limits horizontal
travel; its back wall also intercepts shallow fast entries. This restitution is
an explicitly **uncalibrated modeling choice**, not a measured leather value.
The sharp lip and vertical liner are approximations; full facing backdraft,
rubber deformation, beveled slate geometry and basket ball piles remain future
calibration work.

A ball is recorded as potted only when its bottom passes 110 mm below cloth
inside the pocket. Prior lip/jaw returns remain live and produce no pot event.
The renderer displays actual simulated bottom height, without a second visual
lip dip or premature capture/drop animation. A terminal pot transfers to the
return channel. Pocket interiors still use a visual well below the terminal
plane; we do not simulate a full basket/return mechanism.

The outer 1/240 s physics step is subdivided near pockets to no more than 1/1920 s
and 1 mm travel at the current maximum nearby ball speed. Both implementations
use identical bounds and collision ordering. Tests halve the outer timestep and
compare descent, verify shelf support/return, high-speed entries, airborne
crossings and multi-pot chronology. These establish implementation consistency;
they are not empirical validation against recorded table trajectories.

[Mathavan et al. (2010)](https://drdavepoolinfo.com/physics_articles/Mathavan_IMechE_2010.pdf)
shows that cushion spin/friction response needs richer modeling than a normal
restitution alone, and limits its own rigid-cushion model's experimental agreement
to roughly 2.5 m/s normal speed. Its fitted coefficients are not transplanted to
pocket liners. [Pooltool's algorithm discussion](https://ekiefl.github.io/2020/12/20/pooltool-alg/)
also identifies full pocket dynamics as a simplification in event-based models.
