import bundled from '../../../contracts/terms.json' with {type:'json'};
export const TERMS_VERSION=bundled.version;
export interface TermsStatus {version:string;accepted:boolean;authenticated:boolean;accountId:string|null}
export async function termsStatus():Promise<TermsStatus>{
  const response=await fetch('/api/privacy/terms',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Could not check the current Terms. Please try again.');
  const data=await response.json();
  if(!/^[a-f0-9]{64}$/.test(data.version)||typeof data.accepted!=='boolean'||typeof data.authenticated!=='boolean'||(data.authenticated?typeof data.accountId!=='string':data.accountId!==null))throw Error('Could not check the current Terms. Please try again.');
  return data;
}
export async function acceptTerms(version:string,accountId:string):Promise<void>{
  const response=await fetch('/api/privacy/terms',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Pool-Request':'1'},body:JSON.stringify({version,adult:true,accountId})});
  if(!response.ok)throw Error('Could not save acceptance. The Terms may have changed; refresh and review them before trying again.');
  const data=await response.json();if(data.accepted!==version)throw Error('Could not confirm saved acceptance. Please try again.');
}
