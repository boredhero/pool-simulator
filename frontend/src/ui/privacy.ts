export const PRIVACY_VERSION='2026-10-08';
const VERSION=PRIVACY_VERSION;
const KEY='pool:privacy';
let enabled=false;
let consentGeneration=0;
const nav=navigator as Navigator & {globalPrivacyControl?:boolean};
export const privacyOptedOut=()=>nav.globalPrivacyControl===true||navigator.doNotTrack==='1';
const optedOut=privacyOptedOut;
export function savedPrivacyChoice():{version:string;allow:boolean}|null {
  try {const value=JSON.parse(localStorage.getItem(KEY)??'null');return value?.version===VERSION&&typeof value.allow==='boolean'?value:null;}catch{return null;}
}
export function chooseEssentialPrivacy():void {
  enabled=false;consentGeneration++;
  try {localStorage.setItem(KEY,JSON.stringify({version:VERSION,allow:false}));}catch{/* private mode */}
  document.getElementById('privacynotice')!.hidden=true;
  void consent(false).catch(()=>{});
}
export async function consent(allow:boolean) {
  const generation=++consentGeneration;
  enabled=false;
  const response=await fetch('/api/privacy/consent',{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Pool-Request':'1'},
    body:JSON.stringify({allow:allow&&!optedOut(),adult:allow,version:VERSION,device:matchMedia('(pointer:coarse)').matches?'touch':'pointer'})});
  if(!response.ok)throw new Error('Could not save privacy preference. Optional tracking stays off.');
  const result=await response.json();
  if(generation!==consentGeneration)return;
  enabled=result.analytics===true&&!optedOut();
  try {localStorage.setItem(KEY,JSON.stringify({version:VERSION,allow:enabled}));}catch{/* private mode */}
}
export function recordPrivacySession():void {event('session_start');}
function event(name:string) {
  if(!enabled||optedOut())return;
  void fetch('/api/privacy/events',{method:'POST',headers:{'Content-Type':'application/json','X-Pool-Request':'1'},body:JSON.stringify({name})}).catch(()=>{});
}
export function initPrivacy(options:{deferNotice?:boolean}={}) {
  const dialog=document.getElementById('privacychoices') as HTMLDialogElement;
  const notice=document.getElementById('privacynotice')!;
  document.getElementById('privacybtn')!.addEventListener('click',()=>dialog.showModal());
  document.getElementById('privacyclose')!.addEventListener('click',()=>dialog.close());
  for(const [id,allow] of [['privacyaccept',true],['privacyreject',false]] as const){
    document.getElementById(id)!.addEventListener('click',()=>{
      void consent(allow).then(()=>{notice.hidden=true;dialog.close();if(enabled)event('session_start');})
        .catch(e=>{document.getElementById('privacystatus')!.textContent=e.message;});
    });
  }
  document.getElementById('privacyreview')!.addEventListener('click',()=>dialog.showModal());
  document.getElementById('privacyessential')!.addEventListener('click',()=>{
    chooseEssentialPrivacy();
  });
  const saved=savedPrivacyChoice();
  if(saved?.version===VERSION){
    notice.hidden=true;
    // Rotate a session on page load; never create a visitor identifier before opt-in.
    if(saved.allow&&!optedOut())void consent(true).then(()=>event('session_start')).catch(()=>{});
    else void consent(false).catch(()=>{});
  } else notice.hidden=options.deferNotice===true;
  if(optedOut()){enabled=false;notice.hidden=true;void consent(false).catch(()=>{});}
  const features:Record<string,string>={settingsbtn:'settings',helpbtn:'help',viewbtn:'camera',onlinebtn:'online',cpubtn:'cpu',jevbtn:'jev',rack:'new_rack',resetspin:'spin_reset',version:'changelog'};
  for(const [id,name] of Object.entries(features))document.getElementById(id)?.addEventListener('click',()=>event(name));
}
