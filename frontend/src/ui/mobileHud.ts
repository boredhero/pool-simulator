/** Move existing controls, retaining their listeners and restoring desktop positions. */
export function setupMobileHud():void {
  const header=document.querySelector<HTMLElement>('.topbar')!;
  const settings=document.querySelector<HTMLElement>('#settingspanel .settings-body')!;
  const section=document.createElement('section');
  section.id='mobile-settings-about';section.hidden=true;
  const title=document.createElement('h2');title.textContent='About & privacy';section.append(title);settings.append(section);
  const moves=[
    {element:document.getElementById('scorecard')!,destination:header},
    {element:document.getElementById('version')!,destination:section},
    {element:document.querySelector<HTMLElement>('.legal-links')!,destination:section},
  ].map(move=>{
    const anchor=document.createComment('desktop control position');move.element.before(anchor);
    return {...move,anchor};
  });
  const gear=document.getElementById('settingsbtn')!;
  const original=document.createElement('span');original.className='settings-desktop-label';
  original.append(...Array.from(gear.childNodes));gear.append(original);
  gear.insertAdjacentHTML('beforeend','<svg class="settings-mobile-icon" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 3-.6 2.3-2 .9-2.1-.7L2 9.5l1.7 1.6v2L2 14.5l2.3 4 2.1-.7 2 .9L9 21h6l.6-2.3 2-.9 2.1.7 2.3-4-1.7-1.4v-2L22 9.5l-2.3-4-2.1.7-2-.9L15 3Z"/><circle cx="12" cy="12" r="3"/></svg>');
  gear.setAttribute('aria-label','Table settings');
  const mobile=matchMedia('(max-width:900px) and (pointer:coarse)');
  const sync=()=>{
    section.hidden=!mobile.matches;
    for(const {element,destination,anchor} of moves){
      if(mobile.matches)destination.append(element);else anchor.after(element);
    }
  };
  mobile.addEventListener('change',sync);sync();
}
