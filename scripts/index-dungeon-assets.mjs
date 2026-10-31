// Index existing CC0 art. Copies the author's PNG byte-for-byte; draws no pixels.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),src=new URL('vendor/0x72-dungeon-ii/original/',root),out=new URL('assets/dungeon/',root);
const hash=b=>createHash('sha256').update(b).digest('hex');
const png=await readFile(new URL('0x72_DungeonTilesetII_v1.7.png',src));
const list=await readFile(new URL('tile_list_v1.7',src),'utf8');
const sourceFrames=new Map(list.trim().split(/\r?\n/).map(line=>{const [id,...values]=line.split(/\s+/);return [id,values.map(Number)];}));
const frames={};
function frame(id,name,worldSize,anchor=[.5,1],extra={}){
 const rect=sourceFrames.get(name);if(!rect)throw Error(`Missing original frame ${name}`);
 const [sx,sy,sw,sh]=rect,[cx,cy,cw,ch]=extra.crop??[0,0,sw,sh];
 if(cx<0||cy<0||cw<=0||ch<=0||cx+cw>sw||cy+ch>sh)throw Error(`Crop escapes original ${id}`);
 const {crop,...attributes}=extra;
 frames[id]={x:sx+cx,y:sy+cy,width:cw,height:ch,worldSize,anchor,original:name,...(crop?{originalCrop:crop}:{}),...attributes};
}
for(let i=0;i<8;i++)frame(`tile-floor-${i}`,`floor_${i+1}`,[24,24],[0,0]);
for(const [id,name]of Object.entries({'wall-front':'wall_mid','wall-top':'wall_top_mid','wall-cap-left':'wall_top_left','wall-cap-right':'wall_top_right','wall-side-left':'wall_left','wall-side-right':'wall_right'}))frame(id,name,[24,24],[0,0]);
frame('gate-post-left','doors_frame_left',[24,48],[.5,.5]);
frame('gate-post-right','doors_frame_right',[24,48],[.5,.5]);
frame('gate-leaf-closed','doors_leaf_closed',[48,48],[.5,.5]);
frame('floor-stairs','floor_stairs',[48,48],[.5,.5]);
for(let i=0;i<3;i++){
 frame(`fountain-red-${i}`,`wall_fountain_mid_red_anim_f${i}`,[24,24],[.5,.5]);
 frame(`fountain-blue-${i}`,`wall_fountain_basin_blue_anim_f${i}`,[48,48],[.5,.5]);
}
frame('trap-idle','floor_spikes_anim_f0',[24,24],[.5,.5]);
frame('trap-warn','floor_spikes_anim_f1',[24,24],[.5,.5]);
frame('trap-active','floor_spikes_anim_f3',[24,24],[.5,.5]);
frame('trap-cooldown','floor_spikes_anim_f0',[24,24],[.5,.5]);
// The original column has 9 transparent bottom rows. Its visible foot, not its
// source cell edge, is aligned with the existing 40 x 28 ground collision box.
frame('obstacle-column','column',[40,87.5],[.5,1],{crop:[0,4,16,35]});
frame('crate','crate',[24,240/7],[.5,1],{crop:[1,3,14,20]});
frame('chest-closed','chest_full_open_anim_f0',[32,32]);
frame('chest-open','chest_empty_open_anim_f2',[32,32]);
frame('altar','floor_stairs',[48,48],[.5,.5]);
frame('altar-idol','wall_fountain_top_2',[24,16.5],[.5,1],{crop:[0,5,16,11]});
frame('potion-health','flask_red',[24,24],[.5,.5]);
frame('companion-moss','big_zombie_idle_anim_f0',[64,72]);
for(let i=0;i<4;i++){
 frame(`player-idle-${i}`,`knight_m_idle_anim_f${i}`,[48,84]);
 frame(`player-run-${i}`,`knight_m_run_anim_f${i}`,[48,84]);
 frame(`enemy-imp-idle-${i}`,`imp_idle_anim_f${i}`,[48,48]);
 frame(`enemy-imp-run-${i}`,`imp_run_anim_f${i}`,[48,48]);
 frame(`enemy-shaman-idle-${i}`,`orc_shaman_idle_anim_f${i}`,[48,69]);
 frame(`enemy-shaman-run-${i}`,`orc_shaman_run_anim_f${i}`,[48,69]);
 frame(`enemy-orc-idle-${i}`,`masked_orc_idle_anim_f${i}`,[48,69]);
 frame(`enemy-orc-run-${i}`,`masked_orc_run_anim_f${i}`,[48,69]);
 frame(`enemy-skeleton-idle-${i}`,`skelet_idle_anim_f${i}`,[48,48]);
 frame(`enemy-skeleton-run-${i}`,`skelet_run_anim_f${i}`,[48,48]);
 frame(`enemy-priest-idle-${i}`,`necromancer_anim_f${i}`,[48,69]);
 frame(`boss-idle-${i}`,`big_demon_idle_anim_f${i}`,[96,108]);
 frame(`boss-run-${i}`,`big_demon_run_anim_f${i}`,[96,108]);
 frame(`merchant-${i}`,`dwarf_m_idle_anim_f${i}`,[40,70]);
}
frame('player-hit','knight_m_hit_anim_f0',[48,84]);
frame('enemy-remains','skull',[24,24],[.5,.8]);
frame('weapon-sword','weapon_regular_sword',[15,31.5],[.5,.82]);
frame('weapon-hammer','weapon_big_hammer',[15,55.5],[.5,.88]);
frame('weapon-spear','weapon_spear',[9,45],[.5,.84]);
frame('weapon-dual','weapon_knife',[9,19.5],[.5,.82]);
frame('weapon-chain','weapon_knife',[12,26],[.5,.77]);
frame('weapon-greatsword','weapon_anime_sword',[18,45],[.5,.86]);
frame('weapon-fire','weapon_red_magic_staff',[12,45],[.5,.82]);
frame('weapon-frost','weapon_bow',[21,39],[.5,.72]);
frame('weapon-lightning','weapon_green_magic_staff',[12,45],[.5,.82],{tint:0xa5d9ff});
frame('weapon-boomerang','weapon_throwing_axe',[20,28],[.5,.72]);
frame('weapon-meteor','weapon_red_gem_sword',[20,42],[.5,.82]);
frame('weapon-blade-ring','weapon_double_axe',[24,36],[.5,.7]);
frame('rune-fire','weapon_red_magic_staff',[24,24],[.5,.5],{crop:[0,0,8,8]});
frame('rune-frost','weapon_green_magic_staff',[24,24],[.5,.5],{crop:[0,0,8,8],tint:0x9cd9ff});
frame('rune-lightning','weapon_green_magic_staff',[24,24],[.5,.5],{crop:[0,0,8,8],tint:0xfff0a1});
frame('rune-boomerang','weapon_throwing_axe',[20,28],[.5,.5]);
frame('projectile-fire','weapon_red_magic_staff',[13,13],[.5,.5],{crop:[0,0,8,8],tint:0xffdb8d});
frame('projectile-frost','weapon_arrow',[8,24],[.5,.5],{rotationOffset:Math.PI/2,tint:0xb0e6ff});
frame('projectile-lightning','weapon_green_magic_staff',[13,13],[.5,.5],{crop:[0,0,8,8],tint:0xb0dfff});
frame('projectile-blade','weapon_throwing_axe',[20,28],[.5,.5]);
frame('projectile-enemy','bomb_f2',[16,16],[.5,.5],{tint:0xff9292});
frame('effect-impact','weapon_red_magic_staff',[10,10],[.5,.5],{crop:[0,0,8,8]});
const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
for(const [id,f]of Object.entries(frames))if(f.x<0||f.y<0||f.x+f.width>width||f.y+f.height>height||f.worldSize.some(n=>!Number.isFinite(n)||n<=0))throw Error(`Invalid indexed frame ${id}`);
const manifest={schemaVersion:2,title:'0x72 DungeonTileset II v1.7',source:{author:'0x72',url:'https://0x72.itch.io/dungeontileset-ii',version:'1.7',license:'CC0-1.0',archiveSha256:'a5b23341ebc831d7798bfb9666d864a08c079bb7aed18e3cf023a27d517c1512',imageSha256:hash(png),frameListSha256:hash(list),indexer:'scripts/index-dungeon-assets.mjs',imageTransform:'none; original PNG bytes copied unchanged'},atlas:{file:'0x72_DungeonTilesetII_v1.7.png',width,height,frames},limitations:['No dedicated weapon attack or character death sequence in this pack. Use original idle/run/hit plus held-weapon rotation and short fade.','No boomerang, torch, standalone altar, rune, or spell-effect set. Throwing axe, magic-fountain, stone-stairs and gem crops are documented adaptations of existing art.','Wide room gates are composed of original posts and repeated closed leaves at 1.5x; the open 120-unit passage contains no centered open-leaf texture.']};
await mkdir(out,{recursive:true});
await copyFile(new URL('0x72_DungeonTilesetII_v1.7.png',src),new URL(manifest.atlas.file,out));
await writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({frames:Object.keys(frames).length,imageSha256:hash(png),dimensions:[width,height],source:'0x72 official v1.7; no generated image'}));
