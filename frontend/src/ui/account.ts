export interface Account {id:string;username:string;createdAt:number;premium:boolean}
interface Stats {matches:number;wins:number;losses:number;abandoned:number;shots:number;ballsPocketed:number;scratches:number;fouls:number;recent:Array<{id:string;opponent:string;status:string;result:string|null}>}
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;

export class AccountPanel {
  account:Account|null=null;
  private mode:'login'|'register'|'recover'='login';
  private recoveryPending=false;
  private busy=false;
  constructor(private playing:()=>boolean,private changed:(account:Account|null)=>void) {
    el('accountbtn').addEventListener('click',()=>{el<HTMLDialogElement>('accountdialog').showModal();void this.refresh();});
    el('accountclose').addEventListener('click',()=>el<HTMLDialogElement>('accountdialog').close());
    el('accountdialog').addEventListener('cancel',e=>{if(this.recoveryPending||this.busy)e.preventDefault();});
    el('accountdialog').addEventListener('close',()=>el('accountbtn').focus());
    for(const mode of ['login','register','recover'] as const)el('account-'+mode).addEventListener('click',()=>this.setMode(mode));
    el('accountform').addEventListener('submit',e=>{e.preventDefault();void this.submit();});
    el('accountlogout').addEventListener('click',()=>void this.logout());
    el('acceptterms').addEventListener('click',()=>{
      if(!el<HTMLInputElement>('termsadult').checked){this.status('Confirm you are 18 or older and accept the Terms.');return;}
      void fetch('/api/privacy/terms',{method:'POST',headers:{'Content-Type':'application/json','X-Pool-Request':'1'},body:JSON.stringify({version:'2026-10-08',adult:true})})
        .then(r=>{if(!r.ok)throw new Error();this.status('Terms accepted. You can now start your daily Jev game.');void this.refreshJevUsage();})
        .catch(()=>this.status('Could not save acceptance. Please try again.'));
    });
    el('accountrefresh').addEventListener('click',()=>void this.refresh());
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
    const response=await fetch('/api/account'+path,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json','X-Pool-Request':'1'}:undefined,body:payload?JSON.stringify(payload):undefined});
    const data=await response.json();
    if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Please check the form and try again.');
    return data;
  }
  async refresh() {
    if(this.recoveryPending||this.busy)return;
    try {const data=await this.request('');this.account=data.account;this.changed(this.account);this.render(data.stats);}
    catch {this.status('Account service unavailable. Local play still works.');}
  }
  private setMode(mode:typeof this.mode) {
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
  }
  private render(stats?:Stats) {
    for(const id of ['accountpremium','settingspremium'])el(id).hidden=!this.account?.premium;
    el('accountbtn').textContent=this.account?`${this.account.username} · Account`:'Sign in / Create account';
    el('accountauth').hidden=!!this.account||this.recoveryPending;
    el('accountprofile').hidden=!this.account||this.recoveryPending;
    if(this.account){
      el('accountname').textContent=this.account.username;
      void this.refreshJevUsage();
      el('accountsince').textContent=`Joined ${new Date(this.account.createdAt*1000).toLocaleDateString()}`;
    }
    if(stats){
      const list=el('accountstats');list.replaceChildren();
      for(const [label,value] of [['Casual matches',stats.matches],['Wins',stats.wins],['Losses',stats.losses],['Shots',stats.shots],['Balls pocketed',stats.ballsPocketed],['Scratches',stats.scratches],['Fouls',stats.fouls],['Matches left',stats.abandoned]]){
        const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=String(label);dd.textContent=String(value);div.append(dt,dd);list.append(div);
      }
      const recent=el('accountmatches');recent.replaceChildren();
      for(const match of stats.recent){const li=document.createElement('li');li.textContent=`${match.opponent} · ${match.result??match.status}${match.status==='forfeit'?' (forfeit)':''}`;recent.append(li);}
    }
    el<HTMLButtonElement>('accountlogout').disabled=this.playing();
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
          : `Jev AI: ${u.gamesRemaining} free game available today (one per account and network). ${data.game?.status==='active'?'Your current game can be resumed. ':''}Resets ${new Date(u.resetsAt*1000).toLocaleString()}.`
        : 'Jev AI is not configured on this server.';
    } catch {
      if(this.account?.id===accountId)el('accountjev').textContent='Jev AI usage is unavailable.';
    }
  }
  private async submit() {
    if(this.playing()){this.status('Leave your current room before changing accounts.');return;}
    if(this.busy)return;
    if(this.mode==='register'&&!el<HTMLInputElement>('registeradult').checked){this.status('Accounts require age 18+ and acceptance of the Terms.');return;}
    this.busy=true;el<HTMLButtonElement>('accountsubmit').disabled=true;el<HTMLButtonElement>('accountclose').disabled=true;
    const password=el<HTMLInputElement>('accountpassword'),recovery=el<HTMLInputElement>('accountrecovery');
    try {
      const data=await this.request('/'+this.mode,{username:el<HTMLInputElement>('accountusername').value.trim(),password:password.value,...(this.mode==='register'?{terms_version:'2026-10-08',adult:el<HTMLInputElement>('registeradult').checked}:{}),...(this.mode==='recover'?{recovery:recovery.value}:{})});
      this.account=data.account??null;this.changed(this.account);this.status('');
      if(data.recovery){this.recoveryPending=true;el<HTMLInputElement>('recoveryvalue').value=data.recovery;el('recoverypanel').hidden=false;}
      this.render();
    } catch(error){this.status(error instanceof Error?error.message:'Unable to complete request.');}
    finally {password.value='';recovery.value='';this.busy=false;el<HTMLButtonElement>('accountsubmit').disabled=false;el<HTMLButtonElement>('accountclose').disabled=this.recoveryPending;}
    if(!this.recoveryPending)await this.refresh();
  }
  private async logout(){
    if(this.playing()||this.busy){this.status('Leave your current room before signing out.');return;}
    try {await this.request('/logout',{});this.account=null;this.changed(null);this.render();this.status('Signed out. You can still play as a guest.');}
    catch(error){this.status(error instanceof Error?error.message:'Unable to sign out.');}
  }
}
