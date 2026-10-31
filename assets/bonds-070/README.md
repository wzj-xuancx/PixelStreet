# 同行伙伴与秘境奇珍像素资源

2026-10-23 用户要求继续精美像素绘画、更多伙伴与遗物，授权本轮使用内置 `image_gen`。没有购买服务，也没有调用第三方图像API/CLI。

最终运行选用8张本地PNG：`companions-v2.png`（透明3×3九伙伴）、`rarities.png`（3×5十五奇珍）、`training.png`（伙伴训练园）、`heartwood.png`、`tidevault.png`、`starbell.png`、`honeyglass.png`、`auroranest.png`（五秘境）。`companions.png` 是保留的初版，运行使用修正留白后的v2。9位伙伴顺序：苔团、提灯向导、树芽守卫、灯尾狐、月角鹿、泡泡水獭、星页鸮、蜜糖熊、霜羽雀。

`prompts.json` 保存原始八次生成提示词；`companions-refinement.json` 保存局部尺寸/透明留白编辑提示词。`generation.json` 记录每张源输出绝对路径、SHA-256、像素尺寸、PNG色彩类型与选择状态。所有图片都经本地查看，图集用CSS/data属性映射，不含联网引用、文字或持续绘制任务。

图集视觉允许插画级像素纹理，界面以 `image-rendering:pixelated` 展示。原生隐藏窗口截图用于验证实际单格内容、坐标、加载与裁切；不当作物理鼠标或用户屏幕验收证据。
