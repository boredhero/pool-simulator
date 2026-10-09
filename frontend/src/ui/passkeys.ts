import {startRegistration,startAuthentication,browserSupportsWebAuthn,browserSupportsWebAuthnAutofill,WebAuthnAbortService} from '@simplewebauthn/browser';
import type {Account} from './account';
import './passkeys.css';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
type Key={id:string;name:string;createdAt:number;lastUsedAt:number|null;backedUp:boolean};

export class PasskeyPanel {
  private account:Account|null=null;
  private keys:Key[]=[];
  private renderedKeys='';
  private fresh=false;
  private busy=false;
  private revision=0;
  private conditional=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private loginActive=false;
  private loginCancelled=false;
  private loginOptionsFlight:Promise<any>|null=null;
  private pending:(()=>Promise<void>)|null=null;
  private pendingOpener:HTMLElement|null=null;
  private supported=window.isSecureContext&&browserSupportsWebAuthn();
  constructor(private signedIn:(account:Account)=>void,private blocked:()=>boolean,private setBusy:(busy:boolean)=>void){
    el('passkeylogin').hidden=!this.supported;
    el('passkeyunsupported').hidden=this.supported;
    el('passkeyadd').hidden=!this.supported;
    el('passkeylogin').addEventListener('click',()=>void this.login());
    el('passkey-login-cancel').addEventListener('click',()=>{this.loginCancelled=true;WebAuthnAbortService.cancelCeremony();el('accountstatus').textContent='Returning to sign-in…';});
    el('passkeyadd').addEventListener('click',()=>void this.authorize(()=>this.add()));
    el('passkeyofferadd').addEventListener('click',()=>void this.authorize(()=>this.add()));
    el('passkeyskip').addEventListener('click',()=>{el('passkeyoffer').hidden=true;el('passkeyadd').focus();});
    el('passkeyverifyform').addEventListener('submit',e=>{e.preventDefault();void this.reverify(false);});
    el('passkeyverifykey').addEventListener('click',()=>void this.reverify(true));
    el('passkeyverifycancel').addEventListener('click',()=>{const opener=this.pendingOpener;this.pending=null;this.clearVerify();if(opener?.isConnected)opener.focus();else el('passkeystatus').focus();});
    el('passkeypasswordeye').addEventListener('click',()=>{
      const field=el<HTMLInputElement>('passkeypassword'),shown=field.type==='password';field.type=shown?'text':'password';
      el('passkeypasswordeye').setAttribute('aria-pressed',String(shown));el('passkeypasswordeye').setAttribute('aria-label',shown?'Hide verification password':'Show verification password');
    });
  }
  private status(message:string){el('passkeystatus').textContent=message;}
  private async request(path:string,body?:object,method=body?'POST':'GET'){
    const r=await fetch('/api/account/passkeys'+path,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000),headers:{'X-Pool-Request':'1',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'Passkeys are unavailable. Please try again.');return data;
  }
  private message(error:unknown){
    const name=error instanceof Error?error.name:'';
    return name==='NotAllowedError'||name==='AbortError'?'No changes made. You can try again or use another sign-in method.':name==='InvalidStateError'?'A passkey from this provider is already saved. Try another device or provider.':error instanceof Error?error.message:'Passkey request failed. Please try again.';
  }
  private async run(action:()=>Promise<void>){
    if(this.busy||this.blocked())return;
    this.cancelAutofill();this.busy=true;this.setBusy(true);
    el('passkeys').setAttribute('aria-busy','true');
    const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('#passkeys button,#passkeylogin'));
    buttons.forEach(b=>b.disabled=true);
    try{await action();}catch(error){this.status(this.message(error));el('accountstatus').textContent=this.message(error);}
    finally{this.busy=false;this.setBusy(false);el('passkeys').setAttribute('aria-busy','false');buttons.forEach(b=>b.disabled=false);}
  }
  update(account:Account|null,loginActive:boolean){
    if(this.account?.id!==account?.id){this.revision++;this.keys=[];this.renderedKeys='';this.fresh=false;this.clearVerify();el('passkeyoffer').hidden=true;this.status('');}
    this.account=account;
    el('passkeyverifyform').hidden=account?.hasPassword===false;
    el('settingspasskeys').hidden=!account;
    el('passkeylogin').hidden=!this.supported||!loginActive;
    this.loginActive=loginActive&&!account;
    if(!this.loginActive)this.cancelAutofill();
    else if(!this.conditional&&!this.busy)void this.autofill();
    if(account&&!this.busy)void this.refresh();
  }
  offer(){if(this.supported&&this.account){el('passkeyoffer').hidden=false;el('passkeyoffer').scrollIntoView({block:'nearest'});el('passkeyofferadd').focus();}}
  close(){this.loginActive=false;this.cancelAutofill();this.pending=null;this.clearVerify();el('passkeyoffer').hidden=true;}
  cancelAutofill(){this.conditional=0;this.revision++;clearTimeout(this.timer);WebAuthnAbortService.cancelCeremony();}
  private clearVerify(){
    this.pendingOpener=null;
    el('passkeyverify').hidden=true;el<HTMLInputElement>('passkeypassword').value='';el<HTMLInputElement>('passkeypassword').type='password';
    el('passkeypasswordeye').setAttribute('aria-pressed','false');el('passkeypasswordeye').setAttribute('aria-label','Show verification password');
  }
  private async refresh(){
    const accountId=this.account?.id,revision=this.revision;
    try{const data=await this.request('');if(this.account?.id!==accountId||revision!==this.revision)return;this.keys=data.passkeys;this.fresh=data.recentlyVerified;this.render();}
    catch{if(this.account?.id===accountId)this.status('Could not load passkeys. Reopen your account to retry.');}
  }
  private render(){
    // Account refreshes must not discard an open rename or removal confirmation.
    const signature=JSON.stringify(this.keys);if(signature===this.renderedKeys)return;this.renderedKeys=signature;
    const list=el('passkeylist');list.replaceChildren();
    el('passkeyempty').hidden=this.keys.length>0;
    for(const key of this.keys){
      const item=document.createElement('li');item.className='passkey-item';
      const title=document.createElement('strong');title.textContent=key.name;
      const detail=document.createElement('p');detail.className='guide-note';detail.textContent=`Added ${new Date(key.createdAt*1000).toLocaleDateString()} · ${key.lastUsedAt?`Last used ${new Date(key.lastUsedAt*1000).toLocaleDateString()}`:'Not used yet'}${key.backedUp?' · Backed up by your passkey provider':''}`;
      const actions=document.createElement('div');actions.className='row';
      const rename=document.createElement('button');rename.type='button';rename.textContent='Rename';rename.setAttribute('aria-label',`Rename ${key.name}`);
      const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${key.name}`);
      const editor=document.createElement('form');editor.hidden=true;editor.className='passkey-edit';
      const label=document.createElement('label');label.textContent='Passkey name';const input=document.createElement('input');input.value=key.name;input.maxLength=64;input.required=true;label.append(input);
      const save=document.createElement('button');save.type='submit';save.textContent='Save name';editor.append(label,save);
      editor.addEventListener('submit',e=>{e.preventDefault();void this.authorize(async()=>{await this.request('/'+key.id,{name:input.value.trim()||'My passkey'},'PATCH');await this.refresh();this.status('Passkey renamed.');el('passkeystatus').focus();});});
      rename.addEventListener('click',()=>{editor.hidden=!editor.hidden;if(!editor.hidden)input.focus();});
      const confirm=document.createElement('div');confirm.hidden=true;confirm.className='passkey-remove';
      const warning=document.createElement('p');warning.textContent='Remove this passkey? Other sessions will be signed out. Your other sign-in methods still work. You must keep at least one. Also remove it from your password manager if no longer needed.';
      const yes=document.createElement('button');yes.type='button';yes.textContent='Confirm removal';yes.addEventListener('click',()=>void this.authorize(async()=>{await this.request('/'+key.id,undefined,'DELETE');await this.refresh();this.status('Passkey removed. Other sessions have been signed out.');el('passkeyadd').focus();}));
      const no=document.createElement('button');no.type='button';no.textContent='Cancel';no.addEventListener('click',()=>{confirm.hidden=true;remove.focus();});confirm.append(warning,yes,no);
      remove.addEventListener('click',()=>{confirm.hidden=false;yes.focus();});
      actions.append(rename,remove);item.append(title,detail,actions,editor,confirm);list.append(item);
    }
  }
  private async authorize(action:()=>Promise<void>){
    if(this.busy||this.blocked())return;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    await this.refresh();
    if(!this.fresh){
      if(this.account?.hasPassword===false&&!this.keys.length){this.status('Sign out and sign back in with Google, then add your passkey.');return;}
      this.pending=action;this.pendingOpener=opener;el('passkeyverify').hidden=false;el('passkeyverifykey').hidden=!this.keys.length||!this.supported;
      el(this.account?.hasPassword===false?'passkeyverifykey':'passkeypassword').focus();return;
    }
    await this.run(action);
  }
  private async reverify(passkey:boolean){
    await this.run(async()=>{
      if(passkey){const {options,credential}=await this.providerPrompt('Verify your identity',async()=>{const options=await this.request('/reauth/options',{});if(this.loginCancelled)throw new DOMException('Cancelled','AbortError');const credential=await startAuthentication({optionsJSON:options.options});return {options,credential};});await this.request('/reauth/verify',{ceremony:options.ceremony,credential});}
      else await this.request('/reauth/password',{password:el<HTMLInputElement>('passkeypassword').value});
      this.fresh=true;this.clearVerify();const pending=this.pending;this.pending=null;if(pending)await pending();
    });
    el<HTMLInputElement>('passkeypassword').value='';
  }
  private async add(){
    this.status('Follow your device’s instructions to save a passkey.');
    const {options,credential}=await this.providerPrompt('Save a passkey',async()=>{const options=await this.request('/register/options',{});if(this.loginCancelled)throw new DOMException('Cancelled','AbortError');const credential=await startRegistration({optionsJSON:options.options});return {options,credential};});
    const name=el<HTMLInputElement>('passkeyname').value.trim()||'My passkey';
    await this.request('/register/verify',{ceremony:options.ceremony,credential,name});
    el('passkeyoffer').hidden=true;el<HTMLInputElement>('passkeyname').value='';
    await this.refresh();this.status('Passkey added. You can use it to sign in next time.');
    el('passkeystatus').focus();
  }
  private async providerPrompt<T>(title:string,action:()=>Promise<T>):Promise<T>{
    this.loginCancelled=false;el('accountdialog').classList.add('passkey-active');el('passkey-waiting').hidden=false;
    el('passkey-waiting-title').textContent=title;el('passkey-waiting-instructions').textContent='Continue in your device or password manager. You can cancel and return to your sign-in settings at any time.';
    el('passkey-login-cancel').textContent='Cancel';el<HTMLButtonElement>('passkey-login-cancel').disabled=false;el('passkey-waiting').focus();
    try{const value=await action();if(this.loginCancelled)throw new DOMException('Cancelled','AbortError');return value;}
    finally{el('accountdialog').classList.remove('passkey-active');el('passkey-waiting').hidden=true;el('passkeystatus').focus();}
  }
  private loginOptions(){
    // Share an in-flight options request when switching from autofill to the button.
    // Otherwise two first-time responses could set different browser-binding cookies.
    if(!this.loginOptionsFlight)this.loginOptionsFlight=this.request('/login/options',{}).finally(()=>{this.loginOptionsFlight=null;});
    return this.loginOptionsFlight;
  }
  private async login(){
    let started=false;
    await this.run(async()=>{
      started=true;this.loginCancelled=false;el('passkey-waiting-title').textContent='Sign in with your passkey';el('passkey-waiting-instructions').textContent='Continue in your device or password manager to unlock your saved passkey.';el('passkey-login-cancel').textContent='Back to sign-in';
      el('accountdialog').classList.add('passkey-active');el('passkey-waiting').hidden=false;
      el<HTMLButtonElement>('passkey-login-cancel').disabled=false;el('passkey-waiting').focus();el('accountstatus').textContent='';
      const options=await this.loginOptions();
      if(this.loginCancelled)return;
      const credential=await startAuthentication({optionsJSON:options.options});
      if(this.loginCancelled)return;
      el<HTMLButtonElement>('passkey-login-cancel').disabled=true;
      const data=await this.request('/login/verify',{ceremony:options.ceremony,credential});
      this.signedIn(data.account);el('accountstatus').textContent='Signed in with your passkey.';
    });
    if(started){
      el('accountdialog').classList.remove('passkey-active');el('passkey-waiting').hidden=true;
      if(this.loginCancelled)el('accountstatus').textContent='';
      if(!this.account)el('passkeylogin').focus();
      else{el('accountname').tabIndex=-1;el('accountname').focus();}
    }
  }
  private async autofill(){
    if(!this.supported||!this.loginActive)return;
    const revision=++this.revision;this.conditional=revision;
    try{
      if(!await browserSupportsWebAuthnAutofill())return;
      if(revision!==this.revision||!this.loginActive)return;
      const options=await this.loginOptions();
      if(revision!==this.revision||!this.loginActive)return;
      this.timer=setTimeout(()=>{if(this.conditional===revision){this.cancelAutofill();void this.autofill();}},240000);
      const credential=await startAuthentication({optionsJSON:options.options,useBrowserAutofill:true});
      if(revision!==this.revision||!this.loginActive||this.blocked())return;
      await this.run(async()=>{const data=await this.request('/login/verify',{ceremony:options.ceremony,credential});this.signedIn(data.account);el('accountstatus').textContent='Signed in with your passkey.';});
    }catch{/* Conditional UI stays quiet; the explicit button and password remain available. */}
    finally{if(this.conditional===revision){this.conditional=0;clearTimeout(this.timer);}}
  }
}
