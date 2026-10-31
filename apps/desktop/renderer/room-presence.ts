import type {RoomPeerPresence} from '../../../packages/protocol/room';
/** Short, bounded interpolation; unchanged/idle snapshots never keep RAF alive. */
export class RoomPresenceMotion {
 private poses=new Map<string,{from:number;fromPet:number;to:RoomPeerPresence;at:number}>();
 apply(poses:RoomPeerPresence[],now:number):void{
  const ids=new Set(poses.map(p=>p.playerId));for(const id of this.poses.keys())if(!ids.has(id))this.poses.delete(id);
  for(const pose of poses){const old=this.poses.get(pose.playerId);if(old&&JSON.stringify(old.to)===JSON.stringify(pose))continue;const current=old?this.sample(pose.playerId,now):undefined,from=current?.x??pose.x,fromPet=current?.petX??pose.petX;this.poses.set(pose.playerId,{from,fromPet,to:pose,at:from===pose.x&&fromPet===pose.petX?now-120:now});}
 }
 sample(id:string,now:number):RoomPeerPresence|undefined{const p=this.poses.get(id);if(!p)return;const t=Math.max(0,Math.min(1,(now-p.at)/120));return {...p.to,x:p.from+(p.to.x-p.from)*t,petX:p.fromPet+(p.to.petX-p.fromPet)*t};}
 active(now:number):boolean{return [...this.poses.values()].some(p=>now-p.at<120);}
}
