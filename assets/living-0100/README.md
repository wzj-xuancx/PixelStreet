# 0.10.0 分层像素场景

本轮由内置 image_gen 生成或编辑七张本地位图；完整提示词在 [prompts.json](prompts.json)，原始输出路径、尺寸、SHA-256和复用清单在 [provenance.json](provenance.json)。Beta 运行副本使用原尺寸 WebP，当前编码见 ../optimization-manifest.json。用户已授权新的像素图。旧060/070/080原图不覆盖、不删除。

| 文件 | 用途 | 分层规则 |
| --- | --- | --- |
| supply-room.webp | 补给店空场景 | 不烘焙顾客、货物或制作状态 |
| alchemy-room.webp | 炼金工坊空场景 | 固定器具为场景结构，动态由真实排产决定 |
| camp-empty.webp | 营地场景 | 花圃不烘焙作物，按真实种植覆盖 |
| people.webp | 三类旅人四帧行走 | 4列×3行，每格362×362，真实透明 |
| props.webp | 面粉/凝胶/口粮/魔晶餐/钱箱/手记 | 3列×2行，按实际状态显示 |
| alchemy-goods.webp | 炼金商品 | 3列×3行，六件炼金商品取第二、三行 |
| crops-transparent.webp | 五作物和幼芽 | 3列×2行，空地不画作物 |

透明伙伴复用bonds-070/companions-v2.webp；世界地图、地下城箱子继续使用既有本地资源。人物/货物/作物通过CSS精确裁格，未用程序绘制或Python编辑位图。顾客代表已有真实委托，场景动画不计算额外客流或收益。

图片元数据、透明通道与实际格内容已检查；本仓库不携带内部工作区或历史证据；本地软件点击和隐藏截图也不是物理设备试玩。
