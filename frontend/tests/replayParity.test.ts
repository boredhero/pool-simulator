import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {expect, it} from 'vitest';
import {strikeBalls} from '../src/sim/stroke';
import {simulateShot, type Ball} from '../src/sim/physics';

// Run explicitly in the cross-runtime CI job; ordinary browser-only installs do
// not need Python. Expectations are live server results, not refreshed snapshots.
const enabled = process.env.POOL_REPLAY_PARITY === '1';
it.skipIf(!enabled)('matches Python outcomes for racks, close ball spacing, pocket entries, spin and flight', () => {
  const script = fileURLToPath(new URL('../../scripts/physics-replay.py', import.meta.url));
  const cases = JSON.parse(execFileSync(process.env.POOL_PYTHON ?? 'python3', [script], {
    encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  }));
  for (const fixture of cases) {
    const balls: Ball[] = structuredClone(fixture.balls);
    if(fixture.args){fixture.args[0] = Math.cos(fixture.aim);fixture.args[1] = Math.sin(fixture.aim);}
    const startEvents = fixture.args ? strikeBalls(balls, 0, ...fixture.args as [number, number, number, number, number, number, number, number]) : undefined;
    const events = simulateShot(balls, 0, 45, startEvents);
    const label = fixture.name;
    expect(events.potted, `${label} pot order`).toEqual(fixture.events.potted);
    expect(events.offTable, `${label} off-table`).toEqual(fixture.events.off_table);
    expect(events.firstContact, `${label} first contact`).toEqual(fixture.events.first_contact);
    expect(events.cuePotted, `${label} scratch`).toEqual(fixture.events.cue_potted);
    expect(events.railAfterContact, `${label} rail`).toEqual(fixture.events.rail_after_contact);
    expect(events.objectRails ?? [], `${label} object rails`).toEqual(fixture.events.object_rails);
    expect(events.cueLeftKitchen ?? false, `${label} kitchen exit`).toEqual(fixture.events.cue_left_kitchen);
    expect(events.pockets ?? [], `${label} pocket identities`).toEqual(fixture.events.pockets);
    for (let index = 0; index < balls.length; index++) {
      const actual = balls[index], expected = fixture.expected[index];
      expect(actual.potted, `${label} ball ${index} potted`).toBe(expected.potted);
      expect(actual.asleep, `${label} ball ${index} asleep`).toBe(expected.asleep);
      // Ten micrometres is far below visible movement, but catches the previous
      // metre-scale divergence. Outcomes above must match exactly, no tolerance.
      for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz'] as const) {
        expect(Math.abs(actual[key] - expected[key]), `${label} ball ${index} ${key}`).toBeLessThanOrEqual(1e-5);
      }
    }
  }
}, 200_000);
