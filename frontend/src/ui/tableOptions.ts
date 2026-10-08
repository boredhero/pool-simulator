import { matchConfig, rulesName, type MatchConfig } from '../sim/config';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id);
const input = (id: string) => el<HTMLInputElement>(id);

export class TableOptions {
  private context:'local'|'room'|'jev'|'jev-premium'='local';
  fastForward = false;
  autoCamera = false;
  constructor(start: (rules: MatchConfig) => void) {
    let savedCamera:string|null=null;try{savedCamera=localStorage.getItem('pool:auto-camera');}catch{}
    this.autoCamera=savedCamera===null?(matchMedia('(pointer: coarse)').matches||matchMedia('(max-width: 700px)').matches):savedCamera==='1';
    input('autocamera').checked=this.autoCamera;
    input('autocamera').addEventListener('change',()=>{this.autoCamera=input('autocamera').checked;try{localStorage.setItem('pool:auto-camera',this.autoCamera?'1':'0');}catch{}});
    try { this.fastForward = localStorage.getItem('pool:fast-forward') === '1'; } catch { /* private storage */ }
    input('fastforward').checked = this.fastForward;
    input('fastforward').addEventListener('change', () => { this.fastForward = input('fastforward').checked; try { localStorage.setItem('pool:fast-forward', this.fastForward ? '1' : '0'); } catch { /* private storage */ } });
    let dismissed = false;
    try { dismissed = localStorage.getItem('pool:help-dismissed') === '1'; } catch { /* private storage */ }
    select('rulespreset').addEventListener('change', () => this.write(matchConfig({ preset: select('rulespreset').value as MatchConfig['preset'] }),this.context));
    el('closesettings').addEventListener('click',()=>{el('settingspanel').classList.remove('open');el('settingsbtn').focus();});
    el('applyrules').addEventListener('click', () => { start(this.read()); el('settingspanel').classList.remove('open'); });
    const show = (open: boolean, remember = false) => {
      if (!open && remember) { dismissed = true; try { localStorage.setItem('pool:help-dismissed', '1'); } catch { /* private storage */ } }
      el('helppanel').classList.toggle('open', open);
      el('helpbtn').setAttribute('aria-expanded', String(open));
      if (open) { el('settingspanel').classList.remove('open'); el('onlinepanel').classList.remove('open'); }
    };
    el('helpbtn').addEventListener('click', () => show(!el('helppanel').classList.contains('open'), true));
    el('closehelp').addEventListener('click', () => show(false, true));
    el('starttutorial').addEventListener('click',()=>show(false,true));
    for (const id of ['settingsbtn', 'onlinebtn']) el(id).addEventListener('click', () => show(false, true));
    const tab = (touch: boolean) => {
      document.documentElement.classList.toggle('touch-input',touch);
      el('hint').textContent=touch?'Drag to aim · set power · tap Shoot · two fingers move the camera':'Aim on the felt · pull back and release · choose camera controls in the HUD';
      el('helppanel').querySelector('h2')!.textContent=touch?'Aim. Set power. Shoot.':'Aim. Pull. Release.';
      el('touchguide').hidden = !touch; el('mouseguide').hidden = touch;

    };
    const coarse = matchMedia('(pointer: coarse)');
    tab(coarse.matches);
    coarse.addEventListener('change', e => tab(e.matches));
    addEventListener('pointerdown', e => tab(coarse.matches || e.pointerType !== 'mouse'), {passive: true});
    addEventListener('pointermove', e => { if (!coarse.matches && e.pointerType === 'mouse' && (e.movementX || e.movementY)) tab(false); }, {passive: true});
    const desktop = matchMedia('(min-width: 1101px)');
    show(desktop.matches && !dismissed);
    desktop.addEventListener('change', e => show(e.matches && !dismissed));
    addEventListener('keydown', e => { if (e.key === 'Escape') { if(el('settingspanel').classList.contains('open'))el('settingsbtn').focus(); show(false, true); el('settingspanel').classList.remove('open'); el('onlinepanel').classList.remove('open'); } });
    this.write(matchConfig());
  }
  read(): MatchConfig {
    return matchConfig({ preset: select('rulespreset').value as MatchConfig['preset'], scratch: select('scratchrule').value as MatchConfig['scratch'], calls: select('callsrule').value as MatchConfig['calls'], eightOnBreak: select('eightbreakrule').value as MatchConfig['eightOnBreak'], scratchOnEightLoss: input('scratch8rule').checked, assignOnBreak: input('assignrule').checked, strictBreak: input('strictbreakrule').checked, normalMax: input('normalspeed').valueAsNumber, breakMax: input('breakspeed').valueAsNumber });
  }
  write(c: MatchConfig, context:typeof this.context='local'): void {
    this.context=context;const online=context==='room'||context==='jev';
    select('rulespreset').value = c.preset; select('rulespreset').disabled = online;
    select('scratchrule').value = c.scratch; select('callsrule').value = c.calls; select('eightbreakrule').value = c.eightOnBreak;
    input('scratch8rule').checked = c.scratchOnEightLoss; input('assignrule').checked = c.assignOnBreak; input('strictbreakrule').checked = c.strictBreak;
    input('normalspeed').value = String(c.normalMax); input('breakspeed').value = String(c.breakMax);
    el<HTMLFieldSetElement>('rulefields').disabled = online || c.preset !== 'custom';
    el<HTMLButtonElement>('applyrules').disabled = online;
    el('applyrules').textContent=context==='jev-premium'?'Start new Jev game with these rules':'Start new rack with these rules';
    el('rulesnotice').textContent = context==='room'?'This room uses its host’s rules. Start a new room to change them.':context==='jev'?'This Jev game keeps its starting rules. Switch to a local table to choose rules for a future game.':context==='jev-premium'?'Changes apply only when you start a new Jev game. The current game keeps its rules.':'Preset rules are locked. Custom changes apply when you start a new rack.';
  }
  summary(c: MatchConfig): void {
    el('kitchenhelp').hidden=c.scratch!=='kitchen';
    el('rulesummary').textContent = `${rulesName(c)} · Scratch: ${c.scratch === 'kitchen' ? 'behind the head string' : 'ball in hand anywhere'}. Calls: ${c.calls === 'eight' ? '8-Ball only' : c.calls === 'all' ? 'every ball' : 'none'}. ${c.assignOnBreak ? 'Groups may be assigned on the break.' : 'Table stays open after the break.'} Groups require a legal pot; a scratch leaves an open table unassigned. 8 on break: ${c.eightOnBreak === 'win' ? 'win' : 'respot'}. ${c.strictBreak ? 'Illegal break: rerack for the opponent.' : 'Empty break: keep the layout and pass the turn; no rerack.'} ${c.preset==='tournament'?'Off-table objects stay out. The 8 off on the break is respotted; the opponent places in the kitchen. The 8 off during regular play loses. Break choices use automatic placement.':'Off-table objects are respotted. The 8 off the table loses. Bar/Custom use house rules.'}`;
  }
}
