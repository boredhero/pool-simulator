/** Only show opaque server-issued IDs, never arbitrary header text. */
export function diagnosticId(response:Response):string|null {
  const id=response.headers.get('X-Request-ID');
  return id&&/^[a-f0-9]{24}$/.test(id)?id:null;
}
export function diagnosticMessage(message:string,id:string|null):string {
  return id?`${message} · Diagnostic ID: ${id}`:message;
}
