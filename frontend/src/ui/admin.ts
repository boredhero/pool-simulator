import {defaultBudgetControls,accountBudgetControls} from './budgetControls';
import type { Account } from './account';
import './admin.css';

type Usage = {games:number;requests:number;input_tokens:number;output_tokens:number;estimated_cost_nano:number;unmetered_requests:number;last_activity:number|null};
type User = {id:string;username:string;createdAt:number;lastActiveAt?:number|null;premium:boolean;simEnabled?:boolean;disabled?:boolean;isAdmin:boolean;usage:Usage};
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
      this.dialog.close();el('adminrows').replaceChildren();el('adminsummary').replaceChildren();el('adminvisitors').replaceChildren();
    } else el('adminowner').textContent=`Signed in as ${account.username}`;
  }
  private async request(path:string,options:RequestInit={}) {
    const response=await fetch('/api/admin'+path,{...options,cache:'no-store',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Pool-Request':'1',...options.headers}});
    if(response.status===401||response.status===403||response.status===404){
      if(path==='/overview'||response.status!==404)this.setAccount(null);
      throw new Error('Admin access is unavailable. Refresh your account to continue.');
    }
    if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(typeof data?.detail==='string'?data.detail:'Could not complete the admin request. Please try again.');}
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
      const visits=summary.visitors;
      el('adminvisitors').replaceChildren();
      if(visits){
        el('adminvisitors').append(node('h3','Anonymous analytics'));
        const cards=node('div','','admin-summary');
        for(const [label,value] of [['Visitor IDs · 24h',visits.dailyVisitors],['Visits · 24h',visits.day],['Visits · 7 days',visits.week],['Visits · 30 days',visits.month]] as [string,number][]){
          const card=node('div','','admin-metric');card.append(node('span',label),node('strong',number(value)));cards.append(card);
        }
        el('adminvisitors').append(cards,node('p','Opt-in browsers only, including signed-in players without account links. Daily cookie IDs are not unique people. A visit starts after 30 minutes of inactivity; refreshing does not add a visit. Cookie expiry, clearing, and separate devices can count again. Rolling time windows.','admin-note'));
      }
      if(summary.budgetDefaultNano!==undefined)defaultBudgetControls(el('adminsummary').parentElement!,summary.budgetDefaultNano,(p,o)=>this.request(p,o));
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
    if(user.disabled)identity.append(node('span','Disabled','admin-disabled-tag'));
    identity.append(node('small',`Joined ${new Date(user.createdAt*1000).toLocaleDateString()}`));
    identity.append(node('small',`Last active ${date(user.lastActiveAt??null)}`));
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
    const simulation=node('button',user.simEnabled?'Sim on':'Sim off','admin-switch');simulation.type='button';
    simulation.setAttribute('role','switch');simulation.setAttribute('aria-checked',String(!!user.simEnabled));simulation.setAttribute('aria-label',`Simulation for ${user.username}`);
    simulation.addEventListener('click',async()=>{
      simulation.disabled=true;
      try {await this.request(`/accounts/${encodeURIComponent(user.id)}/simulation`,{method:'PATCH',body:JSON.stringify({simEnabled:!user.simEnabled})});await this.load();this.accountChanged();}
      catch(error){el('adminstatus').textContent=error instanceof Error?error.message:'Update failed.';simulation.disabled=false;}
    });status.append(simulation);
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
        cell.append(node('p',`Joined ${date(user.createdAt)} · Last active ${date(data.lastActiveAt??null)}`));
        cell.append(node('p',`${number(data.lifetimeAttempts)} lifetime attempts · ${number(data.lifetimeCompleted)} completed selections. Last game activity: ${date(user.usage.last_activity)}.`));
        cell.append(node('p',`${number(user.usage.input_tokens)} input tokens · ${number(user.usage.output_tokens)} output tokens · ${number(user.usage.unmetered_requests)} unmetered requests in recorded games.`));
        if(data.budget)accountBudgetControls(cell,user.id,data,(p,o)=>this.request(p,o));
        const games=node('ul','','admin-game-list');
        for(const game of data.games as Game[]){
          const item=node('li');item.append(node('strong',`${game.status} · ${date(game.startedAt)}`),node('span',`${game.premiumGame?'Premium':'Free'} · ${number(game.requests)} requests · ${number(game.input_tokens)} input / ${number(game.output_tokens)} output tokens · ${money(game.estimated_cost_nano)} estimated${game.unmetered_requests?` · ${game.unmetered_requests} unmetered`:''}`));games.append(item);
        }
        cell.append(games.children.length?games:node('p','No recorded Jev games yet.'));
        if(data.accountActions?.length){cell.append(node('h4','Recent account changes'));const log=node('ul');for(const entry of data.accountActions)log.append(node('li',`${date(entry.at)} · ${entry.action}`));cell.append(log);}
        if(data.audit.length){cell.append(node('h4','Recent Premium changes'));const log=node('ul');for(const entry of data.audit)log.append(node('li',`${date(entry.at)} · ${entry.from?'Premium':'Free'} → ${entry.to?'Premium':'Free'}`));cell.append(log);}
      } catch(error){if(detailRow?.isConnected)cell.textContent=error instanceof Error?error.message:'Unable to load usage.';}
    });
    action.append(details);
    if(!user.isAdmin){
      const access=node('button',user.disabled?'Re-enable':'Disable','admin-details-button');access.type='button';
      access.setAttribute('aria-label',`${user.disabled?'Re-enable':'Disable'} account ${user.username}`);
      access.addEventListener('click',async()=>{
        access.disabled=true;
        try{
          await this.request(`/accounts/${encodeURIComponent(user.id)}/status`,{method:'PATCH',body:JSON.stringify({disabled:!user.disabled})});
          await this.load();el('adminstatus').textContent=`${user.username}: account ${user.disabled?'enabled':'disabled and signed out'}.`;
          el<HTMLInputElement>('adminsearch').focus();
        }catch(error){el('adminstatus').textContent=error instanceof Error?error.message:'Update failed.';access.disabled=false;}
      });
      const remove=node('button','Delete','admin-delete-button');remove.type='button';remove.setAttribute('aria-label',`Delete account ${user.username}`);
      remove.addEventListener('click',()=>{
        remove.disabled=true;
        const confirmation=node('tr'),cell=node('td','','admin-detail admin-delete-confirm');cell.colSpan=5;
        cell.append(node('h3',`Delete ${user.username}?`),node('p','This permanently removes the account, sign-in credentials, sessions and Jev usage records. Shared match history remains with the account link cleared and name replaced. Limited security audit records remain. This cannot be undone.'));
        const label=node('label',`Type ${user.username} to confirm`),input=node('input');input.type='text';input.autocomplete='off';label.append(input);
        const submit=node('button','Permanently delete','admin-delete-button'),cancel=node('button','Cancel');submit.type=cancel.type='button';submit.disabled=true;
        input.addEventListener('input',()=>{submit.disabled=input.value!==user.username;});
        cancel.addEventListener('click',()=>{confirmation.remove();remove.disabled=false;remove.focus();});
        submit.addEventListener('click',async()=>{
          submit.disabled=cancel.disabled=input.disabled=true;
          try{
            await this.request(`/accounts/${encodeURIComponent(user.id)}`,{method:'DELETE',body:JSON.stringify({username:input.value})});
            await this.load();el('adminstatus').textContent=`${user.username}: account deleted.`;el<HTMLInputElement>('adminsearch').focus();
          }catch(error){el('adminstatus').textContent=error instanceof Error?error.message:'Delete failed.';submit.disabled=cancel.disabled=input.disabled=false;}
        });
        cell.append(label,submit,cancel);confirmation.append(cell);row.after(confirmation);input.focus();
      });
      action.append(access,remove);
    }
    action.className='admin-account-actions';row.append(identity,status,requests,cost,action);return row;
  }
}
