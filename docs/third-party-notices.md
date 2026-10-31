# 第三方代码与媒体边界

> 本文保留素材来源和原有授权边界。2026-10-31 Beta 仓库仅对部分背景／图集转为 WebP，未生成或重画美术；原 PNG 来源 SHA 与当前运行文件 SHA 分别记录。当前文件映射见 `assets/optimization-manifest.json`，部分原图与历史设计资料不在此仓库重复分发。下文版本号与原实现过程不代表本轮重新验收。

0.4 地牢像素图改用下述 0x72 官方现成素材；商业街与旧 Action 原型图保留历史版本。提示音仍由本地振荡器提供。未购买素材、使用 Riot 游戏媒体或在线 icon font。界面和道路箭头使用有许可的离线 SVG，保留提示与 aria-label。

## lolPing 审计参考

上游 [darrenprx/lolPing](https://github.com/darrenprx/lolPing)，本轮审计锁定本地 `origin/main` commit `f24a51e5a11c2b31dab72d89a571cc4025ad3c98`；工作分支 HEAD 为 `cc8725fe12362e243ea80e88c4c657fcc083f3da`。许可证 MIT，Copyright (c) 2026 Danrui Meng。源码许可不授权 Riot 游戏媒体，LICENSE 中另有媒体排除说明。

参考 `src/main/overlayManager.ts`、`quickTextWindow.ts` 及输入框 composition 处理的设计思路，所有本轮代码独立实现，无源代码直接复制。采用显式 focus、Esc、鼠标穿透与托盘的概念；不采用其每屏全尺寸窗口、全局输入钩子、LAN/UDP、Nostr、中继或身份数据。房间/网络设计仅审计，S2 仍未实施。因此没有把上游功能或隐私声明记为本项目已拥有。

## 随应用分发的依赖

- Electron 44.5.1：MIT；完整 Electron 与 Chromium 许可保留在源码 `licenses/` 及应用包 `Contents/Resources/licenses/`，必须一同分发。
- PixiJS 8.22.0：MIT，Copyright (c) 2013–2023 Mathew Groves, Chad Engler。完整许可在 `PixiJS-LICENSE.txt`、`licenses/` 及应用包 `Contents/Resources/licenses/`，随应用保留。

TypeScript 5.9.3、esbuild 0.25.12、electron-builder 26.15.3 等仅为构建工具，精确依赖树见 package-lock.json，各自许可随 npm 安装包保留。本项目没有把第三方 MIT 许可扩展为对用户旧资产的授权。

2026-10-31 另外从精确安装的 PixiJS 依赖树保留了 11 份原始许可文本，见 `licenses/renderer-dependencies/manifest.json`。`@pixi/colord` 的安装包声明 MIT，但未附独立许可全文；公开分发二进制前仍需从上游核验并补齐，不能将 package.json 的许可字段或本清单视为法律完整性保证。

## PixiJS MIT 许可全文

The MIT License

Copyright (c) 2013-2023 Mathew Groves, Chad Engler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


## Ant Design Icons

官方仓库 https://github.com/ant-design/ant-design-icons ，固定commit `7f2516ac91226d2b41f93b35cb5197c8d94f7189`。MIT许可证全文在 `licenses/AntDesignIcons-LICENSE.txt`，随应用Resources/licenses分发；完整来源、每个SVG和LICENSE的SHA在 `vendor/ant-design-icons/provenance.json`。使用setting、eye-invisible、message、close、send、save、redo、upload、download、left、arrow-down（home仅保留供应源，无主工具按钮）。统一1024 viewBox/currentColor，箭头动画由本项目CSS提供；不加载CDN、不请求字体服务。

## 0x72 DungeonTileset II v1.7

作者 0x72（Robert）；官方来源 https://0x72.itch.io/dungeontileset-ii ，美术资产采用 CC0 1.0（https://creativecommons.org/publicdomain/zero/1.0/），页面注明未使用生成式 AI。原始 ZIP 经官方下载流程免费取得，没有支付或捐赠。ZIP 内没有独立 LICENSE；项目保存官方页面快照、来源及完整 CC0 文本 `licenses/0x72-DungeonTilesetII-CC0-1.0.txt`。页面另列的 MIT 是代码许可，本项目没有导入该作者代码。

原包、原图、原帧表与 SHA-256 在 `vendor/0x72-dungeon-ii/` 和 `provenance.json`；运行图 `assets/dungeon/0x72_DungeonTilesetII_v1.7.png` 与原图逐字节一致。只做帧索引、裁切、翻转、色调和现成门片组合，不重绘像素。取原包的骑士、小恶魔、兽人、恶魔首领、石墙/地板/柱、箱子、尖刺、武器、魔泉和石阶；回旋使用投斧、法术/符文使用宝石裁片。动作及适配限制见 `vendor/0x72-dungeon-ii/provenance.json` 与随包的来源记录。没有采用评论区扩展。

## Kenney RPG Audio 1.0 / Impact Sounds 1.0

作者 Kenney Vleugels（Kenney.nl），均为 CC0 1.0。官方来源：[RPG Audio](https://kenney.nl/assets/rpg-audio)、[Impact Sounds](https://kenney.nl/assets/impact-sounds)。原包 License.txt 随应用 Resources/licenses/kenney-rpg-audio 与 kenney-impact-sounds 分发。八个短样本仅复制、改运行文件名，不合成声音；原文件名、下载地址、原包和每个音频 SHA-256 在 assets/audio/dungeon/manifest.json。kill 使用木质重落地声，未声称为作者录制的角色死亡语音。

## 0.5.0 镰刀、拳套、链节与盾牌

战镰采用 screaming mandrake [medival weapon pixel art](https://screaming-mandrake.itch.io/medival-weapon-pxlart) 的原 PNG（作者名 small_shield.png，实际像素是镰刀）；拳套与盾牌采用 7Soul1（Henrique Lazarini），由 AntumDeluge 汇编的 [CC0 Hand Wear Icons](https://opengameart.org/content/cc0-hand-wear-icons) 和 [CC0 Shield Icons](https://opengameart.org/content/cc0-shield-icons)。链节来自 Gabe Hess / GabeChHe 的 [Pixel Weapons](https://opengameart.org/content/pixel-weapons)，致谢及作者链接：[Gabe Hess — Super Pixel Weapons Pack](https://gabech.itch.io/super-pixel-weapons-pack)。这些来源页面均标 CC0；商业署名请求亦在此保留。

原 PNG、归档、许可/署名原文和 SHA-256 保存在 vendor/combat-050；运行图保持原图字节，裁切、握点、缩放仅使用元数据。完整来源及已知源文件命名错位见 assets/combat/manifest.json；随应用分发 licenses/Combat-050-CC0-SOURCES.md。链刃组合真实链环与0x72匕首刀头，双刀和拳套各用两份现成贴图；不将几何线条当实体贴图。

## 0.6.0原创像素美术

assets/camp-060/*：根据用户2026-10-23明确绘画授权，通过内置 image_gen 生成的原创游戏背景、地图与遗物图集，不来自第三方游戏。原始 PNG 来源、提示词、工具模式与源输出路径见 assets/camp-060/provenance.json 及 prompts.json、camp-prompt.json、relic-prompt.json；当前 WebP 运行文件见 assets/optimization-manifest.json。未调用付费外部 API，未购买素材。原 0x72 CC0 人物精灵与 MIT 图标许可保持原记录。
