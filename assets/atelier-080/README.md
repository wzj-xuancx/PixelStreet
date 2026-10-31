# 补给与炼金像素美术

内置image_gen生成三张运行PNG：supply.png、alchemy.png两幅店内横幅，goods-v2.png九件商品图集（goods.png初稿保留）（3×3，顺序与FORMULAS/GOOD_IDS一致）。prompts.json为完整提示词；provenance.json记录源输出绝对路径、SHA-256和尺寸。原输出保留，不覆盖070资源。界面用外部CSS/data坐标显示，无放宽CSP或新增连续绘制。

设计参考：Potion Craft官方Steam产品页 https://store.steampowered.com/app/1210320/Potion_Craft_Alchemist_Simulator/ 展示材料→配方→顾客用途的关联。本轮借鉴“配方有明确产物用途”这一原则：每件商品都能经营交易，药剂/餐盒另有实际补给用途，精炼晶投入设施升级；避免把炼金仅做成另一组没有用途的商品名称。通过独立库存守恒和每个使用操作验证，未复制其画面、配方或手动调配机制。
