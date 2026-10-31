export type InventoryCategory='material'|'supply'|'crafted'|'equipment'|'petgear';
export type InventorySource='bag'|'materials'|'journal'|'atelier'|'equipment'|'petgear'|'field';
export type InventoryDestination='supply-craft'|'supply-trade'|'supply-specials'|'supply-special-shelves'|'supply-shelves'|'alchemy-craft'|'alchemy-shelves'|'alchemy-study'|'kitchen'|'camp-growth'|'collection'|'companions';
export interface InventoryLink {label:string;target:InventoryDestination}
export interface InventoryDefinition {id:string;name:string;category:InventoryCategory;iconId:string;source:InventorySource;useText:string;sourceText:string;links:readonly InventoryLink[]}
const use=(target:InventoryDestination):InventoryLink=>({label:({'supply-craft':'前往补给制作','supply-specials':'前往餐盒制作','alchemy-craft':'前往炼金','alchemy-study':'前往设施研修',kitchen:'前往厨房', 'camp-growth':'前往营地建设',collection:'前往收藏室',companions:'前往伙伴喂养'} as Partial<Record<InventoryDestination,string>>)[target]??'前往工坊',target});
const sell=(target:InventoryDestination):InventoryLink=>({label:target==='kitchen'?'前往厨房出售':'前往补给商人',target});
const shelf=(target:InventoryDestination):InventoryLink=>({label:target==='supply-shelves'?'前往补给货架':target==='supply-special-shelves'?'前往餐盒上架':'前往炼金上架',target});
function item(source:InventorySource,key:string,name:string,category:InventoryCategory,useText:string,links:InventoryLink[]):InventoryDefinition{return{id:`${source}:${key}`,name,category,iconId:`${source}:${key}`,source,useText,sourceText:({bag:'随身原料与补给',materials:'营地材料与食品',journal:'探索手记',atelier:'工坊已完成成品',equipment:'底部冒险装备',petgear:'宠物装备',field:'底部野外怪物材料'})[source],links};}
export const INVENTORY_CATALOG:readonly InventoryDefinition[]=[
 item('field','bone','硬骨片','material','制作破甲锤、岩纹手套；余量可出售，1金币/份。',[]),
 item('field','curseCrystal','咒晶碎片','material','制作鸣晶杖、回声镜与采矿药剂；余量可出售，1金币/份。',[use('alchemy-craft')]),
 item('field','toughHide','韧皮','material','制作苔纹披肩、接枝护符与药草绷带；余量可出售，1金币/份。',[use('alchemy-craft')]),
 item('atelier','herbal-bandage','药草绷带','supply','下趟底部野外选择携带，低血量时自动使用一次。',[use('alchemy-craft'),shelf('alchemy-shelves')]),
 item('atelier','mining-tonic','采矿药剂','supply','下趟底部野外选择携带，前几次采矿增加个人产量。',[use('alchemy-craft'),shelf('alchemy-shelves')]),
 item('bag','flour','面粉','material','用于制作旅行口粮、魔晶餐、营地食品与餐盒，也可出售。',[use('supply-craft'),sell('supply-trade')]),
 item('bag','gel','凝胶','material','用于魔晶餐、菌菇汤及工坊配方，也可出售。',[use('alchemy-craft'),sell('supply-trade')]),
 item('bag','ration','旅行口粮','supply','可在补给店出售或上架，也用于远征补给。',[sell('supply-trade'),shelf('supply-shelves')]),
 item('bag','crystal','魔晶餐','supply','可在补给店出售或上架。',[sell('supply-trade'),shelf('supply-shelves')]),
 item('materials','herb','晨露草','material','制作花草茶、雪绒暖茶及多种工坊成品。',[use('kitchen')]),
 item('materials','berry','甜莓','material','制作莓果饼、餐盒、星尘墨和伙伴蜜酿。',[use('kitchen')]),
 item('materials','mushroom','萤光菇','material','制作菌菇汤、菌香补给盒和古木香氛。',[use('kitchen')]),
 item('materials','ore','月纹石','material','底部冒险矿脉开采；可制行路短靴（2矿）、短剑（3矿＋3凝胶），也用于营地与工坊。',[use('camp-growth'),sell('kitchen')]),
 item('materials','tea','花草茶','supply','营地食品，可在旅人厨房出售。',[sell('kitchen')]),
 item('materials','biscuit','莓果饼','supply','营地食品，可在旅人厨房出售，也可喂养伙伴。',[sell('kitchen'),use('companions')]),
 item('materials','soup','菌菇汤','supply','营地食品，可在旅人厨房出售。',[sell('kitchen')]),
 item('materials','pumpkin','蜜糖南瓜','material','用于制作南瓜派、星糖礼盒等配方。',[use('kitchen')]),
 item('materials','snowflower','雪绒花','material','用于制作雪绒暖茶、霜花晶瓶。',[use('kitchen')]),
 item('materials','pie','南瓜派','supply','营地食品，可在旅人厨房出售。',[sell('kitchen')]),
 item('materials','snowtea','雪绒暖茶','supply','营地食品，可在旅人厨房出售。',[sell('kitchen')]),
 item('journal','dust','星尘','material','用于遗物升级及霜花晶瓶配方。',[use('collection')]),
 item('atelier','picnic','旅人野餐篮','crafted','打开获得3口粮、1莓果饼。',[use('supply-specials'),shelf('supply-special-shelves')]),
 item('atelier','stew','菌香补给盒','crafted','打开获得2口粮、1菌菇汤。',[use('supply-specials'),shelf('supply-special-shelves')]),
 item('atelier','gift','星糖礼盒','crafted','打开获得2莓果饼、1南瓜派。',[use('supply-specials'),shelf('supply-special-shelves')]),
 item('atelier','dew','萤露药剂','crafted','第一块生长中的花圃缩短30秒。',[use('alchemy-craft'),shelf('alchemy-shelves')]),
 item('atelier','ink','星尘墨','crafted','使用获得2星尘。',[use('alchemy-craft'),shelf('alchemy-shelves')]),
 item('atelier','ingot','精炼晶','crafted','用于二、三级设施研修。',[use('alchemy-study'),shelf('alchemy-shelves')]),
 item('atelier','nectar','伙伴蜜酿','crafted','使用获得2莓果饼。',[use('alchemy-craft'),shelf('alchemy-shelves')]),
 item('atelier','incense','古木香氛','crafted','使用获得1花草茶、1菌菇汤。',[use('alchemy-craft'),shelf('alchemy-shelves')]),
 item('atelier','frost','霜花晶瓶','crafted','使用获得2雪绒暖茶。',[use('alchemy-craft'),shelf('alchemy-shelves')]),
];
