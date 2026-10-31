import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PixelScene} from '../apps/desktop/renderer/scene';
import {roomIdentityTint} from '../packages/protocol/room';
import {EquipmentPanel} from '../apps/desktop/renderer/equipment-panel';
import {InventoryActions} from '../apps/desktop/renderer/inventory-actions';
import {inventoryPartyReason} from '../apps/desktop/renderer/inventory-party-affordance';
import {initialProfile,initialEquipment,initialPets,equipmentRecipeEntries} from '../packages/solo-core';
test('empty-roster local hero resets to actual0181 gold during normal animation',()=>{
 const scene:any=Object.create(PixelScene.prototype);Object.assign(scene,{player:{sprite:{tint:0xffffff,scale:{x:1,y:1},x:0,y:0,rotation:0,pivot:{set:()=>{}},position:{set:()=>{}}}},state:{room:{members:[],localPlayerId:'local'},game:{profile:null},mode:'display'},effects:[],setFrame:()=>{},applyPeers:()=>{},actorAnchor:()=>undefined});
 scene.animate();assert.equal(scene.player.sprite.tint,0xffd58c);assert.equal(scene.player.sprite.tint,roomIdentityTint([],'local'));
 const source=fs.readFileSync('apps/desktop/renderer/scene.ts','utf8');assert.match(source,/this\.player=this\.add\('player-idle-0',this\.playerX,0\);if\(this\.player\)this\.player\.sprite\.tint=roomIdentityTint\(state\.room\.members,state\.room\.localPlayerId\)/);
});
test('public busy summary disables the first equipment/pet menu but leaves ordinary sale available',()=>{
 const p=initialProfile(1);p.job='keeper';p.bag.gel=4;p.equipment=initialEquipment();p.equipment.ownedIDs=['trail-coat'];p.equipment.slots.body='trail-coat';p.pets=initialPets();p.pets.ownedGearIDs=['moss-collar'];p.pets.slots.collar='moss-collar';
 const actions:any=Object.create(InventoryActions.prototype);let busy=true;actions.profile=()=>p;actions.partyBusy=()=>busy;
 assert.match(actions.menu('equipment:trail-coat')[0].reason,/组队/);assert.match(actions.menu('pet:slime')[0].reason,/组队/);assert.match(actions.menu('petgear:moss-collar')[0].reason,/组队/);assert.equal(actions.menu('bag:gel')[0].reason,'');assert.equal((p as any).party,undefined);
 busy=false;assert.equal(actions.menu('equipment:trail-coat')[0].reason,'');assert.equal(inventoryPartyReason('petgear:moss-collar','unequip',true),'请先结束组队准备或回营后调整宠物。');assert.equal(inventoryPartyReason('field:bone','sell',true),'');
});
test('boss necessary text is16px and its unchanged compact box fits smallest48DIP height',()=>{
 const css=fs.readFileSync('apps/desktop/renderer/field.css','utf8'),rule=css.match(/#fieldBoss\{([^}]+)\}/)![1],progress=css.match(/#fieldBoss progress\{([^}]+)\}/)![1];const px=(name:string,s=rule)=>Number(s.match(new RegExp('(?:^|;)'+name+':(\\d+)px'))![1]);
 assert.ok(px('font-size')>=16);assert.equal(px('line-height'),18);assert.equal(rule.match(/padding:([^;]+)/)![1],'1px 7px 4px');assert.ok(px('top')+1+18+4+4+2<=48);assert.equal(px('height',progress),4);
});

test('equipment recipe first action reads the same public busy flag and unlocks when returned',()=>{
 const p=initialProfile(1);p.coins=1000;p.bag.gel=100;p.leisure.materials.ore=100;p.leisure.materials.herb=100;
 const panel:any=Object.create(EquipmentPanel.prototype),buttons=new Map<string,any>(),rows=new Map<string,any>(),picks=new Map<string,any>();
 for(const r of equipmentRecipeEntries(p)){const button={disabled:false,textContent:'',dataset:{}},cost={innerHTML:''},reason={textContent:''};buttons.set(r.id,button);rows.set(r.id,{hidden:false,querySelector:(selector:string)=>selector==='button'?button:selector==='.equipment-costs'?cost:reason});picks.set(r.id,{hidden:false,setAttribute:()=>{}});}
 Object.assign(panel,{profile:p,partyBusy:true,recipeFilter:'all',selectedRecipe:'equipment:trail-boots',recipes:rows,recipePicks:picks,element:{querySelectorAll:()=>[]}});panel.renderRecipes();assert.equal(buttons.get('equipment:trail-boots').disabled,true);assert.match(buttons.get('equipment:trail-boots').dataset.disabledReason,/组队/);panel.partyBusy=false;panel.renderRecipes();assert.equal(buttons.get('equipment:trail-boots').disabled,false);assert.equal(buttons.get('equipment:trail-boots').dataset.disabledReason,'');
});
