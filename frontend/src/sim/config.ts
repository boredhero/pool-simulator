export interface MatchConfig {
  preset: 'bar' | 'tournament' | 'custom';
  scratch: 'kitchen' | 'anywhere';
  calls: 'none' | 'eight' | 'all';
  eightOnBreak: 'win' | 'spot';
  scratchOnEightLoss: boolean;
  assignOnBreak: boolean;
  strictBreak: boolean;
  normalMax: number;
  breakMax: number;
}
export const BAR_RULES: MatchConfig = { preset: 'bar', scratch: 'kitchen', calls: 'eight', eightOnBreak: 'win', scratchOnEightLoss: true, assignOnBreak: false, strictBreak: true, normalMax: 3.5, breakMax: 8.5 };
export const TOURNAMENT_RULES: MatchConfig = { ...BAR_RULES, preset: 'tournament', scratch: 'anywhere', calls: 'all', eightOnBreak: 'spot', scratchOnEightLoss: false };
export function matchConfig(input: Partial<MatchConfig> = {}): MatchConfig {
  if (input.preset === 'tournament') return { ...TOURNAMENT_RULES };
  if (input.preset !== 'custom') return { ...BAR_RULES };
  return {
    ...BAR_RULES, preset: 'custom',
    scratch: input.scratch === 'anywhere' ? 'anywhere' : 'kitchen',
    calls: input.calls === 'none' || input.calls === 'all' ? input.calls : 'eight',
    eightOnBreak: input.eightOnBreak === 'spot' ? 'spot' : 'win',
    scratchOnEightLoss: input.scratchOnEightLoss ?? true,
    assignOnBreak: input.assignOnBreak ?? false,
    strictBreak: input.strictBreak ?? true,
    normalMax: Number.isFinite(input.normalMax) ? Math.max(1, Math.min(8.5, input.normalMax!)) : 3.5,
    breakMax: Number.isFinite(input.breakMax) ? Math.max(1, Math.min(12, input.breakMax!)) : 8.5,
  };
}
export const rulesName = (c: MatchConfig) => c.preset === 'bar' ? '8-ball (Bar)' : c.preset === 'tournament' ? '8-ball (Tourny)' : '8-ball (Custom)';
