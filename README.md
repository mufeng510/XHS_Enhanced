# 小红书网页版增强（浏览器扩展）

一个零运行时依赖的 Chrome / Edge 扩展（Manifest V3），用于在小红书网页版快速识别热门笔记，并可将笔记一键保存到自建的内容库（XHS_ALL_IN_ONE）。

> 本项目曾以 Tampermonkey 油猴脚本形式发布（Greasy Fork），现已全面迁移为浏览器扩展。油猴版本已从仓库移除；**旧脚本、旧说明页与旧单测归档于 [`archive/`](./archive/)**，仅供参考、不再维护，后续可整体删除。

## 功能

- 在搜索结果页、用户主页、首页 feed 中，高亮点赞数**严格大于所设阈值**的笔记卡片；
- **热门阈值配置**（默认 `100`）位于扩展选项页，与内容库配置同一页；保存在扩展本地存储（`chrome.storage.local`），保存后对**所有已打开的小红书页面立即生效**；
- 同时高亮卡片内的点赞数；
- 页面右上角提供“上一条热门笔记 / 下一条热门笔记”悬浮按钮；
- 到达边界时分别滚动到页面底部/顶部并提示，后续动态加载热门笔记后仍可继续跳转；
- **“只显示热门”开关**：开启后，点赞数未达阈值的笔记卡片模糊虚化（鼠标悬浮可暂时看清、卡片按钮仍可用），卡片仍保留占位、不影响布局和懒加载，热门笔记保持清晰高亮；
- **笔记卡片悬浮显示“复制链接”“复制封面”“下载封面”“保存入库”按钮**：
  - 复制链接：写入 `https://www.xiaohongshu.com/explore/<id>?xsec_token=<token>&xsec_source=pc_feed` 格式的分享链接（`xsec_token` 优先取自笔记卡片自身的 `href`，缺失时从页面内联的 `__INITIAL_STATE__` 脚本文本中解析；均无则使用裸链接）；
  - 复制封面：把**无水印**笔记封面图片写入剪贴板（自动去掉 CDN `!nd_*` 等处理后缀；通过扩展后台服务（具有 CDN host 权限）拉取图片字节，不受页面跨域限制；受剪贴板权限限制时给出失败提示）；
  - 下载封面：把**无水印**的笔记封面原图保存到本地磁盘。取图地址优先 `ci.xiaohongshu.com` 原图对象（剥掉 `/{时间戳}/{签名}/` 前缀、保留 `<scene>/<traceId>` 对象键），其次服务端 `?imageView2/format/jpeg` 转码、`sns-img-hw` 镜像，最后回退原有 `sns-webpic` 链；非 JPEG 的原图会经本地 canvas 有损重编码为 JPEG（HEIC 无法解码时保留原字节），下载扩展名按实际字节判定；
  - 四个卡片按钮在**首页 feed、搜索结果页、用户主页**均可用；
- **批量勾选并批量下载笔记图片（封面/内图/全部）**：
  - Feed 卡片右上角复选框勾选笔记；底部批量栏显示“已选 N 篇”，提供“全选已加载”（再点取消）、“连续勾选”（开启后滚动加载的新卡片自动勾选）、“清空”；
  - 下载范围三档：**只封面 / 只内图 / 全部**（保存到扩展本地存储，所有页面一致生效）；
  - 勾选列表在刷新后保留（浏览器会话级）；内图来自详情页 `__INITIAL_STATE__`（后台服务带登录态直拉详情页，失败时退化为后台隐藏标签页复核）；视频笔记没有内图，“只内图”时自动跳过并提示；
  - 文件组织方式可在扩展选项页「批量下载」一栏切换：**按笔记建文件夹（默认）**或**平铺到同一个文件夹**（不分子文件夹，文件名带序号与笔记 ID，如 `001_<笔记id>_01_封面.jpg`）；
  - 一次点击打包下载：输出单个 `XHS笔记_<时间>_<N>篇.zip`（每笔记一个文件夹，封面为 `01_封面.jpg`，内图 `02…`；图片原样或就近 JPEG 重编码；超过 200MB 自动分卷）；
- **商品详情页（`/goods-detail/*`）下载商品高清图**：
  - 页面右侧注入悬浮面板（📷 商品高清图下载）；
  - “扫描图片”一键收集页面中的商品高清图：DOM 渲染图（含 `srcset` 最大候选、懒加载 `data-*`、背景图）+ 整页 HTML 文本中的 CDN URL，自动去重并排除 JS/CSS/字体、头像/表情等修饰图（可手动包含）；
  - 三种高清格式可选：**高清 PNG**（默认，`?imageView2/2/format/png`）/ **原始格式** / **JPEG q90**；
  - **按来源分区命名**：下载时自动识别每张图在页面中的位置，分别命名 `主图_01.png`（swiper 主图轮播）/ `详情图_01.png`（graphic-detail 图文详情区）/ `其它_01.png`（推荐区等无法归属的图），zip 内 info.txt 附分区计数；
  - “下载高清图”打包为单个 `小红书商品高清图_<商品ID>_<时间>_<N>张.zip`（附 `00_商品信息.txt`：标题/链接/ID/时间/格式），超过 200MB 自动分卷；不逐张触发下载，不需要 `downloads` 权限；
- **一键保存到自建内容库（XHS_ALL_IN_ONE）**：
  - 笔记卡片悬浮“保存入库”按钮；
  - 笔记详情视图右上角“保存到内容库”浮动按钮（覆盖 `/explore/<id>`、`/discovery/item/<id>`，以及从搜索结果页/用户主页/首页打开的详情弹窗地址）；
  - 列表页右上角“本页全部入库”按钮（服务端单次上限 50 条，自动分批）；
  - 右下角“⚙ 设置”按钮，打开**扩展选项页**：一页内配置热门阈值和所有内容库设置（服务器地址、用户名、密码），一键“测试连接”并自动发现已绑定的小红书 PC 端账号；首次连接时扩展会申请该服务器来源的访问授权（仅限你填写的地址）。
  - **设置入口**：点击浏览器工具栏上的扩展图标（**左键**）即直接打开设置页（`chrome.action.onClicked`，无需右键）；小红书页面内的“⚙ 设置”也直接跳转到同一页面。
- 自动处理首屏内容、无限滚动新增内容、属性更新和站内 SPA 导航；
- 不展示或推断笔记发布时间。

## 隐私

- 不收集、不上传任何用户数据，无任何统计/遥测；不使用 `cookies`、`tabs`、`webRequest`、`<all_urls>` 权限；
- 笔记链接**只**在你主动点击保存时，发送到你在选项页**自己填写的**内容库服务器；
- 内容库密码与 refresh token 只保存在 `chrome.storage.local`（页面脚本无法读取），且仅用于向你的内容库服务认证；
- 封面图片字节仅从小红书图片 CDN 读取，仅用于复制/下载到本地；
- 扩展不申请 `cookies` 权限；后台请求仅发往小红书 CDN / 你的内容库服务器，并会按浏览器策略携带目标站点的 cookie（Referer 由 declarativeNetRequest 规则改写为小红书域，用于 CDN 防盗链校验）；
- 完整政策见 `store/privacy-policy.md`；权限逐条说明见 `store/permissions.md`。

## 安装

### 方式一：商店安装（审核通过后）

- Chrome：Chrome Web Store 搜索“小红书网页版增强”
- Edge：Edge Add-ons 搜索“小红书网页版增强”

### 方式二：从源码加载（开发/体验）

```bash
npm install
npm run build     # 生成 extension/ 下的 content.js / options.js / background.js
```

然后：

1. Chrome（或 Edge）打开 `chrome://extensions`（Edge 为 `edge://extensions`）；
2. 开启右上角“开发者模式”；
3. 点击“加载已解压的扩展程序”，选择本仓库的 `extension/` 目录；
4. 打开小红书搜索结果页、用户主页、首页 feed 或笔记详情页。

### 从油猴脚本迁移

- 热门阈值、“只显示热门”开关与内容库非敏感配置保存在页面 localStorage 的旧键会在首次运行时**自动迁移**到扩展本地存储，所有已打开的小红书页面即时生效；
- 内容库密码与 refresh token 在油猴脚本存储中、扩展无法读取，**需要重新进入选项页填写密码一次**；
- 建议迁移后移除 Tampermonkey 中的旧脚本，避免重复注入。

## 内容库（XHS_ALL_IN_ONE）配置

前置条件：

1. 已部署 XHS_ALL_IN_ONE（后端默认监听 `8000` 端口），且浏览器可访问该地址（局域网 IP 或域名）；
2. 已在 XHS_ALL_IN_ONE 网页端注册用户，并在“平台账号”里**绑定一个小红书 PC 端账号**（采集依赖该账号的 cookie）。

步骤：

1. 打开小红书任意页面，点击右下角“⚙ 设置”，或扩展详情页 →“扩展选项”；
2. 填写服务器地址（如 `http://192.168.1.10:8000`）、用户名与密码；
3. 点击“测试连接”——扩展会申请对该服务器的访问授权（仅这一次、仅该来源），随后自动登录、拉取已绑定的账号列表并选中 PC 端账号（多个账号可手动选择）；
4. 点击“保存设置”，之后即可用“保存入库 / 保存到内容库 / 本页全部入库”。

说明：

- 保存请求由扩展后台服务发出（你的服务器 CORS 白名单只放行 localhost，页面直接 fetch 会被拦截，扩展后台不受限）；
- access token 过期自动用 refresh token 续期（7 天），失效则用保存的账号密码重新登录；
- 未授权该服务器时，保存类功能给出提示，其余功能不受影响；
- token 过期或失效时刷新页面重新获取即可；
- 保存失败的提示会透传服务端返回的错误信息（最常见原因是绑定账号的 cookie 失效）。

## 匹配范围

- `https://www.xiaohongshu.com/search_result*`
- `https://www.xiaohongshu.com/user/profile/*`
- `https://www.xiaohongshu.com/explore*`（首页 feed 与笔记详情页）
- `https://www.xiaohongshu.com/discovery/item/*`
- `https://www.xiaohongshu.com/goods-detail/*`（商品详情页，仅“商品高清图下载”面板）

## 点赞数规则

- 支持明确的整数、分组整数以及常见的 `万`、`w/W`、`k/K` 缩写；
- 仅当解析结果严格大于用户设置的热门阈值（默认 `100`）时高亮；
- 歧义或无法解析的文本不会高亮；
- 无法确认笔记卡片或点赞控件时会保守跳过，避免误高亮大容器。

## 项目结构

```
extension/            扩展本体（manifest.json + 构建产物，直接可加载）
  icons/              16/32/48/128 图标
  rules.json          declarativeNetRequest 规则（为小红书 CDN 请求设置 Referer）
  options.html|css    扩展选项页（增强设置 + 内容库设置）
src/
  lib/                纯函数库：pure（解析/路由/封面URL）、settings（存储）、remote（后台代理）、
                      library（内容库 API）、cover（封面拉取/转码/剪贴板）、initial-state（__INITIAL_STATE__ 解析）、
                      goods（商品高清图：路由/URL 过滤去重/高清改写/zip 命名）、env、text、selection、zip
  content/index.js    内容脚本入口（高亮/跳转/卡片按钮/批量/观察者/测试 seam）
  content/goods.js    商品详情页悬浮面板（扫描/格式/下载 zip，懒加载自动重扫）
  options/options.js  选项页逻辑
  background/index.js 后台 service worker（特权 fetch 代理 + 隐藏标签页采集）
tests/
  unit/               node:test 单测（vm 加载 extension/content.js 与 extension/background.js）
  browser/            Chrome headless 断言 harness（fixtures + iframe）
  fixtures/           搜索/主页/动态加载页 fixture
scripts/              build.cjs、static-check.cjs、run-browser-tests.{sh,ps1}、
                      package.mjs（打包 dist/*.zip）、edge-publish.cjs（Edge Add-ons 更新 API）
store/                上架素材：listing.md、permissions.md、privacy-policy.md、checklist.md、截图
.github/workflows/    ci.yml（push/PR 构建+测试）、release-edge.yml（发布 Release 自动更新 Edge 商店）
```

## 本地验证

```bash
npm install
npm test                  # = check + test:unit + test:browser（Windows 走 PowerShell）
npm run package           # 产出 dist/xhs-enhanced-extension-v<版本>.zip（商店上传物）
```

Linux / macOS：

```bash
npm run check && npm run test:unit && npm run test:browser:unix
```

浏览器环节默认调用 `scripts/run-browser-tests.sh`（无头 Chrome），加载 `extension/content.js` 与 chrome.* mock，断言高亮/跳转/复制/保存/批量/商品图面板/生命周期行为。

## 自动发布（Edge Add-ons）

创建 **GitHub Release**（tag 形如 `v2.2.0`，需与 `extension/manifest.json` 的 version 一致）后，`release-edge.yml` workflow 会自动：校验版本一致性 → 跑 check 与单测 → 打包 zip → 通过 Edge Add-ons Update REST API v1.1（仓库 secrets `EDGE_CLIENT_ID` / `EDGE_API_KEY` / `EDGE_PRODUCT_ID`）上传草稿扩展并提交审核 → 把 zip 附到 Release。

- 发布=提交 Edge 审核队列，非立即上线；审核通过后用户自动获得更新；
- `workflow_dispatch` 手动触发默认为 dry-run（只校验、不调 Edge API），便于预演；
- Chrome Web Store 侧未配置 API 凭据，更新仍需手动上传同一个 zip（见 `store/checklist.md`）；
- CI（`ci.yml`）在每次 push/PR 时运行构建与全部测试。

## 相关链接

- **GitHub 仓库**：https://github.com/mufeng510/XHS_Enhanced
- 油猴版本（已停止维护）：见仓库 Git 历史与 Greasy Fork 存档

## 许可证

MIT License
