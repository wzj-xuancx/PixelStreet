import adventure from '../../../assets/adventure-0190/manifest.json';
import frames from '../../../assets/inventory-next/frames.json';
import gear from '../../../assets/equipment-0160/frames.json';
import pets from '../../../assets/pets-0160/frames.json';
/** Each viewport clips the unchanged atlas to its approved nonuniform frame. */
export function inventoryArt(id:string):string {
 const candidate=adventure.frames.find(f=>f.id===id);
 if(candidate){
  const crop=(f:typeof candidate,x=0,y=0,w=40,h=40)=>{const [sx,sy,sw,sh]=f.rect;return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${sx} ${sy} ${sw} ${sh}" overflow="hidden"><image href="${f.file}" width="${f.width}" height="${f.height}"/></svg>`;};
  let corner='';
  if(candidate.composition?.id){const leaf=adventure.frames.find(f=>f.id===candidate.composition!.id)!;corner=crop(leaf,21,22,19,18);}
  if(candidate.composition?.old){const ore=frames.frames.find(f=>f.id===candidate.composition!.old)!;const [x,y,w,h]=ore.frame;corner=`<svg x="23" y="22" width="17" height="18" viewBox="${x} ${y} ${w} ${h}" overflow="hidden"><image href="assets/inventory-next/items.webp" width="1254" height="1254"/></svg>`;}
  return `<svg class="inventory-art adventure-art" viewBox="0 0 40 40" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${crop(candidate)}${corner}</svg>`;
 }

 if(id==='pet:slime'||id.startsWith('petgear:')){const f=pets.frames.find(f=>f.id===(id==='pet:slime'?'slime-portrait':id.slice(8)));if(!f)return '';const [x,y,right,bottom]=f.bounds,w=right-x,h=bottom-y;return `<svg class="inventory-art pet-art" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" overflow="hidden"><image href="assets/pets-0160/pet-atlas-2x2.webp" width="${pets.sourceWidth}" height="${pets.sourceHeight}"/></svg></svg>`;}
 if(id.startsWith('equipment:')){const f=gear.frames.find(f=>f.id===id.slice(10));if(!f)return '';const [x,y,right,bottom]=f.bounds,w=right-x,h=bottom-y;return `<svg class="inventory-art equipment-art" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" overflow="hidden"><image href="assets/equipment-0160/gear-atlas-4x2.webp" width="${gear.sourceWidth}" height="${gear.sourceHeight}"/></svg></svg>`;}
 const frame=frames.frames.find(f=>f.id===id);if(!frame)return '';
 const [x,y,w,h]=frame.frame;
 return `<svg class="inventory-art" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" overflow="hidden"><image href="assets/inventory-next/items.webp" width="1254" height="1254"/></svg></svg>`;
}
