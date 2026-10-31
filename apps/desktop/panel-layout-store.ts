import fs from 'node:fs';
import path from 'node:path';
import type {Rect} from '../../packages/protocol';

export type MovablePanel='shop'|'inventory';
type Position={x:number;y:number};
export function clampPanel(bounds:Rect,area:Rect):Rect {
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  return {x:Math.round(Math.max(area.x,Math.min(area.x+area.width-width,bounds.x))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-height,bounds.y))),width,height};
}
/** UI placement is separate from the economy and the exact settings schema. */
export class PanelLayoutStore {
  private positions:Partial<Record<MovablePanel,Position>>={};
  private readonly file:string;
  constructor(folder:string){
    this.file=path.join(folder,'panel-layout.json');
    try{
      if(fs.statSync(this.file).size>2048)return;
      const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(data.version!==1||!data.positions||typeof data.positions!=='object')return;
      for(const name of ['shop','inventory'] as const){const p=data.positions[name];if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<32768&&Math.abs(p.y)<32768)this.positions[name]={x:Math.round(p.x),y:Math.round(p.y)};}
    }catch{/* A missing or malformed UI position never blocks the game. */}
  }
  has(name:MovablePanel):boolean{return !!this.positions[name];}
  place(name:MovablePanel,fallback:Rect,areas:Rect[]):Rect{
    const p=this.positions[name];if(!p)return clampPanel(fallback,areas[0]);
    const desired={...fallback,...p};
    const area=areas.find(a=>p.x+fallback.width/2>=a.x&&p.x+fallback.width/2<a.x+a.width&&p.y+fallback.height/2>=a.y&&p.y+fallback.height/2<a.y+a.height)??areas[0];
    return clampPanel(desired,area);
  }
  save(name:MovablePanel,bounds:Rect):void{
    this.positions[name]={x:Math.round(bounds.x),y:Math.round(bounds.y)};
    const tmp=this.file+'.tmp-'+process.pid;
    try{fs.writeFileSync(tmp,JSON.stringify({version:1,positions:this.positions})+'\n',{mode:0o600});fs.renameSync(tmp,this.file);}catch{try{fs.unlinkSync(tmp);}catch{/* Best effort layout only. */}}
  }
}
