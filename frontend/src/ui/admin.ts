import type { Account } from './account';
import './admin.css';

type Usage = {games:number;requests:number;input_tokens:number;output_tokens:number;estimated_cost_nano:number;unmetered_requests:number;last_activity:number|null};
type User = {id:string;username:string;createdAt:number;premium:boolean;isAdmin:boolean;usage:Usage};
type Game = {id:string;status:string;startedAt:number;updatedAt:number;premiumGame:boolean} & Usage;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const number=(n:number)=>n.toLocaleString();
const money=(nano:number)=>nano>0&&nano<1000?'<$0.000001':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:6,maximumFractionDigits:6}).format(nano/1e9);
const date=(seconds:number|null)=>seconds?new Date(seconds*1000).toLocaleString(): 'No activity';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='') {
  const n=document.createElement(tag);n.textContent=text;n.className=className;return n;
}

export class AdminPanel {
  private account:Account|null=null;
  private offset=0;
  private total=0;
  private sequence=0;
  private pending?:AbortController;
  private opener:HTMLElement|null=null;
  private debounce=0;
  private dialog=el<HTMLDialogElement>('admindialog');
  constructor(private accountChanged:()=>void) {
    el('adminbtn').addEventListener('click',()=>{
      if(!this.account?.isAdmin)return;
      this.opener=document.activeElement as HTMLElement;
      this.dialog.showModal();void this.load();
    });
    el('adminclose').addEventListener('click',()=>this.dialog.close());
    // Keep game-level shortcuts from closing the panel underneath this modal.
    this.dialog.addEventListener('keydown',event=>event.stopPropagation());
    this.dialog.addEventListener('close',()=>{
      this.pending?.abort();this.sequence++;
      this.opener?.focus();
    });
    el('adminrefresh').addEventListener('click',()=>void this.load());
    el('adminsearch').addEventListener('input',()=>{
      clearTimeout(this.debounce);
      this.debounce=window.setTimeout(()=>{this.offset=0;void this.load();},250);
    });
    for(const id of ['adminfilter','adminsort'])el(id).addEventListener('change',()=>{this.offset=0;void this.load();});
    el('adminprev').addEventListener('click',()=>{this.offset=Math.max(0,this.offset-20);void this.load();});
    el('adminnext').addEventListener('click',()=>{this.offset+=20;void this.load();});
  }
  setAccount(account:Account|null) {
    this.account=account;el('adminbtn').hidden=!account?.isAdmin;
    if(!account?.isAdmin){
      this.pending?.abort();this.sequence++;
      this.dialog.close();el('adminrows').replaceChildren();el('adminsummary').replaceChildren();
    } else el('adminowner').textContent=`Signed in as ${account.username}`;
  }
  private async request(path:string,options:RequestInit={}) {
    const response=await fetch('/api/admin'+path,{...options,cache:'no-store',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Pool-Request':'1',...options.headers}});
    if(response.status===401||response.status===403||response.status===404){
      if(path==='/overview'||response.status!==404)this.setAccount(null);
      throw new Error('Admin access is unavailable. Refresh your account to continue.');
    }
    if(!response.ok)throw new Error('Could not complete the admin request. Please try again.');
    return response.json();
  }
  private async load() {
    if(!this.account?.isAdmin||!this.dialog.open)return;
    this.pending?.abort();const controller=new AbortController();this.pending=controller;
    const seq=++this.sequence;
    el('adminstatus').textContent='Loading accounts…';el('adminresults').setAttribute('aria-busy','true');
    const sort=el<HTMLSelectElement>('adminsort').value;
    const query=new URLSearchParams({search:el<HTMLInputElement>('adminsearch').value,
      premium:el<HTMLSelectElement>('adminfilter').value,sort,direction:sort==='username'?'asc':'desc',offset:String(this.offset),limit:'20'});
    try {
      const [summary,list]=await Promise.all([
        this.request('/overview',{signal:controller.signal}),this.request('/accounts?'+query,{signal:controller.signal}),
      ]);
      if(seq!==this.sequence)return;
      this.total=list.total;
      if(this.offset>=this.total&&this.offset>0){this.offset=Math.max(0,Math.floor((this.total-1)/20)*20);void this.load();return;}
      el('adminsummary').replaceChildren(...[
        ['Accounts',number(summary.accounts),'Registered players'],
        ['Premium',number(summary.premium),'Unlimited Jev games'],
        ['Jev requests',number(summary.usage.requests),`${number(summary.lifetimeAttempts)} lifetime attempts`],
        ['Estimated cost',money(summary.usage.estimated_cost_nano),'USD · recorded games'],
      ].map(([title,value,caption])=>{const card=node('div','','admin-metric');card.append(node('span',title),node('strong',value),node('small',caption));return card;}));
      el('adminusage-note').textContent=`${number(summary.usage.input_tokens)} input tokens · ${number(summary.usage.output_tokens)} output tokens · ${number(summary.usage.unmetered_requests)} requests without reported usage. Costs are estimates; unmetered requests may still have incurred charges.`;
      el('adminrows').replaceChildren(...list.accounts.map((user:User)=>this.row(user)));
      el('adminempty').hidden=this.total!==0;
      el('adminstatus').textContent=`${number(this.total)} ${this.total===1?'account':'accounts'} found`;
      el('adminpage').textContent=this.total?`${this.offset+1}–${Math.min(this.offset+20,this.total)} of ${number(this.total)}`:'0 accounts';
      el<HTMLButtonElement>('adminprev').disabled=this.offset===0;
      el<HTMLButtonElement>('adminnext').disabled=this.offset+20>=this.total;
    } catch(error){if(!controller.signal.aborted)el('adminstatus').textContent=error instanceof Error?error.message:'Unable to load accounts.';}
    finally {if(seq===this.sequence)el('adminresults').setAttribute('aria-busy','false');}
  }
  private row(user:User) {
    const row=node('tr');row.dataset.accountId=user.id;
    const identity=node('th');identity.scope='row';identity.append(node('strong',user.username));
    if(user.isAdmin)identity.append(node('span','Owner','admin-owner-tag'));
    identity.append(node('small',`Joined ${new Date(user.createdAt*1000).toLocaleDateString()}`));
    const status=node('td');
    const toggle=node('button',user.premium?'Premium':'Free','admin-switch');toggle.type='button';
    toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(user.premium));
    toggle.setAttribute('aria-label',`Premium for ${user.username}`);
    toggle.addEventListener('click',async()=>{
      toggle.disabled=true;
      try {
        await this.request(`/accounts/${encodeURIComponent(user.id)}/premium`,{method:'PATCH',body:JSON.stringify({premium:!user.premium})});
        await this.load();el('adminstatus').textContent=`${user.username}: Premium ${user.premium?'disabled':'enabled'}.`;
        const updated=el('adminrows').querySelector<HTMLButtonElement>(`tr[data-account-id="${CSS.escape(user.id)}"] .admin-switch`);updated?.focus();
        this.accountChanged();
      } catch(error){el('adminstatus').textContent=error instanceof Error?error.message:'Update failed.';toggle.disabled=false;}
    });
    status.append(toggle);
    const requests=node('td',number(user.usage.requests),'admin-numeric');
    requests.append(node('small',`${number(user.usage.games)} games`));
    const cost=node('td',money(user.usage.estimated_cost_nano),'admin-numeric');
    if(user.usage.unmetered_requests)cost.append(node('small',`${number(user.usage.unmetered_requests)} unmetered`,'admin-unmetered'));
    const action=node('td'),details=node('button','Details','admin-details-button');details.type='button';
    details.setAttribute('aria-expanded','false');details.setAttribute('aria-label',`Usage details for ${user.username}`);
    let detailRow:HTMLTableRowElement|undefined;
    details.addEventListener('click',async()=>{
      if(detailRow){detailRow.remove();detailRow=undefined;details.setAttribute('aria-expanded','false');return;}
      detailRow=node('tr');const cell=node('td','','admin-detail');cell.colSpan=5;cell.textContent='Loading usage…';
      detailRow.append(cell);row.after(detailRow);details.setAttribute('aria-expanded','true');
      try {
        const data=await this.request(`/accounts/${encodeURIComponent(user.id)}`);
        if(!detailRow?.isConnected)return;
        cell.replaceChildren(node('h3',`${user.username} · Jev activity`));
        cell.append(node('p',`${number(data.lifetimeAttempts)} lifetime attempts · ${number(data.lifetimeCompleted)} completed selections. Last game activity: ${date(user.usage.last_activity)}.`));
        cell.append(node('p',`${number(user.usage.input_tokens)} input tokens · ${number(user.usage.output_tokens)} output tokens · ${number(user.usage.unmetered_requests)} unmetered requests in recorded games.`));
        const games=node('ul','','admin-game-list');
        for(const game of data.games as Game[]){
          const item=node('li');item.append(node('strong',`${game.status} · ${date(game.startedAt)}`),node('span',`${game.premiumGame?'Premium':'Free'} · ${number(game.requests)} requests · ${number(game.input_tokens)} input / ${number(game.output_tokens)} output tokens · ${money(game.estimated_cost_nano)} estimated${game.unmetered_requests?` · ${game.unmetered_requests} unmetered`:''}`));games.append(item);
        }
        cell.append(games.children.length?games:node('p','No recorded Jev games yet.'));
        if(data.audit.length){cell.append(node('h4','Recent Premium changes'));const log=node('ul');for(const entry of data.audit)log.append(node('li',`${date(entry.at)} · ${entry.from?'Premium':'Free'} → ${entry.to?'Premium':'Free'}`));cell.append(log);}
      } catch(error){if(detailRow?.isConnected)cell.textContent=error instanceof Error?error.message:'Unable to load usage.';}
    });
    action.append(details);row.append(identity,status,requests,cost,action);return row;
  }
}
