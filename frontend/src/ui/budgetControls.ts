export const usd=(nano:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:9}).format(nano/1e9);
type Request=(path:string,options?:RequestInit)=>Promise<any>;
function moneyForm(label:string,value:string,save:(dollars:string,id:string)=>Promise<void>){
 const form=document.createElement('form');form.className='budget-form';
 const title=document.createElement('label');title.textContent=label;
 const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.pattern='(0|[1-9][0-9]{0,5})\\.[0-9]{2}';input.required=true;input.value=value;input.placeholder='0.15';title.append(input);
 const button=document.createElement('button');button.type='submit';button.textContent='Save';
 const status=document.createElement('span');status.setAttribute('role','status');
 let id=crypto.randomUUID();input.addEventListener('input',()=>{id=crypto.randomUUID();});
 form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;try{await save(input.value,id);status.textContent='Saved';id=crypto.randomUUID();}catch(error){status.textContent=error instanceof Error?error.message:'Could not save';}finally{button.disabled=false;}});
 form.append(title,button,status);return form;
}
export function defaultBudgetControls(parent:HTMLElement,nano:number,request:Request){
 parent.querySelector('.budget-default')?.remove();const box=document.createElement('section');box.className='budget-default';
 box.append(moneyForm('Default monthly Jev allowance (USD)',(nano/1e9).toFixed(2),async(dollars,requestId)=>{await request('/budget-default',{method:'PATCH',body:JSON.stringify({dollars,requestId})});}));const provider=document.createElement('p');provider.textContent='TypeSafe prepaid balance: unavailable through the documented API. ';const link=document.createElement('a');link.href='https://console.typesafe.ai/settings/billing';link.target='_blank';link.rel='noopener';link.textContent='Open TypeSafe billing';provider.append(link);box.append(provider);const anchor=parent.querySelector('#adminusage-note');if(anchor)anchor.after(box);else parent.append(box);
}
export function accountBudgetControls(parent:HTMLElement,id:string,data:any,request:Request){
 const box=document.createElement('section');box.className='budget-account';const summary=document.createElement('p');
 const render=(b:any)=>{summary.textContent=`${b.month} · ${usd(b.spentNano)} metered usage · ${usd(b.reservedNano)} reserved for pending/unknown requests · ${usd(b.limitNano)} allowance (${usd(b.topupsNano)} in top-ups) · ${b.unlimited?'Premium: unlimited':usd(b.remainingNano)+' remaining'}. Completion grace: ${usd(b.graceNano)}, then CPU finishes the rack. Resets ${new Date(b.resetsAt*1000).toLocaleString()}.`;};render(data.budget);box.append(summary);
 for(const [kind,label,value] of [['limit','Monthly allowance for this account (USD)',(data.budget.baseNano/1e9).toFixed(2)],['topup','Add to this month only (USD)','0.05']])box.append(moneyForm(label,value,async(dollars,requestId)=>render(await request(`/accounts/${encodeURIComponent(id)}/budget/${kind}`,{method:'POST',body:JSON.stringify({dollars,requestId})}))));
 const heading=document.createElement('h4');heading.textContent='Recent request ledger';box.append(heading);
 const list=document.createElement('ul');for(const r of data.requests??[]){const li=document.createElement('li');li.textContent=`${new Date(r.at*1000).toLocaleString()} · ${r.model} · seat ${r.seat+1} · ${r.status} · ${r.costNano===null?'Charge unknown; '+usd(r.reservedNano)+' reserved':usd(r.costNano)+' from '+r.inputTokens+' input tokens'} · ${r.id}`;list.append(li);}box.append(list);
 for(const a of data.budgetAdjustments??[]){const p=document.createElement('p');p.textContent=`${new Date(a.at*1000).toLocaleString()} · ${a.month} · ${a.kind}: ${usd(a.amountNano)}`;box.append(p);}parent.append(box);
}
