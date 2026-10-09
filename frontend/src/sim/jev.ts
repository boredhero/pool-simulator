import {diagnosticId,diagnosticMessage} from '../diagnostics';
/** Authenticated monthly-budget games. All shots and provider choices are server-owned. */
export async function jevRequest(path: string, body: object, signal: AbortSignal): Promise<any> {
  const response = await fetch('/api/opponents/jev'+path, {
    method:'POST', headers:{'Content-Type':'application/json','X-Pool-Request':'1'},
    signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),body:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({}));
  const id=diagnosticId(response);
  if(!response.ok)throw new Error(diagnosticMessage(typeof data.detail==='string'?data.detail:'Jev game unavailable.',id));
  return {...data,diagnosticId:id};
}

export function jevFallbackNotice(result:{source:string;fallbackReason?:string;diagnosticId?:string|null}):string|null {
  if(result.source!=='cpu-fallback'&&result.source!=='budget-fallback')return null;
  const reasons:Record<string,string>={
    budget_exhausted:'Monthly Jev allowance and completion grace used. CPU is finishing this rack.',
    provider_timeout:'Jev AI timed out. CPU took this shot.',
    provider_rate_limited:'Jev AI is busy. CPU took this shot.',
    invalid_selection:'Jev AI returned an unusable choice. CPU took this shot.',
    provider_error:'Jev AI was unavailable. CPU took this shot.',
  };
  return diagnosticMessage(reasons[result.fallbackReason??'']??(result.source==='budget-fallback'?reasons.budget_exhausted:reasons.provider_error),result.diagnosticId??null);
}
