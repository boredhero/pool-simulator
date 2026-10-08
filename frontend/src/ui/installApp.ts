import './installApp.css';

type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export function setupInstallApp(){
 let deferred:InstallEvent|null=null,busy=false,confirmed=false,opener:HTMLElement|null=null;
 const display=matchMedia('(display-mode: standalone)');
 const installed=()=>confirmed||display.matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const button=document.getElementById('installapp') as HTMLButtonElement;
 const status=document.getElementById('installappstatus')!;
 const dialog=document.createElement('dialog');dialog.id='installappdialog';dialog.setAttribute('aria-labelledby','installapptitle');
 const title=document.createElement('h2');title.id='installapptitle';title.textContent='Install Pool Simulator';
 const description=document.createElement('p');description.textContent='Add Pool Simulator to your Home Screen or desktop for easy access.';
 const steps=document.createElement('ol'),done=document.createElement('button');done.type='button';done.textContent='Done';done.autofocus=true;
 dialog.append(title,description,steps,done);document.body.append(dialog);
 const refresh=()=>{const active=installed();document.body.classList.toggle('app-installed',active);button.disabled=active||busy;button.textContent=active?'App installed':'Install app';if(active)status.textContent='Pool Simulator is installed on this device.';};
 const help=()=>{
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const instructions=ios?['Open this page in Safari on your iPhone or iPad.','Tap Share, then Add to Home Screen. You may need to scroll or use Edit Actions to find it.','Keep Open as Web App enabled if shown, then tap Add.']:
   /Android/i.test(navigator.userAgent)?['Open your browser’s menu (⋮).','Choose Install app or Add to Home screen, then confirm.','If that option is missing, open this page in Chrome and try again.']:
   /Mac/.test(navigator.platform)&&/Safari/.test(navigator.userAgent)&&!/Chrome|Chromium/.test(navigator.userAgent)?['In Safari, choose File → Add to Dock.','Confirm the name and choose Add.']:
   ['Look for Install app in your browser’s address bar or menu.','If your browser has no install option, try Chrome or Edge, or Safari’s File → Add to Dock on Mac.'];
  steps.replaceChildren(...instructions.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  if(!dialog.open)dialog.showModal();
 };
 done.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>opener?.focus());dialog.addEventListener('keydown',e=>e.stopPropagation());
 addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event as InstallEvent;refresh();});
 addEventListener('appinstalled',()=>{confirmed=true;deferred=null;if(dialog.open)dialog.close();refresh();});display.addEventListener('change',refresh);
 document.addEventListener('click',async event=>{
  if(!(event.target instanceof Element)||!event.target.closest('[data-install-app]')||installed()||busy)return;
  opener=event.target.closest('[data-install-app]') as HTMLElement;
  if(!deferred){help();return;}
  const prompt=deferred;deferred=null;busy=true;refresh();
  try {await prompt.prompt();const choice=await prompt.userChoice;status.textContent=choice.outcome==='accepted'?'Installation requested. Follow your browser’s instructions.':'Installation dismissed. You can install later from Settings or your browser menu.';}
  catch {status.textContent='Your browser could not open the install prompt. Follow these steps instead.';help();}
  finally{busy=false;refresh();}
 });
 refresh();
}
