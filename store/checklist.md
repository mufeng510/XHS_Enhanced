# 上架清单（Chrome Web Store 与 Edge Add-ons）

扩展包装：`npm run package`（构建 zip 到 `dist/xhs-enhanced-extension-v<manifest 版本>.zip`，stored-zip 零依赖，排除 `_metadata/`/点文件）；`extension/` 目录本身也是未打包扩展，可直接加载。

## 0. 打包

```bash
npm install
npm run build          # 生成 extension/content.js、options.js、background.js
npm test               # check + 单测 + 浏览器 harness（见下方说明）
npm run package        # 产出 dist/xhs-enhanced-extension-v2.2.0.zip
```

上传物：`dist/xhs-enhanced-extension-v<version>.zip`（包含 manifest.json（2.2.0）、content.js、options.js/html/css、background.js、rules.json、icons/）。

## 1. Chrome Web Store（https://chrome.google.com/webstore/devconsole）

- [ ] 开发者账号注册并缴纳一次性注册费；
- [ ] 新增条目 → 上传 zip；
- [ ] 商店信息：名称/简短描述/详细描述取自 `store/listing.md`；语言 中文（简体），分类 工具/实用程序；
- [ ] 图标 128×128（`extension/icons/icon128.png`）；截图至少 1 张 1280×800（`store/screenshot-1280x800.png`）；小宣传图 440×280（`store/promo-440x280.png`，可选但建议）；
- [ ] 隐私实践：
  - Single purpose：见 `store/listing.md`；
  - 权限理由：逐条复制 `store/permissions.md` 中的对应段落；
  - 数据使用：声明不收集任何用户数据（checkbox 全部选“否”，无需披露数据销售/转移——没有发生）；
  - 隐私政策 URL：发布后把 `store/privacy-policy.md` 的内容放到公开可访问地址（如仓库中的 raw 链接或 GitHub Pages）后填入；
  - 远程代码：声明“不，扩展不使用远程代码”；
- [ ] 分发范围：公开（或“不公开”，仅测试）；
- [ ] 提交审核（首次通常数小时至数天）。

## 2. Microsoft Edge Add-ons（https://partner.microsoft.com/dashboard/microsoftedge）

### 首次上架（手动，一次性）

- [ ] 注册 Edge 开发者（免费）；
- [ ] 新增扩展 → 上传 `npm run package` 产出的 zip（MV3、同一 manifest）；
- [ ] 商店信息复用 `store/listing.md` 的文案与中文描述；
- [ ] 图标/截图/宣传图复用同一套素材（Edge 接受 128×128；截图建议 ≥1280×800）；
- [ ] 隐私政策 URL 同上；权限说明复用 `store/permissions.md`；
- [ ] 年龄分级选择全年龄段；可见性选择公开；
- [ ] 提交审核。

### 后续更新（自动）

发布 GitHub Release 即自动更新 Edge 商店扩展（`.github/workflows/release-edge.yml`，2026-11-14 起）：

1. 确认 `extension/manifest.json` 与 `package.json` 的 version 已 bump，且 `npm test` 全绿；
2. 在 GitHub 创建 Release，tag 用 `v<version>`（如 `v2.2.0`）；
3. workflow 校验 tag ≡ manifest 版本 → 打包 zip → 用仓库 secrets `EDGE_CLIENT_ID` / `EDGE_API_KEY` / `EDGE_PRODUCT_ID` 调 Edge Add-ons Update REST API v1.1：上传草稿包 → 轮询 → 提交审核 → 轮询；
4. zip 自动附到 Release；提交进入 Edge 审核队列（审核通过后商店页面更新，用户自动获更新）。

注意：自动化只能**更新已发布的商品**；Chrome Web Store 侧未配置 API 凭据，仍需手动上传同一个 zip。手动触发（workflow_dispatch，默认 dry-run）可预演全流程而不真正调用 Edge API。

## 3. 已知注意点

- 官方 Google Chrome **不允许** `--load-extension` 命令行参数；本地验证请用 `chrome://extensions` → 开发者模式 → 加载已解压的扩展，或改用 Chromium / Edge（`--load-extension` 可用）。
- 内容库服务器地址任意（局域网 IP/自定义域名）靠 **optional_host_permissions + 运行时申请** 实现，审核常对此提问——审核备注中说明“只向用户自己填写的自建服务器发起请求，逐来源、用户手势触发”，并附 `store/permissions.md`。
- `declarativeNetRequestWithHostAccess` 只为两个 CDN 域名（`*.xhscdn.com`、`ci.xiaohongshu.com`）设置 Referer，不拦截请求；规则在运行时对全浏览器生效（仅这两个主机下改写 Referer，不影响其它站点）。如审核追问，附 `extension/rules.json` 链接与 `store/permissions.md` 的说明。
- 首次上架后版本号遵循 semver；更新 zip 时同步 `extension/manifest.json` 的 `version` 与 `package.json`。
- 隐私政策需要公网 URL。可放在仓库内（raw.githubusercontent.com 链接）或 GitHub Pages；提交前先把该 URL 填好。
