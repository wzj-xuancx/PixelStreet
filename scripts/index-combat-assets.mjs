// Preserve original PNG bytes. Every crop is metadata, not redrawn artwork.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),vendor=new URL('vendor/combat-050/',root),out=new URL('assets/combat/',root);
const provenance=JSON.parse(await readFile(new URL('provenance.json',vendor),'utf8'));
const sources={};
await mkdir(out,{recursive:true});
for(const [name,source]of Object.entries(provenance.sources)){
 const raw=await readFile(new URL(source.file,vendor)),sha256=createHash('sha256').update(raw).digest('hex');
 if(sha256!==source.sha256||raw.readUInt32BE(16)!==source.width||raw.readUInt32BE(20)!==source.height)throw Error(`Unverified source ${name}`);
 await copyFile(new URL(source.file,vendor),new URL(source.file,out));sources[name]={...source};
}
const frames={
 'weapon-scythe':{source:'scythe',x:0,y:0,width:16,height:32,worldSize:[24,48],anchor:[3/16,24/32],nativeDirection:-Math.PI/2},
 'weapon-fists':{source:'glove',x:0,y:0,width:32,height:32,worldSize:[18,18],anchor:[12/32,25/32],rotationOffset:-Math.PI/6,nativeDirection:-Math.PI/3},
 'chain-link':{source:'chain',x:176,y:105,width:14,height:15,worldSize:[6,6.43],anchor:[.5,.5],nativeDirection:Math.PI/2},
 'chain-segment':{source:'chain',x:176,y:105,width:14,height:60,worldSize:[7,30],anchor:[.5,1/60],nativeDirection:Math.PI/2},
 'enemy-guard-shield':{source:'shield',x:0,y:0,width:32,height:32,worldSize:[22,28],anchor:[.5,18/32],nativeDirection:-Math.PI/2},
};
for(const [id,frame]of Object.entries(frames)){
 const source=sources[frame.source];if(!source||frame.x<0||frame.y<0||frame.x+frame.width>source.width||frame.y+frame.height>source.height)throw Error(`Crop escapes source: ${id}`);
}
await writeFile(new URL('manifest.json',out),JSON.stringify({schemaVersion:1,sources,frames,limitations:['Static original equipment sprites are articulated with authoritative combat trajectories; no claim of author-supplied attack animation.','Chain blade composes real Flail chain-link pixels with the original 0x72 dagger; no geometry-line substitution.','Source filename small_shield.png visibly depicts the scythe; classification follows inspected pixels.']},null,2)+'\n');
console.log(JSON.stringify({sources:Object.keys(sources).length,frames:Object.keys(frames).length,transform:'original PNG bytes unchanged'}));
