import './settingsLayout.css';
type Section='overview'|'signin'|'profile';
const sections:Section[]=['overview','signin','profile'];
export function showAccountSection(section:Section):void {
  for(const key of sections){
    const button=document.getElementById(`account-tab-${key}`)!;
    button.setAttribute('aria-selected',String(key===section));button.tabIndex=key===section?0:-1;
    document.getElementById(`account-section-${key}`)!.hidden=key!==section;
  }
}
export function setupAccountSections():void {
  const preset=document.getElementById('rulespreset') as HTMLSelectElement;
  const fields=document.getElementById('rulefields')!;
  const details=document.getElementById('rule-details-toggle')!;
  const syncRules=()=>{const custom=preset.value==='custom';details.hidden=custom;fields.hidden=!custom;details.setAttribute('aria-expanded',String(custom));details.textContent='View rule details';};
  details.addEventListener('click',()=>{fields.hidden=!fields.hidden;details.setAttribute('aria-expanded',String(!fields.hidden));details.textContent=fields.hidden?'View rule details':'Hide rule details';});
  preset.addEventListener('change',syncRules);document.getElementById('settingsbtn')!.addEventListener('click',syncRules);requestAnimationFrame(syncRules);

  sections.forEach((section,index)=>{
    const button=document.getElementById(`account-tab-${section}`)!;
    button.addEventListener('click',()=>showAccountSection(section));
    button.addEventListener('keydown',event=>{
      const offset=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
      if(!offset&&event.key!=='Home'&&event.key!=='End')return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?sections.length-1:(index+offset+sections.length)%sections.length;
      showAccountSection(sections[next]);document.getElementById(`account-tab-${sections[next]}`)!.focus();
    });
  });
}

export function setAccountSectionsBusy(busy:boolean):void {
  for(const key of sections)(document.getElementById(`account-tab-${key}`) as HTMLButtonElement).disabled=busy;
}
