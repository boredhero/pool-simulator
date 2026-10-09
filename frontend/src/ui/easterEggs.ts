import type {Account} from './account';
import {KonamiSequence} from './konami';
import './easterEggs.css';

interface EasterEggsOptions {
  getAccount:()=>Account|null;
  unlockAccount:()=>Promise<Account|null>;
  onToggle:(enabled:boolean)=>void|Promise<void>;
  getEnabled:()=>boolean;
  canToggle?:()=>boolean;
}
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;

export class EasterEggsPanel {
  private sequence=new KonamiSequence();
  private accountId:string|null=null;
  private pending=false;
  private saving=false;
  private opener:HTMLElement|null=null;
  private dialog=document.createElement('dialog');
  constructor(private options:EasterEggsOptions){
    this.dialog.id='eastereggsdialog';this.dialog.setAttribute('aria-labelledby','eastereggstitle');
    this.dialog.innerHTML='<div class="easter-eggs-emblem" aria-hidden="true">✦</div><h2 id="eastereggstitle">Easter eggs unlocked</h2><p id="eastereggsdetail">Go to Settings to try them out</p><div class="easter-eggs-actions"><button id="eastereggsopen" type="button">Open Settings</button><button id="eastereggsclose" type="button">Close</button></div>';
    document.body.append(this.dialog);
    this.dialog.addEventListener('keydown',event=>event.stopPropagation());
    this.dialog.addEventListener('close',()=>this.opener?.focus());
    el('eastereggsclose').addEventListener('click',()=>this.dialog.close());
    el('eastereggsopen').addEventListener('click',()=>{
      this.dialog.close();
      if(!this.options.getAccount()?.easterEggsEnabled){el('accountidentity').click();return;}
      if(!el('settingspanel').classList.contains('open'))el('settingsbtn').click();
      el<HTMLDetailsElement>('eastereggssettings').open=true;
      el('eastereggssettings').scrollIntoView({block:'nearest'});
      el('eastereggssettings').querySelector('summary')!.focus();
    });
    el('chalksimenabled').addEventListener('change',()=>void this.toggle());
    document.addEventListener('keydown',event=>this.keydown(event),true);
    window.addEventListener('blur',()=>this.sequence.reset());
    this.update();
  }
  update(){
    const account=this.options.getAccount(),id=account?.id??null;
    const changed=id!==this.accountId;
    this.accountId=id;
    if(changed){this.sequence.reset();this.dialog.close();}
    if(changed)el('chalksimstatus').textContent='';
    el('eastereggssettings').hidden=!account?.easterEggsEnabled;
    const checkbox=el<HTMLInputElement>('chalksimenabled');
    if(!this.saving||changed)checkbox.checked=!!account?.easterEggsEnabled&&this.options.getEnabled();
    checkbox.disabled=this.saving||!(this.options.canToggle?.()??true);
  }
  private async toggle(){
    const id=this.options.getAccount()?.id;
    if(this.saving||!this.options.getAccount()?.easterEggsEnabled||!(this.options.canToggle?.()??true)){this.update();return;}
    const enabled=el<HTMLInputElement>('chalksimenabled').checked;
    this.saving=true;el('chalksimstatus').textContent='Saving…';this.update();
    try{await this.options.onToggle(enabled);if(this.options.getAccount()?.id===id)el('chalksimstatus').textContent='Saved. Applies to new games.';}
    catch(error){if(this.options.getAccount()?.id===id)el('chalksimstatus').textContent=error instanceof Error?error.message:'Could not save. Please try again.';}
    finally{this.saving=false;this.update();}
  }
  private keydown(event:KeyboardEvent){
    if(event.repeat)return;
    if(event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||this.pending||document.querySelector('dialog[open]')||(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,button,a,summary,[contenteditable],[role="dialog"],[role="button"]'))){this.sequence.reset();return;}
    const result=this.sequence.push(event.key);
    if(result.consume){event.preventDefault();event.stopImmediatePropagation();}
    if(result.complete)void this.unlock();
  }
  private async unlock(){
    const accountId=this.options.getAccount()?.id;
    if(!accountId){this.show('Sign in to unlock Easter eggs','Sign in, then enter the code again to save your unlock.','Sign in');return;}
    this.pending=true;
    try{
      const account=await this.options.unlockAccount();
      if(!account?.easterEggsEnabled||account.id!==accountId||this.options.getAccount()?.id!==accountId)return;
      this.update();
      this.show('Easter eggs unlocked','Go to Settings to try them out','Open Settings');
    }catch{
      // No local unlock: the sequence can be retried when the service recovers.
    }finally{this.pending=false;}
  }
  private show(title:string,detail:string,action:string){
    el('eastereggstitle').textContent=title;el('eastereggsdetail').textContent=detail;el('eastereggsopen').textContent=action;
    this.opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    this.dialog.showModal();el('eastereggsopen').focus();
  }
}
