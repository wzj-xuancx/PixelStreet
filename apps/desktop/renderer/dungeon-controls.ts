export const CONTROL_ACTIONS=['up','down','left','right','attack','special','dash','dashAlt','ward','interact','switch'] as const;
export type ControlAction=typeof CONTROL_ACTIONS[number];
export type DungeonBindings=Record<ControlAction,string>;
export interface DungeonPreferences {version:1;bindings:DungeonBindings;showNumbers:boolean;screenShake:boolean;reducedMotion:boolean;showDebug:boolean;showMetrics:boolean;effectsEnabled:boolean;audioEnabled:boolean;audioVolume:number}
export const DEFAULT_BINDINGS:Readonly<DungeonBindings>={up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',attack:'Mouse0',special:'KeyQ',dash:'ShiftLeft',dashAlt:'Mouse2',ward:'KeyE',interact:'KeyF',switch:'Tab'};
export const CONTROL_LABELS:Record<ControlAction,string>={up:'向上',down:'向下',left:'向左',right:'向右',attack:'攻击',special:'特殊动作',dash:'翻滚',dashAlt:'翻滚备用',ward:'守护',interact:'交互',switch:'换武器'};
const RESERVED=new Set(['Escape','Digit1','Digit2','Digit3','Enter','NumpadEnter','Backspace','Delete','MetaLeft','MetaRight','ControlLeft','ControlRight','AltLeft','AltRight']);
export function canonicalCode(code:string):string{return code==='ShiftRight'?'ShiftLeft':code;}
export function supportedCode(code:string):boolean {return /^(Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Mouse[012]|Space|ShiftLeft|Tab)$/.test(canonicalCode(code));}
export type BindResult={ok:true;bindings:DungeonBindings}|{ok:false;reason:'reserved'|'unsupported'|'conflict';conflict?:ControlAction};
export function rebindControl(current:DungeonBindings,action:ControlAction,rawCode:string):BindResult {
 const code=canonicalCode(rawCode);
 if(RESERVED.has(code))return{ok:false,reason:'reserved'};
 if(!supportedCode(code))return{ok:false,reason:'unsupported'};
 const conflict=CONTROL_ACTIONS.find(a=>a!==action&&canonicalCode(current[a])===code);
 if(conflict)return{ok:false,reason:'conflict',conflict};
 return{ok:true,bindings:{...current,[action]:code}};
}
export function controlForCode(bindings:DungeonBindings,rawCode:string):ControlAction|null {const code=canonicalCode(rawCode);return CONTROL_ACTIONS.find(a=>bindings[a]===code)??null;}
export function bindingLabel(code:string):string {
 const simple:Record<string,string>={Mouse0:'鼠标左键',Mouse1:'鼠标中键',Mouse2:'鼠标右键',ShiftLeft:'Shift',Tab:'Tab',Space:'空格',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'};
 return simple[code]??code.replace(/^Key|^Digit/,'');
}
export function defaultDungeonPreferences():DungeonPreferences {return{version:1,bindings:{...DEFAULT_BINDINGS},showNumbers:false,screenShake:false,reducedMotion:false,showDebug:false,showMetrics:false,effectsEnabled:true,audioEnabled:false,audioVolume:.3};}
function plain(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
export function parseDungeonPreferences(raw:unknown):DungeonPreferences|null {
 if(!plain(raw)||Object.keys(raw).length!==10||raw.version!==1||!plain(raw.bindings))return null;
 const flags=['showNumbers','screenShake','reducedMotion','showDebug','showMetrics','effectsEnabled','audioEnabled'] as const;
 if(flags.some(k=>typeof raw[k]!=='boolean')||typeof raw.audioVolume!=='number'||!Number.isFinite(raw.audioVolume)||raw.audioVolume<0||raw.audioVolume>1||Object.keys(raw.bindings).length!==CONTROL_ACTIONS.length)return null;
 const bindings={} as DungeonBindings,used=new Set<string>();
 for(const action of CONTROL_ACTIONS){const code=raw.bindings[action];if(typeof code!=='string'||!supportedCode(code)||RESERVED.has(canonicalCode(code))||used.has(canonicalCode(code)))return null;bindings[action]=canonicalCode(code);used.add(bindings[action]);}
 return{version:1,bindings,audioVolume:raw.audioVolume,...Object.fromEntries(flags.map(k=>[k,raw[k]]))} as DungeonPreferences;
}
export interface PreferenceStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export const DUNGEON_PREFERENCE_KEY='pixelstreet-dungeon-050';
export function loadDungeonPreferences(storage:PreferenceStorage):DungeonPreferences {try{const text=storage.getItem(DUNGEON_PREFERENCE_KEY);return text&&text.length<=8192?parseDungeonPreferences(JSON.parse(text))??defaultDungeonPreferences():defaultDungeonPreferences();}catch{return defaultDungeonPreferences();}}
export function saveDungeonPreferences(storage:PreferenceStorage,prefs:DungeonPreferences):boolean {const valid=parseDungeonPreferences(prefs);if(!valid)return false;try{storage.setItem(DUNGEON_PREFERENCE_KEY,JSON.stringify(valid));return true;}catch{return false;}}
export function movementFromHeld(bindings:DungeonBindings,held:ReadonlySet<string>):{x:number;y:number}{return{x:Number(held.has(bindings.right))-Number(held.has(bindings.left)),y:Number(held.has(bindings.down))-Number(held.has(bindings.up))};}
