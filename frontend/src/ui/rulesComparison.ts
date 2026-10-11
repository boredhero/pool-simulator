import { BAR_RULES, TOURNAMENT_RULES, type MatchConfig } from '../sim/config';

const rows: [string, (c: MatchConfig) => string][] = [
  ['Scratch after the break', c => c.scratch === 'kitchen' ? 'Behind head string' : 'Place anywhere'],
  ['Called shots', c => c.calls === 'eight' ? '8-ball only' : c.calls === 'all' ? 'Every ball' : 'None'],
  ['8-ball on a legal break', c => c.eightOnBreak === 'win' ? 'Win' : 'Respot; continue'],
  ['Scratch on the 8; 8 stays up', c => c.scratchOnEightLoss ? 'Lose rack' : 'Ordinary foul'],
  ['Groups on a legal break', c => c.assignOnBreak ? 'Assigned if one group drops' : 'Table stays open'],
  ['Break spread', c => c.strictBreak ? 'Pot or four object balls hit rails' : 'No four-ball requirement'],
  ['Opening cue placement', c => c.breakPlacement !== false ? 'Behind head string' : 'Fixed spot'],
  ['Object ball off table (not 8)', c => c.preset === 'tournament' ? 'Foul; stays off' : 'Foul; respot'],
  ['Maximum shot / break speed', c => `${c.normalMax} / ${c.breakMax} m/s`],
];

export function renderRulesComparison(container: HTMLElement, selected: MatchConfig): void {
  const columns: [string, MatchConfig][] = [['Bar', BAR_RULES], ['Tournament', TOURNAMENT_RULES]];
  if (selected.preset === 'custom') columns.push(['Your Custom', selected]);
  const table = document.createElement('table');
  const caption = table.createCaption();
  caption.textContent = 'Ruleset comparison';
  const header = table.createTHead().insertRow();
  for (const label of ['Rule', ...columns.map(([name]) => name)]) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; header.append(cell);
  }
  const body = table.createTBody();
  for (const [label, describe] of rows) {
    const row = body.insertRow();
    const heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label; row.append(heading);
    for (const [, config] of columns) {
      const cell = row.insertCell(); cell.textContent = describe(config);
      if (config.preset === selected.preset) cell.classList.add('selected-rules');
    }
  }
  container.replaceChildren(table);
}
