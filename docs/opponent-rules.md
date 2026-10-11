# Opponents and rule configurations

Both planners evaluate copied game states with the active rule engine and speed
limits. CPU runs in the browser. Jev's server planner offers executable shots and
their simulated consequences; the model chooses among those plans rather than
deciding which rules to enforce.

New Jev games accept the selected Bar, Tournament or Custom configuration. The
server validates its types and bounds and normalizes named presets. Existing games
keep their saved rules when resumed. Premium players can explicitly start a new
game with different rules; editing controls does not change an active rack.

The model receives the full canonical configuration plus current legal targets,
call requirements, kitchen restrictions, remaining groups and whether it is on the
8-ball. Context also describes policies that are derived from the preset: Custom
uses house-rule off-table handling, while Tournament leaves off-table objects out.
Break scratches grant kitchen placement even when ordinary scratches grant ball
in hand anywhere. Physics and server rule resolution remain authoritative.

## Coverage

- Shared policy examples run through both rule engines for all 96 combinations of
  scratch placement, call policy, 8-on-break outcome, scratch-on-8 loss, assignment
  on break and strict break. They cover eight result scenarios per configuration.
- Planner tests execute actual shots under both named presets and representative
  custom combinations, including call policies and low/high speed limits.
- API tests verify persistence, resume, explicit replacement, invalid settings,
  provider context and the selected rule limits used by actual Jev turns.
- Browser checks verify CPU settings and the complete Jev settings request/response
  flow, including a resumed game whose saved settings differ from the local table.

This establishes coverage for rule handling, not perfect play across all layouts.
The search is bounded. If no completed legal preview is found, an explicitly
unverified fallback still takes the turn and may foul. A custom speed cap of 1 m/s
can make a long shot or four-rail legal break physically unattainable. Shot quality
also depends on the simulator approximations and the candidates the planner finds.

## House-rule previews (1.5.7)

Bar now treats a scratch while on the 8 as an ordinary foul when the 8 stays on
the table. Pocketing the 8 with a scratch still loses. Custom can enable the old
scratch-on-8 loss option. Both engines and the Jev API default agree.

Settings → Table & rules → Compare rulesets shows Bar and Tournament side by
side, adding a live Custom column when selected. Previewing does not alter the
active rack. First-time welcome offers Bar or Tournament for the first local
rack; tutorial practice remains isolated and restores that rack on exit. Existing
welcome acknowledgments are not invalidated to advertise the new selector.
