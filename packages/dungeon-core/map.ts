import {GEOMETRY_PROFILES,type GeometryProfile} from './geometry';
import {CURRENT_WEAPON_KINDS} from './weapons';
import {createSpawnState} from './combat-state';
import type {RoomState,WeaponKind,WeaponItem} from './types';
export const ROOM_WALL=24,DOOR_OPENING_WIDTH=120,DOOR_TRIGGER_DEPTH=56;
export interface DoorRectangle {x:number;y:number;width:number;height:number}
/** The rendered opening and the movement trigger share one rectangle in world units. */
export function doorTriggerRect(room:Pick<RoomState,'width'|'height'>,side:'N'|'E'|'S'|'W'):DoorRectangle {
  return side==='N'||side==='S'?{x:room.width/2-DOOR_OPENING_WIDTH/2,y:side==='N'?ROOM_WALL:room.height-ROOM_WALL-DOOR_TRIGGER_DEPTH,width:DOOR_OPENING_WIDTH,height:DOOR_TRIGGER_DEPTH}:{x:side==='W'?ROOM_WALL:room.width-ROOM_WALL-DOOR_TRIGGER_DEPTH,y:room.height/2-DOOR_OPENING_WIDTH/2,width:DOOR_TRIGGER_DEPTH,height:DOOR_OPENING_WIDTH};
}
/** Wider/deeper than the visible trigger so props cannot pinch any legal door approach. */
export function doorApproachRect(room:Pick<RoomState,'width'|'height'>,side:'N'|'E'|'S'|'W'):DoorRectangle {const r=doorTriggerRect(room,side);if(side==='N'||side==='S'){r.x-=20;r.width+=40;if(side==='S')r.y-=56;r.height+=56;}else{r.y-=20;r.height+=40;if(side==='E')r.x-=56;r.width+=56;}return r;}
const overlaps=(a:DoorRectangle,b:DoorRectangle)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
/** Local streams keep exploring one branch from changing rewards on another. */
export function deriveSeed(seed:number,label:string):number {let h=(seed^0x811c9dc5)>>>0;for(let i=0;i<label.length;i++){h=Math.imul(h^label.charCodeAt(i),16777619)>>>0;}return h||0x9e3779b9;}
export function seeded(seed:number):()=>number {let s=seed||0x9e3779b9;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};}
export function roomWeapon(room:RoomState,suffix:string):WeaponItem {const roll=seeded(deriveSeed(room.lootSeed,suffix)),kinds=CURRENT_WEAPON_KINDS;return{id:`weapon-${room.id}-${suffix}`,kind:(suffix==='rack'||suffix==='chest')?kinds[room.lootSeed%kinds.length]:kinds[Math.floor(roll()*kinds.length)],level:1,evolved:false,form:'base'};}
export function baseRoom(id:string,kind:RoomState['kind'],seed:number):RoomState {return{spawns:createSpawnState(deriveSeed(seed,`${id}-encounter`)),id,kind,gridX:0,gridY:0,width:720,height:528,visited:false,cleared:false,doors:[],locked:false,wave:0,totalWaves:kind==='boss'?1:kind==='combat'||kind==='elite'?2:0,nextWaveAt:0,layoutId:'plain',encounterSeed:deriveSeed(seed,`${id}-encounter`),lootSeed:deriveSeed(seed,`${id}-loot`),encounterStarted:false,restUsed:false,merchantStock:[],eventUsed:false,altarUsed:false,eliteRuneClaimed:false,obstacles:[],enemies:[],ground:[],traps:[],chestOpened:false};}
/** A randomized walking route keeps two full fights beyond the evolution camp. */
export function makeFloor(seed:number,profile:GeometryProfile='mild'):RoomState[] {
  const roll=seeded(deriveSeed(seed,'floor'));
  const shuffle=<T>(items:T[]):T[]=>{for(let i=items.length-1;i>0;i--){const j=Math.floor(roll()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;};
  type Cell={x:number;y:number};
  const around=({x,y}:Cell):Cell[]=>[{x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1}];
  const key=({x,y}:Cell)=>`${x},${y}`;
  const cells:Cell[]=[{x:0,y:0}],occupied=new Set(['0,0']);
  // Backtracking also reserves enough free front cells for the four optional branches.
  const branchSites=():{cell:Cell;anchor:number}[]=>{const sites=new Map<string,{cell:Cell;anchor:number}>();for(const anchor of [1,2,3,4,5,6,7])for(const cell of around(cells[anchor]))if(!occupied.has(key(cell))&&!sites.has(key(cell)))sites.set(key(cell),{cell,anchor});return [...sites.values()];};
  const walk=():boolean=>{
    if(cells.length===12)return around(cells[1]).some(c=>!occupied.has(key(c)))&&branchSites().length>=4;
    for(const cell of shuffle(around(cells.at(-1)!))){if(occupied.has(key(cell)))continue;cells.push(cell);occupied.add(key(cell));if(walk())return true;occupied.delete(key(cell));cells.pop();}return false;
  };
  if(!walk())throw Error('Could not build reachable floor');
  const backbone:[string,RoomState['kind']][]=[['entrance','entrance'],['crossroads','event'],['battle-a','combat'],['battle-b','combat'],['battle-c','combat'],['battle-d','combat'],['battle-e','combat'],['battle-f','combat'],['altar','altar'],['depth-a','combat'],['depth-b','combat'],['boss','boss']];
  const defs:[string,RoomState['kind'],Cell,number?][]=backbone.map(([id,kind],i)=>[id,kind,cells[i]]);
  const sites=shuffle(branchSites()),crossSite=sites.findIndex(s=>s.anchor===1);
  // At least one visible choice at the first junction; remaining roles/anchors vary by seed.
  const chosen=[sites.splice(crossSite,1)[0],...sites.slice(0,3)];
  const optional:[string,RoomState['kind']][]=shuffle([['treasure','chest'],['spring','rest'],['merchant','shop'],['elite','elite']]);
  optional.forEach(([id,kind],i)=>defs.push([id,kind,chosen[i].cell,chosen[i].anchor]));
  const rooms=defs.map(([id,kind,p])=>{
    const room=baseRoom(id,kind,seed),local=seeded(deriveSeed(seed,`${id}-layout`)),combat=kind==='combat'||kind==='elite';
    room.gridX=p.x;room.gridY=p.y;room.width=(combat?[456,480,504,552]:[384,408,432,456])[Math.floor(local()*4)];room.height=(combat?[336,360,384,408]:[288,312,336])[Math.floor(local()*3)];
    let variant=Math.floor(local()*4);if(kind==='boss'){room.width=600;room.height=432;}
    if(id==='battle-b'){const a=seeded(deriveSeed(seed,'battle-a-layout'));a();a();variant=(Math.floor(a()*4)+1+Math.floor(local()*3))%4;}
    const scale=GEOMETRY_PROFILES[profile].roomScale;room.width=48+Math.round((room.width-48)*scale/24)*24;room.height=48+Math.round((room.height-48)*scale/24)*24;
    room.layoutId=`${kind}-${variant}`;
    if(kind==='shop')room.merchantStock=[0,1].map(i=>({id:`offer-${id}-${i}`,weapon:roomWeapon(room,`stock-${i}`),price:8+Math.floor(local()*5),sold:false}));return room;
  });
  const connect=(a:number,b:number)=>{const x=rooms[a],y=rooms[b],side=x.gridX<y.gridX?'E':x.gridX>y.gridX?'W':x.gridY<y.gridY?'S':'N',opposite={N:'S',S:'N',E:'W',W:'E'} as const;x.doors.push({to:y.id,side});y.doors.push({to:x.id,side:opposite[side]});};
  for(let i=1;i<backbone.length;i++)connect(i-1,i);
  for(let i=backbone.length;i<rooms.length;i++)connect(defs[i][3]!,i);
  for(const room of rooms)decorate(room,seeded(deriveSeed(seed,`${room.id}-props`)));
  const bag:WeaponKind[]=[...CURRENT_WEAPON_KINDS],lootRoll=seeded(deriveSeed(seed,'loot-bag'));for(let i=bag.length-1;i>0;i--){const j=Math.floor(lootRoll()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
  for(const [i,id] of ['crossroads','treasure'].entries()){const room=rooms.find(v=>v.id===id)!;room.lootSeed=(Math.floor(room.lootSeed/12)*12+CURRENT_WEAPON_KINDS.indexOf(bag[i]))>>>0;if(!room.lootSeed)room.lootSeed=4;}
  rooms.find(v=>v.id==='merchant')!.merchantStock.forEach((o,i)=>o.weapon.kind=bag[i+2]);rooms[0].visited=true;return rooms;
}
function decorate(room:RoomState,roll:()=>number):void {
  if(room.kind!=='combat'&&room.kind!=='elite')return;
  const variant=Number(room.layoutId.split('-').at(-1)),w=room.width,h=room.height;
  // Ground footprints only: tall art may extend upward, collision must match this base.
  const templates=[[[.24,.18],[.76,.82]],[[.24,.82],[.76,.18]],[[.24,.18],[.76,.18]],[[.24,.82],[.76,.82]]],spots=templates[variant];
  room.obstacles=spots.map(([x,y],i)=>({id:`obstacle-${room.id}-${i}`,x:Math.round(w*x-20),y:Math.round(h*y-14),width:40,height:28,kind:'pillar' as const,hp:100}));
  const crates=[[[.76,.18],[.24,.82]],[[.24,.18],[.76,.82]],[[.24,.82],[.76,.82]],[[.24,.18],[.76,.18]]][variant];
  for(const [i,[x,y]] of crates.entries())room.obstacles.push({id:`crate-${room.id}-${i}`,x:Math.round(w*x-12),y:Math.round(h*y-12),width:24,height:24,kind:'crate',hp:24});
  const aprons=room.doors.map(d=>doorApproachRect(room,d.side));room.obstacles=room.obstacles.filter(o=>!aprons.some(a=>overlaps(a,{x:o.x-11,y:o.y-11,width:o.width+22,height:o.height+22})));
  const candidates=[[.50,.28],[.50,.72],[.30,.50],[.70,.50],[.50,.50]];for(let i=candidates.length-1;i>0;i--){const j=Math.floor(roll()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  const safe=candidates.find(([x,y])=>{const area={x:w*x-28,y:h*y-28,width:56,height:56};return !aprons.some(a=>overlaps(a,area))&&!room.obstacles.some(o=>overlaps(o,area));});room.traps=safe?[{id:`trap-${room.id}`,x:w*safe[0],y:h*safe[1],radius:22,state:'idle',stateUntil:1800+Math.floor(roll()*1000),hit:false}]:[];
}
