import './accountIdentity.css';
import './mobileHud.css';
import {acceptTerms,termsStatus,type TermsStatus} from './terms';
import { AdminPanel } from './admin';
export interface Account {id:string;username:string;createdAt:number;premium:boolean;simEnabled?:boolean;isAdmin:boolean}
interface Stats {matches:number;wins:number;losses:number;abandoned:number;shots:number;ballsPocketed:number;scratches:number;fouls:number;shotStatsComplete?:boolean;byMode?:Record<string,{matches:number;wins:number;losses:number}>;recent:Array<{id:string;opponent:string;status:string;result:string|null;mode?:string;shotStatsComplete?:boolean}>}
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;

export class AccountPanel {
  account:Account|null=null;
  private mode:'login'|'register'|'recover'='login';
  private recoveryPending=false;
  private busy=false;
  private accountRevision=0;
  private opener:HTMLElement|null=null;
  private agreement:TermsStatus|null=null;
  private agreementBusy=false;
  private agreementRevision=0;
  private admin=new AdminPanel(()=>void this.refresh());
  constructor(private playing:()=>boolean,private changed:(account:Account|null)=>void) {
    for(const id of ['accountbtn','accountidentity'])el(id).addEventListener('click',()=>{this.opener=el(id);el<HTMLDialogElement>('accountdialog').showModal();void this.refresh();});
    el('accountdialog').addEventListener('keydown',e=>e.stopPropagation());
    el('accountclose').addEventListener('click',()=>el<HTMLDialogElement>('accountdialog').close());
    el('accountdialog').addEventListener('cancel',e=>{if(this.recoveryPending||this.busy||this.agreementBusy)e.preventDefault();});
    el('accountdialog').addEventListener('close',()=>this.opener?.focus());
    for(const mode of ['login','register','recover'] as const)el('account-'+mode).addEventListener('click',()=>this.setMode(mode));
    el('accountform').addEventListener('submit',e=>{e.preventDefault();void this.submit();});
    el('accountlogout').addEventListener('click',()=>void this.logout());
    el('acceptterms').addEventListener('click',()=>void this.acceptAgreement());
    el('settingsbtn').addEventListener('click',()=>void this.refresh());
    el('recoverycopy').addEventListener('click',()=>void navigator.clipboard.writeText(el<HTMLInputElement>('recoveryvalue').value).then(()=>this.status('Recovery code copied. Keep it somewhere safe.')).catch(()=>this.status('Select and copy the recovery code above.')));
    el('recoverysaved').addEventListener('click',()=>{
      this.recoveryPending=false;el<HTMLInputElement>('recoveryvalue').value='';el('recoverypanel').hidden=true;
      el<HTMLButtonElement>('accountclose').disabled=false;this.render();
      this.status(this.account?'Your account is ready.':'Password reset. Sign in with your new password.');
      if(!this.account)this.setMode('login');
      void this.refresh();
    });
    this.setMode('login');void this.refresh();
  }
  private status(text:string){el('accountstatus').textContent=text;}
  private async request(path:string,payload?:object) {
    const response=await fetch('/api/account'+path,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000),headers:payload?{'Content-Type':'application/json','X-Pool-Request':'1'}:undefined,body:payload?JSON.stringify(payload):undefined});
    const data=await response.json();
    if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Please check the form and try again.');
    return data;
  }
  async refresh() {
    if(this.recoveryPending||this.busy||this.agreementBusy)return;
    const revision=++this.accountRevision;
    try {const data=await this.request('');if(revision!==this.accountRevision||this.busy||this.agreementBusy||this.recoveryPending)return;this.account=data.account;this.changed(this.account);this.render(data.stats);void this.refreshAgreement();}
    catch {if(revision===this.accountRevision&&!this.busy)this.status('Account service unavailable. Local play still works.');}
  }
  private async refreshAgreement(){
    const revision=++this.agreementRevision,accountId=this.account?.id;
    this.agreement=null;el('termsupdate').hidden=true;
    el('accounttermsstatus').textContent=accountId?'Checking Terms acceptance…':'';
    try{
      const status=await termsStatus();
      if(revision!==this.agreementRevision||this.account?.id!==accountId)return;
      if(accountId&&status.accountId!==accountId){el('accounttermsstatus').textContent='Your signed-in account changed. Reopen Account to refresh it.';return;}
      this.agreement=status;
      el('termsupdate').hidden=!accountId||status.accepted||!status.authenticated;
      el<HTMLInputElement>('termsadult').checked=false;
      el('accounttermsstatus').textContent=accountId?(status.accepted?'Current Terms accepted.':status.authenticated?'Please review and accept the current Terms to use Jev AI.':'Sign in again to manage Terms acceptance.'):'';
    }catch{
      if(revision===this.agreementRevision&&this.account?.id===accountId)el('accounttermsstatus').textContent=accountId?'Terms status is unavailable. Reopen Account to try again.':'';
    }
  }
  private async acceptAgreement(){
    if(this.agreementBusy||!this.account||!this.agreement)return;
    if(!el<HTMLInputElement>('termsadult').checked){this.status('Confirm you are 18 or older and accept the Terms.');return;}
    const accountId=this.account.id,version=this.agreement.version;
    this.agreementBusy=true;++this.accountRevision;el<HTMLButtonElement>('acceptterms').disabled=true;el<HTMLButtonElement>('accountlogout').disabled=true;el<HTMLButtonElement>('accountclose').disabled=true;
    try{
      await acceptTerms(version,accountId);
      if(this.account?.id!==accountId)return;
      el('termsupdate').hidden=true;this.status('Terms accepted. You can now use Jev AI.');
      await this.refreshAgreement();void this.refreshJevUsage();
    }catch(error){if(this.account?.id===accountId)this.status(error instanceof Error?error.message:'Could not save acceptance. Please try again.');}
    finally{this.agreementBusy=false;el<HTMLButtonElement>('acceptterms').disabled=false;el<HTMLButtonElement>('accountlogout').disabled=this.playing();el<HTMLButtonElement>('accountclose').disabled=this.recoveryPending;}
  }
  private setMode(mode:typeof this.mode) {
    if(this.busy||this.agreementBusy)return;
    this.mode=mode;
    for(const name of ['login','register','recover'])el('account-'+name).setAttribute('aria-pressed',String(name===mode));
    el('accountrecoverylabel').hidden=mode!=='recover';
    el('registerterms').hidden=mode!=='register';
    el<HTMLInputElement>('registeradult').required=mode==='register';
    const recovery=el<HTMLInputElement>('accountrecovery');recovery.required=mode==='recover';recovery.disabled=mode!=='recover';
    el<HTMLInputElement>('accountpassword').autocomplete=mode==='login'?'current-password':'new-password';
    el('accountsubmit').textContent=mode==='register'?'Create account':mode==='recover'?'Reset password':'Sign in';
    el('accountpasswordlabel').textContent=mode==='recover'?'New password':'Password';
    this.status('');
    if(mode==='register')void this.refreshAgreement();
  }
  private render(stats?:Stats) {
    this.admin.setAccount(this.account);
    for(const id of ['accountpremium','settingspremium'])el(id).hidden=!this.account?.premium;
    el('accountbtn').textContent=this.account?`${this.account.username} · Account`:'Sign in / Create account';
    const identity=el('accountidentity');
    el('accountidentityname').textContent=this.account?.username??'Sign in';
    identity.setAttribute('aria-label',this.account?`Account settings for ${this.account.username}`:'Sign in or create an account');
    identity.title=this.account?`${this.account.username} · Account settings`:'Sign in or create an account';
    el('accountauth').hidden=!!this.account||this.recoveryPending;
    el('accountprofile').hidden=!this.account||this.recoveryPending;
    if(this.account){
      el('accountname').textContent=this.account.username;
      void this.refreshJevUsage();
      el('accountsince').textContent=`Joined ${new Date(this.account.createdAt*1000).toLocaleDateString()}`;
    }
    if(stats){
      const list=el('accountstats');list.replaceChildren();
      for(const [label,value] of [['Online + Jev matches',stats.matches],['Wins',stats.wins],['Losses',stats.losses],['Recorded shots',stats.shots],['Recorded balls pocketed',stats.ballsPocketed],['Recorded scratches',stats.scratches],['Recorded fouls',stats.fouls],['Matches left',stats.abandoned]]){
        const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=String(label);dd.textContent=String(value);div.append(dt,dd);list.append(div);
      }
      let note=document.getElementById('accountstatsnote');
      if(!note){note=document.createElement('p');note.id='accountstatsnote';list.after(note);}
      note.textContent=stats.shotStatsComplete===false?'Includes earlier Jev results. Shot, ball, scratch and foul counts cover recorded play; earlier shot details are unavailable.':'Online and Jev AI games. Local CPU practice is not included.';
      const recent=el('accountmatches');recent.replaceChildren();
      for(const match of stats.recent){const li=document.createElement('li');li.textContent=`${match.mode==='online'?'Online · ':''}${match.opponent} · ${match.result??match.status}${match.status==='forfeit'?' (forfeit)':''}`;recent.append(li);}
    }
    el<HTMLButtonElement>('accountlogout').disabled=this.playing()||this.busy||this.agreementBusy;
    el('accountplaying').hidden=!this.playing();
  }
  private async refreshJevUsage() {
    const accountId=this.account?.id;
    try {
      const response=await fetch('/api/opponents/jev',{cache:'no-store'});
      if (!response.ok) throw new Error();
      const data=await response.json();
      if(this.account?.id!==accountId)return;
      const u=data.usage;
      el('accountjev').textContent=data.available
        ? u.unlimited
          ? 'Premium · Unlimited Jev AI games. Resume your game or use New rack while playing Jev to start another.'
          : `Jev AI: ${u.gamesRemaining} of 5 free games remaining today. ${data.game?.status==='active'?'Your current game can be resumed. ':''}Resets ${new Date(u.resetsAt*1000).toLocaleString()}.`
        : 'Jev AI is not configured on this server.';
    } catch {
      if(this.account?.id===accountId)el('accountjev').textContent='Jev AI usage is unavailable.';
    }
  }
  private async submit() {
    if(this.playing()){this.status('Leave your current room before changing accounts.');return;}
    if(this.busy||this.agreementBusy)return;
    if(this.mode==='register'&&!el<HTMLInputElement>('registeradult').checked){this.status('Accounts require age 18+ and acceptance of the Terms.');return;}
    this.busy=true;++this.accountRevision;++this.agreementRevision;el<HTMLButtonElement>('accountsubmit').disabled=true;el<HTMLButtonElement>('accountclose').disabled=true;
    const password=el<HTMLInputElement>('accountpassword'),recovery=el<HTMLInputElement>('accountrecovery');
    try {
      const currentTerms=this.mode==='register'?await termsStatus():null;
      if(currentTerms&&this.agreement?.version!==currentTerms.version){this.agreement=currentTerms;el<HTMLInputElement>('registeradult').checked=false;throw Error('The Terms have changed. Please review them and confirm acceptance again.');}
      const data=await this.request('/'+this.mode,{username:el<HTMLInputElement>('accountusername').value.trim(),password:password.value,...(this.mode==='register'?{terms_version:currentTerms!.version,adult:el<HTMLInputElement>('registeradult').checked}:{}),...(this.mode==='recover'?{recovery:recovery.value}:{})});
      this.account=data.account??null;this.changed(this.account);this.status('');
      if(data.recovery){this.recoveryPending=true;el<HTMLInputElement>('recoveryvalue').value=data.recovery;el('recoverypanel').hidden=false;}
      this.render();
    } catch(error){this.status(error instanceof Error?error.message:'Unable to complete request.');}
    finally {password.value='';recovery.value='';this.busy=false;el<HTMLButtonElement>('accountsubmit').disabled=false;el<HTMLButtonElement>('accountclose').disabled=this.recoveryPending;}
    if(!this.recoveryPending)await this.refresh();
  }
  private async logout(){
    if(this.busy||this.agreementBusy)return;
    if(this.playing()){this.status('Leave your current room before signing out.');return;}
    this.busy=true;++this.accountRevision;++this.agreementRevision;
    el<HTMLButtonElement>('accountlogout').disabled=true;el<HTMLButtonElement>('accountclose').disabled=true;
    try {await this.request('/logout',{});this.account=null;this.changed(null);this.render();void this.refreshAgreement();this.status('Signed out. You can still play as a guest.');}
    catch(error){this.status(error instanceof Error?error.message:'Unable to sign out.');}
    finally{this.busy=false;el<HTMLButtonElement>('accountlogout').disabled=this.playing();el<HTMLButtonElement>('accountclose').disabled=this.recoveryPending;}
  }
}
