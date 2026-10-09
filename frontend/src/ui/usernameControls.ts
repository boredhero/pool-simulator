import type {Account} from './account';
import './usernameControls.css';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export class UsernameControls {
  private account:Account|null=null;
  private generation=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private request:AbortController|null=null;
  constructor(private save:(name:string)=>Promise<void>){
    el('usernameform').addEventListener('submit',e=>{e.preventDefault();if(el<HTMLFormElement>('usernameform').reportValidity())void this.save(el<HTMLInputElement>('newusername').value);});
    el('newusername').addEventListener('input',()=>this.check());
  }
  update(account:Account|null,blocked:boolean){
    const changed=this.account?.id!==account?.id||this.account?.username!==account?.username;
    this.account=account;
    if(changed){this.cancel();el<HTMLInputElement>('newusername').value=account?.username??'';el('usernameavailability').textContent='';}
    const next=account?.usernameChangeAvailableAt;
    const locked=!!next&&next*1000>Date.now();
    el('usernamecooldown').textContent=locked?`You can change your username again on ${new Date(next!*1000).toLocaleString()}.`:'Your next username change is available now.';
    el<HTMLInputElement>('newusername').disabled=blocked||locked;
    el<HTMLButtonElement>('usernamechange').disabled=blocked||locked;
  }
  cancel(){this.generation++;clearTimeout(this.timer);this.request?.abort();this.request=null;}
  private check(){
    this.cancel();const generation=this.generation,accountId=this.account?.id;
    const name=el<HTMLInputElement>('newusername').value,status=el('usernameavailability');
    status.textContent='';
    if(!/^[A-Za-z0-9_]{3,20}$/.test(name))return;
    if(name===this.account?.username){status.textContent='This is your current username.';return;}
    this.timer=setTimeout(async()=>{
      status.textContent='Checking availability…';const controller=new AbortController();this.request=controller;
      try{
        const response=await fetch('/api/account/username/availability?username='+encodeURIComponent(name),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
        if(!response.ok)throw Error();const data=await response.json();
        if(generation===this.generation&&accountId===this.account?.id)status.textContent=data.available?'Available.':'That username is already taken.';
      }catch{if(generation===this.generation&&!controller.signal.aborted)status.textContent='Availability check unavailable. You can still try saving.';}
    },350);
  }
}
