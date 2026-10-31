// Dungeon-door companions; no expedition or shop behavior is owned here.
export const NEW_COMPANIONS={
 fox:{name:'灯尾狐',effect:'藏宝间额外找到8金币',coins:100,ore:12,unlock:0,frame:'enemy-imp-idle-0'},
 deer:{name:'月角鹿',effect:'每趟带回2份晨露草',coins:160,ore:20,unlock:1,frame:'enemy-orc-idle-0'},
 otter:{name:'泡泡水獭',effect:'藏宝间矿石+4；秘境徽记+1',coins:200,ore:24,unlock:1,frame:'merchant-0'},
 owl:{name:'星页鸮',effect:'每趟整理出1份星尘',coins:280,ore:35,unlock:2,frame:'enemy-shaman-idle-0'},
 bear:{name:'蜜糖熊',effect:'每趟分享1份莓果饼',coins:360,ore:45,unlock:3,frame:'enemy-orc-idle-0'},
 bird:{name:'霜羽雀',effect:'领队耗时−4%；支援耗时−2%',coins:480,ore:60,unlock:4,frame:'enemy-skeleton-idle-0'},
} as const;
export type NewCompanion=keyof typeof NEW_COMPANIONS;
export const BUDDY_ORDER=['slime','guide','guard','fox','deer','otter','owl','bear','bird'] as const;
export type Buddy=typeof BUDDY_ORDER[number];
export const BUDDY_LORE:Record<Buddy,readonly[string,string,string]>={
 slime:['第一次绕过古树时，它把最亮的萤火留给了你。','它学会把浆果藏在叶子底下，回营后再一起分享。','无论走到多远，苔团子都记得回家的石桥。'],
 guide:['那盏旧提灯，照亮过很多独自赶路的夜晚。','旅人把陌生小路画进地图，也把你的名字记在旁边。','这一次，他说营地就是自己愿意停留的地方。'],
 guard:['守卫起初只在林边点头，后来开始等你一起出发。','他会把最平坦的路留给伙伴，把风雨挡在自己这边。','森林仍是他的职责，而你们成了他想守护的朋友。'],
 fox:['灯尾狐总绕远路，却第一次带你找到了藏在根须后的铜币。','尾尖的小灯能辨认熟悉的脚步，天黑也不再慌张。','它终于肯把自己的宝物藏处，标在你的地图上。'],
 deer:['月角鹿从泉边走来，角上还挂着清晨的露水。','它记住了每一处药草生长的地方，也记得你的偏好。','满月的夜晚，鹿角的花朵为营地亮了一整夜。'],
 otter:['水獭把最喜欢的贝壳放在你手里，作为同行的约定。','它发现宝藏时总先回头，确认你也看见了那道光。','口袋里装满了远方的石头，它说每一颗都有故事。'],
 owl:['星页鸮带来一本空白笔记，第一行写着今晚的星座。','小小羽毛夹在书页间，记录下许多一起走过的路。','它把最亮的那颗星，命名为归途。'],
 bear:['蜜糖熊最先关心的，是背包里的点心够不够大家吃。','有它在，长途旅行的休息总带着一点蜂蜜香气。','它说最好的食谱，是有人愿意一起分享的那一份。'],
 bird:['霜羽雀轻轻落在灯边，抖掉羽尖的细雪。','它会提前飞过山口，再带着安全的路线回来。','极光升起时，它绕着营地飞了三圈，像在唱一首归家的歌。'],
};
