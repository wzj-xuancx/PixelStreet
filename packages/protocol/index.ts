import {parsePartyCommand,type PartyCommand,type PartyControl,type PartyFieldState} from './party-field';
export * from './party-field';
import {parseFieldControl,type FieldControl} from './field-control';
export * from './field-control';
import type {NativePresentations} from './presentation';
export * from './presentation';
import type {ChapterCommand,ChapterPresentation} from './chapter';
export * from './chapter';
import {itemCardDefinition} from '../solo-core/item-cards';
import {isTowerOnlyAction} from '../solo-core/mastery';
import {type InventoryActionRequest,type InventoryQuote} from '../solo-core/inventory-actions';
import type {InventoryDestination} from '../content/inventory-catalog';
import {towerRouteChoices,type TowerRouteChoice,type TowerRouteContext,type TowerTarget as CoreTowerTarget} from '../solo-core/tower';
import {parseVillageAction,parseCampAction,parseEnvelope,parseLeisureAction,type GameEnvelope,type GameState} from '../solo-core';
import { validLocalText } from './input';
import {parseArenaCommand,type ArenaCommand,type ActionSession} from './action';
import {parseStreetPresence,type StreetPresence,parseRoomCommand,type RoomCommand,type RoomState} from './room';
import {parseDungeonCommand,type DungeonCommand,type DungeonSession} from './dungeon';
import type {DungeonInput} from '../dungeon-core';
export type InputMode = 'display' | 'interaction' | 'hidden';
export type View = 'street' | 'interior' | 'field';
export type ShopId = 'shop-bakery' | 'shop-alchemy';
export interface Rect { x: number; y: number; width: number; height: number }
export interface DisplayInfo { id: number; label: string; workArea: Rect; scaleFactor: number; refreshRate?:number }
export const heightPresets = [48, 80, 112, 160, 208] as const;
export interface Settings {
  version: 4; mode: 'quiet' | 'friends'; height: number; displayId: number | null;
  dock: 'top' | 'bottom'; alwaysOnTop: boolean; cameraX: number;
  opacity: number; soundEnabled: boolean; volume: number; bubbles: boolean; interactionEnabled: boolean;
}
export const defaults: Settings = Object.freeze({ version: 4, mode: 'quiet', height: 112, displayId: null, dock: 'bottom', alwaysOnTop: true,
  cameraX: 0, opacity: 1, soundEnabled: false, volume: 0.15, bubbles: true, interactionEnabled: true });
export type PopupKind = 'chapter' | 'settings' | 'actor' | 'dialogue' | 'shop' | 'alchemy' | 'adventure' | 'room';
export interface PopupState { kind: PopupKind; generation: number; anchor: Rect; bounds: Rect; tail: number; side: 'top' | 'bottom'; suspended: boolean; detached?:boolean }
export interface InventoryPreview {token:string;expiresAt:number;quote:InventoryQuote}
export interface GameImportPreview {token:string;fileName:string;sourceVersion:number;coins:number;xp:number;companions:number;buildings:number;expiresAt:number}
export const channels = Object.freeze({ inventoryPreview:'street:inventory-preview', gameImportPreview:'street:preview-game-import',gameImportConfirm:'street:confirm-game-import', state: 'street:state', command: 'street:command', dungeonControl:'street:dungeon-control', save: 'street:save-settings', export: 'street:export-settings', import: 'street:import-settings', update: 'street:update' });
export const towerTargets=['supply','supply-job','supply-craft','supply-trade','supply-manage','supply-orders','kitchen','camp-growth','collection','village-projects','alchemy','alchemy-craft','alchemy-trade','dungeon','garden','companions','ledger'] as const satisfies readonly CoreTowerTarget[];
export type TowerTarget=CoreTowerTarget;
export const inventoryTargets=['supply-craft','supply-trade','supply-specials','supply-special-shelves','supply-shelves','alchemy-craft','alchemy-shelves','alchemy-study','kitchen','camp-growth','collection','companions'] as const satisfies readonly InventoryDestination[];
export type InventoryTarget=InventoryDestination;
export type Command = PartyCommand | PartyControl | {type:'street-presence';epoch:number;presence:StreetPresence} | {type:'expedition-open'|'field-open';generation:number;supply?:'herbal-bandage'|'mining-tonic'|null} | FieldControl | ChapterCommand | {type:'inventory-share';generation:number;itemId:string} | {type:'inventory-confirm'|'inventory-cancel';generation:number;token:string} | {type:'inventory-page';generation:number;page:'items'|'pet'} | {type:'inventory-link';generation:number;target:InventoryTarget} | {type:'tower-open'|'tower-close'|'tower-minimize'} | {type:'tower-action';envelope:GameEnvelope} | {type:'tower-link';target:TowerTarget} | {type:'tower-route';floor:number;choice?:TowerRouteChoice} | DungeonCommand | RoomCommand | ArenaCommand | { type: 'play' | 'release' | 'restore' | 'scene-ready' | 'dungeon-portal' | 'inventory-toggle' | 'pet-toggle' } | {type:'visit';shop:ShopId} | { type:'hide'; generation?:number }
  | {type:'leisure';envelope:GameEnvelope}
  | {type:'expedition-link';generation:number;target:'shop'|'inventory'|'pet'}
  | { type: 'inventory-ready' | 'inventory-close' | 'field-view' | 'talk' | 'close-popup' | 'input-focus' | 'resume-popup'; generation: number }
  | {type:'return-camp';envelope:GameEnvelope} | {type:'adventure-panel';anchor:Rect} | {type:'game';generation:number;envelope:GameEnvelope} | {type:'shop-panel'|'alchemy-panel';anchor:Rect}
  | { type: 'settings'; anchor?: Rect } | { type: 'actor'; anchor: Rect } | { type: 'popup-ready'; generation: number }
  | { type: 'view'; value: View } | { type: 'pointer'; capture: boolean } | { type: 'camera'; value: number; generation: number } | { type: 'local-text'; text: string; generation: number };
export interface ShellState {
  presentation?:NativePresentations;partyField?:PartyFieldState;
  chapter?:ChapterPresentation;
  inventoryNavigation?:{id:number;target:InventoryTarget}; tower?:{suspended:boolean}; towerNavigation?:{id:number;target:TowerTarget;context?:TowerRouteContext}; workingElsewhere?: boolean; mode: InputMode; view: View; epoch: number; revision: number; bounds: Rect; scaleFactor: number; keyboard: boolean;
  activeShop: ShopId | null;
  popup: PopupState | null; inventory?:{generation:number;page:'items'|'pet';bounds:Rect;suspended:boolean}|null; cameraX: number; localMessage: { id: number; text: string } | null;
  game:GameState; action:ActionSession; dungeon?:DungeonSession; room:RoomState; settings: Settings; displays: DisplayInfo[]; warnings: string[]; version: string;
}
export interface StreetAPI {
  previewInventory(generation:number,request:InventoryActionRequest):Promise<InventoryPreview>;
  state(): Promise<ShellState>; command(command: Command): Promise<ShellState>;
  dungeonControl(input:Extract<DungeonInput,{type:'control'|'cancel-controls'}>):void;
  saveSettings(settings: Settings, generation: number): Promise<ShellState>; exportSettings(generation: number): Promise<string>; importSettings(text: string, generation: number): Promise<ShellState>;
  previewGameImport(generation:number):Promise<GameImportPreview|null>; confirmGameImport(token:string,generation:number):Promise<ShellState>;
  subscribe(callback: (state: ShellState) => void): () => void;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function legacyShortcut(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 96) return false;
  const parts = value.split('+'), key = parts.pop();
  const mods = ['CommandOrControl','Command','Cmd','Control','Ctrl','Alt','Option','Shift','Super'];
  return !!key && parts.length > 0 && new Set(parts).size === parts.length && parts.every(p => mods.includes(p)) && parts.some(p => p !== 'Shift') && /^(?:[A-Za-z0-9]|F(?:[1-9]|1\d|2[0-4])|Space)$/.test(key);
}
export function closestHeight(height: number): number { return heightPresets.reduce<number>((best, value) => Math.abs(value-height) < Math.abs(best-height) ? value : best, 112); }
export function parseSettings(value: unknown): Settings {
  if (!isRecord(value) || Object.keys(value).length !== Object.keys(defaults).length || Object.keys(value).some(k => !Object.hasOwn(defaults,k))) throw new Error('配置字段不匹配；只接受本项目设置，不接受余额或令牌。');
  const v = value;
  if (v.version !== 4 || typeof v.mode !== 'string' || !['quiet','friends'].includes(v.mode) || typeof v.dock !== 'string' || !['top','bottom'].includes(v.dock)) throw new Error('配置版本、停靠或工作模式不支持。');
  for (const key of ['soundEnabled','bubbles','interactionEnabled','alwaysOnTop']) if (typeof v[key] !== 'boolean') throw new Error(`无效开关：${key}`);
  if (typeof v.height !== 'number' || !heightPresets.includes(v.height as typeof heightPresets[number])) throw new Error('街道高度只支持48/80/112/160/208 DIP五个档位。');
  if (v.displayId !== null && (typeof v.displayId !== 'number' || !Number.isSafeInteger(v.displayId))) throw new Error('显示器设置无效。');
  if (typeof v.cameraX !== 'number' || !Number.isInteger(v.cameraX) || v.cameraX < 0 || v.cameraX > 320) throw new Error('镜头位置必须在0–320。');
  for (const [key,min,max] of [['opacity',0.4,1],['volume',0,1]] as const) if (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] < min || v[key] > max) throw new Error(`无效数值：${key}`);
  return { ...v } as unknown as Settings;
}
export function readSettings(value: unknown): Settings {
  if (!isRecord(value) || ![1,2,3].includes(Number(value.version))) return parseSettings(value);
  const version = value.version;
  if (typeof version !== 'number') throw new Error('旧版设置无效。');
  const keys = Object.keys(defaults).filter(k => k !== 'cameraX' && (version !== 1 || (k !== 'dock' && k !== 'alwaysOnTop')));
  if (version < 3) keys.push('interactShortcut','hideShortcut');
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k))) throw new Error('旧版设置字段不匹配。');
  if (version < 3 && (!legacyShortcut(value.interactShortcut) || !legacyShortcut(value.hideShortcut) || value.interactShortcut.toLowerCase() === value.hideShortcut.toLowerCase())) throw new Error('旧版快捷键字段无效。');
  if (typeof value.height !== 'number' || !Number.isInteger(value.height) || value.height < (version === 1 ? 128 : 80) || value.height > (version === 1 ? 320 : 240)) throw new Error('旧版高度无效。');
  const { interactShortcut: _enter, hideShortcut: _hide, ...settings } = value;
  return parseSettings({ ...settings, version: 4, cameraX: 0, height: closestHeight(value.height), ...(version === 1 ? { dock: 'bottom', alwaysOnTop: true } : {}) });
}
function anchor(value: unknown): value is Rect {
  return isRecord(value) && Object.keys(value).length === 4 && ['x','y','width','height'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && Math.abs(value[k] as number) <= 32768)
    && Number(value.width) > 0 && Number(value.height) > 0;
}
export function parseCommand(value: unknown): Command {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('无效命令。');
  const count = Object.keys(value).length;
  if(value.type==='street-presence'&&count===3&&Number.isSafeInteger(value.epoch)&&(value.epoch as number)>=0)return {type:'street-presence',epoch:value.epoch as number,presence:parseStreetPresence(value.presence)};
  if(value.type==='chapter-demo-end'&&count===4&&typeof value.generation==='number'&&Number.isSafeInteger(value.generation)&&value.generation>0&&typeof value.session==='number'&&Number.isSafeInteger(value.session)&&value.session>0&&(value.outcome==='skip'||value.outcome==='defeated'))return value as Command;
  if(value.type==='chapter'&&count===3&&typeof value.generation==='number'&&Number.isSafeInteger(value.generation)&&value.generation>0&&typeof value.op==='string'&&['open','start','skip','resume','replay','perform','preview','cancel','more'].includes(value.op))return value as Command;
  if(value.type==='chapter-confirm'&&count===3&&typeof value.generation==='number'&&Number.isSafeInteger(value.generation)&&value.generation>0&&typeof value.token==='string'&&/^[a-f0-9-]{36}$/.test(value.token))return value as Command;
  if(['tower-open','tower-close','tower-minimize'].includes(value.type)&&count===1)return value as Command;
  if(value.type==='tower-action'&&count===2){const envelope=parseEnvelope(value.envelope);if(!isTowerOnlyAction(envelope.action))throw Error('成就之塔仅接受固定领奖与精通操作');return {type:'tower-action',envelope};}
  if(value.type==='tower-link'&&count===2&&typeof value.target==='string'&&towerTargets.includes(value.target as TowerTarget))return value as Command;
  if(value.type==='tower-route'&&(count===2||count===3&&Object.hasOwn(value,'choice'))&&typeof value.floor==='number'&&Number.isSafeInteger(value.floor)&&value.floor>=1&&value.floor<=20&&(count===2||typeof value.choice==='string'&&towerRouteChoices.includes(value.choice as TowerRouteChoice))){if(value.choice!==undefined&&!(value.floor===11&&['supply-specials','alchemy-craft'].includes(String(value.choice))||value.floor===12&&['ordinary-orders','atelier-orders'].includes(String(value.choice))))throw Error('本层路线选项无效。');return value as Command;}
  if(value.type==='leisure'&&count===2){const envelope=parseEnvelope(value.envelope);if(!parseLeisureAction(envelope.action as unknown as Record<string,unknown>)&&!parseCampAction(envelope.action as unknown as Record<string,unknown>)&&!parseVillageAction(envelope.action as unknown as Record<string,unknown>))throw Error('悠游窗口仅接受营地养成操作');return {type:'leisure',envelope};}
  const party=parsePartyCommand(value);if(party)return party;
  const field=parseFieldControl(value);if(field)return field;
  const dungeon=parseDungeonCommand(value);if(dungeon)return dungeon;
  const room=parseRoomCommand(value);if(room)return room;
  const arena=parseArenaCommand(value);if(arena)return arena;
  if (['play','release','restore','scene-ready','dungeon-portal','inventory-toggle','pet-toggle'].includes(value.type) && count === 1) return value as Command;
  if (value.type === 'visit' && count === 2 && ['shop-bakery','shop-alchemy'].includes(String(value.shop)) && typeof value.shop === 'string') return value as Command;
  const generation = typeof value.generation === 'number' && Number.isSafeInteger(value.generation) && value.generation > 0;
  if(value.type==='inventory-share'&&count===3&&generation&&itemCardDefinition(value.itemId))return value as Command;
  if((value.type==='inventory-confirm'||value.type==='inventory-cancel')&&count===3&&generation&&typeof value.token==='string'&&/^[a-f0-9-]{36}$/.test(value.token))return value as Command;
  if(value.type==='inventory-page'&&count===3&&generation&&(value.page==='items'||value.page==='pet'))return value as Command;
  if(value.type==='inventory-link'&&count===3&&generation&&typeof value.target==='string'&&inventoryTargets.includes(value.target as InventoryTarget))return value as Command;
  if(value.type==='field-open'&&generation&&count===3&&Object.hasOwn(value,'supply')&&(value.supply===null||value.supply==='herbal-bandage'||value.supply==='mining-tonic'))return value as Command;
  if((value.type==='expedition-open'||value.type==='field-open')&&count===2&&generation)return value as Command;
  if(value.type==='expedition-link'&&count===3&&generation&&(value.target==='shop'||value.target==='inventory'||value.target==='pet'))return value as Command;
  if (value.type === 'hide' && (count === 1 || (count === 2 && generation))) return value as Command;
  if (['inventory-ready','inventory-close','field-view','talk','close-popup','input-focus','resume-popup'].includes(value.type) && count === 2 && generation) return value as Command;
  if (value.type === 'settings' && (count === 1 || (count === 2 && anchor(value.anchor)))) return value as Command;
  if(value.type==='return-camp'&&count===2){const envelope=parseEnvelope(value.envelope);if(envelope.action.type!=='retreat')throw Error('回营地点仅允许回营');return {type:'return-camp',envelope};}
  if(value.type==='game'&&count===3&&generation){const envelope=parseEnvelope(value.envelope);if(envelope.action.type==='material-sell'||envelope.action.type.startsWith('field-'))throw Error('底部冒险只能从营地操作');return {type:'game',generation:value.generation as number,envelope};}
  if (['actor','shop-panel','alchemy-panel','adventure-panel'].includes(value.type) && count === 2 && anchor(value.anchor)) return value as Command;
  if (value.type === 'popup-ready' && count === 2 && typeof value.generation === 'number' && Number.isSafeInteger(value.generation) && value.generation > 0) return value as Command;
  if (value.type === 'view' && count === 2 && typeof value.value === 'string' && ['street','interior','field'].includes(value.value)) return value as Command;
  if (value.type === 'pointer' && count === 2 && typeof value.capture === 'boolean') return value as Command;
  if (value.type === 'camera' && count === 3 && generation && typeof value.value === 'number' && Number.isInteger(value.value) && value.value >= 0 && value.value <= 320) return value as Command;
  if (value.type === 'local-text' && count === 3 && generation && typeof value.text === 'string' && validLocalText(value.text)) return value as Command;
  throw new Error('未知命令或参数。');
}
