/** Authenticated monthly-budget games. All shots and provider choices are server-owned. */
export async function jevRequest(path: string, body: object, signal: AbortSignal): Promise<any> {
  const response = await fetch('/api/opponents/jev'+path, {
    method:'POST', headers:{'Content-Type':'application/json','X-Pool-Request':'1'},
    signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),body:JSON.stringify(body),
  });
  const data=await response.json();
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Jev game unavailable.');
  return data;
}
