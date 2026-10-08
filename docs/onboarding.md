# Welcome and practice tutorial (0.9.3)

New visitors receive a welcome dialog with brief game context, explicit adult
Terms acceptance, a separate optional analytics choice, and a prominent quick
tutorial action. Analytics is off by default and does not gate either tutorial
or ordinary play. GPC/DNT preferences remain respected. Guest/browser Terms
acknowledgment does not replace the authenticated server's account/Jev acceptance.

The tutorial uses an isolated offline practice layout. It does not submit shots
to Jev, consume an allowance, or send multiplayer events. Entry is unavailable
while an online match, authoritative request, or a rolling shot cannot safely be
interrupted. Finishing or leaving practice restores the saved local game and
camera rather than retaining tutorial pots, settings or opponent state.

Each step stages the task and frames a visible work area. The compact nonmodal
coach must leave its relevant table/controls unobscured. Instructions follow the
actual touch interface or selected Mouse & Keyboard/Trackpad profile, including
trackpad scrolling and the current keyboard shortcuts. Camera staging and internal
setup do not count as successful user actions.

## Design references

- [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  supports native welcome focus containment while keeping background controls
  inert. The tutorial itself must leave the game interactive.
- [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) motivates
  compact mobile layouts with readable, reachable controls across viewport sizes.
- [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
  supports checking actual target and focused-control bounds against the guide.

Validation covers first-visit choices, storage/reload, optional consent behavior,
welcome-to-tutorial handoff, input-specific text, staged targets, real control
actions and exit restoration. Synthetic touch/pointer checks supplement desktop
and mobile screenshots; actual trackpad hardware feel remains device-dependent.
