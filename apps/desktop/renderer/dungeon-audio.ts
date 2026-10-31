/** Licensed samples only; no oscillator substitutes. Audio stays local to this window. */
export const DUNGEON_SOUNDS={
 swing:'swing.ogg',hit:'hit.ogg',heavy:'heavy.ogg',block:'block.ogg',
 fist:'fist.ogg',kill:'kill.ogg',hurt:'hurt.ogg',dot:'dot.ogg',
} as const;
export type DungeonSound=keyof typeof DUNGEON_SOUNDS;
export class SoundGate {
 private last=new Map<DungeonSound,number>();private voices=0;
 constructor(readonly maxVoices=6){}
 acquire(kind:DungeonSound,now:number):boolean {
  if(!Number.isFinite(now)||this.voices>=this.maxVoices||now-(this.last.get(kind)??-Infinity)<(kind==='dot'?200:60))return false;
  this.last.set(kind,now);this.voices++;return true;
 }
 release():void{this.voices=Math.max(0,this.voices-1);}
 get activeVoices():number{return this.voices;}
}
export class DungeonAudio {
 private context:AudioContext|null=null;private buffers=new Map<DungeonSound,AudioBuffer>();
 private loading:Promise<void>|null=null;private gate=new SoundGate();
 private active=new Set<AudioBufferSourceNode>();private disposed=false;
 constructor(private settings:()=>{enabled:boolean;volume:number;focused:boolean}){}
 /** Call only from a gesture; loading/decoding never plays samples. */
 async unlock():Promise<void>{
  if(this.disposed)return;
  const settings=this.settings();if(!settings.enabled||!settings.focused||settings.volume<=0)return;
  try{
   this.context??=new AudioContext();await this.context.resume();
   this.loading??=this.load();await this.loading;
  }catch{/* Unsupported audio or muted system never stops combat. */}
 }
 private async load():Promise<void>{
  const context=this.context!;
  await Promise.all(Object.entries(DUNGEON_SOUNDS).map(async([kind,file])=>{
   try{const response=await fetch(`assets/audio/dungeon/${file}`);if(!response.ok)return;
    const bytes=await response.arrayBuffer();if(bytes.byteLength>1_000_000)return;
    const buffer=await context.decodeAudioData(bytes);if(!this.disposed)this.buffers.set(kind as DungeonSound,buffer);
   }catch{/* Missing sample is silent rather than a synthesized fallback. */}
  }));
 }
 play(kind:DungeonSound,strength=1):boolean {
  const s=this.settings(),context=this.context,buffer=this.buffers.get(kind);
  if(this.disposed||!s.enabled||!s.focused||!context||context.state!=='running'||!buffer||s.volume<=0||!this.gate.acquire(kind,performance.now()))return false;
  const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;
  gain.gain.value=Math.min(1,Math.max(0,s.volume))*Math.min(1,Math.max(.05,strength))*(kind==='heavy'?.36:kind==='dot'?.1:.24);
  source.connect(gain);gain.connect(context.destination);this.active.add(source);
  source.onended=()=>{this.active.delete(source);source.disconnect();gain.disconnect();this.gate.release();};
  source.start();return true;
 }
 silence():void{for(const source of this.active)try{source.stop();}catch{};}
 dispose():void{this.disposed=true;this.silence();void this.context?.close();this.buffers.clear();}
}
