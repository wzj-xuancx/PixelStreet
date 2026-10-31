# 地牢像素素材

这组素材服务于 0.4 的基础战斗、封门波次、陷阱、可破坏物、双槽武器与符文构筑。所有图形都由本仓库的生成器以整数坐标构成原创 SVG 像素画；没有复用或修改旧 action 原画，也没有引入第三方图像、图标、字体或纹理。色板沿用 action 地牢原画的墨色、石色、青绿、金色、紫色与暖肤色，另补火焰和冰霜状态色。

## 文件与生成

- `scripts/generate-dungeon-art.mjs`：唯一源帧定义与确定性生成器，只写 `assets/dungeon/sprites.svg` 和 `assets/dungeon/manifest.json`。
- `assets/dungeon/sprites.svg`：透明底 576×360 SVG 图集，8 列 × 5 行，每格 72×72，`shape-rendering="crispEdges"`。所有帧按整数坐标绘制。
- `assets/dungeon/manifest.json`：沿用 action 图集的 schema；`atlas.frames[id]` 提供 `x/y/width/height/trim/worldSize/anchor/tags`。`worldSize` 使用 24 单位地砖坐标，`anchor` 是相对 72×72 source cell 的归一化位置。sprite UI/世界显示需 nearest-neighbor，关闭 image smoothing。

重建命令：

```sh
node scripts/generate-dungeon-art.mjs
```

生成器对缺失/多余/重复 key、非整数或越界图形坐标、atlas crop 越界、无效世界尺寸和归一化 anchor 做断言；同时打印产出文件 SHA-256。门、陷阱、木桶与动画姿态分别作为离散帧，动画时长和战斗状态由核心/renderer 决定。

## 帧清单

| 类别 | keys | worldSize / 约定 |
|---|---|---|
| 地面与边界 | `tile-floor-0`, `tile-floor-1`, `tile-floor-2`, `tile-wall` | 24×24；左上锚点 `[0,0]` |
| 房门 | `door-open`, `door-closed` | 64×32；底线锚点，root 按门方向旋转 |
| 光源 | `torch-0`, `torch-1` | 12×24；底线锚点，轻微火焰帧 |
| 陷阱 | `trap-idle`, `trap-warn`, `trap-active` | 24×24；中心锚点；警告与伤害帧分离 |
| 可破坏木桶 | `barrel-intact`, `barrel-cracked`, `barrel-broken` | 24×30；底线锚点 |
| NPC/交互物 | `altar`, `merchant` | 祭坛 56×56；商人 32×42；底线锚点 |
| 基础武器 | `weapon-sword`, `weapon-fire`, `weapon-frost`, `weapon-lightning`, `weapon-boomerang` | 24×32；轮廓分别为直剑、火杖、冰弓、雷杖、回旋刃 |
| 进阶武器 | `weapon-meteor`, `weapon-blade-ring` | 32×32；流星与环绕刃轮廓区别于基础武器 |
| 符文 | `rune-fire`, `rune-frost`, `rune-boomerang` | 24×24；中心锚点 |
| 投射物 | `projectile-fire`, `projectile-frost`, `projectile-lightning`, `projectile-blade` | 18×18、20×20、18×24、22×16；中心锚点 |
| 玩家反馈 | `player-hit`, `player-death-0/1`, `player-attack-0/1`, `player-dash-0/1` | 38×48；feet baseline `[0.5,0.88]` |
| 敌人反馈 | `enemy-hit`, `enemy-death-0/1` | 28×28；脚部锚点 |

完整 crop 位置、锚点、动画 key 和 tags 以 `manifest.json` 为准。图集共 40 帧，按上表顺序排列；build 不会自动加入本 atlas，需 renderer 按 manifest 明确集成。

## 静态验证与范围

本轮执行 `node --check scripts/generate-dungeon-art.mjs`、生成器内置 required-key/crop 断言及独立静态核对：40 个 frame key 完整且唯一；每个 crop 在 576×360 atlas 内且互不重叠；SVG group id 与 manifest 顺序一致；无 `<image>`/外部 href。重复生成输出哈希一致。没有启动 GUI 或 build。视觉可读性、缩放采样、与 F1 renderer 的实际组合尚未验收；后续 Luna 负责独立视觉复核，当前不标为 final art 通过。

## SHA-256

| 文件 | SHA-256 |
|---|---|
| `scripts/generate-dungeon-art.mjs` | `230a79fd6c2f519e3f6c260d4459750a3e6c1729660990ff6af94cc2bd42ff20` |
| `assets/dungeon/sprites.svg` | `72ef5f50624b68121588fd316b5007acebd1ace96fbb795e0fc40aa89e42ac79` |
| `assets/dungeon/manifest.json` | `9fa5e6d1c530cfb798c9c10c4466dfe958d14bc71f3aaca8c662e4b4614bda34` |

## F2 场景整合修订

F1图集Luna视觉审阅通过，原报告及原哈希保留于 `docs/evidence/dungeon-040/F1-art-luna.md`。F2把地砖改为每格一块低对比石板，裂缝和苔藓稀疏出现，减少战斗背景干扰。门、宝箱、商人、祭坛、泉水、武器架、符文、破桶、火把及受击/死亡姿态在renderer显式连接；动态表现由F2原生验收与最终构筑场景复核，不把静态图集通过算作玩法通过。

当前生成器 SHA256 `5d42fd01f63bc0bc72b9ac3f5e6ffd4777e879089773f4ad6c74262b1e02d3e3`；图集 SHA256 `884653e355bb6e1cbdfabb5fea3a81f7903b7cd6ae28b8d6075abb354de54b5d`。帧位置/尺寸/anchors不变。
