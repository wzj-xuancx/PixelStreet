# 内部工作台物件图

2026-10-23 使用内置 image_gen 生成，真实RGBA透明背景。图像原样复制，无重绘/去背/像素变更。最终提示词见同目录两个prompt.txt；尺寸、SHA256、alpha见files.json。既有0100/070/060美术保持原文件。

- food-goods.webp：3×3等格。tea / biscuit / soup；pie / snowtea / picnic；stew / gift / ore。
- workshop-objects.webp：2×2等格。seed / dust；book / pot。

原始生成路径已从 Beta 仓库元数据脱敏；当前 WebP 文件和哈希见 ../optimization-manifest.json。

已观察全部九/四实际物件及透明间隙；CSS仅按固定格采样。用于真实配方、材料、种植、制作和手记入口，不增加新的游戏物品。
