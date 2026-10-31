# 0.6.0 像素美术

本轮按用户“画像素图、地图、多画一些东西”的明确要求，使用内置 `image_gen` 工具生成8张项目资源，未使用CLI/API后备模式。原始 PNG 来源记录保留在 `provenance.json`；Beta 运行副本使用原尺寸 WebP，当前文件哈希与编码策略见 ../optimization-manifest.json。

| 资源文件 | 游戏中的位置 |
| --- | --- |
| [world.webp](world.webp) | 五地区可点击世界地图 |
| [moss.webp](moss.webp) | 苔光庭院旅途风景 |
| [moon.webp](moon.webp) | 月泉矿洞旅途风景 |
| [star.webp](star.webp) | 星落遗迹旅途风景 |
| [wind.webp](wind.webp) | 风铃麦田旅途风景 |
| [snow.webp](snow.webp) | 霜灯雪境旅途风景 |
| [camp.webp](camp.webp) | 营地全景与花圃场景 |
| [relics.webp](relics.webp) | 3列×5行的15件遗物图集 |

最终完整提示词：[地图和五地景](prompts.json)、[营地](camp-prompt.json)、[遗物](relic-prompt.json)。图集格坐标写在casual.css，采用外部CSS规则兼容原有严格CSP；没有放宽页面策略。官方0x72人物/怪物/伙伴精灵另沿用既有CC0许可，未声称新图是这些作者的原资源。
