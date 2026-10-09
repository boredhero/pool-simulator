import type {Account} from './account';
import {termsStatus} from './terms';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
type Result={account?:Account;recovery?:string;signup?:string;linked?:boolean};
type GoogleAPI={initialize:(options:Record<string,unknown>)=>void;renderButton:(element:HTMLElement,options:Record<string,unknown>)=>void;cancel:()=>void};
const api=()=> (window as unknown as {google?:{accounts:{id:GoogleAPI}}}).google?.accounts.id;
let scriptLoad:Promise<void>|undefined;
function loadGoogle(){
  if(api())return Promise.resolve();
  if(scriptLoad)return scriptLoad;
  scriptLoad=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
    const timer=setTimeout(()=>fail(),12000);
    const fail=()=>{clearTimeout(timer);script.remove();scriptLoad=undefined;reject(Error('Google could not load. Check your connection or use another sign-in method.'));};
    script.onload=()=>{clearTimeout(timer);if(api())resolve();else fail();};script.onerror=fail;document.head.append(script);
  });
  return scriptLoad;
}
export class GooglePanel {
  private account:Account|null=null;
  private revision=0;
  private flow='';
  private terms='';
  private active=false;
  private busy=false;
  constructor(private completed:(data:Result)=>void,private blocked:()=>boolean,private setBusy:(busy:boolean)=>void){
    el('googlelogin').addEventListener('click',()=>void this.begin());
    el('googlelink').addEventListener('click',()=>void this.begin());
    el('googlecancel').addEventListener('click',()=>{this.close();this.message('');el(this.account?'googlelink':'googlelogin').focus();});
    el('googlesignup').addEventListener('submit',e=>{e.preventDefault();void this.signup();});
    el('googleunlink').addEventListener('click',()=>{el('googleunlinkconfirm').hidden=false;el('googleunlinkyes').focus();});
    el('googleunlinkno').addEventListener('click',()=>{el('googleunlinkconfirm').hidden=true;el('googleunlink').focus();});
    el('googleunlinkyes').addEventListener('click',()=>void this.run(async()=>{await this.request('/unlink',{});el('googleunlinkconfirm').hidden=true;await this.refresh();this.message('Google unlinked. Other sessions have been signed out.');}));
  }
  private message(text:string){el('googlestatus').textContent='';el('accountstatus').textContent=text;}
  private async request(path:string,body?:object){
    const r=await fetch('/api/account/google'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000),headers:body?{'X-Pool-Request':'1','Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    const data=await r.json();if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:'Google sign-in is unavailable. Please try again.');return data;
  }
  update(account:Account|null){
    if(this.account?.id!==account?.id)this.close();
    this.account=account;
    if(el<HTMLDialogElement>('accountdialog').open)void this.refresh();
  }
  private async refresh(){
    const revision=this.revision;
    try{const data=await this.request('');if(revision!==this.revision)return;
      el('googlelogin').hidden=!data.enabled||!!this.account;
      el('googlemanage').hidden=!data.enabled||!this.account;
      el('googlelink').hidden=!!data.linked;el('googleunlink').hidden=!data.linked;
      el('googlelinked').textContent=data.linked?'Google is linked to this account.':'Link Google as another way to sign in to this account.';
    }catch{el('googlelogin').hidden=true;el('googlemanage').hidden=true;}
  }
  close(){
    el('accountdialog').classList.remove('google-active');
    ++this.revision;this.active=false;this.flow='';this.terms='';api()?.cancel();
    el('googlebox').hidden=true;el('googlebutton').replaceChildren();el('googlesignup').hidden=true;el('googleunlinkconfirm').hidden=true;
    el<HTMLFormElement>('googlesignup').reset();
  }
  private async run(action:()=>Promise<void>){
    if(this.busy||this.blocked())return;
    this.busy=true;this.setBusy(true);
    const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('#googlebox button,#googlemanage button,#googlelogin'));buttons.forEach(b=>b.disabled=true);
    try{await action();}catch(e){this.message(e instanceof Error?e.message:'Google sign-in failed. Please try again.');}
    finally{this.busy=false;buttons.forEach(b=>b.disabled=false);this.setBusy(false);}
  }
  private async begin(){await this.run(async()=>{
    this.close();const revision=this.revision;this.active=true;el('accountdialog').classList.add('google-active');el('googlebox').hidden=false;el('googlebox').tabIndex=-1;el('googlebox').focus();this.message('Loading Google sign-in…');
    const [flow]=await Promise.all([this.request('/start',{purpose:this.account?'link':'login'}),loadGoogle()]);
    if(revision!==this.revision)return;
    api()!.initialize({client_id:flow.clientId,nonce:flow.nonce,auto_select:false,button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup',callback:(result:{credential:string})=>{if(revision===this.revision&&this.active)void this.finish(flow.flow,result.credential,revision);}});
    api()!.renderButton(el('googlebutton'),{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:Math.min(320,el('googlebox').clientWidth)});
    this.message(this.account?'Choose the Google account to link.':'Continue with Google, then choose a username if you are new.');
    el('googlebox').scrollIntoView({block:'nearest'});
  });}
  private async finish(flow:string,credential:string,revision:number){await this.run(async()=>{
    const data:Result=await this.request('/finish',{flow,credential});if(revision!==this.revision)return;
    el('googlebutton').replaceChildren();
    if(data.signup){this.flow=data.signup;const terms=await termsStatus();this.terms=terms.version;el('googlesignup').hidden=false;el<HTMLInputElement>('googleadult').checked=false;el('googleusername').focus();this.message('Choose your pool username to finish creating your account.');}
    else {this.close();if(data.account)this.completed(data);else{await this.refresh();this.message('Google linked. You can use it next time you sign in.');}}
  });}
  private async signup(){await this.run(async()=>{
    if(!this.flow)return;
    const terms=await termsStatus();if(terms.version!==this.terms){this.terms=terms.version;el<HTMLInputElement>('googleadult').checked=false;throw Error('The Terms changed. Review them and confirm acceptance again.');}
    const data=await this.request('/register',{flow:this.flow,username:el<HTMLInputElement>('googleusername').value.trim(),terms_version:this.terms,adult:el<HTMLInputElement>('googleadult').checked});
    this.close();this.completed(data);
  });}
}
