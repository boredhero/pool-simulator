const VERSION='2026-10-08';
const KEY='pool:privacy';
let enabled=false;
const nav=navigator as Navigator & {globalPrivacyControl?:boolean};
const optedOut=()=>nav.globalPrivacyControl===true||navigator.doNotTrack==='1';
async function consent(allow:boolean) {
  enabled=false;
  const response=await fetch('/api/privacy/consent',{method:'POST',headers:{'Content-Type':'application/json','X-Pool-Request':'1'},
    body:JSON.stringify({allow:allow&&!optedOut(),adult:allow,version:VERSION,device:matchMedia('(pointer:coarse)').matches?'touch':'pointer'})});
  if(!response.ok)throw new Error('Could not save privacy preference. Optional tracking stays off.');
  enabled=(await response.json()).analytics===true;
  try {localStorage.setItem(KEY,JSON.stringify({version:VERSION,allow:enabled}));}catch{/* private mode */}
}
function event(name:string) {
  if(!enabled||optedOut())return;
  void fetch('/api/privacy/events',{method:'POST',headers:{'Content-Type':'application/json','X-Pool-Request':'1'},body:JSON.stringify({name})}).catch(()=>{});
}
export function initPrivacy() {
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
    enabled=false;
    try {localStorage.setItem(KEY,JSON.stringify({version:VERSION,allow:false}));}catch{/* private mode */}
    notice.hidden=true;
    void consent(false).catch(()=>{});
  });
  let saved:any=null;
  try {saved=JSON.parse(localStorage.getItem(KEY)??'null');}catch{/* private mode */}
  if(saved?.version===VERSION){
    notice.hidden=true;
    // Rotate a session on page load; never create a visitor identifier before opt-in.
    if(saved.allow&&!optedOut())void consent(true).then(()=>event('session_start')).catch(()=>{});
    else void consent(false).catch(()=>{});
  } else notice.hidden=false;
  if(optedOut()){enabled=false;notice.hidden=true;void consent(false).catch(()=>{});}
  const features:Record<string,string>={settingsbtn:'settings',helpbtn:'help',viewbtn:'camera',onlinebtn:'online',cpubtn:'cpu',jevbtn:'jev',rack:'new_rack',resetspin:'spin_reset',version:'changelog'};
  for(const [id,name] of Object.entries(features))document.getElementById(id)?.addEventListener('click',()=>event(name));
}
