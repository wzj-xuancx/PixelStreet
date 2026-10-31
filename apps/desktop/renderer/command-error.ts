/** Electron and the worker may each wrap a rejected command in Error text. */
export function commandErrorText(error:unknown):string {
 let text=error instanceof Error?error.message:String(error);
 for(;;){
  const next=text.replace(/^Error:\s*/,'').replace(/^Error invoking remote method '[^']+':\s*/,'');
  if(next===text)return text||'操作未完成，请稍后再试。';
  text=next;
 }
}
