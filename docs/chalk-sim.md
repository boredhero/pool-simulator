# Chalk-Sim

Chalk-Sim is an optional Easter egg. A signed-in player enters ↑ ↑ ↓ ↓ ← → ← → B A to unlock the Easter eggs section at the bottom of Settings. The authenticated unlock saves `accounts.easter_eggs_enabled`; it does not enable the mechanic. Checking **Chalk-Sim Enabled** separately saves `accounts.chalk_sim`. Both default to false. Neither is inferred from browser storage.

Two blue chalk cubes sit on opposite wooden rails, away from the playing surface and pocket mouths. Click/tap either cube, or use the keyboard-accessible **Rechalk** button, on your turn before shooting. Both cubes replenish your current cue; each player has independent chalk. Appearance is based on [Tweeten's chalk](https://tweeten.us/chalk/) and [product photographs](https://www.cue-shop.jp/shopdetail/000000000736/): a small cube with paper sides and exposed, recessed chalk. The meshes use original generic markings, not downloaded logos.

For local games the setting changes at rest. Jev matches keep their starting rules. In online games either participant's enabled selection at room entry enables Chalk-Sim for both seats for that match. Guests and players who have not unlocked Easter eggs can rechalk in such a match. The inherited rule never changes their account flags or saved preference. Ongoing online rules are not changed by saving a preference.

## Contact model

Ordinary games assume a reliably chalked tip. Enabling Chalk-Sim starts both cues at full chalk. The grip calculation compares required tangential impulse with available friction, using the contact offset and ball radius. When the tip grips, the existing strike calculation remains unchanged. When it slips, the tangential impulse and spin decrease together and the launch direction changes coherently; there is no random spin/power bonus.

The geometric friction requirement is supported by [Alciatore TP 2.1](https://drdavepoolinfo.com/technical_proofs/TP_2-1.pdf), a simplified model neglecting squirt. [Cross (2008), *Cue and ball deflection (or “squirt”) in billiards*](https://www.physics.usyd.edu.au/~cross/PUBLICATIONS/39.%20squirt.pdf) experimentally distinguishes gripping and slipping contacts. Neither source provides a universal chalk lifetime.

The following are **gameplay approximations**, not fitted experimental material parameters:

- Friction capacity varies linearly from 0.25 when empty to 0.70 when full.
- Each accepted stroke consumes `0.12 + 0.08 × power + 0.10 × normalized tip offset`, clamped to zero.
- Rechalking restores level 1. CPU/Jev automatically rechalk below 0.45 before planning. Candidate previews use the resulting level.

A full tip supports the existing 0.55-radius offset limit. Center hits can still grip when chalk is empty. Shot power and contact offset affect wear, but elapsed time, aiming, rejected requests, and the other player's shots do not. Chalk does not alter rail clearance, cloth friction, or ball–ball friction. Residue and ball cling are not modeled.

## Authority and persistence

Room and Jev state contain `chalk: [level0, level1]`. The server derives chalk impulse, wear, and miscue metadata; client-supplied chalk values are not trusted. Rechalking checks ownership, current turn, idle state, active game, enabled rule, and revision. It increments revision and broadcasts/returns authoritative state. AI rechalking performs no separate provider request or allowance reservation.

TypeScript/Python share golden contact/velocity/wear fixtures in `contracts/chalk.json`; browser tests cover independent wear, inherited room rules, and stale rechalk responses. Normal mode remains the default and follows the unchanged full-grip strike path.
