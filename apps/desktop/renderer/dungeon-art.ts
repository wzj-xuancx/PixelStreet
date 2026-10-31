export interface DungeonFrame {x:number;y:number;width:number;height:number;worldSize:number[];anchor:number[];tint?:number;rotationOffset?:number;nativeDirection?:number}
export interface DungeonImage {folder:string;file:string;width:number;height:number}
/** SVG crops reference the same local original PNGs as Pixi, under the same CSP. */
export class DungeonIcons {
 private serial=0;
 constructor(private frames:ReadonlyMap<string,DungeonFrame>,private images:ReadonlyMap<string,DungeonImage>){}
 atlas(id:string,size=22):string {
  const frame=this.frames.get(id),file=this.images.get(id);if(!frame||!file)return '';
  const scale=size/Math.max(frame.width,frame.height),clip=`d-atlas-${++this.serial}`;
  return `<svg class="d-atlas-icon" aria-hidden="true" focusable="false" width="${frame.width*scale}" height="${frame.height*scale}" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="${clip}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/></clipPath></defs><image clip-path="url(#${clip})" href="assets/${file.folder}/${file.file}" width="${file.width}" height="${file.height}" image-rendering="pixelated"/></svg>`;
 }
 weapon(kind:string,size=22):string {
  if(!['dual','fists','chain'].includes(kind))return this.atlas(`weapon-${kind}`,size);
  const prefix=`d-weapon-${++this.serial}`;let index=0;
  const part=(id:string,x:number,y:number,box:number,angle=0,flip=false):string=>{
   const frame=this.frames.get(id),file=this.images.get(id);if(!frame||!file)return '';
   const scale=box/Math.max(frame.width,frame.height),w=frame.width*scale,h=frame.height*scale,clip=`${prefix}-${++index}`;
   return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${flip?-1:1} 1)"><defs><clipPath id="${clip}"><rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#${clip})"><image href="assets/${file.folder}/${file.file}" x="${-frame.x*scale-w/2}" y="${-frame.y*scale-h/2}" width="${file.width*scale}" height="${file.height*scale}" image-rendering="pixelated"/></g></g>`;
  };
  const body=kind==='dual'?part('weapon-dual',13,20,31,-18)+part('weapon-dual',27,20,31,18,true)
   :kind==='fists'?part('weapon-fists',12,20,25,-15)+part('weapon-fists',28,20,25,15,true)
   :[[8,32],[13,27],[18,22],[23,17]].map(([x,y])=>part('chain-link',x,y,7,-40)).join('')+part('weapon-chain',28,12,23,35);
  return `<svg class="d-atlas-icon d-weapon-composite" aria-hidden="true" focusable="false" width="${size}" height="${size}" viewBox="0 0 40 40">${body}</svg>`;
 }
}
