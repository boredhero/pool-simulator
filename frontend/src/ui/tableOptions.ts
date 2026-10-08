import { matchConfig, rulesName, type MatchConfig } from '../sim/config';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id);
const input = (id: string) => el<HTMLInputElement>(id);

export class TableOptions {
  constructor(start: (rules: MatchConfig) => void) {
    select('rulespreset').addEventListener('change', () => this.write(matchConfig({ preset: select('rulespreset').value as MatchConfig['preset'] })));
    el('applyrules').addEventListener('click', () => { start(this.read()); el('settingspanel').classList.remove('open'); });
    const show = (open: boolean) => {
      el('helppanel').classList.toggle('open', open);
      el('helpbtn').setAttribute('aria-expanded', String(open));
      if (open) { el('settingspanel').classList.remove('open'); el('onlinepanel').classList.remove('open'); }
    };
    el('helpbtn').addEventListener('click', () => show(!el('helppanel').classList.contains('open')));
    el('closehelp').addEventListener('click', () => show(false));
    for (const id of ['settingsbtn', 'onlinebtn']) el(id).addEventListener('click', () => show(false));
    const tab = (touch: boolean) => {
      el('touchguide').hidden = !touch; el('mouseguide').hidden = touch;

    };
    const coarse = matchMedia('(pointer: coarse)');
    tab(coarse.matches);
    coarse.addEventListener('change', e => tab(e.matches));
    addEventListener('pointerdown', e => tab(e.pointerType !== 'mouse'), {passive: true});
    addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) tab(false); }, {passive: true});
    const desktop = matchMedia('(min-width: 1101px)');
    show(desktop.matches);
    desktop.addEventListener('change', e => show(e.matches));
    addEventListener('keydown', e => { if (e.key === 'Escape') { show(false); el('settingspanel').classList.remove('open'); el('onlinepanel').classList.remove('open'); } });
    this.write(matchConfig());
  }
  read(): MatchConfig {
    return matchConfig({ preset: select('rulespreset').value as MatchConfig['preset'], scratch: select('scratchrule').value as MatchConfig['scratch'], calls: select('callsrule').value as MatchConfig['calls'], eightOnBreak: select('eightbreakrule').value as MatchConfig['eightOnBreak'], scratchOnEightLoss: input('scratch8rule').checked, assignOnBreak: input('assignrule').checked, strictBreak: input('strictbreakrule').checked, normalMax: input('normalspeed').valueAsNumber, breakMax: input('breakspeed').valueAsNumber });
  }
  write(c: MatchConfig, online = false): void {
    select('rulespreset').value = c.preset; select('rulespreset').disabled = online;
    select('scratchrule').value = c.scratch; select('callsrule').value = c.calls; select('eightbreakrule').value = c.eightOnBreak;
    input('scratch8rule').checked = c.scratchOnEightLoss; input('assignrule').checked = c.assignOnBreak; input('strictbreakrule').checked = c.strictBreak;
    input('normalspeed').value = String(c.normalMax); input('breakspeed').value = String(c.breakMax);
    el<HTMLFieldSetElement>('rulefields').disabled = online || c.preset !== 'custom';
    el<HTMLButtonElement>('applyrules').disabled = online;
    el('rulesnotice').textContent = online ? 'This room uses its host’s rules. Start a new room to change them.' : 'Preset rules are locked. Custom changes apply when you start a new rack.';
  }
  summary(c: MatchConfig): void {
    el('rulesummary').textContent = `${rulesName(c)} · Scratch: ${c.scratch === 'kitchen' ? 'behind the head string' : 'ball in hand anywhere'}. Calls: ${c.calls === 'eight' ? '8-Ball only' : c.calls === 'all' ? 'every ball' : 'none'}. ${c.assignOnBreak ? 'Groups may be assigned on the break.' : 'Table stays open after the break.'} 8 on break: ${c.eightOnBreak === 'win' ? 'win' : 'respot'}. ${c.strictBreak ? 'Illegal break: rerack for the opponent.' : ''}`;
  }
}
