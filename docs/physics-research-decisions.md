# Physics research decisions for 1.6.0

New physical effects need a published basis and an implementation that actually
follows that model. A paper describing the same phenomenon does not validate an
unrelated solver or its coefficients. This release narrows the proposed work on
pockets, cue contact and advanced AI accordingly.

## Kept

| Change | Basis and implementation | Limits |
| --- | --- | --- |
| Pocket mouth and shelf geometry | [WPA equipment specifications, section 9](https://www.wpapool.com/wp-content/uploads/2024/01/RECOMMENDED-EQUIPMENT-SPECIFICATIONS.pdf). Correct the diagonal corner-mouth measurement and use the same opening geometry in rendering and simulation. | Dimensions specify equipment, not the dynamics of a ball rattling inside it. The table is still an idealized geometry. |
| Geometric pocket capture and falling presentation | [Kiefl, Pooltool algorithm description, ball–pocket events](https://ekiefl.github.io/2020/12/20/pooltool-alg/). Crossing a geometric capture boundary is an explicit simulator simplification; gravity provides the subsequent visual descent. | This is published simulator methodology, not an experimentally validated model of a shelf lip or a pocket liner. Capture is terminal; no deep bounce-out is claimed. |
| Short continuation search for CPU and Jev | [Smith, *Running the Table: An AI for Computer Billiards*, AAAI 2006](https://fileadmin.cs.lth.se/ai/Proceedings/aaai06/09/AAAI06-156.pdf). Evaluate follow-up shots through the production rules and simulation rather than only valuing the immediate pot. | Our bounded deterministic search is an adaptation, not a reproduction of PickPocket's stochastic evaluation. Beam width, preview count and deadline are performance choices, not physical constants. |
| Existing instantaneous stroke model | Retain the existing impulse implementation while researching a replacement. [Alciatore, TP B.10, pages 2–3](https://drdavepoolinfo.com/technical_proofs/new/TP_B-10.pdf) discusses a sequential cue impact/slate rebound approximation and its limitations. | The retained implementation is not an exact implementation of that paper and is not newly certified by its citation. Existing squirt, jump and chalk approximations remain limitations. |

## Removed or deferred

| Proposed effect | Research found | Why it is not included |
| --- | --- | --- |
| Pocket liner bounce-out | No billiards source establishing the proposed cylindrical liner and its restitution was found. | The proposed `0.25` restitution and wall geometry were assumptions. Removed rather than presented as measured behavior. |
| Rolling around or returning from the pocket lip | Published sphere–hole work exists, including [Penner, *The physics of putting* (2002)](https://doi.org/10.1139/P01-137). | Our proposed contact projection was not a verified adaptation of those equations. Golf-hole geometry and contact assumptions also need an explicit transfer to pool. Deferred the solver, rather than adding a citation to a different model. |
| Finite tip compression and shaft dynamics | [Kim, *Motions of a billiard ball after a cue stroke* (2022), especially section V](https://arxiv.org/abs/2104.11232) models cue/end dynamics. [Alciatore's contact-time measurements](https://drdavepoolinfo.com/faq/cue-tip/contact-time/) establish a finite contact interval. | These do not validate our proposed clipped spring/damper tip law. Removed that solver; tip deformation, detailed shaft flex and contact-duration simulation remain deferred. |
| Simultaneous cue/ball/slate compliance | [Jia, Mason and Erdmann, *Multiple impacts: A state transition diagram approach*, IJRR 32(1), 84–114 (2013), section 8](https://doi.org/10.1177/0278364912461539) includes a massé experiment. | Its coupled impact method differs materially from the proposed `0.8 ms` slate spring. Removed the spring and its unsourced calibration. Implementing the published method requires separate work and validation. |
| New double-hit and push-shot detection | Rules describe these fouls, but rules alone do not supply a contact solver. | With finite contact deferred, there is no reliable new contact history to detect them. Removed the arbitrary grazing threshold and new foul flags. No duration threshold is used to invent a push-shot foul. |
| Deliberate jump/massé rescue candidates | [Alciatore TP B.9](https://drdavepoolinfo.com/technical_proofs/new/TP_B-9.pdf), [TP B.10](https://drdavepoolinfo.com/technical_proofs/new/TP_B-10.pdf), and [TP A.19](https://drdavepoolinfo.com/technical_proofs/new/TP_A-19.pdf) derive relevant motion and discuss assumptions. | Published phenomena do not make the existing high-elevation approximation accurate enough for a new specialized planner. Deferred those candidate families until their contact physics is implemented and validated. Ordinary cue-clearance elevation remains. |

## What the tests establish

Geometry tests check dimensions and render/collision agreement. Planning tests
check completed legal continuations, work budgets and independence from the Jev
API. Differential tests compare actual Python and TypeScript outcomes, including
pocket order and final positions. Browser tests check execution and presentation.

These tests establish internal correctness and repeatability for covered cases.
They do not establish experimental accuracy, a measured win rate, or equivalence
to professional billiards equipment. See [pocket physics](pocket-physics.md),
[cue stroke](stroke.md), [planning](advanced-planning.md) and
[simulation synchronization](simulation-sync.md) for implementation details.
