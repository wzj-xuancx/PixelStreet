export type Recipe = 'ration' | 'crystal';
export type ItemId = 'flour' | 'gel' | Recipe;
export const recipes = {
  ration: {name:'旅行口粮',flour:2,gel:0,ticks:60,price:5},
  crystal: {name:'魔晶餐',flour:1,gel:2,ticks:100,price:14},
} as const;
export const ITEMS:Record<ItemId,{name:string;icon:string;buy:number;sell:number}> = {
  flour:{name:'面粉',icon:'flour',buy:1,sell:0.6},
  gel:{name:'凝胶',icon:'gel',buy:5,sell:2},
  ration:{name:'旅行口粮',icon:'ration',buy:0,sell:4},
  crystal:{name:'魔晶餐',icon:'crystal',buy:0,sell:10},
};
