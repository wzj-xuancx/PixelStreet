// Development QA navigation. This reads the authoritative room geometry, but
// returns only normal movement targets: it never changes run state or awards loot.
import {circleRectOverlap} from '../packages/dungeon-core';
import type {Point,RoomState} from '../packages/dungeon-core';
export function walkable(room:RoomState,p:Point,radius=15):boolean {
 return p.x>=24+radius&&p.y>=24+radius&&p.x<=room.width-24-radius&&p.y<=room.height-24-radius&&!room.obstacles.some(o=>o.hp>0&&circleRectOverlap(p,radius,o));
}
export function lineClear(room:RoomState,a:Point,b:Point,radius=15):boolean {
 const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/6));for(let i=0;i<=n;i++)if(!walkable(room,{x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n},radius))return false;return true;
}
/** Cardinal grid BFS with continuous-safe links at the two ends. */
export function navigation(room:RoomState,from:Point,to:Point,radius=15):Point {
 if(!walkable(room,from,radius))return{x:Math.max(44,Math.min(room.width-44,from.x)),y:Math.max(44,Math.min(room.height-44,from.y))};
 if(lineClear(room,from,to,radius))return to;
 const nodes:Point[]=[];for(let y=42;y<=room.height-39;y+=24)for(let x=42;x<=room.width-39;x+=24){const p={x,y};if(walkable(room,p,radius))nodes.push(p);}
 const nearest=(p:Point)=>nodes.map((n,i)=>({i,d:Math.hypot(n.x-p.x,n.y-p.y)})).sort((a,b)=>a.d-b.d).find(v=>lineClear(room,p,nodes[v.i],radius));
 const start=nearest(from),end=nearest(to);if(!start||!end)return from;
 const indices=new Map(nodes.map((p,i)=>[`${p.x},${p.y}`,i])),queue=[start.i],parents=new Map<number,number>([[start.i,-1]]);
 for(let h=0;h<queue.length&&!parents.has(end.i);h++){const i=queue[h],p=nodes[i];for(const [dx,dy]of [[24,0],[-24,0],[0,24],[0,-24]]){const j=indices.get(`${p.x+dx},${p.y+dy}`);if(j===undefined||parents.has(j)||!lineClear(room,p,nodes[j],radius))continue;parents.set(j,i);queue.push(j);}}
 if(!parents.has(end.i))return from;
 const route:number[]=[];for(let i=end.i;i>=0;i=parents.get(i)??-1)route.push(i);route.reverse();
 for(let i=route.length-1;i>=0;i--)if(lineClear(room,from,nodes[route[i]],radius))return nodes[route[i]];
 return nodes[start.i];
}
export function roomRoute(rooms:RoomState[],from:string,to:string):string[]{const q=[[from]],seen=new Set([from]);for(let i=0;i<q.length;i++){const route=q[i],id=route.at(-1)!;if(id===to)return route.slice(1);for(const d of rooms.find(r=>r.id===id)!.doors)if(!seen.has(d.to)){seen.add(d.to);q.push([...route,d.to]);}}throw Error(`No connected route ${from} → ${to}`);}
export function combatTarget(room:RoomState,player:Point,elapsed:number):{move:Point;aim:Point;danger:boolean}|null {
 const live=room.enemies.filter(e=>e.hp>0);if(!live.length)return null;
 const sorted=[...live].sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y));
 const target=sorted.find(e=>lineClear(room,player,e,3))??sorted[0],distance=Math.hypot(target.x-player.x,target.y-player.y),near=sorted[0],danger=Math.hypot(near.x-player.x,near.y-player.y)<80||room.traps.some(t=>t.state!=='idle'&&Math.hypot(t.x-player.x,t.y-player.y)<t.radius+32);
 let move=player;
 // Keep enough space to read telegraphs. Choose a legal nearby point which can
 // actually be reached, rather than holding a key into a pillar indefinitely.
 if(distance<160||!lineClear(room,player,target,3)||danger){
  let best=-Infinity;for(let i=0;i<16;i++){const angle=i*Math.PI/8,p={x:player.x+Math.cos(angle)*100,y:player.y+Math.sin(angle)*100};if(!walkable(room,p)||!lineClear(room,player,p))continue;const closest=Math.min(...live.map(e=>Math.hypot(e.x-p.x,e.y-p.y))),d=Math.hypot(target.x-p.x,target.y-p.y),score=Math.min(closest,190)-Math.abs(d-190)*.5+(lineClear(room,p,target,3)?25:0)-room.traps.reduce((n,t)=>n+(Math.hypot(t.x-p.x,t.y-p.y)<t.radius+35?80:0),0);if(score>best){best=score;move=p;}}
 }else if(distance>270)move=navigation(room,player,target);
 return{move,aim:target,danger};
}
