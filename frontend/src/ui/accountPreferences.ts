const keys = ['pool:felt', 'pool:wood', 'pool:cue-style', 'pool:sights', 'pool:auto-camera', 'pool:fast-forward', 'pool:cameraInput'] as const;
export type PreferenceKey = typeof keys[number];
type Settings = Partial<Record<PreferenceKey, string>>;
type Identity = {id:string; settings?:Record<string,string>};
type Save = (patch:{settings:Settings})=>Promise<Identity|null>;

/** Guest preferences remain on this device; account preferences come only from the server. */
export class AccountPreferences {
  private accountId:string|null=null;
  private values:Settings={};
  private pending:Settings={};
  private sending:Settings={};
  private generation=0;
  private busy=false;
  private save?:Save;
  private listeners=new Set<()=>void>();
  error='';
  constructor(private storage:()=>Storage=()=>localStorage) {}
  getItem(key:PreferenceKey):string|null {
    if(this.accountId)return this.values[key]??null;
    try{return this.storage().getItem(key);}catch{return null;}
  }
  setItem(key:PreferenceKey,value:string):void {
    if(!this.accountId){try{this.storage().setItem(key,value);}catch{}return;}
    this.values[key]=value;this.pending[key]=value;
    queueMicrotask(()=>void this.flush());
  }
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  private emit():void {for(const listener of this.listeners)listener();}
  bind(account:Identity|null,save:Save):void {
    const id=account?.id??null;
    if(id!==this.accountId){this.generation++;this.pending={};this.sending={};this.busy=false;this.error='';}
    this.accountId=id;this.save=save;
    this.values={};
    for(const key of keys)if(typeof account?.settings?.[key]==='string')this.values[key]=account.settings[key];
    Object.assign(this.values,this.sending,this.pending);
    this.emit();
  }
  async retry():Promise<void> {await this.flush();}
  private async flush():Promise<void> {
    if(this.busy||!this.accountId||!this.save||!Object.keys(this.pending).length)return;
    const generation=this.generation,id=this.accountId,patch=this.pending;
    this.pending={};this.sending=patch;this.busy=true;
    try {
      const account=await this.save({settings:patch});
      if(generation!==this.generation)return;
      if(!account||account.id!==id)throw new Error('Settings could not be saved. Retry when signed in.');
      this.error='';
    }catch {
      if(generation!==this.generation)return;
      this.pending={...patch,...this.pending};
      this.error='Settings could not be saved to your account.';
    }finally {
      if(generation===this.generation){this.sending={};this.busy=false;this.emit();if(!this.error&&Object.keys(this.pending).length)queueMicrotask(()=>void this.flush());}
    }
  }
}
export const accountPreferences=new AccountPreferences();

export function mountPreferenceStatus():void {
  const status=document.createElement('p');status.id='preferencesstatus';status.setAttribute('role','status');status.hidden=true;
  const message=document.createElement('span'),retry=document.createElement('button');retry.type='button';retry.textContent='Retry';
  retry.addEventListener('click',()=>void accountPreferences.retry());status.append(message,retry);
  document.getElementById('settingspanel')!.append(status);
  accountPreferences.subscribe(()=>{message.textContent=accountPreferences.error+' ';status.hidden=!accountPreferences.error;});
}
