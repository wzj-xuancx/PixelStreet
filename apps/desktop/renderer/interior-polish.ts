/** Put final presentation styles after the workspaces' lazily mounted styles. */
export function ensureInteriorPolish():void {
 for(const name of ['room-polish','village-polish','compact-rooms','compact-camp','compact-field','action-feedback']){
  let link=document.querySelector<HTMLLinkElement>(`link[data-interior-polish="${name}"]`);
  if(!link){link=document.createElement('link');link.rel='stylesheet';link.href=new URL(name+'.css',document.baseURI).href;link.dataset.interiorPolish=name;}
  document.head.append(link);
 }
}
