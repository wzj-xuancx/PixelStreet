# Beta 源码仓库边界

本仓库从现有 0.19.0 源码整理，不继承本地开发历史；游戏代码版本仍为 0.19.0。Beta 是开发状态，不代表新玩法已经实现，也不等于开放全部代码／美术许可。

## 保留

- `apps/`、`packages/`：桌面、协议和玩法核心。
- `tests/`：逻辑、故障、网络与原生测试源码和人工测试夹具；不是玩家存档。
- `assets/`：运行必需素材、帧表、音频、来源和优化映射。已移除未使用的概念图、重复源图与失败抠图。
- `vendor/`：第三方素材原包、图标与来源归档。约 3 MB，保留比删掉后破坏许可／哈希验证更合理。
- `licenses/`：第三方许可，包括约 20 MB 的 Chromium 许可 HTML；不能仅因体积大直接丢掉。
- `package.json`、精确 `package-lock.json`、`tsconfig.json` 与构建／隔离试玩／当前发版检查脚本。
- `docs/approved-0190/preserved-bottom-baseline.json`：测试实际使用的受保护文件路径和 SHA；不包含私人资料。
- README、CHANGELOG、ROADMAP、CONTRIBUTING 和当前说明。

## 不带入

- 旧 `.git` 历史、`node_modules/`、`dist/`、`release/`、App、DMG、游戏安装 ZIP。
- 玩家存档、备份、私人试玩数据、房间身份与邀请码、凭据和机器配置。
- 历史内部截图、完整调试日志、执行会话、打包收据和本机清理记录。
- 私人开发交接文档、旧任务账本和全部设计过程附件。

原始第三方素材 ZIP 放在 `vendor/`，不等于游戏安装包；不能使用不分目录的 `*.zip` 排除把它们全部丢掉。

## 美术与隐私

背景候选使用保持原尺寸的 WebP q90；精灵／装备等图集使用无损 WebP，解码 RGBA 与 alpha 逐像素校验。小型受保护原图不变。格式、尺寸、前后哈希和是否实际视觉验收，见 `assets/optimization-manifest.json`。

旧来源元数据中的原图 SHA 保留为**原始 PNG 的来源记录**，不冒充当前 WebP 哈希；当前映射以优化清单为准。个人机器绝对路径已脱敏；原图在旧本地源归档中保留，不随本仓库重复上传。

## 验证与发布

```bash
node scripts/check-repository.mjs
npm run typecheck
npm run build
npm test
```

`check-repository` 检查资源映射、当前哈希、静态／动态远征图片引用、明显本机目录和大文件；它不是完整秘密扫描或法律许可审查。

维护者已于 2026-11-01 确认并完成 Public 仓库 [wzj-xuancx/PixelStreet](https://github.com/wzj-xuancx/PixelStreet) 的创建与初次上传，默认分支为 `main`；协作者 `d3ac` 已收到 write 权限邀请，核验时等待接受。`UNLICENSED` 在项目许可证另行决定前保持原样。创建仓库、上传内容与邀请接受是不同状态，实际核验见 [verification.md](verification.md)。
