# Opponent cue presentation (0.9.2)

The client presents a selected shot, rather than inventing an animation of the
model thinking. While CPU/Jev planning is pending, hide the human cue. Once a
concrete executable shot is known, show its aim, pullback and forward stroke, then
execute the exact selected shot once. Jev remains server-authoritative: presentation
does not select another aim, change power, or affect the stored outcome.

Player aim, spin, power, placement and called-shot controls are unavailable during
opponent turns. Camera controls remain available so a spectator can follow the
shot. Starting another rack, changing opponent or entering a room invalidates
pending presentation; delayed responses must not shoot into a different game.

Reduced-motion preferences use a brief static aim presentation instead of cue
pullback animation. Thinking/aiming transitions can be announced as status text,
without emitting announcements every animation frame.

Research references:

- [W3C animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)
  supports suppressing unnecessary movement for users who request reduced motion.
- [W3C status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages)
  describes accessible updates without moving keyboard focus.

Tests should verify cue visibility, actual selected aim/power consistency, exact
once-only firing, cancellation, unchanged shot fields under human inputs, camera
freedom, reduced motion, and authoritative Jev placement/playback.
